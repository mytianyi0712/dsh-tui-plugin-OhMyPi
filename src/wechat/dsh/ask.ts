// dsh/ask.ts — ask 工具桥：把提问推送到微信，等待回答。
//
// 机制：提问同时推送到微信（数字选选项 / 自由输入）并在终端显示输入框，
// 双通道谁先回答谁生效。微信侧的回答由 core/monitors 在入站时调用
// consumeAskAnswer 消费（优先级高于 @dsh 命令）。

import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { WeixinMessage } from '../core/api.ts'
import type { Account } from '../core/state.ts'
import { loadAccounts } from '../core/state.ts'
import { activePeers, extractText } from '../core/bridge.ts'
import { sendTextToPeer } from '../core/send.ts'
import { getContextToken } from '../core/bridge.ts'
import { log } from '../core/runtime.ts'

/** 挂起的微信 ask：等待该 peer 的下一条消息作为回答。 */
export interface PendingAsk {
  accountId: string
  peer: string
  questions: AskUserQuestionItem[]
  resolve: (answer: AskUserQuestionAnswer | null) => void
}

/** 当前挂起的 ask（同一时刻最多一个；并发 ask 会回退到终端原生实现）。 */
let askPending: PendingAsk | null = null

export function isAskPending(): boolean {
  return askPending !== null
}

export function getPendingAsk(): PendingAsk | null {
  return askPending
}

export function setPendingAsk(pending: PendingAsk): void {
  askPending = pending
}

export function clearPendingAsk(): void {
  askPending = null
}

/** 微信回答映射：单问题时纯数字选择对应选项的 label，其余原样透传。 */
export function mapAskAnswer(raw: string, questions: AskUserQuestionItem[]): AskUserQuestionAnswer {
  const t = raw.trim()
  const answers = questions.map((q) => {
    const selected: string[] = []
    let custom: string | undefined
    if (questions.length === 1 && /^\d+$/.test(t)) {
      const idx = parseInt(t, 10) - 1
      const option = q.options?.[idx]
      if (option) selected.push(option.label)
      else custom = raw
    } else {
      custom = raw
    }
    return {
      id: q.id,
      selected,
      ...(custom !== undefined ? { custom } : {}),
    }
  })
  return { answers }
}

/** 构建微信推送文本并解析推送目标；无可推送目标时返回 null（纯终端提问）。 */
export function buildAskPush(
  questions: AskUserQuestionItem[],
  accounts: Account[],
): { text: string; account: Account; peer: string } | null {
  const account = accounts[0]
  if (!account) return null
  const peer = activePeers.get(account.id)?.userId ?? account.userId
  if (!peer) return null
  const lines: string[] = ['【dsh 提问】']
  questions.forEach((q, qi) => {
    const prefix = questions.length > 1 ? `问题${qi + 1}: ` : ''
    lines.push(`${prefix}${q.question}`)
    q.options?.forEach((opt, oi) => {
      lines.push(`  ${oi + 1}. ${opt.label}`)
    })
  })
  lines.push(
    questions.length === 1
      ? '请回复数字选择，或直接输入你的回答。'
      : '请直接输入你的回答（将作为各问题的答案）。',
  )
  return { text: lines.join('\n'), account, peer }
}

/**
 * 微信入站消息尝试消费为挂起 ask 的回答。
 * 命中（peer 匹配且非空文本）时解析回答并返回 true；否则返回 false。
 */
export async function consumeAskAnswer(acc: Account, msg: WeixinMessage): Promise<boolean> {
  const pending = askPending
  if (!pending || msg.from_user_id !== pending.peer || acc.id !== pending.accountId) {
    return false
  }
  const text = extractText(msg.item_list).trim()
  if (!text) return false
  const mapped = mapAskAnswer(text, pending.questions)
  askPending = null
  pending.resolve(mapped)
  return true
}

/**
 * dsh 版双通道 ask：有微信 peer 时推送到微信，同时调用终端 provider；
 * 谁先回答谁生效。无微信 peer 或已有挂起 ask 时直接走终端。
 */
export async function bridgeAsk(
  request: AskUserQuestionRequest,
  terminalAsk: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>,
): Promise<AskUserQuestionAnswer> {
  const questions = request.questions ?? []
  if (questions.length === 0) {
    throw new Error('ask_user_question requires at least one question')
  }

  // 已有微信 ask 挂起时回退到终端，避免覆盖挂起状态。
  if (isAskPending()) return terminalAsk(request)

  const target = buildAskPush(questions, loadAccounts())
  if (!target) return terminalAsk(request)

  const { promise, resolve } = Promise.withResolvers<AskUserQuestionAnswer | null>()
  let settled = false
  const terminalAbort = new AbortController()
  const settle = (answer: AskUserQuestionAnswer | null): void => {
    if (settled) return
    settled = true
    terminalAbort.abort()
    clearPendingAsk()
    resolve(answer)
  }

  setPendingAsk({
    accountId: target.account.id,
    peer: target.peer,
    questions,
    resolve: settle,
  })

  try {
    await sendTextToPeer(
      target.account,
      target.peer,
      target.text,
      getContextToken(target.account.id, target.peer),
    )
  } catch (err) {
    log(`wechat: ask push failed, terminal-only: ${String(err)}`)
    settle(null)
    return terminalAsk(request)
  }

  // 终端输入与微信回答竞争；微信先答时中止终端弹窗。
  const terminalSignal = request.signal
    ? AbortSignal.any([request.signal, terminalAbort.signal])
    : terminalAbort.signal
  void terminalAsk({ ...request, signal: terminalSignal }).then(settle).catch(() => settle(null))

  const onAbort = () => settle(null)
  request.signal?.addEventListener('abort', onAbort, { once: true })
  const answer = await promise
  request.signal?.removeEventListener('abort', onAbort)
  if (answer === null) {
    throw new Error('Ask input was cancelled')
  }
  return answer
}
