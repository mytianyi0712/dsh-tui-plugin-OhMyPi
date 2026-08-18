// dsh-wechat-ilink 插件入口：把 OMP 的微信桥迁移到 DeepSeek Harness (dsh)。
//
// 装配：
//   1) 注册 /wechat-* 斜杠命令与 @dsh 快捷命令；
//   2) 注册模型工具 wechat_send / wechat_status；
//   3) 注册进度汇报与结果推送钩子；
//   4) 管理 getUpdates 接收锁与账号 Monitor；
//   5) 向 TUI 暴露 askWithFallback，使 ask_user_question 可同步推送到微信。

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { WeixinMessage } from './core/api.ts'
import { loadAccounts, type Account, type BridgeConfig } from './core/state.ts'
import {
  reloadConfig,
  getConfig,
  setConfig,
  markWechatPending,
  clearWechatPending,
  setReceiverHeld,
  isReceiverHeld,
  log,
  setOutputSink,
  writeOutputToStderr,
  type WechatOutputMessage,
  type WechatOutputListener,
} from './core/runtime.ts'
import {
  tryAcquireReceiverLock,
  releaseReceiverLock,
  receiverHolderPid,
} from './core/receiver-lock.ts'
import { startMonitor, stopMonitors, type MonitorHooks } from './core/monitors.ts'
import { registerDshCommands, handleDshMessage } from './dsh/commands.ts'
import { registerWechatCommands } from './dsh/wechat-commands.ts'
import { registerWechatTools } from './dsh/tools.ts'
import { registerProgressHooks } from './dsh/progress.ts'
import { bridgeAsk, consumeAskAnswer } from './dsh/ask.ts'
import { setActiveAgent, getActiveAgent } from './dsh/session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    wechat: WechatBridge
  }
}

export type { WechatOutputMessage, WechatOutputListener, BridgeConfig }

/** TUI 尚未订阅时缓冲的最大条数，避免无 TUI 场景下无限增长。 */
const OUTPUT_BUFFER_LIMIT = 500

export class WechatBridge extends Service {
  static inject = ['agents', 'commands', 'tools', 'userQuestions', 'llm', 'agentDefaultModel', 'skills']

  private readonly outputBuffer: WechatOutputMessage[] = []
  private readonly outputListeners = new Set<WechatOutputListener>()

  constructor(ctx: Context) {
    super(ctx, 'wechat')
    // 后续所有 log/二维码都走输出通道：TUI 未就绪时回退 stderr，
    // TUI 就绪后只进缓冲等待订阅，避免 stderr 覆盖输入框。
    setOutputSink(message => this.publishOutput(message))
    reloadConfig()

    // 多进程接收互斥：只有持有锁的进程长轮询，其他进程仅发送。
    setReceiverHeld(tryAcquireReceiverLock())
    log(`receiver lock: ${isReceiverHeld() ? 'acquired' : `held by pid ${receiverHolderPid()}`}`)

    // 命令 / 工具 / 进度钩子。
    registerDshCommands(ctx)
    registerWechatCommands(ctx, {
      onLoginSuccess: (account) => {
        startMonitor(account, this.buildMonitorHooks(ctx))
      },
    })
    registerWechatTools(ctx)
    registerProgressHooks(ctx)

    // 跟踪活动 agent：TUI 前台优先；无 TUI 时回退到第一个 root。
    const pickRoot = (): Agent | undefined => {
      const roots = ctx.agents.roots()
      return roots[0] ?? ctx.agents.list()[0]
    }
    const existing = pickRoot()
    if (existing !== undefined) setActiveAgent(existing)
    ctx.on('agent/created', ({ agent }) => {
      if (getActiveAgent() === undefined) setActiveAgent(agent)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      if (getActiveAgent()?.id !== agent.id) return
      // 指针始终跟随前台会话：优先问 TUI，无 TUI 时再回退到存活的首个 agent。
      setActiveAgent(this.foregroundAgentFromTui() ?? pickRoot())
    })

    // 启动已保存账号的接收 Monitor。
    for (const account of loadAccounts()) {
      startMonitor(account, this.buildMonitorHooks(ctx))
    }

    ctx.effect(() => () => {
      stopMonitors()
      if (isReceiverHeld()) {
        releaseReceiverLock()
        setReceiverHeld(false)
      }
      setOutputSink(undefined)
    })
  }

  /**
   * 订阅微信桥的终端输出。TUI 在 mount 时调用；订阅前产生的日志/二维码会
   * 从缓冲按序回放，订阅后实时推送。返回取消订阅函数。
   */
  subscribeOutput(listener: WechatOutputListener): () => void {
    this.outputListeners.add(listener)
    const backlog = this.outputBuffer.splice(0)
    for (const message of backlog) {
      try {
        listener(message)
      } catch {
        // 订阅者渲染失败不应影响微信桥。
      }
    }
    return () => {
      this.outputListeners.delete(listener)
    }
  }

  /**
   * 输出发布策略：有订阅者直接推送；没有订阅者时先进缓冲。只有 TUI 尚未
   * 就绪时才同步回退 stderr —— 此时终端还没有差分渲染器，不会覆盖输入框。
   */
  private publishOutput(message: WechatOutputMessage): void {
    if (this.outputListeners.size > 0) {
      for (const listener of this.outputListeners) {
        try {
          listener(message)
        } catch {
          // 订阅者渲染失败不应影响微信桥。
        }
      }
      return
    }
    this.outputBuffer.push(message)
    if (this.outputBuffer.length > OUTPUT_BUFFER_LIMIT) this.outputBuffer.shift()
    if (!this.hasTui()) writeOutputToStderr(message)
  }

  private hasTui(): boolean {
    try {
      return this.ctx.get('tui') !== undefined
    } catch {
      return false
    }
  }

  /**
   * 供 TUI 的 userQuestions provider 调用：有微信会话时推送到微信并与终端
   * 输入竞争，否则直接走终端。
   */
  async askWithFallback(
    request: AskUserQuestionRequest,
    terminalAsk: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>,
  ): Promise<AskUserQuestionAnswer> {
    return bridgeAsk(request, terminalAsk)
  }

  /** 读取微信桥配置（policy / progress / notify）。 */
  getBridgeConfig(): BridgeConfig {
    return getConfig()
  }

  /** 更新微信桥配置并持久化到 config.json。 */
  setBridgeConfig(next: BridgeConfig): void {
    setConfig(next)
  }

  /**
   * Resolve the agent that should receive ordinary WeChat messages.
   * 会话指针始终跟随 TUI 前台会话：先问 TUI，其次才回退到活动指针 /
   * 存活的首个 root（无 TUI 或 TUI 尚未挂载时）。
   */
  private resolveLiveAgent(ctx: Context): Agent | undefined {
    const foreground = this.foregroundAgentFromTui()
    if (foreground !== undefined && ctx.agents.get(foreground.id) === foreground) {
      if (getActiveAgent() !== foreground) setActiveAgent(foreground)
      return foreground
    }
    const active = getActiveAgent()
    if (active !== undefined && ctx.agents.get(active.id) === active) return active
    const fallback = ctx.agents.roots()[0] ?? ctx.agents.list()[0]
    if (fallback !== undefined) setActiveAgent(fallback)
    return fallback
  }

  /** 从 TUI 服务读取前台会话；TUI 不存在或未挂载时返回 undefined。 */
  private foregroundAgentFromTui(): Agent | undefined {
    try {
      const tui = this.ctx.get('tui') as { foregroundAgent?: () => Agent | undefined } | undefined
      if (typeof tui?.foregroundAgent === 'function') return tui.foregroundAgent()
    } catch {
      // TUI 未注册/不可用：走无 TUI 回退。
    }
    return undefined
  }

  private buildMonitorHooks(ctx: Context): MonitorHooks {
    return {
      policy: () => getConfig().policy,
      log,
      sendUserMessage: async (text: string) => {
        const agent = this.resolveLiveAgent(ctx)
        if (!agent) {
          clearWechatPending()
          log('wechat: no active agent, inbound message dropped')
          return false
        }
        try {
          markWechatPending()
          agent.steer(createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          }))
          return true
        } catch (err) {
          clearWechatPending()
          log(`wechat: steer inbound message failed: ${String(err)}`)
          return false
        }
      },
      consumeAskAnswer: async (acc: Account, msg: WeixinMessage) => consumeAskAnswer(acc, msg),
      handleOmpCommand: async (acc: Account, msg: WeixinMessage, text: string) => {
        await handleDshMessage(ctx, acc, msg.from_user_id ?? '', text)
        return true
      },
    }
  }
}

export default WechatBridge
