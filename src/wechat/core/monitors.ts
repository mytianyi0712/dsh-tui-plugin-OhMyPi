// core/monitors.ts — 每账号 Monitor 的生命周期编排（启动/停止/查询）。
//
// 所有账号共享一个进程内注册表。onMessage 的消费顺序是：
//   1) 挂起的 ask 回答（dsh/ask 注入的钩子）
//   2) @dsh 快捷命令（dsh/commands 注入的钩子）
//   3) 普通消息 → 注入 dsh 会话（core/bridge.handleInbound）
// 通过钩子注入而不是直接 import 上层模块，避免 core → dsh/command 的循环依赖。

import { Monitor, type MonitorStatus } from './monitor.ts'
import type { WeixinMessage } from './api.ts'
import type { Account } from './state.ts'
import { restoreContextTokensFor, extractText } from './bridge.ts'
import { handleInbound } from './bridge.ts'
import { isReceiverHeld, log } from './runtime.ts'

/** index 注入的运行时钩子：把上层逻辑（ask/@dsh）与微信轮询解耦。 */
export interface MonitorHooks {
  /** 当前鉴权策略（每次入站读取，允许运行中修改）。 */
  policy: () => 'pairing' | 'allowlist' | 'open'
  /** 日志。 */
  log: (msg: string) => void
  /** 把文本注入 dsh 会话（index 负责标记 run 归属）；返回 true 表示已成功排队。 */
  sendUserMessage: (text: string) => Promise<boolean>
  /** 尝试把消息消费为挂起 ask 的回答；返回 true 表示已消费。 */
  consumeAskAnswer?: (acc: Account, msg: WeixinMessage) => Promise<boolean>
  /** 尝试把消息消费为 @dsh 命令；返回 true 表示已消费。 */
  handleOmpCommand?: (acc: Account, msg: WeixinMessage, text: string) => Promise<boolean>
}

const monitors = new Map<string, Monitor>()

/**
 * 启动一个账号的 Monitor（幂等：已存在则跳过）。
 * 接收是独占的：本进程未持有接收锁时仅发送（不轮询）。
 */
export function startMonitor(account: Account, hooks: MonitorHooks): void {
  if (monitors.has(account.id)) return
  if (!isReceiverHeld()) {
    log(`monitor for ${account.id} not started: receiver lock not held`)
    return
  }
  restoreContextTokensFor(account)
  const monitor = new Monitor(account, {
    onMessage: async (acc, msg) => {
      // 1) 挂起的 ask 工具在等微信回答：优先消费，不进入会话。
      if (hooks.consumeAskAnswer && (await hooks.consumeAskAnswer(acc, msg))) return
      // 2) @dsh 快捷命令：本地处理，不进会话。
      const text = extractText(msg.item_list).trim()
      if (text && /^@dsh\b/i.test(text)) {
        if (hooks.handleOmpCommand) {
          await hooks.handleOmpCommand(acc, msg, text)
          return
        }
      }
      // 3) 普通消息：注入会话（steer），并回执"任务进行中"。
      await handleInbound(
        {
          policy: hooks.policy(),
          sendUserMessage: hooks.sendUserMessage,
          log: hooks.log,
        },
        acc,
        msg,
      )
    },
    log: hooks.log,
  })
  monitors.set(account.id, monitor)
  monitor.start()
}

/** 停止并移除全部 Monitor（service dispose 调用）。 */
export function stopMonitors(): void {
  for (const monitor of monitors.values()) {
    void monitor.stop()
  }
  monitors.clear()
}

/** 停止并移除指定账号的 Monitor（/wechat-logout 调用）。 */
export function stopMonitor(id: string): void {
  const monitor = monitors.get(id)
  if (!monitor) return
  void monitor.stop()
  monitors.delete(id)
}

/** 查询账号对应的 Monitor 实例（无则 undefined）。 */
export function getMonitor(id: string): Monitor | undefined {
  return monitors.get(id)
}

/** 当前活跃的 Monitor 数量。 */
export function monitorCount(): number {
  return monitors.size
}

export type { MonitorStatus }
