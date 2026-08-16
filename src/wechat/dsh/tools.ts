// dsh/tools.ts — 向模型注册的微信工具（wechat_send / wechat_status）。
//
// dsh 的 ask_user_question 由官方 @deepseek-ai/dsh-tool-ask-user 提供；
// 本插件通过 WechatBridge.askWithFallback 让 TUI 的 userQuestions provider
// 把提问同步推送到微信，因此这里不再注册 ask 工具。

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadAccounts } from '../core/state.ts'
import { activePeers } from '../core/bridge.ts'
import { getConfig, log } from '../core/runtime.ts'
import { getMonitor, monitorCount } from '../core/monitors.ts'
import { sendToPeer, activePeerOf } from './push.ts'

/** 注册微信工具（WechatBridge 构造时调用一次）。 */
export function registerWechatTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'wechat_send',
    description:
      '向微信用户发送文本消息（进度汇报/结果回复）。默认发给最近发来消息的微信用户；' +
      '如当前没有微信会话可指定 to 参数（用户ID，如 xxx@im.wechat）。文本会自动分段（每段 ≤4000 字符）。',
    parameters: {
      text: {
        type: 'string',
        required: true,
        description: '要发送的文本内容',
      },
      to: {
        type: 'string',
        description: '目标微信用户ID（默认: 最近活跃的微信会话）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
          to: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `已发送 ${value.to ? `给 ${value.to} ` : ''}`
          : `发送失败: ${value.error ?? 'unknown error'}`,
      }],
    },
    async execute(args) {
      const accounts = loadAccounts()
      const first = accounts[0]
      if (!first) {
        return { ok: false, error: '未连接微信账号（运行 /wechat-login）' }
      }
      const accountId = args.to
        ? first.id
        : activePeers.get(first.id)?.accountId ?? first.id
      const result = await sendToPeer(accountId, args.to, args.text)
      return {
        ok: result.ok,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(args.to !== undefined ? { to: args.to } : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wechat_status',
    description: '查看微信桥状态：连接账号、最近活跃会话、白名单、策略。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      const accounts = loadAccounts()
      if (accounts.length === 0) {
        return { text: '未连接微信。运行 /wechat-login 扫码连接。' }
      }
      const lines = accounts.map((a) => {
        const st = getMonitor(a.id)?.getStatus()
        const peer = activePeerOf(a.id)
        return `${a.id} userId=${a.userId ?? '?'} running=${st?.running ?? false} peer=${peer?.userId ?? '无'}`
      })
      return {
        text: `账号:\n${lines.join('\n')}\n策略=${getConfig().policy} 监控数=${monitorCount()}`,
      }
    },
  }))
}
