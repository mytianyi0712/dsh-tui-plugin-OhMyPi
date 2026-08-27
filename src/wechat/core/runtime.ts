// 进程内运行态：所有模块共享的可变状态与日志助手。
//
// 本模块是插件各层（core / dsh / command）之间的"状态总线"：
// - cfg：微信桥配置（config.json）的内存态 + 持久化
// - 运行归属标志：当前模型回合是否由微信消息发起（决定进度汇报/结果推送）
// - receiverHeld：本进程是否持有 getUpdates 独占接收锁
// - outputSink：日志/二维码的 TUI 输出通道（避免 stderr 越过差分渲染器覆盖输入框）
//
// 设计约束：只读写状态，不持有任何 dsh 扩展 API 引用，避免循环依赖。

import { loadConfig, saveConfig, type BridgeConfig, DEFAULT_CONFIG } from './state.ts'
export type WechatTaskMode = 'chat' | 'work'

/** 微信发起任务的回传策略与可选目标。 */
export interface WechatTask {
  readonly mode: WechatTaskMode
  readonly accountId?: string
  readonly userId?: string
}

const DEFAULT_WECHAT_TASK: WechatTask = { mode: 'work' }

/** 微信普通消息的当前回传模式；由 @dsh chat / @dsh work 切换。 */
let wechatMode: WechatTaskMode = 'work'


/** 微信桥配置内存态（config.json）。所有读写都走 get/set，禁止直接赋值。 */
let cfg: BridgeConfig = DEFAULT_CONFIG

/** 当前由微信发起的任务；chat 流式回传，work 在 turn/end 回传结果。 */
let wechatTurn: WechatTask | undefined

/** 刚收到一条微信任务，下一次启动的 turn 继承其回传策略。 */
let wechatPending: WechatTask | undefined

/** 自上次进度汇报以来经过的模型回合数（agent/request 计数）。 */
let modelRoundCount = 0

/** 本进程是否持有 getUpdates 独占接收锁（多 dsh 进程互斥，未持有则仅发送）。 */
let receiverHeld = false


/** 读取当前配置。 */
export function getConfig(): BridgeConfig {
  return cfg
}

/** 更新内存配置并立即持久化到 config.json。 */
export function setConfig(next: BridgeConfig): void {
  cfg = next
  try {
    saveConfig(next)
  } catch (err) {
    log(`saveConfig failed: ${String(err)}`)
  }
}

/** 从磁盘重新加载配置（服务启动时调用）。 */
export function reloadConfig(): BridgeConfig {
  try {
    cfg = loadConfig()
  } catch (err) {
    log(`loadConfig failed, keeping defaults: ${String(err)}`)
    cfg = DEFAULT_CONFIG
  }
  return cfg
}

/** 返回微信普通消息当前使用的回传模式。 */
export function getWechatMode(): WechatTaskMode {
  return wechatMode
}

/** 切换后续普通微信消息的回传模式。 */
export function setWechatMode(mode: WechatTaskMode): void {
  wechatMode = mode
}

/** 当前活跃微信任务；未由微信触发时返回 undefined。 */
export function getWechatTurn(): WechatTask | undefined {
  return wechatTurn
}

export function isWechatTurnActive(): boolean {
  return wechatTurn !== undefined
}

/** 仅 work 任务允许周期性进度汇报。 */
export function isWechatWorkTurnActive(): boolean {
  return wechatTurn?.mode === 'work'
}

/** turn/start 时调用：把待处理微信任务转为当前 turn 的回传策略。 */
export function markTurnStarted(): void {
  if (wechatTurn === undefined && wechatPending !== undefined) {
    wechatTurn = wechatPending
  }
  wechatPending = undefined
}

/** 微信消息到达时标记下一个 turn 的回传策略；普通消息默认 work。 */
export function markWechatPending(task: WechatTask = DEFAULT_WECHAT_TASK): void {
  wechatPending = task
}

/** turn/end：清掉 pending，避免下一个终端发起的 turn 被误标记。 */
export function clearWechatPending(): void {
  wechatPending = undefined
}

/** 消费当前微信任务的归属与回传策略。 */
export function consumeWechatTurn(): WechatTask | undefined {
  const task = wechatTurn
  wechatTurn = undefined
  return task
}


export function getModelRoundCount(): number {
  return modelRoundCount
}

export function getAndResetModelRoundCount(): number {
  const n = modelRoundCount
  modelRoundCount = 0
  return n
}

export function incrementModelRoundCount(): void {
  modelRoundCount += 1
}

export function isReceiverHeld(): boolean {
  return receiverHeld
}

export function setReceiverHeld(held: boolean): void {
  receiverHeld = held
}

/** 微信桥发往 TUI 的持久化输出类型。 */
export type WechatOutputKind = 'log' | 'qr' | 'error' | 'status'

export interface WechatOutputMessage {
  readonly kind: WechatOutputKind
  readonly text: string
}

export type WechatOutputSink = (message: WechatOutputMessage) => void
export type WechatOutputListener = (message: WechatOutputMessage) => void

/** TUI 输出订阅。WechatBridge 构造时安装，TUI mount 后订阅并回放缓冲。 */
let outputSink: WechatOutputSink | undefined

export function setOutputSink(sink: WechatOutputSink | undefined): void {
  outputSink = sink
}

/**
 * 发布一条微信桥输出：有 TUI sink 时走 TUI 订阅/缓冲（不会越过差分渲染器
 * 覆盖输入框）；没有 sink（无 TUI 场景）时回退到 stderr。
 */
export function publishOutput(message: WechatOutputMessage): void {
  if (outputSink !== undefined) {
    try {
      outputSink(message)
    } catch {
      // 输出失败可忽略，不能反过来打断微信桥业务。
    }
    return
  }
  writeOutputToStderr(message)
}

/** 无 TUI sink 时的 stderr 回退，保持与旧版日志格式一致。 */
export function writeOutputToStderr(message: WechatOutputMessage): void {
  try {
    const text = message.kind === 'log'
      ? `[dsh-wechat-ilink] ${message.text}\n`
      : `\n${message.text}\n`
    process.stderr.write(text)
  } catch {
    // 输出失败可忽略
  }
}

/** 统一日志入口：TUI 内不展示普通日志，无 TUI 时回退 stderr。 */
export function log(msg: string): void {
  publishOutput({ kind: 'log', text: msg })
}

/** 需要用户看到的错误：TUI 内走临时 error 通知。 */
export function logError(msg: string): void {
  publishOutput({ kind: 'error', text: msg })
}

/** 持久状态行：TUI 固定在通知占位行展示。 */
export function publishStatus(text: string): void {
  publishOutput({ kind: 'status', text })
}
