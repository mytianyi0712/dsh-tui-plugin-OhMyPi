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

/** 微信桥配置内存态（config.json）。所有读写都走 get/set，禁止直接赋值。 */
let cfg: BridgeConfig = DEFAULT_CONFIG

/**
 * 当前 turn 由微信消息发起（turn/start 从 wechatPending 转正）。
 * 回合中途到达的微信消息（作为 steer 加入）不拥有 turn，turn/end 会清掉 pending。
 */
let wechatTurnActive = false

/** 刚收到一条微信消息，下一次由它启动的 turn 归微信所有。 */
let wechatPending = false

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

export function isWechatTurnActive(): boolean {
  return wechatTurnActive
}

/** turn/start 时调用：微信发起的 turn 在跨模型回合间保持归属。 */
export function markTurnStarted(): void {
  wechatTurnActive = wechatTurnActive || wechatPending
  wechatPending = false
}

/** 微信消息到达时标记"下个 turn 归微信"。 */
export function markWechatPending(): void {
  wechatPending = true
}

/** turn/end：清掉 pending，避免下一个终端发起的 turn 被误标记。 */
export function clearWechatPending(): void {
  wechatPending = false
}

/** 消费 turn 归属：回合真正结束后调用，返回是否曾归微信所有。 */
export function consumeWechatTurn(): boolean {
  const owned = wechatTurnActive
  wechatTurnActive = false
  return owned
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
export type WechatOutputKind = 'log' | 'qr'

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

/** 统一日志入口：TUI 内进入 transcript，无 TUI 时回退 stderr。 */
export function log(msg: string): void {
  publishOutput({ kind: 'log', text: msg })
}
