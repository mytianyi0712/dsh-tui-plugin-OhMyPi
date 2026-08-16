// QR login flow (ported from openclaw-weixin/src/auth/login-qr.ts).
// 【职责】扫码登录状态机（二维码 → 轮询 → token 落盘）。

import {
  ILINK_BASE_URL,
  fetchQrCode,
  pollQrStatus,
} from './api.ts'
import { loadAccounts } from './state.ts'

const QR_TTL_MS = 5 * 60_000
const MAX_QR_REFRESH = 3
const QR_POLL_TIMEOUT_MS = 15_000

/**
 * Anchor fetch: a fast RESOLVING request that re-arms the timer horizon.
 * This was needed by the OMP embedded runtime; dsh runs on Node with normal
 * timers, so this is kept only as a harmless compatibility shim.
 */
async function anchorFetch(): Promise<void> {
  try {
    await fetch(`${ILINK_BASE_URL}/`).then((r) => r.text())
  } catch {
    // Non-fatal.
  }
}

interface ActiveLogin {
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  currentBaseUrl: string
  pendingVerifyCode?: string
}

const activeLogins = new Map<string, ActiveLogin>()

export interface LoginStartResult {
  ok: boolean
  sessionKey: string
  qrcodeUrl?: string
  message: string
}

export interface LoginWaitResult {
  connected: boolean
  alreadyConnected?: boolean
  botToken?: string
  accountId?: string
  baseUrl?: string
  userId?: string
  message: string
}

/** Fetch a fresh QR code and register a polling session. */
export async function startLogin(force: boolean): Promise<LoginStartResult> {
  const sessionKey = 'default'
  const existing = activeLogins.get(sessionKey)
  if (!force && existing && Date.now() - existing.startedAt < QR_TTL_MS) {
    return {
      ok: true,
      sessionKey,
      qrcodeUrl: existing.qrcodeUrl,
      message: '二维码已显示，请用手机微信扫描。',
    }
  }
  try {
    const localTokens = loadAccounts()
      .map((a) => a.token.trim())
      .filter(Boolean)
      .slice(-10)
    const resp = await fetchQrCode(localTokens)
    if (resp.ret !== undefined && resp.ret !== 0) {
      return { ok: false, sessionKey, message: `get_bot_qrcode ret=${resp.ret}` }
    }
    activeLogins.set(sessionKey, {
      qrcode: resp.qrcode,
      qrcodeUrl: resp.qrcode_img_content,
      startedAt: Date.now(),
      currentBaseUrl: ILINK_BASE_URL,
    })
    return {
      ok: true,
      sessionKey,
      qrcodeUrl: resp.qrcode_img_content,
      message: '二维码已生成，用手机微信扫描以连接。',
    }
  } catch (err) {
    return { ok: false, sessionKey, message: `登录失败: ${String(err)}` }
  }
}

/**
 * Poll QR status until confirmed/timeout.
 * `promptVerifyCode` is called when the server asks for the on-screen number;
 * return null to abort. `onRefresh` is called with the new QR URL when the
 * server expires the code (max 3 refreshes).
 */
export async function waitLogin(opts: {
  sessionKey: string
  timeoutMs?: number
  promptVerifyCode: (attempt: number) => Promise<string | null>
  onRefresh?: (qrcodeUrl: string) => void
  log: (msg: string) => void
}): Promise<LoginWaitResult> {
  const { sessionKey, promptVerifyCode, onRefresh, log } = opts
  let login = activeLogins.get(sessionKey)
  if (!login) {
    return { connected: false, message: '当前没有进行中的登录，请先运行 /wechat-login。' }
  }
  if (Date.now() - login.startedAt >= QR_TTL_MS) {
    activeLogins.delete(sessionKey)
    return { connected: false, message: '二维码已过期，请重新生成。' }
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000)
  const deadline = Date.now() + timeoutMs
  let verifyAttempt = 0
  let qrRefreshCount = 0

  while (Date.now() < deadline) {
    await anchorFetch()
    const status = await pollQrStatus(login.currentBaseUrl, login.qrcode, login.pendingVerifyCode, QR_POLL_TIMEOUT_MS)
    switch (status.status) {
      case 'wait':
        break
      case 'scaned':
        login.pendingVerifyCode = undefined
        break
      case 'need_verifycode': {
        verifyAttempt += 1
        const code = await promptVerifyCode(verifyAttempt)
        if (code === null) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: '登录已取消。' }
        }
        login.pendingVerifyCode = code
        continue
      }
      case 'expired':
      case 'verify_code_blocked': {
        qrRefreshCount += 1
        if (qrRefreshCount > MAX_QR_REFRESH) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: '二维码多次失效，请稍后再试。' }
        }
        try {
          const resp = await fetchQrCode(loadAccounts().map((a) => a.token).filter(Boolean).slice(-10))
          login.qrcode = resp.qrcode
          login.qrcodeUrl = resp.qrcode_img_content
          login.startedAt = Date.now()
          login.pendingVerifyCode = undefined
          onRefresh?.(resp.qrcode_img_content)
        } catch (err) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: `刷新二维码失败: ${String(err)}` }
        }
        break
      }
      case 'binded_redirect':
        activeLogins.delete(sessionKey)
        return {
          connected: false,
          alreadyConnected: true,
          message: '该微信已连接过此实例，无需重复连接。',
        }
      case 'scaned_but_redirect':
        if (status.redirect_host) {
          login.currentBaseUrl = `https://${status.redirect_host}`
          log(`wechat login: switched polling host to ${status.redirect_host}`)
        }
        break
      case 'confirmed': {
        if (!status.ilink_bot_id) {
          activeLogins.delete(sessionKey)
          return { connected: false, message: '登录失败：服务器未返回 ilink_bot_id。' }
        }
        activeLogins.delete(sessionKey)
        return {
          connected: true,
          botToken: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: status.baseurl || ILINK_BASE_URL,
          userId: status.ilink_user_id,
          message: '已连接微信。',
        }
      }
    }
    await sleep(1000)
  }

  activeLogins.delete(sessionKey)
  return { connected: false, message: '登录超时，请重试。' }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}
