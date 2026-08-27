// dsh/commands.ts — @dsh 微信快捷命令与微信侧分发器。
//
// 这些命令只供微信消息调用：它们不再注册进 dsh 命令注册表，因此不会出现
// 在本地命令菜单（/help、命令补全）里，也无法在本地用 `/dsh-*` 执行。
// 微信消息以 `@dsh` 开头时被 core/monitors 拦截。@dsh chat/work 只切换
// 后续普通微信消息的回传模式；其余命令在此直接执行并回推结果。


import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandId, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { type ImageBlock, type ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Account } from '../core/state.ts'
import { loadAccount } from '../core/state.ts'
import { sendTextToPeer } from '../core/send.ts'
import { getContextToken } from '../core/bridge.ts'
import { getConfig, setConfig, setWechatMode, log } from '../core/runtime.ts'
import { getActiveAgent, setActiveAgent } from './session.ts'
import { getTuiForegroundControl, type TuiForegroundControl } from './tui-control.ts'

/** Pending model picker: a bare-number reply selects by index. */
let pendingModelPicker: { at: number; entries: Array<{ provider: string; model: string; name?: string }> } | null = null

/** dsh rc8 added an `images` parameter to commands.execute; pass an empty batch. */
function executeCommand(ctx: Context, agent: Agent, line: string, signal: AbortSignal) {
  return (ctx.commands.execute as unknown as (
    agent: Agent,
    line: string,
    images: readonly unknown[],
    signal: AbortSignal,
  ) => ReturnType<typeof ctx.commands.execute>).call(ctx.commands, agent, line, [], signal)
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

interface CommandDescription {
  usage: string
  desc: string
}

interface CommandSpec extends CommandDescription {
  run: (args: string, inv: CommandInvocation, ctx: Context) => Promise<CommandResult>
}

type RemoteTaskMode = 'chat' | 'work'

const REMOTE_TASK_COMMANDS: Record<RemoteTaskMode, CommandDescription> = {
  chat: {
    usage: '@dsh chat',
    desc: '切换为实时分段回传模式；不发送进度汇报',
  },
  work: {
    usage: '@dsh work',
    desc: '切换为任务结束后回传结果模式，并按配置发送进度汇报',
  },
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

const HELP_COMMANDS: Record<string, CommandDescription> = {
  ...REMOTE_TASK_COMMANDS,
  ...COMMANDS,
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
      const entry = picker.entries[idx]
      pendingModelPicker = null
      if (!entry) {
        await safeSend(account, userId, `❌ 序号无效（请输入 1-${picker.entries.length}）`)
        return true
      }
      await applyModelSelection(ctx, account, userId, entry.provider, entry.model)
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

/** Build a synthetic CommandInvocation for the WeChat-only @dsh command path.
 *  Commands are intentionally not registered with ctx.commands, so no local
 *  slash-command surface (help, completion, or direct execution) sees them. */
function buildInvocation(agent: Agent, rawInput: string): CommandInvocation {
  const attachments: readonly ImageBlock[] = []
  return {
    commandId: `wechat-${randomUUID()}` as CommandId,
    agent,
    rawInput,
    attachments,
    signal: new AbortController().signal,
  }
}

function isRemoteTaskMode(name: string): name is RemoteTaskMode {
  return name === 'chat' || name === 'work'
}

async function switchRemoteTaskMode(
  account: Account,
  userId: string,
  mode: RemoteTaskMode,
  args: string,
): Promise<void> {
  if (args) {
    await safeSend(account, userId, `用法: ${REMOTE_TASK_COMMANDS[mode].usage}`)
    return
  }
  setWechatMode(mode)
  await safeSend(
    account,
    userId,
    mode === 'chat'
      ? '✅ 已切换到 chat 模式。后续普通微信消息将实时分段返回内容，不发送进度汇报。'
      : '✅ 已切换到 work 模式。后续普通微信消息将在任务结束后返回结果，并按配置汇报进度。',
  )
}

/** Dispatch a @dsh command directly to its implementation. WeChat-only path:
 *  it must not go through ctx.commands.execute, which would require the command
 *  to be registered (and therefore visible/callable locally). */
async function runCommand(ctx: Context, account: Account, userId: string, line: string): Promise<void> {
  const name = line.split(/\s+/)[0] ?? ''
  const rawInput = line.slice(name.length)
  const args = rawInput.trim()
  if (isRemoteTaskMode(name)) {
    await switchRemoteTaskMode(account, userId, name, args)
    return
  }

  const spec = COMMANDS[name]
  if (!spec) {
    await safeSend(account, userId, `❌ 未知命令: ${name}\n\n发送 @dsh help 查看全部命令。`)
    return
  }
  const agent = getActiveAgent()
  if (!agent) {
    await safeSend(account, userId, '❌ 未找到活动会话（dsh agent 尚未就绪）')
    return
  }
  try {
    const result = await spec.run(args, buildInvocation(agent, rawInput), ctx)
    if (result.text) {
      await safeSend(account, userId, result.text)
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
  // Prefer the TUI foreground agent's live selection: it is the one that
  // actually routes the next request and drives the status line.
  const tui = getTuiForeground(ctx)
  const live = tui?.currentModelSelection?.()
  if (live !== undefined) {
    return {
      provider: live.provider,
      model: live.model,
      reasoningEffort: live.reasoningEffort,
    }
  }
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

interface ModelCatalogEntry {
  provider: string
  model: string
  name?: string
}

/** Save a model selection through the TUI when available, else agentDefaultModel. */
async function saveModelSelection(
  ctx: Context,
  selection: { provider: string; model: string; reasoningEffort?: ReasoningEffortId },
): Promise<void> {
  const tui = getTuiForeground(ctx)
  if (tui?.saveModelSelection !== undefined) {
    await tui.saveModelSelection(selection as ModelSelection)
    return
  }
  const def = ctx.get('agentDefaultModel')
  if (def && typeof def.saveSelection === 'function') {
    await def.saveSelection(selection as ModelSelection)
    return
  }
  throw new Error('当前部署缺少 agentDefaultModel 服务，无法保存模型选择')
}

/** Probe every registered/configurable provider's model list and merge the results. */
async function listAllModels(ctx: Context): Promise<ModelCatalogEntry[]> {
  const providers = typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []
  const seen = new Set<string>()
  const entries: ModelCatalogEntry[] = []
  const add = (provider: string, model: { id: string; name?: string }): void => {
    const key = `${provider}\u0000${model.id}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ provider, model: model.id, name: model.name })
  }
  for (const provider of providers) {
    try {
      for (const model of await ctx.llm.listModels(provider.id)) add(provider.id, model)
    } catch {
      // Providers without credentials or a live catalog are skipped.
    }
  }
  if (typeof ctx.llm.listConfigurableProviders === 'function') {
    for (const entry of ctx.llm.listConfigurableProviders()) {
      if (providers.some(provider => provider.id === entry.provider)) continue
      try {
        for (const model of await ctx.llm.listModels(entry.provider)) add(entry.provider, model)
      } catch {
        // Dormant configurable providers may not expose a live catalog.
      }
    }
  }
  return entries
}

/** Resolve a model query across all providers, preferring the current provider. */
function resolveModelQuery(
  entries: ModelCatalogEntry[],
  q: string,
  currentProvider: string,
): ModelCatalogEntry | undefined {
  const currentMatches = entries.filter(entry => entry.provider === currentProvider)
  const exact = currentMatches.find(entry => entry.model === q || entry.name === q)
    ?? entries.find(entry => entry.model === q || entry.name === q)
  if (exact !== undefined) return exact
  const slash = q.indexOf('/')
  if (slash > 0) {
    const provider = q.slice(0, slash)
    const model = q.slice(slash + 1)
    return entries.find(entry => entry.provider === provider && entry.model === model)
  }
  return undefined
}

/** Switch a model by provider/model from the pending picker or direct command. */
async function applyModelSelection(
  ctx: Context,
  account: Account,
  userId: string,
  provider: string,
  model: string,
): Promise<void> {
  const agent = getActiveAgent()
  if (!agent) {
    await safeSend(account, userId, '❌ 未找到活动会话（dsh agent 尚未就绪）')
    return
  }
  const current = currentModel(ctx, agent)
  try {
    await saveModelSelection(ctx, {
      provider,
      model,
      ...(current.reasoningEffort !== undefined ? { reasoningEffort: current.reasoningEffort } : {}),
    })
    await safeSend(account, userId, `✅ 已切换模型: ${model}（${provider}）`)
  } catch (err) {
    await safeSend(account, userId, `❌ 切换失败: ${err instanceof Error ? err.message : String(err)}`)
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
  const sel = currentModel(ctx, inv.agent)
  try {
    await saveModelSelection(ctx, { provider: sel.provider, model: sel.model, reasoningEffort: level as ReasoningEffortId })
    return { kind: 'success', text: `✅ 思考强度已切换: ${level}` }
  } catch (err) {
    return { kind: 'error', text: `❌ 切换失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function cmdModel(args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const q = args.trim()
  if (!q) {
    return { kind: 'success', text: '用法: @dsh model <模型ID或别名>（@dsh models 查看列表）' }
  }
  const current = currentModel(ctx, inv.agent)
  const entries = await listAllModels(ctx)
  const resolved = resolveModelQuery(entries, q, current.provider)
  if (!resolved) {
    return { kind: 'error', text: `❌ 未找到模型: ${q}（用 @dsh models 查看可用列表）` }
  }
  try {
    await saveModelSelection(ctx, {
      provider: resolved.provider,
      model: resolved.model,
      ...(current.reasoningEffort !== undefined ? { reasoningEffort: current.reasoningEffort } : {}),
    })
    return { kind: 'success', text: `✅ 已切换模型: ${resolved.model}（${resolved.provider}）` }
  } catch (err) {
    return { kind: 'error', text: `❌ 切换失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function cmdModels(_args: string, inv: CommandInvocation, ctx: Context): Promise<CommandResult> {
  const entries = await listAllModels(ctx)
  if (!entries.length) {
    return { kind: 'error', text: '❌ 没有可用模型（检查 API key 配置）' }
  }
  const shown = entries.slice(0, 30)
  const lines = ['🤖 可用模型（回复 @dsh <数字> 切换）:']
  shown.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.model}${m.name && m.name !== m.model ? ` (${m.name})` : ''} — ${m.provider}`)
  })
  if (entries.length > shown.length) lines.push(`…还有 ${entries.length - shown.length} 个未列出`)
  lines.push('', '例如：回复 3 切换第 3 个模型（10 分钟内有效）')
  pendingModelPicker = { at: Date.now(), entries: shown }
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
    const spec = HELP_COMMANDS[topic]
    if (!spec) {
      return { kind: 'error', text: `❌ 未知命令: ${topic}\n\n@dsh help 查看全部命令` }
    }
    return { kind: 'success', text: `用法: ${spec.usage}\n${spec.desc}` }
  }
  const lines = ['🛠 @dsh 快捷命令:', ...Object.entries(HELP_COMMANDS).map(([, spec]) => `• ${spec.usage} — ${spec.desc}`)]
  lines.push('', '用 @dsh chat 切换实时回传模式；用 @dsh work 切换任务完成后回传模式。后续普通微信消息持续使用所选模式。')
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
