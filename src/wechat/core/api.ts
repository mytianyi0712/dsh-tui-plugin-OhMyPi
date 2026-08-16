// iLink bot-agent protocol client.
// Ported from @tencent-weixin/openclaw-weixin (MIT, Tencent) — wire-compatible.
// Docs: https://github.com/Tencent/openclaw-weixin
// 【职责】腾讯 iLink 官方通道的全部 HTTP 请求（登录/轮询/发送）。

import crypto from 'node:crypto'

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const ILINK_APP_ID = 'bot'
// Channel version we announce to the backend. Kept at the official plugin's
// version so the server applies identical feature flags; observability only.
export const CHANNEL_VERSION = '2.4.6'
// uint32 0x00MMNNPP for 2.4.6
export const CLIENT_VERSION = 132102
export const BOT_AGENT = 'DshWechatIlink/0.1.0'

export const MSG_TYPE_USER = 1
export const MSG_TYPE_BOT = 2
export const MSG_STATE_FINISH = 2
export const ITEM_TEXT = 1
export const ITEM_VOICE = 3
export const TYPING_START = 1
export const TYPING_CANCEL = 2
export const STALE_TOKEN_ERRCODE = -14

const API_TIMEOUT = 15_000
const LIGHT_TIMEOUT = 10_000

export function buildBaseInfo(): { channel_version: string; bot_agent: string } {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT }
}

function randomUin(): string {
  const n = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(n), 'utf-8').toString('base64')
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(CLIENT_VERSION),
  }
}

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomUin(),
    ...commonHeaders(),
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

/**
 * Combine an internal timeout with an optional external abort signal.
 * dsh runs on Node with normal timers, so this is simpler than the OMP
 * embedded-runtime constraint; we keep the same conservative timeouts.
 */
function combineSignals(
  timeoutMs: number | undefined,
  external: AbortSignal | undefined,
): { signal?: AbortSignal; cleanup: () => void } {
  if (timeoutMs == null) return { signal: external, cleanup: () => {} }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  if (!external) {
    return { signal: ctrl.signal, cleanup: () => clearTimeout(t) }
  }
  if (external.aborted) {
    clearTimeout(t)
    ctrl.abort()
    return { signal: ctrl.signal, cleanup: () => {} }
  }
  const onAbort = () => ctrl.abort()
  external.addEventListener('abort', onAbort, { once: true })
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(t)
      external.removeEventListener('abort', onAbort)
    },
  }
}

async function postRaw(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  opts: { token?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const url = new URL(endpoint, ensureSlash(baseUrl))
  const { signal, cleanup } = combineSignals(opts.timeoutMs, opts.signal)
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: authHeaders(opts.token),
      body: JSON.stringify(body),
      signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 200)}`)
    return text
  } finally {
    cleanup()
  }
}

async function getRaw(
  baseUrl: string,
  endpoint: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const url = new URL(endpoint, ensureSlash(baseUrl))
  const { signal, cleanup } = combineSignals(opts.timeoutMs, opts.signal)
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: commonHeaders(),
      signal,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 200)}`)
    return text
  } finally {
    cleanup()
  }
}

/**
 * Long-poll getUpdates. Returns an empty page on abort so the monitor loop can
 * exit cleanly.
 */
export async function getUpdates(params: {
  baseUrl: string
  token?: string
  buf: string
  signal?: AbortSignal
}): Promise<GetUpdatesResp> {
  try {
    const raw = await postRaw(params.baseUrl, 'ilink/bot/getupdates', {
      get_updates_buf: params.buf ?? '',
      base_info: buildBaseInfo(),
    }, {
      token: params.token,
      signal: params.signal,
    })
    return JSON.parse(raw) as GetUpdatesResp
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: params.buf }
    }
    throw err
  }
}

/** Send a single message (already-chunked text). */
export async function sendMessage(
  baseUrl: string,
  token: string | undefined,
  req: SendMessageReq,
): Promise<void> {
  const raw = await postRaw(baseUrl, 'ilink/bot/sendmessage', {
    ...req,
    base_info: buildBaseInfo(),
  }, { token, timeoutMs: API_TIMEOUT })
  const resp = JSON.parse(raw) as SendMessageResp
  if (resp.ret !== undefined && resp.ret !== 0) {
    throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? '(none)'}`)
  }
}

export async function getConfig(
  baseUrl: string,
  token: string | undefined,
  ilinkUserId: string,
  contextToken?: string,
): Promise<GetConfigResp> {
  const raw = await postRaw(baseUrl, 'ilink/bot/getconfig', {
    ilink_user_id: ilinkUserId,
    context_token: contextToken,
    base_info: buildBaseInfo(),
  }, { token, timeoutMs: LIGHT_TIMEOUT })
  return JSON.parse(raw) as GetConfigResp
}

export async function sendTyping(
  baseUrl: string,
  token: string | undefined,
  body: { ilink_user_id: string; typing_ticket: string; status: number },
): Promise<void> {
  await postRaw(baseUrl, 'ilink/bot/sendtyping', {
    ...body,
    base_info: buildBaseInfo(),
  }, { token, timeoutMs: LIGHT_TIMEOUT })
}

export async function notifyStart(
  baseUrl: string,
  token: string | undefined,
): Promise<void> {
  await postRaw(baseUrl, 'ilink/bot/msg/notifystart', {
    base_info: buildBaseInfo(),
  }, { token, timeoutMs: LIGHT_TIMEOUT })
}

export async function notifyStop(
  baseUrl: string,
  token: string | undefined,
): Promise<void> {
  await postRaw(baseUrl, 'ilink/bot/msg/notifystop', {
    base_info: buildBaseInfo(),
  }, { token, timeoutMs: LIGHT_TIMEOUT })
}

// ---------------------------------------------------------------------------
// Login (QR code)
// ---------------------------------------------------------------------------

export async function fetchQrCode(
  localTokenList: string[],
): Promise<{ qrcode: string; qrcode_img_content: string; ret?: number }> {
  const raw = await postRaw(ILINK_BASE_URL, 'ilink/bot/get_bot_qrcode?bot_type=3', {
    local_token_list: localTokenList,
  }, { timeoutMs: 15_000 })
  return JSON.parse(raw) as { qrcode: string; qrcode_img_content: string; ret?: number }
}

export type QrStatus = {
  status:
    | 'wait' | 'scaned' | 'confirmed' | 'expired'
    | 'scaned_but_redirect' | 'need_verifycode'
    | 'verify_code_blocked' | 'binded_redirect'
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}

export async function pollQrStatus(
  baseUrl: string,
  qrcode: string,
  verifyCode?: string,
  timeoutMs?: number,
): Promise<QrStatus> {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
  try {
    const raw = await getRaw(baseUrl, endpoint, { timeoutMs })
    return JSON.parse(raw) as QrStatus
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' }
    }
    // Network blips: keep polling.
    return { status: 'wait' }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextItem { text?: string }
export interface RefMessage { message_item?: MessageItem; title?: string }
export interface MessageItem {
  type?: number
  ref_msg?: RefMessage
  text_item?: TextItem
  voice_item?: { text?: string; [k: string]: unknown }
  image_item?: unknown
  file_item?: unknown
  video_item?: unknown
  [k: string]: unknown
}
export interface WeixinMessage {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  session_id?: string
  message_type?: number
  message_state?: number
  item_list?: MessageItem[]
  context_token?: string
  [k: string]: unknown
}
export interface GetUpdatesResp {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}
export interface SendMessageReq {
  msg: {
    from_user_id?: string
    to_user_id?: string
    client_id?: string
    message_type?: number
    message_state?: number
    item_list?: MessageItem[]
    context_token?: string
  }
}
export interface SendMessageResp { ret?: number; errmsg?: string }
export interface GetConfigResp { ret?: number; errmsg?: string; typing_ticket?: string }
