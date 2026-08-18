// dsh/tui-control.ts — TUI 前台能力在微信桥侧的进程内注册表。
//
// 不依赖 Cordis 的 ctx.get('tui') 解析：TUI 挂载后把前台控制对象注册
// 到这里，微信命令直接读取。这样即使命令执行上下文与 TUI 服务不在
// 同一个 Cordis scope，也能稳定拿到“创建并切换前台会话”的能力。

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface TuiForegroundControl {
  /** 当前前台 agent；TUI 未挂载时为 undefined。 */
  foregroundAgent: () => Agent | undefined
  /** 按 TUI `/new` 逻辑创建会话并切到前台；TUI 未挂载时返回 undefined。 */
  createForegroundSession: () => Promise<SessionId | undefined>
}

let control: TuiForegroundControl | undefined

/** TUI 挂载后调用；TUI 卸载时传 undefined 清理。 */
export function setTuiForegroundControl(next: TuiForegroundControl | undefined): void {
  control = next
}

/** 微信命令读取当前 TUI 前台控制。 */
export function getTuiForegroundControl(): TuiForegroundControl | undefined {
  return control
}
