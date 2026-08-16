// dsh/session.ts — 访问当前 dsh 活动会话。
//
// dsh 的扩展命令（/wechat-*）通过 ctx.commands 分发，处理器携带 agent。
// 微信侧的 @dsh 命令没有用户输入通道，这里通过 service 注册的 active agent
// 直接调用 agent 的 inbox 方法 / commands.execute，获得完整命令上下文。

import type { Agent } from '@deepseek-ai/dsh-agent'

/** 当前插件选中的主 agent（由 WechatBridge 在 agent/created 时设置）。 */
let activeAgent: Agent | undefined

export function setActiveAgent(agent: Agent | undefined): void {
  activeAgent = agent
}

/** 返回当前 dsh 活动 agent（未设置时回退到 registry 的第一个 root）。 */
export function getActiveAgent(): Agent | undefined {
  return activeAgent
}

/** 返回当前 dsh 活动 agent（旧命名兼容）。 */
export function getActiveSession(): Agent | undefined {
  return getActiveAgent()
}
