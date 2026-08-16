// dsh/push.ts — 微信推送：目标解析 + 发送（wechat_send 工具、结果推送、配对确认共用）。
//
// 目标解析规则：
// - 指定 to：按账号 ID + 用户 ID 直发；
// - 未指定：优先最近活跃的微信会话（activePeers），其次账号绑定的扫码用户。

import { loadAccounts, loadAccount, type Account } from '../core/state.ts'
import { activePeers, getContextToken } from '../core/bridge.ts'
import { sendTextToPeer } from '../core/send.ts'
import { log } from '../core/runtime.ts'

/** 推送结果：ok=false 时 error 给调用方展示。 */
export interface PushResult {
  ok: boolean
  error?: string
}

/** 最近活跃的微信会话（账号维度）。 */
export function activePeerOf(accountId: string): { accountId: string; userId: string } | undefined {
  return activePeers.get(accountId)
}

/**
 * 解析推送目标为「账号 + 用户 ID」。
 * 返回 undefined 表示无法确定目标（无账号 / 无活跃会话 / 账号不存在）。
 */
export function resolvePushTarget(
  accountId: string,
  to: string | undefined,
): { account: Account; userId: string } | undefined {
  const accounts = loadAccounts()
  let peer: { accountId: string; userId: string } | undefined
  if (to) {
    const account = accounts.find((a) => a.id === accountId)
    peer = { accountId: accountId ?? account?.id ?? '', userId: to }
  } else {
    // 无目标：优先最近活跃的微信 peer，其次账号绑定的用户（扫码者）。
    // activePeers 是内存态，重启后为空 —— 此时回退到绑定用户。
    const account = accounts[0]
    if (!account) return undefined
    peer =
      activePeers.get(account.id) ??
      (account.userId ? { accountId: account.id, userId: account.userId } : undefined)
  }
  if (!peer?.userId) return undefined
  const acc = loadAccount(peer.accountId)
  if (!acc) return undefined
  return { account: acc, userId: peer.userId }
}

/**
 * 向微信发送文本（自动分段）。失败时返回错误信息而非抛出，
 * 让调用方决定是降级还是静默（推送类调用通常降级为日志）。
 */
export async function sendToPeer(
  accountId: string,
  to: string | undefined,
  text: string,
): Promise<PushResult> {
  const target = resolvePushTarget(accountId, to)
  if (!target) {
    if (loadAccounts().length === 0) {
      return { ok: false, error: '未连接微信账号（运行 /wechat-login）' }
    }
    return {
      ok: false,
      error: '没有活跃的微信会话，请先让用户在微信里发消息，或指定 to 参数。',
    }
  }
  try {
    const n = await sendTextToPeer(
      target.account,
      target.userId,
      text,
      getContextToken(target.account.id, target.userId),
    )
    return { ok: true, error: n > 0 ? undefined : 'empty message' }
  } catch (err) {
    log(`wechat: send failed: ${String(err)}`)
    return { ok: false, error: String(err) }
  }
}
