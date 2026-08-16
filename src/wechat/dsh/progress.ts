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
  getConfig,
  isWechatTurnActive,
  markTurnStarted,
  clearWechatPending,
  consumeWechatTurn,
  getModelRoundCount,
  getAndResetModelRoundCount,
  incrementModelRoundCount,
  log,
} from '../core/runtime.ts'
import { loadAccounts } from '../core/state.ts'
import { activePeers, cancelTyping } from '../core/bridge.ts'
import { getActiveAgent } from './session.ts'
import { sendToPeer } from './push.ts'

/** 注册进度汇报与结果推送钩子（WechatBridge 构造时调用一次）。 */
export function registerProgressHooks(ctx: Context): void {
  // 归属转正：微信消息注入后，下一个 turn/start 把它转正为 wechatTurnActive。
  ctx.on('session/event', (session, event) => {
    const agent = getActiveAgent()
    if (!agent || session.id !== agent.session.id) return
    if (event.type === 'turn/start') {
      markTurnStarted()
    } else if (event.type === 'turn/end') {
      void handleTurnEnd(agent, event)
    }
  })

  // 进度注入：agent/request 瀑布事件，在每次模型请求前检查是否需要汇报。
  ctx.on('agent/request', async (payload, next) => {
    const agent = getActiveAgent()
    if (agent && payload.agent.id === agent.id) {
      const cfg = getConfig()
      const interval = cfg.progress.interval
      if (cfg.progress.enabled && interval > 0 && (isWechatTurnActive() || cfg.notify)) {
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

async function handleTurnEnd(agent: Agent, event: SessionEvent & { type: 'turn/end' }): Promise<void> {
  try {
  // 回合中途到达的微信消息（作为 steer 加入）不拥有本 turn：清掉 pending，
  // 避免下一个 turn 被误标记。
  clearWechatPending()
  const cfg = getConfig()
  if (!isWechatTurnActive() && !cfg.notify) return

  const reason = event.data.reason
  // 真正终局：消费归属，然后报告结果。
  consumeWechatTurn()
  getAndResetModelRoundCount()
  const accounts = loadAccounts()
  if (accounts.length === 0) return
  const account = accounts[0]
  if (!account) return
  const peer =
    activePeers.get(account.id) ??
    (account.userId ? { accountId: account.id, userId: account.userId } : undefined)
  if (!peer) return
  void cancelTyping(account, peer.userId).catch(() => {})
  if (!cfg.progress.enabled) return

  if (reason.kind === 'aborted' || reason.kind === 'error' || reason.kind === 'interrupted') {
    const errorText = reason.kind === 'error' && 'error' in reason && reason.error
      ? typeof reason.error.message === 'string' ? reason.error.message : ''
      : ''
    const text = `❌ 任务执行${reason.kind === 'aborted' ? '中断' : '失败'}${
      errorText ? `：${errorText.slice(0, 300)}` : ''
    }`
    void sendToPeer(account.id, undefined, text).catch((err) => {
      log(`wechat: error push failed: ${String(err)}`)
    })
    return
  }
  if (reason.kind === 'max-tokens') {
    const partial = extractFinalText(agent, event.data.turn)
    void sendToPeer(
      account.id,
      undefined,
      `⚠️ 任务输出被截断${partial ? `（已发送部分内容）\n\n${partial.slice(0, 300)}` : ''}`,
    ).catch((err) => {
      log(`wechat: truncation push failed: ${String(err)}`)
    })
    return
  }
  if (reason.kind !== 'completed') return

  const summary = extractFinalText(agent, event.data.turn)
  if (!summary) return // 空输出：无可报告，保持沉默
  const text = `✅ 任务完成\n\n${summary}`
  void sendToPeer(account.id, undefined, text).catch((err) => {
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
