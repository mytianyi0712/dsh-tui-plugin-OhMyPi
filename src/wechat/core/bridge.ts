// Inbound message handling: extraction, authorization, pairing, steering.
// 【职责】入站消息：提取文本 → 鉴权（配对/白名单）→ 注入 dsh 会话。

import crypto from 'node:crypto'
import {
  getConfig,
  sendTyping,
  MSG_TYPE_USER,
  ITEM_TEXT,
  ITEM_VOICE,
  TYPING_START,
  TYPING_CANCEL,
} from './api.ts'
import type { WeixinMessage, MessageItem } from './api.ts'
import type { Account } from './state.ts'
import {
  loadAllowlist,
  saveAllowlist,
  loadContextTokens,
  saveContextTokens,
} from './state.ts'
import { sendTextToPeer } from './send.ts'

const PAIRING_CODE_TTL_MS = 10 * 60_000
const PAIRING_REPLY_COOLDOWN_MS = 5 * 60_000
const PAIRING_CODE_LEN = 6

export interface BridgeDeps {
  policy: 'pairing' | 'allowlist' | 'open'
  sendUserMessage: (text: string) => Promise<boolean>
  log: (msg: string) => void
}

interface PendingPairing {
  code: string
  userId: string
  accountId: string
  expiresAt: number
}

export interface ActivePeer {
  accountId: string
  userId: string
}

// In-memory: pairing requests + context token cache + per-account active peer.
const pendingPairings = new Map<string, PendingPairing>() // key: accountId:userId
const lastPairingReply = new Map<string, number>()
const contextTokens = new Map<string, string>() // key: accountId:userId
const typingTickets = new Map<string, { ticket: string; at: number }>() // key: accountId:userId
export const activePeers = new Map<string, ActivePeer>() // key: accountId -> last peer

export function restoreContextTokensFor(account: Account): void {
  for (const [userId, token] of Object.entries(loadContextTokens(account.id))) {
    contextTokens.set(`${account.id}:${userId}`, token)
  }
}

export function getContextToken(accountId: string, userId: string): string | undefined {
  return contextTokens.get(`${accountId}:${userId}`)
}

export function setContextToken(accountId: string, userId: string, token: string): void {
  contextTokens.set(`${accountId}:${userId}`, token)
  saveContextTokens(
    accountId,
    Object.fromEntries(
      [...contextTokens.entries()]
        .filter(([k]) => k.startsWith(`${accountId}:`))
        .map(([k, v]) => [k.slice(accountId.length + 1), v]),
    ),
  )
}

export function isAllowed(account: Account, userId: string, policy: string): boolean {
  if (policy === 'open') return true
  if (userId === account.userId) return true
  return loadAllowlist(account.id).includes(userId)
}

export function approvePairing(accountId: string, code: string): string | null {
  const now = Date.now()
  for (const [key, p] of pendingPairings) {
    if (p.accountId !== accountId || p.code !== code) continue
    pendingPairings.delete(key)
    if (p.expiresAt < now) return null
    const list = loadAllowlist(accountId)
    if (!list.includes(p.userId)) {
      list.push(p.userId)
      saveAllowlist(accountId, list)
    }
    return p.userId
  }
  return null
}

export function listAllowlist(accountId: string): string[] {
  return loadAllowlist(accountId)
}

export function allowUser(accountId: string, userId: string): boolean {
  const list = loadAllowlist(accountId)
  if (list.includes(userId)) return false
  list.push(userId)
  saveAllowlist(accountId, list)
  return true
}

export function denyUser(accountId: string, userId: string): boolean {
  const list = loadAllowlist(accountId)
  const next = list.filter((u) => u !== userId)
  if (next.length === list.length) return false
  saveAllowlist(accountId, next)
  return true
}

/** Extract plain text from an inbound item list (text items, quote refs, voice text). */
export function extractText(itemList: MessageItem[] | undefined): string {
  if (!itemList?.length) return ''
  for (const item of itemList) {
    if (item.type === ITEM_TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text)
      const ref = item.ref_msg
      if (!ref) return text
      if (ref.message_item && isMedia(ref.message_item)) return text
      const parts: string[] = []
      if (ref.title) parts.push(ref.title)
      if (ref.message_item) {
        const refBody = extractText([ref.message_item])
        if (refBody) parts.push(refBody)
      }
      if (!parts.length) return text
      return `[引用: ${parts.join(' | ')}]\n${text}`
    }
    if (item.type === ITEM_VOICE && item.voice_item?.text) {
      return item.voice_item.text
    }
  }
  return ''
}

function isMedia(item: MessageItem): boolean {
  return item.type !== undefined && item.type >= 2 && item.type <= 5
}

function hasMediaOnly(itemList: MessageItem[] | undefined): boolean {
  return !!itemList?.some((i) => isMedia(i) && !(i.type === ITEM_VOICE && i.voice_item?.text))
}

function genPairingCode(): string {
  const n = crypto.randomInt(0, 10 ** PAIRING_CODE_LEN)
  return String(n).padStart(PAIRING_CODE_LEN, '0')
}

/** Main inbound handler invoked by the monitor. */
export async function handleInbound(
  deps: BridgeDeps,
  account: Account,
  msg: WeixinMessage,
): Promise<void> {
  if (msg.message_type !== MSG_TYPE_USER) return // bot echoes
  const userId = msg.from_user_id ?? ''
  if (!userId) return

  const text = extractText(msg.item_list)
  if (!text && !hasMediaOnly(msg.item_list)) return

  if (msg.context_token) setContextToken(account.id, userId, msg.context_token)
  const ctxToken = getContextToken(account.id, userId)
  const peerKey = `${account.id}:${userId}`

  // Authorization.
  if (!isAllowed(account, userId, deps.policy)) {
    if (deps.policy !== 'pairing') {
      deps.log(`wechat: dropped message from unauthorized ${userId} (policy=${deps.policy})`)
      return
    }
    await handlePairingReply(deps, account, userId, ctxToken)
    return
  }

  activePeers.set(account.id, { accountId: account.id, userId })

  // Typing indicator (best-effort).
  void signalTyping(account, userId, TYPING_START).catch(() => {})

  // Inject the message into the session as-is (no prefix), then confirm
  // receipt to the WeChat user. On success this notice tells the user the
  // task has started (independent of the progress-reporting switch); on
  // failure we say the message was not injected instead of claiming a start.
  const body = text || '(媒体消息，暂不支持解析)'
  deps.log(`wechat: steering inbound from ${userId}`)
  let queued = false
  try {
    queued = await deps.sendUserMessage(body)
  } catch (err) {
    deps.log(`wechat: sendUserMessage failed: ${String(err)}`)
  }
  try {
    await sendTextToPeer(
      account,
      userId,
      queued
        ? '任务进行中...'
        : '⚠️ 当前没有可用的 dsh 会话，消息未注入。请先在终端打开 dsh 会话。',
      getContextToken(account.id, userId),
    )
  } catch (err) {
    deps.log(`wechat: in-progress notice failed: ${String(err)}`)
  }
}

async function handlePairingReply(
  deps: BridgeDeps,
  account: Account,
  userId: string,
  ctxToken: string | undefined,
): Promise<void> {
  const key = `${account.id}:${userId}`
  const now = Date.now()
  const last = lastPairingReply.get(key) ?? 0
  if (now - last < PAIRING_REPLY_COOLDOWN_MS) return

  let pending = pendingPairings.get(key)
  if (!pending || pending.expiresAt < now) {
    pending = {
      code: genPairingCode(),
      userId,
      accountId: account.id,
      expiresAt: now + PAIRING_CODE_TTL_MS,
    }
    pendingPairings.set(key, pending)
  }
  lastPairingReply.set(key, now)

  try {
    await sendTextToPeer(
      account,
      userId,
      `【dsh 微信桥】你的配对码：${pending.code}（10 分钟内有效）。\n请在 dsh 终端运行 /wechat-pair ${pending.code} 完成授权。`,
      ctxToken,
    )
  } catch (err) {
    deps.log(`wechat: pairing reply failed: ${String(err)}`)
  }
}

async function signalTyping(
  account: Account,
  userId: string,
  status: number,
): Promise<void> {
  const key = `${account.id}:${userId}`
  let cached = typingTickets.get(key)
  if (!cached || Date.now() - cached.at > 60 * 60_000) {
    const cfg = await getConfig(account.baseUrl, account.token, userId)
    if (!cfg.typing_ticket) return
    cached = { ticket: cfg.typing_ticket, at: Date.now() }
    typingTickets.set(key, cached)
  }
  await sendTyping(account.baseUrl, account.token, {
    ilink_user_id: userId,
    typing_ticket: cached.ticket,
    status,
  })
}

/** Cancel typing for a peer (needs account to reach the API). */
export async function cancelTyping(account: Account, userId: string): Promise<void> {
  try {
    await signalTyping(account, userId, TYPING_CANCEL)
  } catch {
    // ignore
  }
}
