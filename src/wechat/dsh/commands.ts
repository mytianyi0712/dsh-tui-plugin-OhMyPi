// dsh/commands.ts — @dsh 微信快捷命令与微信侧分发器。
//
// 命令注册为 `dsh-*` 扩展命令（TUI 里 `/dsh-*` 也可用）。微信消息以
// `@dsh` 开头时被 core/monitors 拦截，经 handleDshMessage 解析后调用
// ctx.commands.execute(agent, '/dsh-...') 执行 —— 命令处理器拥有完整
// agent 上下文，回复文本会由微信侧分发器回推。

import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Account } from '../core/state.ts'
import { loadAccount } from '../core/state.ts'
import { sendTextToPeer } from '../core/send.ts'
import { getContextToken } from '../core/bridge.ts'
import { getConfig, setConfig, log } from '../core/runtime.ts'
import { getActiveAgent, setActiveAgent } from './session.ts'
import { getTuiForegroundControl, type TuiForegroundControl } from './tui-control.ts'

/** Pending model picker: a bare-number reply selects by index. */
let pendingModelPicker: { at: number; ids: string[] } | null = null

/** dsh rc8 added an `images` parameter to commands.execute; pass an empty batch. */
function executeCommand(ctx: Context, agent: Agent, line: string, signal: AbortSignal) {
  return (ctx.commands.execute as unknown as (
    agent: Agent,
    line: string,
    images: readonly unknown[],
    signal: AbortSignal,
  ) => ReturnType<typeof ctx.commands.execute>)(agent, line, [], signal)
}

const MODEL_PICKER_TTL_MS = 10 * 60 * 1000

/** 读取 TUI 前台控制；无 TUI 或未挂载时返回 undefined。 */
function getTuiForeground(ctx: Context): TuiForegroundControl | undefined {
  const registered = getTuiForegroundControl()
  if (registered !== undefined) return registered

  // 回退到 Cordis 服务解析：兼容未安装新注册表模块的旧版 TUI。
  try {
    const tui = ctx.get('tui') as Partial<TuiForegroundControl> | undefined
    return typeof tui?.createForegroundSession === 'function' ? (tui as TuiForegroundControl) : undefined
  } catch {
    return undefined
  }
}

interface CommandSpec {
  usage: string
  desc: string
  run: (args: string, inv: CommandInvocation, ctx: Context) => Promise<CommandResult>
}

const COMMANDS: Record<string, CommandSpec> = {
  status: {
    usage: '@dsh status',
    desc: '查询当前会话状态（模型、思考强度、上下文、进度汇报/通知开关）',
    run: cmdStatus,
  },
  think: {
    usage: '@dsh think <等级>',
    desc: '切换思考强度（不带参数查询当前值）',
    run: cmdThink,
  },
  model: {
    usage: '@dsh model <模型ID或别名>',
    desc: '切换模型',
    run: cmdModel,
  },
  models: {
    usage: '@dsh models',
    desc: '列出可用模型，回复数字序号快速切换',
    run: cmdModels,
  },
  new: {
    usage: '@dsh new',
    desc: '新建会话',
    run: cmdNew,
  },
  compress: {
    usage: '@dsh compress',
    desc: '压缩当前会话上下文',
    run: cmdCompress,
  },
  tools: {
    usage: '@dsh tools',
    desc: '查询当前可用的全部工具',
    run: cmdTools,
  },
  plugins: {
    usage: '@dsh plugins',
    desc: '查询当前 dsh 已安装插件',
    run: cmdPlugins,
  },
  skills: {
    usage: '@dsh skills',
    desc: '查询当前 dsh 全部 skill',
    run: cmdSkills,
  },
  help: {
    usage: '@dsh help [命令]',
    desc: '查询全部命令或某条命令的用法',
    run: cmdHelp,
  },
  notify: {
    usage: '@dsh notify on|off',
    desc: '开启或关闭会话微信通知',
    run: cmdNotify,
  },
}

/** Register all dsh-* commands with the dsh command registry. */
export function registerDshCommands(ctx: Context): void {
  for (const [name, spec] of Object.entries(COMMANDS)) {
    ctx.commands.register({
      name: `dsh-${name}`,
      description: spec.desc,
      handler: async (inv) => {
        try {
          return await spec.run(inv.rawInput.trim(), inv, ctx)
        } catch (err) {
          return {
            kind: 'error',
            text: `❌ ${name} 执行失败: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      },
    })
  }
}

/**
 * Handle a WeChat message that starts with `@dsh`. Returns true when the
 * message was consumed as a command (never injected into the session).
 */
export async function handleDshMessage(
  ctx: Context,
  account: Account,
  userId: string,
  body: string,
): Promise<boolean> {
  const text = body.trim()
  if (!/^@dsh\b/i.test(text)) return false
  const rest = text.replace(/^@dsh\b/i, '').trim()

  // Bare-number reply to a pending model picker: switch by index.
  if (/^\d+$/.test(rest)) {
    const picker = pendingModelPicker
    if (picker && Date.now() - picker.at < MODEL_PICKER_TTL_MS) {
      const idx = Number(rest) - 1
      const id = picker.ids[idx]
      pendingModelPicker = null
      if (!id) {
        await safeSend(account, userId, `❌ 序号无效（请输入 1-${picker.ids.length}）`)
        return true
      }
      await runCommand(ctx, account, userId, `model ${id}`)
      return true
    }
    pendingModelPicker = null
    await safeSend(account, userId, '❌ 没有待选择的模型列表（先发 @dsh models）')
    return true
  }

  // Parse "@dsh <cmd> [args]".
  pendingModelPicker = null
  const [cmd, ...argParts] = rest.split(/\s+/)
  const name = (cmd || 'help').toLowerCase()
  const args = argParts.join(' ').trim()
  await runCommand(ctx, account, userId, `${name}${args ? ' ' + args : ''}`)
  return true
}

/** Dispatch a command through the active agent's command runner. */
async function runCommand(ctx: Context, account: Account, userId: string, line: string): Promise<void> {
  const name = line.split(/\s+/)[0] ?? ''
  if (!COMMANDS[name]) {
    await safeSend(account, userId, `❌ 未知命令: ${name}\n\n发送 @dsh help 查看全部命令。`)
    return
  }
  const agent = getActiveAgent()
  if (!agent) {
    await safeSend(account, userId, '❌ 未找到活动会话（dsh agent 尚未就绪）')
    return
  }
  try {
    const execution = await executeCommand(ctx, agent, `/dsh-${line}`, new AbortController().signal)
    if (execution?.result.text) {
      await safeSend(account, userId, execution.result.text)
    }
  } catch (err) {
    await safeSend(account, userId, `❌ 执行失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Send a best-effort WeChat reply; never throws. */
async function safeSend(account: Account, userId: string, text: string): Promise<void> {
  try {
    await sendTextToPeer(account, userId, text, getContextToken(account.id, userId))
  } catch {
    // Best-effort: send failures must not break @dsh handling.
  }
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

function fmtTokens(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '?'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function fmtPercent(p: number): string {
  const v = p > 1 ? p / 100 : p
  return `${Math.round(v * 100)}%`
}

function currentModel(ctx: Context, agent: Agent): { provider: string; model: string; reasoningEffort?: ReasoningEffortId } {
  const def = ctx.get('agentDefaultModel')
  if (def && typeof def.currentSelection === 'function') {
    const sel = def.currentSelection() as { provider: string; model: string; reasoningEffort?: ReasoningEffortId }
    return {
      provider: sel.provider ?? agent.options.provider ?? '',
      model: sel.model ?? agent.options.model ?? '',
      reasoningEffort: sel.reasoningEffort,
    }
  }
  return {
    provider: agent.options.provider ?? '',
    model: agent.options.model ?? '',
  }
}

async function cmdStatus(_args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const agent = inv.agent
  const model = currentModel(ctx, agent)
  const cfg = getConfig()
  const context = agent.session.requestContext()
  const lines = [
    '📊 会话状态',
    `模型: ${model.model || '未设置'}（${model.provider || '?'}）`,
    `思考强度: ${model.reasoningEffort ?? '默认'}`,
    `上下文: ${context ? `${fmtPercent(context.contextWindow ? 1 : 0)}` : '不可用'}`,
    `进度汇报: ${cfg.progress.enabled ? `开（每 ${cfg.progress.interval} 轮）` : '关'}`,
    `微信通知: ${cfg.notify ? '开' : '关'}`,
  ]
  return { kind: 'success', text: lines.join('\n') }
}

const THINK_LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

async function cmdThink(args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const level = args.trim().toLowerCase()
  const def = ctx.get('agentDefaultModel')
  if (!level) {
    const model = currentModel(ctx, inv.agent)
    return {
      kind: 'success',
      text: `当前思考强度: ${model.reasoningEffort ?? '默认'}\n可用等级: ${THINK_LEVELS.join(' / ')}\n用法: @dsh think <等级>`,
    }
  }
  if (!THINK_LEVELS.includes(level)) {
    return { kind: 'error', text: `❌ 无效等级: ${level}\n可用: ${THINK_LEVELS.join(' / ')}` }
  }
  if (def && typeof def.saveSelection === 'function') {
    const sel = currentModel(ctx, inv.agent)
    await def.saveSelection({ provider: sel.provider, model: sel.model, reasoningEffort: level as ReasoningEffortId })
    return { kind: 'success', text: `✅ 思考强度已切换: ${level}` }
  }
  return { kind: 'error', text: '当前部署没有 agentDefaultModel 服务，无法切换思考强度' }
}

async function cmdModel(args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const q = args.trim()
  if (!q) {
    return { kind: 'success', text: '用法: @dsh model <模型ID或别名>（@dsh models 查看列表）' }
  }
  const def = ctx.get('agentDefaultModel')
  const provider = currentModel(ctx, inv.agent).provider
  let models: { id: string; name?: string }[] = []
  try {
    models = provider ? await ctx.llm.listModels(provider) : []
  } catch {
    models = []
  }
  const resolved = models.find((m) => m.id === q || m.name === q)
  if (!resolved) {
    return { kind: 'error', text: `❌ 未找到模型: ${q}（用 @dsh models 查看可用列表）` }
  }
  if (def && typeof def.saveSelection === 'function') {
    const current = currentModel(ctx, inv.agent)
    await def.saveSelection({
      provider: current.provider || provider,
      model: resolved.id,
      ...(current.reasoningEffort !== undefined ? { reasoningEffort: current.reasoningEffort } : {}),
    })
    return { kind: 'success', text: `✅ 已切换模型: ${resolved.id}` }
  }
  return { kind: 'error', text: `❌ 切换失败（缺少 agentDefaultModel 服务）: ${q}` }
}

async function cmdModels(_args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const provider = currentModel(ctx, inv.agent).provider
  let models: { id: string; name?: string }[] = []
  try {
    models = provider ? await ctx.llm.listModels(provider) : []
  } catch {
    models = []
  }
  if (!models.length) {
    return { kind: 'error', text: '❌ 没有可用模型（检查 API key 配置）' }
  }
  const shown = models.slice(0, 30)
  const ids: string[] = []
  const lines = ['🤖 可用模型（回复 @dsh <数字> 切换）:']
  shown.forEach((m, i) => {
    ids.push(m.id)
    lines.push(`${i + 1}. ${m.id}${m.name && m.name !== m.id ? ` (${m.name})` : ''}`)
  })
  if (models.length > shown.length) lines.push(`…还有 ${models.length - shown.length} 个未列出`)
  lines.push('', '例如：回复 3 切换第 3 个模型（10 分钟内有效）')
  pendingModelPicker = { at: Date.now(), ids }
  return { kind: 'success', text: lines.join('\n') }
}

async function createForegroundSessionWithRetry(
  tui: TuiForegroundControl,
  timeoutMs = 5000,
): Promise<SessionId | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const id = await tui.createForegroundSession()
    if (id !== undefined) return id
    // TUI 可能尚未挂载完成；短暂等待后重试，直到超时。
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return tui.createForegroundSession()
}

async function cmdNew(_args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const current = inv.agent
  try {
    const tui = getTuiForeground(ctx)
    if (tui !== undefined) {
      const id = await createForegroundSessionWithRetry(tui)
      if (id === undefined) {
        return { kind: 'error', text: '⚠️ TUI 尚未就绪，新建会话失败' }
      }
      return { kind: 'success', text: `✅ 已新建会话 ${String(id)}` }
    }

    // 无 TUI 进程：微信桥自己就是前台，直接创建并切换活动会话指针。
    const id = SessionId(`wechat-${randomUUID()}`)
    const handle = await ctx.agents.create({
      sessionId: id,
      meta: { cwd: current.session.header.cwd },
      agentOptions: current.options,
    })
    setActiveAgent(handle.agent)
    return { kind: 'success', text: `✅ 已新建会话 ${String(id)}` }
  } catch (err) {
    return { kind: 'error', text: `❌ 新建会话失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function cmdCompress(_args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  try {
    const execution = await executeCommand(ctx, inv.agent, '/compact', inv.signal)
    if (execution?.result.kind === 'error') {
      return { kind: 'error', text: `❌ 压缩失败: ${execution.result.text}` }
    }
    return { kind: 'success', text: '✅ 上下文已压缩' }
  } catch (err) {
    return { kind: 'error', text: `❌ 压缩失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function cmdTools(_args: string, _inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const all = ctx.tools.schemas()
  const lines = [`🧰 工具（共 ${all.length} 个）:`]
  const shown = all.slice(0, 80)
  for (const t of shown) {
    const desc = (t.description || '').split('\n')[0]?.trim() ?? ''
    lines.push(`• ${t.name}${desc ? ` — ${desc.slice(0, 50)}` : ''}`)
  }
  if (all.length > shown.length) lines.push(`…还有 ${all.length - shown.length} 个未列出`)
  return { kind: 'success', text: lines.join('\n') }
}

async function cmdPlugins(_args: string, _inv: CommandInvocation, _ctx: Context): Promise<CommandResult> {
  const profilesDir = join(os.homedir(), '.dsh', 'profiles')
  let entries: string[] = []
  try {
    const items = await readdir(profilesDir, { withFileTypes: true })
    entries = items
      .filter((d) => d.isDirectory() && d.name !== 'node_modules')
      .map((d) => d.name)
      .sort()
  } catch {
    entries = []
  }
  if (!entries.length) {
    return { kind: 'success', text: '📦 插件: 未在 ~/.dsh/profiles 发现已安装 profile' }
  }
  return { kind: 'success', text: `📦 profiles（${entries.length} 个）:\n${entries.map((n) => `• ${n}`).join('\n')}` }
}

async function cmdSkills(_args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  let skills: { name: string; description?: string }[] = []
  try {
    const snapshot = await ctx.skills.snapshot({ cwd: inv.agent.session.header.cwd })
    skills = snapshot.skills
  } catch {
    skills = []
  }
  if (!skills.length) {
    return { kind: 'success', text: '🧩 skills: 当前没有可用的 skill' }
  }
  const lines = [`🧩 skills（${skills.length} 个）:`]
  for (const s of skills.slice(0, 40)) {
    lines.push(`• ${s.name}${s.description ? ` — ${s.description.slice(0, 50)}` : ''}`)
  }
  if (skills.length > 40) lines.push(`…还有 ${skills.length - 40} 个未列出`)
  return { kind: 'success', text: lines.join('\n') }
}

async function cmdHelp(args: string, _inv: CommandInvocation, _ctx: Context): Promise<CommandResult> {
  const topic = args.trim().toLowerCase()
  if (topic) {
    const spec = COMMANDS[topic]
    if (!spec) {
      return { kind: 'error', text: `❌ 未知命令: ${topic}\n\n@dsh help 查看全部命令` }
    }
    return { kind: 'success', text: `用法: ${spec.usage}\n${spec.desc}` }
  }
  const lines = ['🛠 @dsh 快捷命令:', ...Object.entries(COMMANDS).map(([name, spec]) => `• ${spec.usage} — ${spec.desc}`)]
  lines.push('', '消息以 @dsh 开头即命令；其他消息正常发给会话。')
  return { kind: 'success', text: lines.join('\n') }
}

async function cmdNotify(args: string, _inv: CommandInvocation, _ctx: Context): Promise<CommandResult> {
  const value = args.trim().toLowerCase()
  if (value !== 'on' && value !== 'off') {
    return { kind: 'error', text: '用法: @dsh notify on|off' }
  }
  setConfig({ ...getConfig(), notify: value === 'on' })
  return { kind: 'success', text: `✅ 会话微信通知已${value === 'on' ? '开启' : '关闭'}` }
}
