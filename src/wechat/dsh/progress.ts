// dsh/progress.ts — 进度汇报与结果推送（微信任务的全生命周期通知）。
//
// dsh 事件映射：
// - session/event turn/start：把微信 pending 归属"转正"（跨模型回合保持）；
// - agent/request：每模型请求触发一次，按 interval 注入一条 steer 让模型自查进度；
// - session/event turn/end：回合真正结束时向微信推送结果/失败/截断。

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  clearWechatPending,
  consumeWechatTurn,
  getConfig,
  getAndResetModelRoundCount,
  getModelRoundCount,
  getWechatTurn,
  incrementModelRoundCount,
  isWechatWorkTurnActive,
  log,
  markTurnStarted,
  type WechatTask,
} from '../core/runtime.ts'
import { loadAccount, loadAccounts } from '../core/state.ts'
import { activePeers, cancelTyping } from '../core/bridge.ts'
import { getActiveAgent } from './session.ts'
import { chunkText, readyChunkText } from '../core/send.ts'
import { sendToPeer } from './push.ts'
const CHAT_FLUSH_INTERVAL_MS = 500

interface ChatStream {
  task: WechatTask
  turn: number
  text: string
  timer: NodeJS.Timeout | undefined
  sends: Promise<void>
}

let chatStream: ChatStream | undefined


/** 注册进度汇报与结果推送钩子（WechatBridge 构造时调用一次）。 */
export function registerProgressHooks(ctx: Context): void {
  // 归属转正：微信消息注入后，下一个 turn/start 把它转正为 wechatTurnActive。
  ctx.on('session/event', (session, event) => {
    const agent = getActiveAgent()
    if (!agent || session.id !== agent.session.id) return
    if (event.type === 'turn/start') {
      markTurnStarted()
      return
    }
    if (event.type === 'assistant/chunk') {
      const task = getWechatTurn()
      if (task?.mode === 'chat' && event.data.chunk.type === 'text-delta') {
        queueChatText(task, event.data.turn, event.data.chunk.text)
      }
      return
    }
    if (event.type === 'turn/end') void handleTurnEnd(agent, event)
  })

  // 进度注入：只对微信 work 任务（及显式开启通知的终端任务）生效。
  ctx.on('agent/request', async (payload, next) => {
    const agent = getActiveAgent()
    if (agent && payload.agent.id === agent.id) {
      const cfg = getConfig()
      const interval = cfg.progress.interval
      const terminalNotifications = getWechatTurn() === undefined && cfg.notify
      if (cfg.progress.enabled && interval > 0 && (isWechatWorkTurnActive() || terminalNotifications)) {
        incrementModelRoundCount()
        if (getModelRoundCount() >= interval) {
          getAndResetModelRoundCount()
          try {
            agent.steer(createUserMessage({
              content: [{
                type: 'text',
                text: '任务进行中。请回顾当前任务目标，检查并更新 todo list（如有变化），' +
                  '然后用 wechat_send 工具向微信用户简要汇报当前进度，之后继续原任务。',
              }],
              source: {
                kind: 'plugin',
                plugin: 'dsh-wechat-ilink',
                form: 'notice',
                summary: '微信进度汇报',
              },
            }))
          } catch (err) {
            log(`wechat: progress inject failed: ${String(err)}`)
          }
        }
      }
    }
    return next()
  })
}

/** Queue visible chat text and preserve order across asynchronous WeChat sends. */
function queueChatText(task: WechatTask, turn: number, text: string) {
  if (!text) return
  let stream = chatStream
  if (stream === undefined || stream.task !== task || stream.turn !== turn) {
    if (stream !== undefined) flushChatStream(stream, false)
    stream = { task, turn, text: '', timer: undefined, sends: Promise.resolve() }
    chatStream = stream
  }
  stream.text += text
  if (stream.timer === undefined) {
    stream.timer = setTimeout(() => flushChatStream(stream, false), CHAT_FLUSH_INTERVAL_MS)
  }
}

/** Send only complete sentence/Markdown segments; retain the unfinished tail. */
function flushChatStream(stream: ChatStream, force: boolean) {
  if (stream.timer !== undefined) {
    clearTimeout(stream.timer)
    stream.timer = undefined
  }
  const ready = force
    ? { chunks: stream.text ? chunkText(stream.text) : [], remainder: '' }
    : readyChunkText(stream.text)
  stream.text = ready.remainder
  for (const text of ready.chunks) {
    stream.sends = stream.sends.then(async () => {
      const { accountId, userId } = stream.task
      if (!accountId || !userId) {
        log('wechat: chat stream has no reply target')
        return
      }
      try {
        const result = await sendToPeer(accountId, userId, text)
        if (!result.ok) log(`wechat: chat stream send failed: ${result.error ?? 'unknown error'}`)
      } catch (err) {
        log(`wechat: chat stream send failed: ${String(err)}`)
      }
    })
  }
}

/** Flush and await the active chat stream that belongs to a completed turn. */
async function finishChatStream(task: WechatTask, turn: number) {
  const stream = chatStream
  if (stream === undefined || stream.task !== task || stream.turn !== turn) return false
  flushChatStream(stream, true)
  chatStream = undefined
  await stream.sends
  return true
}

async function handleTurnEnd(agent: Agent, event: SessionEvent & { type: 'turn/end' }): Promise<void> {
  try {
    // 回合中途到达的微信消息（作为 steer 加入）不拥有本 turn：清掉 pending，
    // 避免下一个 turn 被误标记。
    clearWechatPending()
    const task = consumeWechatTurn()
    const cfg = getConfig()
    if (!task && !cfg.notify) return

    const reason = event.data.reason
    getAndResetModelRoundCount()
    const account = task?.accountId ? loadAccount(task.accountId) : loadAccounts()[0]
    if (!account) return
    const userId = task?.userId ?? activePeers.get(account.id)?.userId ?? account.userId
    if (!userId) return
    void cancelTyping(account, userId).catch(() => {})

    if (task?.mode === 'chat') {
      const streamed = await finishChatStream(task, event.data.turn)
      if (reason.kind === 'completed') {
        if (!streamed) {
          const summary = extractFinalText(agent, event.data.turn)
          if (summary) void sendToPeer(account.id, userId, summary)
        }
        return
      }
    }

    if (reason.kind === 'aborted' || reason.kind === 'error' || reason.kind === 'interrupted') {
      const errorText = reason.kind === 'error' && 'error' in reason && reason.error
        ? typeof reason.error.message === 'string' ? reason.error.message : ''
        : ''
      const text = `❌ 任务执行${reason.kind === 'aborted' ? '中断' : '失败'}${
        errorText ? `：${errorText.slice(0, 300)}` : ''
      }`
      void sendToPeer(account.id, userId, text).catch((err) => {
        log(`wechat: error push failed: ${String(err)}`)
      })
      return
    }
    if (reason.kind === 'max-tokens') {
      const partial = task?.mode === 'chat' ? '' : extractFinalText(agent, event.data.turn)
      void sendToPeer(
        account.id,
        userId,
        `⚠️ 任务输出被截断${partial ? `（已发送部分内容）\n\n${partial.slice(0, 300)}` : ''}`,
      ).catch((err) => {
        log(`wechat: truncation push failed: ${String(err)}`)
      })
      return
    }
    if (reason.kind !== 'completed') return

    const summary = extractFinalText(agent, event.data.turn)
    if (!summary) return
    void sendToPeer(account.id, userId, `✅ 任务完成\n\n${summary}`).catch((err) => {
      log(`wechat: result push failed: ${String(err)}`)
    })
  } catch (err) {
    log(`wechat: turn end handling failed: ${String(err)}`)
  }
}

/** 提取某个 turn 内最后一条 assistant/message 的全部文本块（thinking 排除）。 */
function extractFinalText(agent: Agent, turn: number): string {
  let text = ''
  for (const event of agent.session.events) {
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    const parts: string[] = []
    for (const block of event.data.message.content) {
      if (block.type === 'text' && block.text.trim()) {
        parts.push(block.text.trim())
      }
    }
    if (parts.length > 0) text = parts.join('\n\n')
  }
  return text
}
