// dsh/wechat-commands.ts — TUI 斜杠命令层：/wechat-login / status / pair / allow /
// deny / list / logout / notify / config。
//
// 与 @dsh 快捷命令（dsh/commands.ts）的区别：本文件命令由用户在 dsh
// 终端里输入触发（拥有完整命令上下文，可弹输入框、显示命令结果）；@dsh
// 命令由微信消息触发。两者共享 core（微信通信）与 runtime（配置）。

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { ILINK_BASE_URL } from '../core/api.ts'
import { startLogin, waitLogin } from '../core/login.ts'
import {
  loadAccounts,
  loadAccount,
  saveAccount,
  removeAccount,
  removeAccountFiles,
  stateDir,
} from '../core/state.ts'
import {
  approvePairing,
  allowUser,
  denyUser,
  listAllowlist,
} from '../core/bridge.ts'
import { getMonitor, stopMonitor, type MonitorStatus } from '../core/monitors.ts'
import { getConfig, setConfig, isReceiverHeld, log } from '../core/runtime.ts'
import type { Account } from '../core/state.ts'
import { receiverHolderPid } from '../core/receiver-lock.ts'
import { showQr } from './renderer.ts'
import { sendToPeer, activePeerOf } from './push.ts'

/** 注册全部 /wechat-* 斜杠命令（WechatBridge 构造时调用一次）。
 *  @param deps.onLoginSuccess 登录成功后的回调（index 注入：启动该账号 Monitor）。 */
export function registerWechatCommands(
  ctx: Context,
  deps?: { onLoginSuccess?: (account: Account) => void },
): void {
  const onLoginSuccess = deps?.onLoginSuccess ?? (() => {})

  ctx.commands.register({
    name: 'wechat-login',
    description: '生成微信登录二维码（可加 force 强制刷新）',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const force = inv.rawInput.trim().toLowerCase() === 'force'
      const started = await startLogin(force)
      if (!started.ok) {
        return { kind: 'error', text: `微信登录失败: ${started.message}` }
      }
      showQr(started.qrcodeUrl ?? '')
      void (async () => {
        const result = await waitLogin({
          sessionKey: started.sessionKey,
          promptVerifyCode: async () => promptText(ctx, inv, '手机微信显示的数字验证码（回车确认，取消则输入空）'),
          onRefresh: (url) => showQr(url),
          log,
        })
        if (result.connected && result.botToken && result.accountId) {
          saveAccount({
            id: result.accountId,
            token: result.botToken,
            baseUrl: result.baseUrl || ILINK_BASE_URL,
            userId: result.userId,
            savedAt: new Date().toISOString(),
          })
          const account = loadAccount(result.accountId)
          if (account) onLoginSuccess(account)
          log(`✅ ${result.message}（账号 ${result.accountId}）`)
        } else if (result.alreadyConnected) {
          log(`ℹ️ ${result.message}`)
        } else {
          log(`❌ ${result.message}`)
        }
      })()
      return { kind: 'success', text: '微信登录二维码已生成，请用手机微信扫描（二维码文本已写入 ~/.dsh/wechat-ilink/login-qr.txt）' }
    },
  })

  ctx.commands.register({
    name: 'wechat-status',
    description: '查看微信桥状态（账号/监控/白名单）',
    handler: async (_inv: CommandInvocation): Promise<CommandResult> => {
      const cfg = getConfig()
      const accounts = loadAccounts()
      const lines: string[] = [`微信桥状态（状态目录: ${stateDir}）`]
      if (accounts.length === 0) {
        lines.push('  未连接任何账号。运行 /wechat-login 扫码登录。')
      }
      for (const a of accounts) {
        const st: MonitorStatus | undefined = getMonitor(a.id)?.getStatus()
        const peer = activePeerOf(a.id)
        lines.push(
          `  ${a.id}（${a.userId ?? '?'}）` +
            ` 监控=${st?.running ? '运行中' : '未运行'}` +
            (st?.pausedUntil ? ` 已暂停至 ${new Date(st.pausedUntil).toLocaleTimeString()}` : '') +
            (st?.lastInboundAt ? ` 最近消息=${new Date(st.lastInboundAt).toLocaleTimeString()}` : '') +
            (peer ? ` 活跃会话=${peer.userId}` : '') +
            ` 白名单=${listAllowlist(a.id).length}人`,
        )
      }
      lines.push(
        `  策略=${cfg.policy} 进度汇报=${cfg.progress.enabled ? '开' : '关'} 全推=${cfg.notify ? '开' : '关'}`,
      )
      lines.push(
        isReceiverHeld()
          ? '  消息接收=本进程持有（独占）'
          : `  消息接收=未持有（仅发送；接收权在 pid ${receiverHolderPid()}）`,
      )
      return { kind: 'success', text: lines.join('\n') }
    },
  })

  ctx.commands.register({
    name: 'wechat-pair',
    description: '批准微信配对码: /wechat-pair <6位数字>',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const code = inv.rawInput.trim()
      if (!/^\d{6}$/.test(code)) {
        return { kind: 'error', text: '用法: /wechat-pair <6位数字>（微信里收到的配对码）' }
      }
      for (const account of loadAccounts()) {
        const userId = approvePairing(account.id, code)
        if (userId) {
          void sendToPeer(account.id, userId, '✅ 配对成功，现在可以向我发送任务了。').catch(() => {})
          return { kind: 'success', text: `✅ 已授权微信用户 ${userId}（账号 ${account.id}）` }
        }
      }
      return { kind: 'error', text: '配对码无效或已过期。' }
    },
  })

  ctx.commands.register({
    name: 'wechat-allow',
    description: '手动授权微信用户: /wechat-allow <用户ID>',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const id = inv.rawInput.trim()
      if (!id) return { kind: 'error', text: '用法: /wechat-allow <用户ID>' }
      const account = loadAccounts()[0]
      if (!account) return { kind: 'error', text: '尚未连接微信账号。' }
      allowUser(account.id, id)
      return { kind: 'success', text: `✅ 已加入白名单: ${id}` }
    },
  })

  ctx.commands.register({
    name: 'wechat-deny',
    description: '移除微信用户授权: /wechat-deny <用户ID>',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const id = inv.rawInput.trim()
      const account = loadAccounts()[0]
      if (!account) return { kind: 'error', text: '尚未连接微信账号。' }
      denyUser(account.id, id)
      return { kind: 'success', text: `已从白名单移除: ${id}` }
    },
  })

  ctx.commands.register({
    name: 'wechat-list',
    description: '列出白名单用户',
    handler: async (_inv: CommandInvocation): Promise<CommandResult> => {
      const account = loadAccounts()[0]
      const list = account ? listAllowlist(account.id) : []
      return {
        kind: 'success',
        text: list.length ? `白名单（${account?.id}）:\n${list.join('\n')}` : '白名单为空。',
      }
    },
  })

  ctx.commands.register({
    name: 'wechat-logout',
    description: '断开微信账号: /wechat-logout [账号ID]',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const accounts = loadAccounts()
      const target = inv.rawInput.trim() || accounts[0]?.id
      if (!target) return { kind: 'error', text: '没有已连接的账号。' }
      stopMonitor(target)
      removeAccount(target)
      removeAccountFiles(target)
      return { kind: 'success', text: `已断开账号 ${target}。` }
    },
  })

  ctx.commands.register({
    name: 'wechat-notify',
    description: '设置推送范围: /wechat-notify on|off（on=终端任务也推送微信，off=仅微信消息触发）',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const value = inv.rawInput.trim().toLowerCase()
      if (value !== 'on' && value !== 'off') {
        return { kind: 'error', text: '用法: /wechat-notify on|off' }
      }
      setConfig({ ...getConfig(), notify: value === 'on' })
      return {
        kind: 'success',
        text: value === 'on' ? '✅ 已开启全推：终端任务也会推送微信' : '✅ 已关闭全推：仅微信消息触发推送',
      }
    },
  })

  ctx.commands.register({
    name: 'wechat-config',
    description: '设置策略: /wechat-config policy=pairing|allowlist|open | progress=on|off',
    handler: async (inv: CommandInvocation): Promise<CommandResult> => {
      const [key, value] = inv.rawInput.trim().split(/[=\s]+/).slice(0, 2)
      const cfg = getConfig()
      if (key === 'policy' && (value === 'pairing' || value === 'allowlist' || value === 'open')) {
        setConfig({ ...cfg, policy: value })
      } else if (key === 'progress' && (value === 'on' || value === 'off')) {
        setConfig({ ...cfg, progress: { ...cfg.progress, enabled: value === 'on' } })
      } else {
        return { kind: 'error', text: '用法: /wechat-config policy=pairing|allowlist|open 或 progress=on|off' }
      }
      return { kind: 'success', text: `✅ 已更新: ${key}=${value}` }
    },
  })
}

/** 通过 dsh userQuestions 弹窗获取一行文本；provider 不可用时通过日志通道提示。 */
async function promptText(ctx: Context, inv: CommandInvocation, question: string): Promise<string | null> {
  try {
    const answer = await ctx.userQuestions.ask({
      questions: [{ id: 'verify', question }],
      agent: inv.agent,
      signal: inv.signal,
    })
    const item = answer.answers[0]
    return item?.custom ?? item?.selected[0] ?? null
  } catch (err) {
    log(`wechat: verify prompt unavailable: ${String(err)}`)
    return null
  }
}
