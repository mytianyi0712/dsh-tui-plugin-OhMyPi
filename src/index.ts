/**
 * Interactive DeepSeek Harness front door, visually aligned with the local
 * OMP 17.2.15 Catppuccin layout while retaining dsh-native agent, session,
 * command, and persistence contracts.
 * @module dsh-omp-tui
 */

import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  Container,
  Editor,
  ProcessTerminal,
  Spacer,
  TUI,
  Text,
  matchesKey,
  visibleWidth,
  type Component,
  type EditorTheme,
  type SelectItem,
  type TerminalColorScheme,
} from '@earendil-works/pi-tui'
import type { Agent, AgentHandle, AgentStatus, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { CombinedAutocompleteProvider, type AutocompleteItem, type SlashCommand } from '@earendil-works/pi-tui'
import { createUserMessage, errorChain, type CallId, type LlmConfigurableProvider, type LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
// Type-only imports pull in the declaration merges that expose `ctx.commands`,
// `ctx.tokenMeter`, `ctx.llm`, `ctx.userQuestions`, `ctx.sessionQuery`,
// `ctx.agentDefaultModel`, `ctx.skills`, `ctx.sessionReferenceResolver`, and
// `ctx.permissionPresets` on the cordis Context, plus the goal/compaction/skill
// session-event extensions.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-reference'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import { PERMISSION_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-compaction'
// Declaration merges: `ctx.agentPresets` and the `agent-preset/selected`
// session event, plus the runtime preset resolver for resumed sessions.
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import {
  TuiConfigSchema,
  resolveTuiConfig,
  type Config,
  type ResolvedTuiConfig,
  type UiMode,
} from './config.ts'
import type { TuiStartup } from './startup.ts'
import { parseTuiPromptTemplate } from './prompt.ts'
import { createTranslator, type MessageKey, type Translator } from './i18n.ts'
import {
  FULL_ACCESS_REGISTRY_NAME,
  FULL_ACCESS_UI_NAME,
  displayPermissionName,
  permissionCommandMetadata,
  registryPermissionName,
} from './permission.ts'
import { SkillAwareAutocompleteProvider } from './autocomplete.ts'
import {
  BUILTIN_THEMES,
  createPalette,
  detectTruecolor,
  findTheme,
  markdownTheme,
  renderPalette,
  selectTheme,
  type Palette,
  type ThemeCustom,
  type ThemeOverride,
} from './theme.ts'
import {
  SESSION_TITLE_SETTINGS_NAMESPACE,
  TUI_SETTINGS_NAMESPACE,
  TuiSettingsSchema,
} from './settings.ts'
import {
  ContextCardComponent,
  HeaderComponent,
  StaticCardComponent,
  AssistantStreamController,
  TodoPanelComponent,
  ToolCardComponent,
  UserMessageComponent,
  type ToolCardVisibility,
} from './components/transcript.ts'
import {
  CommandHintComponent,
  ComposerFooterComponent,
  InputBorderComponent,
  StatusLineComponent,
  formatContextTokens,
  chooseReasoningEffort,
  resolveSessionModelSelection,
} from './components/status.ts'
import {
  InputDialog,
  SelectDialog,
  runInlineQuestionFlow,
  runModelFlow,
  showOverlay,
} from './components/dialogs.ts'
import { ModelListDialog } from './components/model-list-dialog.ts'
import { SettingsScreen, type SettingsItem, type SettingsTab } from './components/settings-screen.ts'
import { CustomModelForm, type CustomModelDraft } from './components/custom-model-form.ts'
import {
  ProviderForm,
  SUPPORTED_PROVIDER_APIS,
  type DiscoveredModel,
  type ProviderDraft,
} from './components/provider-form.ts'
import { contentText } from './components/content.ts'
import { displayInlineText, displayText } from './components/text.ts'
import { filterProjectSessions, sameProject } from './session-filter.ts'
import { hasConversationData, recordConversationPreset } from './session-lifecycle.ts'
import type { BridgeConfig, WechatBridge } from './wechat/index.ts'

export const name = 'tui'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
/** How long to wait for the configured agent to publish before giving up. */
const AGENT_READY_TIMEOUT_MS = 10000
/** Safety cap for a session resume's persistence load and setup phase. */
const RESUME_TIMEOUT_MS = 30_000
/** How many recent sessions to show in the `/resume` picker before title reads. */
const RESUME_PICKER_LIMIT = 50
/** Safety cap for loading title snapshots before showing the `/resume` picker. */
const RESUME_TITLES_TIMEOUT_MS = 5_000
/** Context fallback while exact model metadata is unavailable. */
const DEFAULT_CONTEXT_WINDOW = 1_000_000

/** UI modes map 1:1 to the shipped dsh agent presets (backend compositions). */
const MODE_PRESETS = { standard: 'standard', minimal: 'minimal', code: 'code', cordis: 'cordis' } as const
type UiModeKey = keyof typeof MODE_PRESETS

/** Bare `/mode` cycles through the shipped presets in this order. */
const MODE_ORDER: readonly UiModeKey[] = ['standard', 'minimal', 'code', 'cordis']

/** i18n key for each mode's localized label. */
const MODE_LABEL_KEYS: Record<UiModeKey, MessageKey> = {
  standard: 'modeStandard',
  minimal: 'modeMinimal',
  code: 'modeCode',
  cordis: 'modeCordis',
}



/** Restore a session's recorded backend preset, falling back for blank sessions. */
function modeForSession(session: Session, fallback: string): string {
  return resolveSessionPreset(session) ?? fallback
}

/** The localized label of a preset id, preferring the roster's own name. */
function modeLabel(
  t: Translator,
  mode: string,
  names: ReadonlyMap<string, string>,
): string {
  const rosterName = names.get(mode)
  if (rosterName !== undefined) return rosterName
  return mode in MODE_LABEL_KEYS ? t(MODE_LABEL_KEYS[mode as UiModeKey]) : mode
}

/** Filter preset argument choices while preserving their descriptions. */
function filterCommandOptions(options: readonly AutocompleteItem[], prefix: string): AutocompleteItem[] | null {
  const query = prefix.trim().toLocaleLowerCase()
  const filtered = query === ''
    ? options
    : options.filter(item => `${item.value} ${item.label}`.toLocaleLowerCase().startsWith(query))
  return filtered.length === 0 ? null : [...filtered]
}

/** Show the command's expected argument while the user edits its prefix. */
function commandInputHint(text: string, commands: readonly SlashCommand[]): string | undefined {
  const match = /^\/([^\s]*)/.exec(text)
  if (match?.[1] === undefined) return undefined
  const command = commands.find(entry => entry.name === match[1])
  return command?.argumentHint === undefined ? undefined : `/${command.name} ${command.argumentHint}`
}

/** Format a token count compactly: 1234 → "1.2k", 1234567 → "1.2M". */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}



/** Resolve a regular repository or linked worktree branch without spawning Git. */
async function readGitBranch(cwd: string): Promise<string | undefined> {
  const dotGit = join(cwd, '.git')
  let gitDir = dotGit
  try {
    const pointer = (await readFile(dotGit, 'utf8')).trim()
    const match = /^gitdir:\s*(.+)$/i.exec(pointer)
    if (match?.[1] !== undefined) {
      gitDir = isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1])
    }
  } catch {
    // A normal checkout exposes `.git` as a directory, not a pointer file.
  }
  try {
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
    if (head.startsWith('ref:')) return head.slice(head.lastIndexOf('/') + 1)
    return head === '' ? undefined : head.slice(0, 7)
  } catch {
    return undefined
  }
}

/** The terminal mode's plugin entry: mounts the whole UI in its constructor. */
export class Tui extends Service {
  static inject = ['tuiStartup', 'agents', 'tuiPrompt', 'commands', 'tokenMeter', 'llm', 'userQuestions', 'sessionQuery', 'agentDefaultModel', 'skills', 'sessionReferenceResolver', 'agentPresets', 'permissionPresets', 'settings', 'sessionTitle']
  static Config = TuiConfigSchema

  constructor(ctx: Context, config: Config) {
    super(ctx, 'tui')

    const startup: TuiStartup = ctx.tuiStartup
    const sessionId = startup.sessionId ?? startup.resumeSessionId
    if (sessionId === undefined) {
      throw new Error('tui: no session identity available')
    }

    const resolved: ResolvedTuiConfig = resolveTuiConfig(config)
    const t: Translator = createTranslator(resolved.locale)
    const truecolor = resolved.theme.truecolor || detectTruecolor()
    // Runtime theme state; `/theme` swaps `themeName` and re-paints in place.
    const settings = ctx.settings
    const tuiSettings = settings?.register(TUI_SETTINGS_NAMESPACE, TuiSettingsSchema, {
      base: { themeName: resolved.theme.name },
    })
    interface ProviderModelProfile {
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
    }
    interface ConfiguredProviderProfile {
      apiKeyEnv?: string
      displayName?: string
      api?: string
      baseURL?: string
      models?: ProviderModelProfile[]
    }
    const asRecord = (value: unknown): Record<string, unknown> | undefined => (
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
    )
    const readPath = (value: unknown, path: readonly string[]): unknown => {
      let current = value
      for (const key of path) {
        const record = asRecord(current)
        if (record === undefined) return undefined
        current = record[key]
      }
      return current
    }
    const configurableProviderList = (): LlmConfigurableProvider[] => (
      typeof ctx.llm.listConfigurableProviders === 'function'
        ? ctx.llm.listConfigurableProviders()
        : []
    )
    const readConfiguredProvider = (entry: LlmConfigurableProvider): ConfiguredProviderProfile | undefined => {
      const value = readPath(settings?.get(settingsNamespace(entry.settingsNs)), entry.settingsPath)
      const record = asRecord(value)
      if (record === undefined) return undefined
      const profile: ConfiguredProviderProfile = {}
      if (typeof record.apiKeyEnv === 'string') profile.apiKeyEnv = record.apiKeyEnv
      if (typeof record.displayName === 'string') profile.displayName = record.displayName
      if (typeof record.api === 'string') profile.api = record.api
      if (typeof record.baseURL === 'string') profile.baseURL = record.baseURL
      if (Array.isArray(record.models) && record.models.length > 0) {
        const models = record.models.flatMap(model => {
          if (typeof model === 'string') return [{ id: model }]
          const modelRecord = asRecord(model)
          return typeof modelRecord?.id === 'string'
            ? [{
              id: modelRecord.id,
              ...(typeof modelRecord.name === 'string' ? { name: modelRecord.name } : {}),
              ...(typeof modelRecord.contextWindow === 'number' ? { contextWindow: modelRecord.contextWindow } : {}),
              ...(typeof modelRecord.maxTokens === 'number' ? { maxTokens: modelRecord.maxTokens } : {}),
            }]
            : []
        })
        if (models.length > 0) profile.models = models
      }
      return profile
    }
    const configuredProviderProfiles = (): Readonly<Record<string, ConfiguredProviderProfile>> => {
      const profiles: Record<string, ConfiguredProviderProfile> = {}
      for (const entry of configurableProviderList()) {
        const profile = readConfiguredProvider(entry)
        if (profile !== undefined) profiles[entry.provider] = profile
      }
      return profiles
    }
    // Provider configuration belongs to the adapter that declares it through
    // dsh-llm's configurable-provider directory. The TUI only follows the
    // declared namespace/path and never invents a provider-owned namespace.
    // Runtime theme state; `/theme` and `/settings` repaint in place.
    let themeName = tuiSettings?.get().themeName ?? resolved.theme.name
    // Runtime presentation state; `/settings` can persist these through the
    // same TUI settings namespace.
    let showReasoning = tuiSettings?.get().showReasoning ?? resolved.showReasoning
    let maxToolOutputLines = tuiSettings?.get().maxToolOutputLines ?? resolved.maxToolOutputLines
    const themeCustom: ThemeCustom | undefined = resolved.theme.custom
    const resolveDefaultMode = (): string => ctx.agentPresets?.defaultId ?? resolved.mode
    let uiMode: string = resolveDefaultMode()
    // Roster display names (id → name); refreshed from ctx.agentPresets.list().
    const presetNames = new Map<string, string>()
    const permissionCommand = permissionCommandMetadata(ctx.permissionPresets, t)
    const themeOverride = (): ThemeOverride => ({ name: themeName, custom: themeCustom })
    const palette: Palette = createPalette(resolved.theme.color, 'dark', truecolor, themeOverride())
    const mdTheme = markdownTheme(palette)
    const terminal = new ProcessTerminal()
    // Keep the hardware cursor visible at the editor's real cursor position;
    // IMEs that preview pinyin/composition inline depend on it being shown there.
    const ui = new TUI(terminal, true)
    ui.setClearOnShrink(true)

    // The agent is published asynchronously on the resume path (persistence
    // load), so agent-dependent setup runs in mount() once it is live.
    let agent: Agent | undefined
    let gitBranch: string | undefined
    /** Running token usage for the active session; kept incrementally to avoid rescanning the whole log on every status update. */
    let tokenTotals = { inputTokens: 0, outputTokens: 0 }
    // Agent-scoped helpers handed to the command surface by mount().
    const handles: {
      newAgent: (() => Promise<void>) | undefined
      switchAgent: ((id: SessionId) => Promise<void>) | undefined
      saveSelection: ((selection: ModelSelection) => Promise<void>) | undefined
      setReasoningEffort: ((effort: NonNullable<ModelSelection['reasoningEffort']>) => Promise<void>) | undefined
      selectionRef: ModelSelectionRef | undefined
    } = {
      newAgent: undefined,
      switchAgent: undefined,
      saveSelection: undefined,
      setReasoningEffort: undefined,
      selectionRef: undefined,
    }
    let reasoningEffortCache: { route: string; efforts: readonly LlmReasoningEffortInfo[] } | undefined
    const reasoningEffortsFor = async (selection: ModelSelection): Promise<readonly LlmReasoningEffortInfo[]> => {
      const route = `${selection.provider}\u0000${selection.model}`
      if (reasoningEffortCache?.route === route) return reasoningEffortCache.efforts
      const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
      const efforts = info.reasoning?.efforts ?? []
      reasoningEffortCache = { route, efforts }
      return efforts
    }

    // --- components -------------------------------------------------------
    const chat = new Container()
    const editor = new Editor(ui, {
      borderColor: (text: string) => palette.borderMuted(text),
      selectList: selectTheme(palette),
    } satisfies EditorTheme, {
      paddingX: 1,
      frame: 'none',
      prompt: { first: '', continuation: '' },
    })
    const leftTemplate = parseTuiPromptTemplate(displayInlineText(resolved.theme.leftPrompt))
    const rightTemplate = parseTuiPromptTemplate(displayInlineText(resolved.theme.rightPrompt))
    const promptValue = (valueName: string): string | undefined => ctx.tuiPrompt.get(valueName)
    const statusLine = new StatusLineComponent(leftTemplate, promptValue, palette)
    const todoPanel = new TodoPanelComponent(palette)
    const noticeSlot = new Container()
    const notice = new Text('', 1, 0)
    const askSlot = new Container()
    let commandHintText: string | undefined
    const commandHint = new CommandHintComponent(() => commandHintText, palette)
    const inputBorder = new InputBorderComponent(palette)
    const footer = new ComposerFooterComponent(rightTemplate, promptValue, palette)
    let noticeMounted = false
    let noticeTimer: NodeJS.Timeout | undefined

    ui.addChild(chat)
    ui.addChild(todoPanel)
    ui.addChild(noticeSlot)
    ui.addChild(statusLine)
    ui.addChild(askSlot)
    ui.addChild(editor)
    ui.addChild(commandHint)
    ui.addChild(inputBorder)
    ui.addChild(footer)
    ui.setFocus(editor)
    terminal.setTitle(resolved.title)

    // --- prompt values ----------------------------------------------------
    const cwdValue = ctx.tuiPrompt.register('cwd')
    const cwdCompactValue = ctx.tuiPrompt.register('cwd/compact')
    const gitValue = ctx.tuiPrompt.register('git/worktree')
    const gitCompactValue = ctx.tuiPrompt.register('git/worktree/compact')
    const modeValue = ctx.tuiPrompt.register('mode')
    const modeCompactValue = ctx.tuiPrompt.register('mode/compact')
    const modelValue = ctx.tuiPrompt.register('model')
    const modelCompactValue = ctx.tuiPrompt.register('model/compact')
    const effortValue = ctx.tuiPrompt.register('effort')
    const effortCompactValue = ctx.tuiPrompt.register('effort/compact')
    const tokensValue = ctx.tuiPrompt.register('tokens')
    const contextValue = ctx.tuiPrompt.register('context')
    const contextCompactValue = ctx.tuiPrompt.register('context/compact')
    const permissionValue = ctx.tuiPrompt.register('permission')
    const permissionCompactValue = ctx.tuiPrompt.register('permission/compact')
    const queuedValue = ctx.tuiPrompt.register('queued')
    const symbolValue = ctx.tuiPrompt.register('symbol')
    const indicatorValue = ctx.tuiPrompt.register('indicator')

    const updateInputPrompt = (): void => {
      const indicator = ctx.tuiPrompt.get('indicator') ?? ''
      const first = indicator === '' ? '' : `${indicator} `
      editor.setPrompt({ first, continuation: ' '.repeat(visibleWidth(first)) })
    }

    const appendNotice = (text: string, kind: 'info' | 'warning' | 'error'): void => {
      const color = kind === 'error'
        ? palette.error
        : kind === 'warning' ? palette.warning : palette.dim
      notice.setText(color(displayInlineText(text)))
      if (!noticeMounted) {
        noticeSlot.addChild(notice)
        noticeMounted = true
      }
      clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => {
        if (noticeMounted) {
          noticeSlot.removeChild(notice)
          noticeMounted = false
        }
        ui.requestRender()
      }, 5000)
      ui.requestRender()
    }

    const warnIfFullAccess = (target: Agent): void => {
      if (ctx.permissionPresets.current(target.session.events) === FULL_ACCESS_REGISTRY_NAME) {
        appendNotice(t('noticeFullAccessWarning'), 'warning')
      }
    }

    // 微信桥输出不直接写 stderr：日志/二维码作为持久化文本进入 transcript，
    // 与 `/help` 的静态卡片一样保留在终端中，且不会越过差分渲染器覆盖输入框。
    const subscribeWechatOutput = (): void => {
      if (offWechatOutput !== undefined) return
      let bridge: WechatBridge | undefined
      try {
        bridge = ctx.get('wechat') as WechatBridge | undefined
      } catch {
        bridge = undefined
      }
      if (bridge?.subscribeOutput === undefined) return
      offWechatOutput = bridge.subscribeOutput((message) => {
        if (message.kind === 'qr') {
          // 二维码保持无边框等宽文本，避免卡片边框影响扫码。
          chat.addChild(new Spacer(1))
          chat.addChild(new Text(displayText(message.text), 1, 0))
        } else {
          const rows = displayText(message.text)
            .split('\n')
            .map(line => palette.muted(`[dsh-wechat-ilink] ${line}`))
          chat.addChild(new StaticCardComponent(rows, palette))
        }
        ui.requestRender()
      })
    }

    // --- status -----------------------------------------------------------
    let currentScheme: TerminalColorScheme = 'dark'
    let spinnerTimer: NodeJS.Timeout | undefined
    let spinnerIndex = 0
    let estimatedContextWindow = DEFAULT_CONTEXT_WINDOW
    let contextEstimateRevision = 0

    const startSpinner = (): void => {
      if (spinnerTimer !== undefined) return
      spinnerIndex = 0
      spinnerTimer = setInterval(() => {
        spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length
        indicatorValue.set(palette.bold(palette.accent(SPINNER_FRAMES[spinnerIndex] ?? '')))
        updateInputPrompt()
        ui.requestRender()
      }, SPINNER_INTERVAL_MS)
    }

    const stopSpinner = (): void => {
      if (spinnerTimer === undefined) return
      clearInterval(spinnerTimer)
      spinnerTimer = undefined
      indicatorValue.set(undefined)
      updateInputPrompt()
    }

    const updateStatusValues = (): void => {
      const current = agent
      if (current === undefined) return
      const cwd = displayText(current.session.header.cwd ?? process.cwd())
      cwdValue.set(palette.path(` ${cwd}`))
      cwdCompactValue.set(palette.path(` ${displayText(basename(cwd))}`))
      gitValue.set(gitBranch === undefined
        ? undefined
        : ` ${palette.statusSep('')} ${palette.git(` ${displayText(gitBranch)}`)}`)
      gitCompactValue.set(gitBranch === undefined
        ? undefined
        : palette.git(` ${displayText(gitBranch)}`))
      const mode = modeLabel(t, uiMode, presetNames)
      const compactMode = visibleWidth(mode) <= visibleWidth(uiMode) ? mode : uiMode
      modeValue.set(`${palette.accent(mode)} ${palette.statusSep('')} `)
      modeCompactValue.set(palette.accent(displayText(compactMode)))
      const selection = handles.selectionRef?.current
      const model = selection?.model ?? current.options.model
      modelValue.set(model === undefined ? undefined : palette.model(displayText(model)))
      modelCompactValue.set(model === undefined ? undefined : palette.model(displayText(model)))
      const effort = selection?.reasoningEffort
      effortValue.set(effort === undefined
        ? undefined
        : ` ${palette.muted('·')} ${palette.accent(displayText(effort))}`)
      effortCompactValue.set(effort === undefined ? undefined : palette.accent(displayText(effort)))
      tokensValue.set(` ${palette.muted('·')} ${palette.spend(`↑${formatTokens(tokenTotals.inputTokens)} ↓${formatTokens(tokenTotals.outputTokens)}`)}`)
      const recordedContext = current.session.requestContext()
      const recordedWindow = recordedContext !== undefined
        && selection !== undefined
        && recordedContext.provider === selection.provider
        && recordedContext.model === selection.model
        ? recordedContext.contextWindow
        : undefined
      const contextWindow = recordedWindow ?? estimatedContextWindow
      let totalTokens = 0
      try {
        totalTokens = ctx.tokenMeter.measure(current.session).totalTokens
      } catch {
        // Before assembly, some providers cannot estimate the input. Show the
        // required zero fallback rather than hiding the context segment.
      }
      const contextText = `ctx ${formatContextTokens(totalTokens)}/${formatContextTokens(contextWindow)}`
      contextValue.set(` ${palette.muted('·')} ${palette.context(contextText)}`)
      contextCompactValue.set(palette.context(contextText))
      const permission = ctx.permissionPresets.current(current.session.events)
      const permissionRole = permission === FULL_ACCESS_REGISTRY_NAME
        ? (text: string) => palette.bold(palette.accent(text))
        : permission === 'read-only' ? palette.muted : palette.accent
      const permissionText = permissionRole(displayText(displayPermissionName(permission)))
      permissionValue.set(` ${palette.muted('·')} ${permissionText}`)
      permissionCompactValue.set(permissionText)
      queuedValue.set(undefined)
      symbolValue.set(undefined)
      updateInputPrompt()
    }

    const refreshGitBranch = (workspace: string): void => {
      const target = agent
      gitBranch = undefined
      void readGitBranch(workspace).then(branch => {
        if (agent !== target) return
        gitBranch = branch
        updateStatusValues()
        ui.requestRender()
      })
    }

    const refreshContextEstimate = (target: Agent, selection: ModelSelection): void => {
      const revision = ++contextEstimateRevision
      const recorded = target.session.requestContext()
      const recordedWindow = recorded !== undefined
        && recorded.provider === selection.provider
        && recorded.model === selection.model
        ? recorded.contextWindow
        : undefined
      estimatedContextWindow = recordedWindow ?? DEFAULT_CONTEXT_WINDOW
      if (target.id === agent?.id) {
        updateStatusValues()
        ui.requestRender()
      }
      if (recordedWindow !== undefined) return
      void ctx.llm.resolveModelInfo(selection.provider, selection.model).then((info) => {
        if (revision !== contextEstimateRevision || target.id !== agent?.id) return
        estimatedContextWindow = info.context?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
        updateStatusValues()
        ui.requestRender()
      }).catch(() => {
        // The 1m fallback remains visible when exact model metadata is unavailable.
      })
    }

    const setStatus = (status: AgentStatus): void => {
      editor.borderColor = status === 'running'
        ? (text: string) => palette.accent(text)
        : (text: string) => palette.borderMuted(text)
      if (status === 'running') startSpinner()
      else stopSpinner()
      terminal.setProgress(status === 'running')
      updateStatusValues()
      ui.requestRender()
    }

    // --- transcript ---------------------------------------------------------
    const assistantStream = new AssistantStreamController(chat, palette, mdTheme)
    const toolCards = new Map<CallId, ToolCardComponent>()
    const allToolCards = new Set<ToolCardComponent>()
    let toolsVisibility: ToolCardVisibility = 'collapsed'
    let live = false
    let header: HeaderComponent | undefined

    const renderEvent = (event: SessionEvent, syncStatus = true, notify = true): void => {
      switch (event.type) {
        case 'user/message': {
          const source = event.data.source
          const text = displayText(contentText(event.data.content).trim())
          if (text === '') break
          chat.addChild(new Spacer(1))
          if (source.kind !== 'user') {
            const label = source.kind === 'plugin' ? source.plugin : source.kind
            chat.addChild(new ContextCardComponent(label, text, maxToolOutputLines, palette))
          } else {
            chat.addChild(new UserMessageComponent(text, palette, mdTheme))
          }
          break
        }
        case 'step/start':
          assistantStream.start(showReasoning)
          break
        case 'assistant/chunk':
          assistantStream.update(event.data.chunk)
          break
        case 'assistant/message':
          assistantStream.settle(event.data.message.content)
          if (event.data.usage !== undefined) {
            tokenTotals.inputTokens += event.data.usage.inputTokens
            tokenTotals.outputTokens += event.data.usage.outputTokens
          }
          break
        case 'step/end':
          assistantStream.end()
          break
        case 'tool/call': {
          const card = new ToolCardComponent(
            event.data.name,
            event.data.arguments,
            maxToolOutputLines,
            palette,
          )
          card.setVisibility(toolsVisibility)
          toolCards.set(event.data.callId, card)
          allToolCards.add(card)
          chat.addChild(card)
          break
        }
        case 'tool/result': {
          const callId = event.data.message.content[0]?.toolCallId
          if (callId !== undefined) toolCards.get(callId)?.updateResult(event.data)
          break
        }
        case 'todo/write':
          todoPanel.setTodos(event.data.todos)
          break
        case 'goal/change':
          if (event.data.operation === 'clear') {
            todoPanel.setGoal(undefined)
          } else {
            todoPanel.setGoal({ objective: event.data.goal.objective, phase: event.data.goal.phase })
          }
          break
        case 'compaction/start':
          if (live && notify) appendNotice(t('noticeCompacting'), 'info')
          break
        case 'compaction/end':
          if (live && notify) {
            appendNotice(
              event.data.error === undefined ? t('noticeCompactionDone') : t('noticeCompactionFailed', { error: event.data.error }),
              event.data.error === undefined ? 'info' : 'error',
            )
          }
          break
        case 'turn/end': {
          // Detach the live streaming slot so straggler chunks that arrive
          // after an abort cannot keep appending to the interrupted step;
          // its rendered partial content stays in the transcript.
          assistantStream.end()
          if (live && notify && event.data.reason.kind !== 'completed') {
            appendNotice(t('noticeTurnEnded', { reason: event.data.reason.kind }), 'warning')
          }
          break
        }
        default:
          break
      }
      if (syncStatus) updateStatusValues()
    }

    const rebuildTranscript = (): void => {
      assistantStream.end()
      toolCards.clear()
      allToolCards.clear()
      chat.clear()
      tokenTotals = { inputTokens: 0, outputTokens: 0 }
      if (header !== undefined) chat.addChild(header)
      for (const event of agent!.session.events) renderEvent(event, false, false)
      updateStatusValues()
    }

    // --- input ---------------------------------------------------------------
    const toggleTools = (): void => {
      toolsVisibility = toolsVisibility === 'collapsed' ? 'expanded'
        : toolsVisibility === 'expanded' ? 'hidden' : 'collapsed'
      for (const card of allToolCards) card.setVisibility(toolsVisibility)
      appendNotice(t('noticeToolCards', { visibility: toolsVisibility }), 'info')
    }

    const recordActivePreset = (target: Agent): void => {
      const mounted = ctx.agentPresets?.composedPreset(target.ctx)
      const preset = mounted ?? resolveSessionPreset(target.session)
        ?? (target.id === agent?.id ? uiMode : undefined)
      if (preset !== undefined) recordConversationPreset(target.session, preset)
    }

    const toggleReasoning = (): void => {
      showReasoning = !showReasoning
      appendNotice(showReasoning ? t('noticeReasoningShown') : t('noticeReasoningHidden'), 'info')
    }

    const runCommand = async (line: string): Promise<void> => {
      const current = agent
      if (current === undefined) return
      if (line === '/palette' || line.startsWith('/palette ')) {
        const rows = renderPalette(palette, currentScheme, resolved.theme.color, truecolor)
        chat.addChild(new StaticCardComponent(rows, palette))
        ui.requestRender()
        return
      }
      // The TUI presents the unrestricted preset as `full-access`; the host
      // registry still knows it as `danger-full-access`, so translate before
      // handing the slash command to the backend.
      const permissionMatch = /^\/permission(?:\s+(.*))?$/.exec(line)
      if (permissionMatch !== null) {
        const arg = permissionMatch[1]?.trim() ?? ''
        line = arg === '' ? '/permission' : `/permission ${registryPermissionName(arg)}`
      }
      if (line === '/model' || line.startsWith('/model ')) {
        const save = handles.saveSelection
        if (save === undefined) return
        try {
          await runModelFlow(ui, palette, t, ctx.llm, save)
        } catch (error: unknown) {
          appendNotice(t('noticeModelFailed', { error: errorChain(error) }), 'error')
        }
        ui.requestRender()
        return
      }
      if (line === '/think' || line.startsWith('/think ')) {
        const selection = handles.selectionRef?.current
        const setEffort = handles.setReasoningEffort
        if (selection === undefined || setEffort === undefined) return
        try {
          const efforts = await reasoningEffortsFor(selection)
          const choice = chooseReasoningEffort(
            efforts,
            selection.reasoningEffort,
            line.slice('/think'.length).trim(),
          )
          if (choice.kind === 'unsupported') {
            appendNotice(t('noticeThinkUnsupported'), 'warning')
            return
          }
          if (choice.kind === 'unknown') {
            appendNotice(t('noticeThinkUnknown', { name: choice.requested }), 'warning')
            return
          }
          const params = { name: displayText(choice.effort.name), id: displayText(choice.effort.id) }
          if (choice.kind === 'already') {
            appendNotice(t('noticeThinkAlready', params), 'info')
            return
          }
          await setEffort(choice.effort.id)
          appendNotice(t('noticeThinkSet', params), 'info')
        } catch (error: unknown) {
          appendNotice(t('noticeThinkFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/new' || line.startsWith('/new ')) {
        const creator = handles.newAgent
        if (creator === undefined) return
        appendNotice(t('noticeCreatingSession'), 'info')
        try {
          await creator()
        } catch (error: unknown) {
          appendNotice(t('noticeSessionCreateFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/resume' || line.startsWith('/resume ')) {
        const switcher = handles.switchAgent
        if (switcher === undefined) return
        const explicit = line.slice('/resume'.length).trim()
        if (explicit !== '') {
          await switcher(SessionId(explicit))
          return
        }
        try {
          const records = await ctx.sessionQuery.listSessions()
          const workspace = current.session.header.cwd ?? process.cwd()
          const persisted = filterProjectSessions(records, workspace)
            .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
            .slice(0, RESUME_PICKER_LIMIT)
          if (persisted.length === 0) {
            appendNotice(t('noticeNoSessions'), 'warning')
            return
          }
          const titlesPromise = ctx.sessionQuery.readTitleSnapshots(
            persisted.map(record => record.header.id),
          ).catch(() => [] as Awaited<ReturnType<typeof ctx.sessionQuery.readTitleSnapshots>>)
          let titleTimer: NodeJS.Timeout | undefined
          const timeoutPromise = new Promise<Awaited<ReturnType<typeof ctx.sessionQuery.readTitleSnapshots>>>(
            resolve => { titleTimer = setTimeout(() => resolve([]), RESUME_TITLES_TIMEOUT_MS) },
          )
          // Titles are decorative; if a slow/corrupt session blocks the batch,
          // show the picker after the timeout with untitled labels instead of freezing.
          const titles = await Promise.race([titlesPromise, timeoutPromise])
          clearTimeout(titleTimer)
          const titleById = new Map<string, string | undefined>()
          for (const observation of titles) {
            if (observation.status === 'fulfilled') {
              titleById.set(String(observation.sessionId), observation.value.title?.title)
            }
          }
          const picked = await showOverlay<string>(ui, (done) => new SelectDialog(
            t('resumeTitle'),
            persisted.map(record => ({
              value: String(record.header.id),
              label: titleById.get(String(record.header.id)) ?? t('untitled'),
              description: `${record.header.id} · ${new Date(record.header.createdAt ?? 0).toLocaleString()}`,
            })),
            palette,
            done,
          ))
          if (picked !== undefined) await switcher(SessionId(picked))
        } catch (error: unknown) {
          appendNotice(t('noticeSessionListFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/skills' || line.startsWith('/skills ')) {
        try {
          const snapshot = await ctx.skills.snapshot({ cwd: current.session.header.cwd ?? process.cwd() })
          if (snapshot.skills.length === 0) {
            appendNotice(t('noticeNoSkills'), 'info')
            return
          }
          const rows = snapshot.skills.map(skill =>
            `/${skill.name} — ${skill.description}${skill.source === undefined ? '' : ` (${skill.source})`}`)
          chat.addChild(new StaticCardComponent(rows, palette))
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(t('noticeSkillListFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line.startsWith('/skill:')) {
        const name = line.slice('/skill:'.length).trim()
        if (name === '') {
          appendNotice(t('noticeSkillUsage'), 'warning')
          return
        }
        try {
          const definition = await ctx.skills.get(name, { cwd: current.session.header.cwd ?? process.cwd() })
          if (definition === undefined) {
            appendNotice(t('noticeUnknownSkill', { name }), 'warning')
            return
          }
          recordActivePreset(current)
          current.followup(createUserMessage({
            content: [{ type: 'text', text: renderSkillContent(definition) }],
            source: { kind: 'skill-invocation', name, form: 'instructions' },
          }))
        } catch (error: unknown) {
          appendNotice(t('noticeSkillFailed', { name, error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/details' || line.startsWith('/details ')) {
        const folded = foldSessionTitle(current.session.events)
        const model = handles.selectionRef?.current?.model ?? current.options.model
        let inputTokens = 0
        let outputTokens = 0
        for (const event of current.session.events) {
          if (event.type === 'assistant/message' && event.data.usage !== undefined) {
            inputTokens += event.data.usage.inputTokens
            outputTokens += event.data.usage.outputTokens
          }
        }
        const contextWindow = current.session.requestContext()?.contextWindow
        const usedTokens = ctx.tokenMeter.measure(current.session).totalTokens
        const rows: Array<[string, string]> = [
          ['Title', folded?.title ?? 'untitled'],
          ['Session', String(current.session.id)],
          ['Directory', current.session.header.cwd ?? process.cwd()],
          ['Model', `${current.options.provider ?? '?'}/${model ?? '?'}`],
          ['Agent', `${current.id} · ${current.status}`],
          ['Tokens', `↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`],
          ['Context', contextWindow === undefined
            ? `${formatTokens(usedTokens)} used · capacity unknown`
            : `${Math.round(usedTokens / contextWindow * 100)}% · ${formatTokens(usedTokens)} / ${formatTokens(contextWindow)}`],
        ]
        const labelWidth = Math.max(...rows.map(([label]) => label.length))
        const body = rows.map(([label, value]) =>
          ` ${palette.dim(String(label).padEnd(labelWidth))}  ${displayText(String(value))}`)
        chat.addChild(new StaticCardComponent(body, palette))
        ui.requestRender()
        return
      }
      if (line === '/mode' || line.startsWith('/mode ')) {
        const presets = ctx.agentPresets
        if (presets === undefined) {
          appendNotice(t('noticeModeUnavailable'), 'warning')
          return
        }
        const roster = (await presets.list()).filter(preset => preset.broken === undefined)
        // Cycle order: the roster's own order (shipped first, then any number
        // of locally installed presets), deduplicated against the shipped set.
        const known = roster.length > 0
          ? [...new Set([...MODE_ORDER, ...roster.map(preset => preset.id)])]
          : [...MODE_ORDER]
        const arg = line.slice('/mode'.length).trim()
        if (arg !== '' && !known.includes(arg)) {
          appendNotice(t('noticeModeUnknown', { name: arg }), 'warning')
          return
        }
        const live = presets.composedPreset(current.ctx)
        const currentMode = live ?? uiMode
        const liveIndex = known.indexOf(currentMode)
        const target = arg === ''
          ? known[(liveIndex + 1) % known.length] ?? currentMode
          : arg
        if (currentMode === target) {
          appendNotice(t('noticeModeAlready', { mode: modeLabel(t, target, presetNames) }), 'info')
          return
        }
        // Swapping the composition mid-conversation would leave logged tool
        // calls the new preset cannot make; the official roster only allows
        // switching while the session is blank.
        const produced = hasConversationData(current.session.events)
        if (produced) {
          appendNotice(t('noticeModeNotBlank'), 'warning')
          return
        }
        try {
          if (live === undefined) await presets.mount(current.ctx, target)
          else await presets.recompose(current.ctx, target)
          uiMode = target
          updateStatusValues()
          ui.requestRender()
          appendNotice(t('noticeModeSet', { mode: modeLabel(t, target, presetNames) }), 'info')
        } catch (error: unknown) {
          appendNotice(t('noticeModeSwitchFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/settings' || line.startsWith('/settings ')) {
        if (settings === undefined || tuiSettings === undefined) {
          appendNotice(t('noticeSettingsUnavailable'), 'warning')
          return
        }
        try {
          type SettingsView =
            | 'main'
            | 'theme'
            | 'show-reasoning'
            | 'tool-output-lines'
            | 'title-provider'
            | 'title-model'
            | 'default-permission'
            | 'default-provider'
            | 'default-model'
            | 'default-model-effort'
            | 'default-effort'
            | 'default-mode'
            | 'max-parallel-tool-calls'
            | 'model-actions'
            | 'wechat-progress-enabled'
            | 'wechat-notify'

          interface ProviderCatalogEntry {
            id: string
            name: string
            source: 'registered' | 'configurable'
            configurable?: LlmConfigurableProvider
            profile?: ConfiguredProviderProfile
          }

          const booleanItems: SelectItem[] = [
            { value: 'true', label: t('settingsOn') },
            { value: 'false', label: t('settingsOff') },
          ]
          const toolOutputLineOptions = [3, 6, 10, 20, 50]
          const parallelToolCallOptions = [1, 2, 4, 8, 10, 16, 32]
          const CUSTOM_PROVIDER = '\u0000custom-provider'
          const CUSTOM_MODEL = '\u0000custom-model'
          const EDIT_CUSTOM_PROVIDER = '\u0000edit-custom-provider'
          const EDIT_CUSTOM_MODEL = '\u0000edit-custom-model'

          const wechatBridge = (): WechatBridge | undefined => {
            try {
              return ctx.get('wechat') as WechatBridge | undefined
            } catch {
              return undefined
            }
          }
          const getWechatConfig = (): BridgeConfig | undefined => {
            return wechatBridge()?.getBridgeConfig()
          }
          const setWechatConfig = (next: BridgeConfig): void => {
            const bridge = wechatBridge()
            if (bridge !== undefined) bridge.setBridgeConfig(next)
          }

          let providerCatalog: ProviderCatalogEntry[] = []
          let modelCatalog: Array<{ provider: string; model: string }> = []
          const refreshProviderModelCatalog = async (): Promise<void> => {
            const providers = new Map<string, ProviderCatalogEntry>()
            const configurableProviders = configurableProviderList()
            const configurableIds = new Set(configurableProviders.map(entry => entry.provider))
            const registeredProviders = typeof ctx.llm.listProviders === 'function'
              ? ctx.llm.listProviders()
              : []
            for (const entry of registeredProviders) {
              if (configurableIds.has(entry.id)) {
                providers.set(entry.id, { id: entry.id, name: entry.name, source: 'registered' })
              }
            }
            const profiles = configuredProviderProfiles()
            for (const entry of configurableProviders) {
              const existing = providers.get(entry.provider)
              const profile = profiles[entry.provider]
              if (existing !== undefined) {
                existing.configurable = entry
                existing.profile = profile
                if (profile?.displayName !== undefined && profile.displayName !== '') existing.name = profile.displayName
                else if (existing.name === existing.id) existing.name = entry.displayName
              } else {
                providers.set(entry.provider, {
                  id: entry.provider,
                  name: profile?.displayName || entry.displayName,
                  source: 'configurable',
                  configurable: entry,
                  ...(profile === undefined ? {} : { profile }),
                })
              }
            }
            providerCatalog = [...providers.values()]

            const models = new Map<string, { provider: string; model: string }>()
            const addModel = (provider: string, model: string): void => {
              const key = `${provider}\u0000${model}`
              if (!models.has(key)) models.set(key, { provider, model })
            }
            const modelLoaders: Promise<void>[] = []
            for (const entry of providerCatalog) {
              if (entry.profile?.models !== undefined) {
                for (const model of entry.profile.models) addModel(entry.id, model.id)
                continue
              }
              modelLoaders.push((async () => {
                try {
                  const found = await ctx.llm.listModels(entry.id)
                  for (const model of found) addModel(entry.id, model.id)
                } catch {
                  // Dormant providers may have no live model catalog yet.
                }
              })())
            }
            await Promise.all(modelLoaders)
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            addModel(defaultSelection.provider, defaultSelection.model)
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            if (titleSettings?.provider !== undefined && titleSettings.model !== undefined) {
              addModel(titleSettings.provider, titleSettings.model)
            }
            modelCatalog = [...models.values()]
          }

          const listModelsForProvider = async (provider: string): Promise<Awaited<ReturnType<typeof ctx.llm.listModels>>> => {
            try {
              return await ctx.llm.listModels(provider)
            } catch {
              return []
            }
          }

          const providerModelCount = (provider: string): number => {
            const entry = providerCatalog.find(candidate => candidate.id === provider)
            if (entry?.profile?.models !== undefined) return entry.profile.models.length
            return modelCatalog.filter(model => model.provider === provider).length
          }

          const providerCurrentValue = (provider: string): string => {
            const count = providerModelCount(provider)
            return count > 0 ? t('settingsProviderModelCount', { count }) : '—'
          }

          const modelCurrentValue = (provider: string, model: string): string => {
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            const marks: string[] = []
            if (defaultSelection.provider === provider && defaultSelection.model === model) marks.push('★')
            if (titleSettings?.provider === provider && titleSettings.model === model) marks.push('T')
            if (marks.length > 0) return marks.join(' ')
            return '—'
          }

          const buildModelItems = (): SettingsItem[] => {
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            const titleProvider = titleSettings?.provider ?? current.options.provider ?? 'auto'
            const titleModel = titleSettings?.model ?? current.options.model ?? 'auto'
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            return [
              { value: 'title-model', label: t('settingsTitleModel'), currentValue: `${titleProvider}/${titleModel}` },
              { value: 'provider', label: t('settingsProvider'), currentValue: defaultSelection.provider },
              { value: 'model', label: t('settingsModel'), currentValue: defaultSelection.model },
              { value: 'custom-config', label: t('settingsCustomConfig'), currentValue: `${defaultSelection.provider}/${defaultSelection.model}` },
              { value: 'effort', label: t('settingsDefaultEffort'), currentValue: defaultSelection.reasoningEffort ?? '—' },
            ]
          }
          const buildSettingsTabs = (): SettingsTab[] => {
            const agentLoopSettings = settings.get(settingsNamespace('agent-loop')) as {
              maxParallelToolCalls?: number
            } | undefined
            const maxParallelToolCalls = agentLoopSettings?.maxParallelToolCalls ?? 10
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            const titleProvider = titleSettings?.provider ?? current.options.provider ?? 'auto'
            const titleModel = titleSettings?.model ?? current.options.model ?? 'auto'
            const defaultPermission = displayPermissionName(ctx.permissionPresets.defaultPreset)
            const defaultPreset = (settings.get(settingsNamespace('agent-presets')) as {
              default?: string
            } | undefined)?.default
            const defaultMode = defaultPreset ?? ctx.agentPresets?.defaultId ?? resolved.mode
            const wechatConfig = getWechatConfig()
            return [
              {
                id: 'general',
                label: t('settingsTabGeneral'),
                items: [
                  { value: 'theme', label: t('settingsTheme'), currentValue: themeName },
                  { value: 'show-reasoning', label: t('settingsShowReasoning'), currentValue: showReasoning ? t('settingsOn') : t('settingsOff') },
                  { value: 'tool-output-lines', label: t('settingsToolOutputLines'), currentValue: String(maxToolOutputLines) },
                  { value: 'provider', label: t('settingsDefaultModel'), currentValue: `${defaultSelection.provider}/${defaultSelection.model}` },
                  { value: 'effort', label: t('settingsDefaultEffort'), currentValue: defaultSelection.reasoningEffort ?? '—' },
                  { value: 'title-model', label: t('settingsTitleModel'), currentValue: `${titleProvider}/${titleModel}` },
                  { value: 'permission', label: t('settingsDefaultPermission'), currentValue: defaultPermission },
                  { value: 'default-mode', label: t('settingsDefaultMode'), currentValue: modeLabel(t, defaultMode, presetNames) },
                ],
              },
              {
                id: 'models-providers',
                label: t('settingsTabModelsProviders'),
                items: [
                  { value: '__providers-header', label: t('settingsConfiguredProviders'), currentValue: '' },
                  ...providerCatalog.map(entry => ({
                    value: `provider:${entry.id}`,
                    label: entry.name,
                    currentValue: providerCurrentValue(entry.id),
                  })),
                  { value: 'add-provider', label: t('settingsAddProvider'), currentValue: '' },
                  { value: '__models-header', label: t('settingsConfiguredModels'), currentValue: '' },
                  ...modelCatalog.map(model => ({
                    value: `model:${model.provider}\u0000${model.model}`,
                    label: `${model.provider}/${model.model}`,
                    currentValue: modelCurrentValue(model.provider, model.model),
                  })),
                ],
              },
              {
                id: 'advanced',
                label: t('settingsTabAdvanced'),
                items: [
                  { value: 'max-parallel-tool-calls', label: t('settingsMaxParallelToolCalls'), currentValue: String(maxParallelToolCalls) },
                ],
              },
              {
                id: 'wechat',
                label: t('settingsTabWechat'),
                items: wechatConfig === undefined
                  ? [{ value: 'wechat-unavailable', label: t('settingsWechatUnavailable'), currentValue: '' }]
                  : [
                    { value: 'wechat-progress-enabled', label: t('settingsWechatProgressEnabled'), currentValue: wechatConfig.progress.enabled ? t('settingsOn') : t('settingsOff') },
                    { value: 'wechat-progress-interval', label: t('settingsWechatProgressInterval'), currentValue: String(wechatConfig.progress.interval) },
                    { value: 'wechat-notify', label: t('settingsWechatNotify'), currentValue: wechatConfig.notify ? t('settingsOn') : t('settingsOff') },
                  ],
              },
            ]
          }
          const themeItems: SelectItem[] = BUILTIN_THEMES.map(theme => ({
            value: theme.id,
            label: `${theme.id} — ${theme.label}`,
            description: theme.description,
          }))
          const providerItems = (): SelectItem[] => {
            const registeredProviders = typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []
            const registeredProviderIds = new Set(registeredProviders.map(entry => entry.id))
            return [
              ...registeredProviders.map(entry => ({
                value: entry.id,
                label: entry.name,
              })),
              ...Object.entries(configuredProviderProfiles())
                .filter(([id]) => !registeredProviderIds.has(id))
                .map(([id, profile]) => ({
                  value: id,
                  label: profile.displayName || id,
                })),
              { value: CUSTOM_PROVIDER, label: t('settingsCustomProvider') },
            ]
          }

          const screen = new SettingsScreen(
            buildSettingsTabs()[0]?.items ?? [],
            t('settingsTitle'),
            palette,
            t,
            Math.max(5, terminal.rows - 4),
            terminal.rows,
          )
          await refreshProviderModelCatalog()
          screen.setTabs(buildSettingsTabs(), t('settingsTitle'))
          let view: SettingsView = 'main'
          let viewVersion = 0
          let pendingProvider: string | undefined
          let pendingModel: ModelSelection | undefined
          let pendingModelItems: SelectItem[] = []
          let pendingEfforts: readonly LlmReasoningEffortInfo[] = []
          let busy = false
          let modelActionsBack = false

          const showItems = (
            nextView: Exclude<SettingsView, 'main'>,
            items: SelectItem[],
            title: string,
            selectedValue?: string,
          ): void => {
            view = nextView
            viewVersion++
            screen.setItems(items, title, selectedValue)
            ui.requestRender()
          }
          const showMain = (): void => {
            view = 'main'
            viewVersion++
            pendingProvider = undefined
            pendingModel = undefined
            pendingModelItems = []
            pendingEfforts = []
            modelActionsBack = false
            screen.setTabs(buildSettingsTabs(), t('settingsTitle'))
            ui.requestRender()
          }

          const promptCustom = async (title: string, initialValue?: string): Promise<string | undefined> => {
            const value = await showOverlay<string>(
              ui,
              done => new InputDialog(title, palette, done, t, initialValue),
              { width: '80%', maxHeight: '50%' },
            )
            const trimmed = value?.trim()
            return trimmed === '' ? undefined : trimmed
          }
          const providerPickerItems = (selected: string | undefined): SelectItem[] => {
            const known = new Set([
              ...(typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []).map(entry => entry.id),
              ...Object.keys(configuredProviderProfiles()),
            ])
            const items = providerItems()
            if (selected !== undefined && selected !== CUSTOM_PROVIDER && !known.has(selected)) {
              items.unshift({ value: selected, label: `${selected} — ${t('settingsCustomProvider')}` })
              items.splice(1, 0, { value: EDIT_CUSTOM_PROVIDER, label: t('settingsEditCustomProvider') })
            }
            return items
          }
          const modelPickerItems = (
            models: readonly { id: string; name?: string }[],
            selected: string | undefined,
          ): SelectItem[] => {
            const items: SelectItem[] = [
              ...models.map(entry => ({
                value: entry.id,
                label: entry.id,
                description: entry.name === undefined ? undefined : displayText(entry.name),
              })),
              { value: CUSTOM_MODEL, label: t('settingsCustomModel') },
            ]
            if (selected !== undefined && selected !== CUSTOM_MODEL && !models.some(entry => entry.id === selected)) {
              items.unshift({ value: selected, label: `${selected} — ${t('settingsCustomModel')}` })
              items.splice(1, 0, { value: EDIT_CUSTOM_MODEL, label: t('settingsEditCustomModel') })
            }
            return items
          }


          interface ProviderSettingsTarget {
            ns: SettingsNamespace
            path: string[]
            entry: LlmConfigurableProvider
          }
          const providerSettingsTarget = (
            providerId: string,
            editingId?: string,
          ): ProviderSettingsTarget | undefined => {
            const entries = configurableProviderList()
            const entry = entries.find(candidate => candidate.provider === (editingId ?? providerId))
              ?? (editingId === undefined ? entries.find(candidate => candidate.settingsPath.length > 0) : undefined)
            if (entry === undefined || (editingId === undefined && entry.settingsPath.length === 0)) return undefined
            const path = editingId === undefined
              ? [...entry.settingsPath.slice(0, -1), providerId]
              : [...entry.settingsPath]
            return { ns: settingsNamespace(entry.settingsNs), path, entry }
          }

          const providerDiscoveryNamespace = (providerId: string | undefined): string | undefined => {
            const entries = configurableProviderList()
            const entry = entries.find(candidate => candidate.provider === providerId)
              ?? entries.find(candidate => candidate.settingsPath.length > 0)
              ?? entries[0]
            if (entry === undefined || typeof ctx.llm.discoverModels !== 'function') return undefined
            const runtime = ctx.llm as typeof ctx.llm & {
              listModelDiscoveryNamespaces?: () => readonly string[]
            }
            const namespaces = runtime.listModelDiscoveryNamespaces?.()
            if (namespaces !== undefined && !namespaces.includes(entry.settingsNs)) return undefined
            return entry.settingsNs
          }

          const credentialReference = (providerId: string): string => {
            const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
            return `${normalized || 'DSH_PROVIDER'}_API_KEY`
          }

          const saveProvider = async (providerId: string | undefined, draft: ProviderDraft): Promise<void> => {
            if (settings === undefined) throw new Error('settings unavailable')
            const id = draft.id.trim()
            if (id === '') throw new Error(t('providerIdRequired'))
            if (providerId !== undefined && providerId !== id) throw new Error(t('providerIdInvalid'))
            const target = providerSettingsTarget(id, providerId)
            if (target === undefined) throw new Error(t('settingsDiscoveryUnavailable'))
            const nestedProfile = target.entry.settingsPath.length > 0
            const catalogEntry = configurableProviderList().find(entry => entry.provider === id)
            const isCatalogProvider = catalogEntry?.declared === false || !nestedProfile
            if (nestedProfile && !isCatalogProvider && draft.models.length === 0) throw new Error(t('providerModelsRequired'))

            const apiKeyEnv = draft.apiKeyEnv ?? (draft.apiKey.trim() === '' ? undefined : credentialReference(id))
            if (draft.apiKey.trim() !== '') {
              const credentials = ctx.get('credentials') as { set?: (ref: string, value: string) => Promise<void> } | undefined
              if (credentials?.set === undefined || apiKeyEnv === undefined) {
                throw new Error('credentials service unavailable')
              }
              await credentials.set(apiKeyEnv, draft.apiKey.trim())
            }

            type SettingsMutation =
              | { op: 'set'; path: readonly string[]; value: unknown }
              | { op: 'unset'; path: readonly string[] }
            const ops: SettingsMutation[] = []
            const set = (field: string, value: unknown): void => { ops.push({ op: 'set', path: [...target.path, field], value }) }
            const unset = (field: string): void => { ops.push({ op: 'unset', path: [...target.path, field] }) }
            if (nestedProfile) {
              const displayName = draft.name.trim()
              if (displayName === '' || displayName === id) unset('displayName')
              else set('displayName', displayName)
              if (draft.api.trim() === '') unset('api')
              else set('api', draft.api.trim())
              if (draft.models.length === 0) unset('models')
              else set('models', draft.models.map(model => ({ id: model })))
            }
            if (draft.baseURL.trim() === '') unset('baseURL')
            else set('baseURL', draft.baseURL.trim())
            if (apiKeyEnv !== undefined) set('apiKeyEnv', apiKeyEnv)
            await settings.mutate(target.ns, ops)
            appendNotice(t('noticeProviderSaved'), 'info')
          }
          const openProviderForm = async (providerId?: string): Promise<void> => {
            if (settings === undefined) {
              appendNotice(t('noticeSettingsUnavailable'), 'warning')
              return
            }
            const existing = providerId === undefined ? undefined : providerCatalog.find(candidate => candidate.id === providerId)
            const profile = providerId === undefined ? undefined : configuredProviderProfiles()[providerId]

            let templateId = ''
            let templateName = ''
            if (providerId === undefined) {
              const addableProviders = configurableProviderList().filter(entry => entry.settingsPath.length > 0)
              const templateItems: SelectItem[] = [
                { value: '', label: t('settingsBlankProvider') },
                ...addableProviders.map(entry => ({
                  value: `preset:${entry.provider}`,
                  label: entry.displayName,
                })),
              ]
              const template = await showOverlay<string>(
                ui,
                done => new SelectDialog(t('settingsProviderTemplate'), templateItems, palette, done),
                { width: '70%', maxHeight: '70%' },
              )
              if (template === undefined) return
              if (template.startsWith('preset:')) {
                const presetId = template.slice('preset:'.length)
                const preset = addableProviders.find(entry => entry.provider === presetId)
                templateId = presetId
                templateName = preset?.displayName ?? ''
              }
            }

            const id = providerId ?? templateId
            const catalogEntry = configurableProviderList().find(entry => entry.provider === id)
            const isCatalogProvider = catalogEntry?.declared === false || catalogEntry?.settingsPath.length === 0
            const apiKeyEnv = profile?.apiKeyEnv
            const apiKeyConfigured = apiKeyEnv === undefined
              ? false
              : await (async () => {
                const credentials = ctx.get('credentials') as { describe?: (ref: string) => Promise<{ configured: boolean }> } | undefined
                if (credentials?.describe === undefined) return true
                try {
                  return (await credentials.describe(apiKeyEnv)).configured
                } catch {
                  return false
                }
              })()
            const draft: ProviderDraft = {
              id,
              name: profile?.displayName ?? existing?.name ?? templateName,
              api: profile?.api ?? '',
              baseURL: profile?.baseURL ?? '',
              apiKey: '',
              apiKeyEnv: profile?.apiKeyEnv,
              apiKeyConfigured,
              models: profile?.models?.map(model => model.id)
                ?? modelCatalog.filter(model => model.provider === providerId).map(model => model.model),
            }
            const submitted = await showOverlay<ProviderDraft>(
              ui,
              done => new ProviderForm(
                providerId === undefined ? t('settingsAddProvider') : t('settingsEditProvider'),
                palette,
                t,
                draft,
                done,
                {
                  discover: async (currentDraft) => {
                    if (typeof ctx.llm.discoverModels !== 'function') return undefined
                    const ns = providerDiscoveryNamespace(providerId)
                    if (ns === undefined) return undefined
                    try {
                      const found = await ctx.llm.discoverModels(ns, {
                        ...(providerId !== undefined ? { provider: providerId } : {}),
                        baseURL: currentDraft.baseURL || undefined,
                        apiKey: currentDraft.apiKey || undefined,
                        api: currentDraft.api || undefined,
                      })
                      return found as DiscoveredModel[]
                    } catch (error: unknown) {
                      appendNotice(t('noticeProviderFailed', { error: errorChain(error) }), 'error')
                      return undefined
                    }
                  },
                  pickApi: async () => await showOverlay<string>(
                    ui,
                    done => new SelectDialog(
                      t('settingsApi'),
                      [
                        { value: SUPPORTED_PROVIDER_APIS[0], label: t('settingsApiOpenAiCompletions') },
                        { value: SUPPORTED_PROVIDER_APIS[1], label: t('settingsApiOpenAiResponses') },
                        { value: SUPPORTED_PROVIDER_APIS[2], label: t('settingsApiAnthropicMessages') },
                      ],
                      palette,
                      done,
                    ),
                    { width: '70%', maxHeight: '50%' },
                  ),
                  manageModels: async (currentDraft, discovered) => {
                    const all = [...new Set([
                      ...currentDraft.models,
                      ...discovered.map(model => model.id),
                    ])]
                    return showOverlay<string[]>(
                      ui,
                      done => new ModelListDialog(t('settingsModels'), all, palette, t, done),
                      { width: '90%', maxHeight: '85%' },
                    )
                  }
                },
                {
                  idEditable: providerId === undefined,
                  requireModels: !isCatalogProvider,
                  requireApi: !isCatalogProvider,
                  requireBaseURL: !isCatalogProvider,
                }
              ),
              { width: '90%', maxHeight: '85%' },
            )
            if (submitted === undefined) return
            await saveProvider(providerId, submitted)
            await refreshProviderModelCatalog()
            if (view === 'main') showMain()
          }

          const handleBack = (): void => {
            if (view === 'title-model') {
              showItems('title-provider', providerItems(), t('modelProvider'), pendingProvider)
              return
            }
            if (view === 'default-model') {
              showItems('default-provider', providerItems(), t('modelProvider'), pendingProvider)
              return
            }
            if (view === 'default-model-effort' && modelActionsBack) {
              modelActionsBack = false
              showMain()
              return
            }
            if (view === 'default-model-effort' && pendingProvider !== undefined) {
              showItems(
                'default-model',
                pendingModelItems,
                t('modelTitle', { provider: pendingProvider }),
                pendingModel?.model,
              )
              return
            }
            showMain()
          }

          const handleSelect = async (item: SelectItem): Promise<void> => {
            if (busy) return
            busy = true
            const selectedView = view
            const selectedVersion = viewVersion
            try {
              if (selectedView === 'main') {
                if (item.value === 'theme') {
                  showItems('theme', themeItems, t('settingsTheme'), themeName)
                } else if (item.value === 'show-reasoning') {
                  showItems('show-reasoning', booleanItems, t('settingsShowReasoning'), String(showReasoning))
                } else if (item.value === 'tool-output-lines') {
                  showItems(
                    'tool-output-lines',
                    toolOutputLineOptions.map(value => ({ value: String(value), label: String(value) })),
                    t('settingsToolOutputLines'),
                    String(maxToolOutputLines),
                  )
                } else if (item.value === 'title-model') {
                  const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
                    provider?: string
                  } | undefined
                  showItems(
                    'title-provider',
                    providerPickerItems(titleSettings?.provider ?? current.options.provider),
                    t('modelProvider'),
                    titleSettings?.provider ?? current.options.provider,
                  )
                } else if (item.value === 'default-mode') {
                  const presets = ctx.agentPresets
                  if (presets === undefined) {
                    appendNotice(t('noticeModeUnavailable'), 'warning')
                    return
                  }
                  const presetsList = (await presets.list()).filter(preset => preset.broken === undefined)
                  const defaultMode = (settings.get(settingsNamespace('agent-presets')) as {
                    default?: string
                  } | undefined)?.default ?? presets.defaultId
                  showItems(
                    'default-mode',
                    presetsList.map(preset => ({
                      value: preset.id,
                      label: preset.name === undefined ? preset.id : `${preset.id} — ${preset.name}`,
                      description: preset.description,
                    })),
                    t('settingsDefaultMode'),
                    defaultMode,
                  )
                } else if (item.value === 'max-parallel-tool-calls') {
                  const current = (settings.get(settingsNamespace('agent-loop')) as {
                    maxParallelToolCalls?: number
                  } | undefined)?.maxParallelToolCalls ?? 10
                  showItems(
                    'max-parallel-tool-calls',
                    parallelToolCallOptions.map(value => ({ value: String(value), label: String(value) })),
                    t('settingsMaxParallelToolCalls'),
                    String(current),
                  )
                } else if (item.value === 'wechat-progress-enabled') {
                  const wechatConfig = getWechatConfig()
                  if (wechatConfig === undefined) {
                    appendNotice(t('settingsWechatUnavailable'), 'warning')
                    return
                  }
                  showItems(
                    'wechat-progress-enabled',
                    booleanItems,
                    t('settingsWechatProgressEnabled'),
                    String(wechatConfig.progress.enabled),
                  )
                } else if (item.value === 'wechat-progress-interval') {
                  const wechatConfig = getWechatConfig()
                  if (wechatConfig === undefined) {
                    appendNotice(t('settingsWechatUnavailable'), 'warning')
                    return
                  }
                  const value = await promptCustom(t('settingsWechatProgressInterval'), String(wechatConfig.progress.interval))
                  if (value === undefined) return
                  const next = Number(value)
                  if (!Number.isInteger(next) || next <= 0) {
                    appendNotice(t('noticeWechatInvalidInterval'), 'warning')
                    return
                  }
                  setWechatConfig({ ...wechatConfig, progress: { ...wechatConfig.progress, interval: next } })
                  appendNotice(t('noticeSettingsSaved'), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                } else if (item.value === 'wechat-notify') {
                  const wechatConfig = getWechatConfig()
                  if (wechatConfig === undefined) {
                    appendNotice(t('settingsWechatUnavailable'), 'warning')
                    return
                  }
                  showItems(
                    'wechat-notify',
                    booleanItems,
                    t('settingsWechatNotify'),
                    String(wechatConfig.notify),
                  )
                } else if (item.value === 'wechat-unavailable') {
                  appendNotice(t('settingsWechatUnavailable'), 'warning')
                } else if (item.value === 'permission') {
                  showItems(
                    'default-permission',
                    permissionCommand.options,
                    t('settingsDefaultPermission'),
                    displayPermissionName(ctx.permissionPresets.defaultPreset),
                  )
                } else if (item.value === 'provider') {
                  showItems(
                    'default-provider',
                    providerPickerItems(ctx.agentDefaultModel.currentSelection().provider),
                    t('modelProvider'),
                    ctx.agentDefaultModel.currentSelection().provider,
                  )
                } else if (item.value === 'model') {
                  const defaultSelection = ctx.agentDefaultModel.currentSelection()
                  const provider = defaultSelection.provider
                  let models: Awaited<ReturnType<typeof ctx.llm.listModels>> = []
                  try {
                    models = await listModelsForProvider(provider)
                  } catch {
                    // Keep the list empty and still allow a custom model id.
                  }
                  if (selectedVersion !== viewVersion || view !== selectedView) return
                  pendingProvider = provider
                  pendingModelItems = modelPickerItems(models, defaultSelection.model)
                  showItems(
                    'default-model',
                    pendingModelItems,
                    t('modelTitle', { provider: pendingProvider }),
                    defaultSelection.model,
                  )
                } else if (item.value === 'custom-config') {
                  const defaultSelection = ctx.agentDefaultModel.currentSelection()
                  const draft: CustomModelDraft = {
                    provider: defaultSelection.provider,
                    model: defaultSelection.model,
                    reasoningEffort: defaultSelection.reasoningEffort ?? '',
                    saveDefault: true,
                    saveTitle: false,
                  }
                  const submitted = await showOverlay<CustomModelDraft>(
                    ui,
                    done => new CustomModelForm(t('settingsCustomConfig'), palette, t, draft, done),
                    { width: '90%', maxHeight: '85%' },
                  )
                  if (selectedVersion !== viewVersion || view !== selectedView) return
                  if (submitted === undefined) {
                    ui.requestRender()
                    return
                  }
                  if (submitted.saveDefault) {
                    await ctx.agentDefaultModel.saveSelection({
                      provider: submitted.provider,
                      model: submitted.model,
                      ...submitted.reasoningEffort === ''
                        ? {}
                        : { reasoningEffort: submitted.reasoningEffort as ModelSelection['reasoningEffort'] },
                    })
                  }
                  if (submitted.saveTitle) {
                    await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, {
                      provider: submitted.provider,
                      model: submitted.model,
                    })
                  }
                  appendNotice(t('noticeSettingsSaved'), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                } else if (item.value === 'effort') {
                  const defaultSelection = ctx.agentDefaultModel.currentSelection()
                  pendingEfforts = await reasoningEffortsFor(defaultSelection)
                  if (selectedVersion !== viewVersion || view !== selectedView) return
                  if (pendingEfforts.length === 0) {
                    appendNotice(t('noticeThinkUnsupported'), 'warning')
                    return
                  }
                  showItems(
                    'default-effort',
                    pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                    t('settingsDefaultEffort'),
                    defaultSelection.reasoningEffort,
                  )
                } else if (item.value === 'add-provider') {
                  await openProviderForm()
                } else if (item.value.startsWith('provider:')) {
                  await openProviderForm(item.value.slice('provider:'.length))
                } else if (item.value.startsWith('model:')) {
                  const route = item.value.slice('model:'.length)
                  const separator = route.indexOf('\u0000')
                  if (separator >= 0) {
                    const provider = route.slice(0, separator)
                    const model = route.slice(separator + 1)
                    pendingProvider = provider
                    pendingModel = { provider, model }
                    showItems(
                      'model-actions',
                      [
                        { value: 'set-default', label: t('settingsSetDefaultModel') },
                        { value: 'set-title', label: t('settingsSetTitleModel') },
                        { value: 'set-effort', label: t('settingsDefaultEffort') },
                      ],
                      `${provider}/${model}`,
                    )
                  }
                }
                return
              }

              if (selectedView === 'theme') {
                await tuiSettings.update({ themeName: item.value })
                themeName = item.value
                Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, themeOverride()))
                Object.assign(mdTheme, markdownTheme(palette))
                rebuildTranscript()
                setStatus(current.status)
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                else ui.requestRender()
                return
              }

              if (selectedView === 'show-reasoning') {
                const next = item.value === 'true'
                await tuiSettings.update({ showReasoning: next })
                showReasoning = next
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'tool-output-lines') {
                const next = Number(item.value)
                await tuiSettings.update({ maxToolOutputLines: next })
                maxToolOutputLines = next
                rebuildTranscript()
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-mode') {
                await settings.update(settingsNamespace('agent-presets'), { default: item.value })
                appendNotice(t('noticeDefaultModeSet', { mode: modeLabel(t, item.value, presetNames) }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'max-parallel-tool-calls') {
                const next = Number(item.value)
                await settings.update(settingsNamespace('agent-loop'), { maxParallelToolCalls: next })
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'wechat-progress-enabled') {
                const wechatConfig = getWechatConfig()
                if (wechatConfig === undefined) {
                  appendNotice(t('settingsWechatUnavailable'), 'warning')
                  return
                }
                setWechatConfig({
                  ...wechatConfig,
                  progress: { ...wechatConfig.progress, enabled: item.value === 'true' },
                })
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'wechat-notify') {
                const wechatConfig = getWechatConfig()
                if (wechatConfig === undefined) {
                  appendNotice(t('settingsWechatUnavailable'), 'warning')
                  return
                }
                setWechatConfig({ ...wechatConfig, notify: item.value === 'true' })
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'title-provider') {
                const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
                  provider?: string
                  model?: string
                } | undefined
                const savedProvider = titleSettings?.provider ?? current.options.provider
                const provider = item.value === CUSTOM_PROVIDER
                  ? await promptCustom(t('modelProvider'))
                  : item.value === EDIT_CUSTOM_PROVIDER
                    ? await promptCustom(t('settingsEditCustomProvider'), savedProvider)
                    : item.value
                if (provider === undefined) return
                const models = await listModelsForProvider(provider)
                if (selectedVersion !== viewVersion || view !== selectedView) return
                pendingProvider = provider
                const savedModel = titleSettings?.provider === provider ? titleSettings.model : undefined
                pendingModelItems = modelPickerItems(models, savedModel)
                showItems(
                  'title-model',
                  pendingModelItems,
                  t('modelTitle', { provider: pendingProvider }),
                  savedModel,
                )
                return
              }

              if (selectedView === 'title-model') {
                if (pendingProvider === undefined) return
                const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
                  provider?: string
                  model?: string
                } | undefined
                const savedModel = titleSettings?.provider === pendingProvider ? titleSettings.model : undefined
                const model = item.value === CUSTOM_MODEL
                  ? await promptCustom(t('modelTitle', { provider: pendingProvider }))
                  : item.value === EDIT_CUSTOM_MODEL
                    ? await promptCustom(t('settingsEditCustomModel'), savedModel)
                    : item.value
                if (model === undefined) return
                await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, { provider: pendingProvider, model })
                const sessionTitle = ctx.get('sessionTitle')
                if (sessionTitle !== undefined) void sessionTitle.refresh(current.session).catch(() => undefined)
                appendNotice(t('noticeTitleModelSet', { provider: pendingProvider, model }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-permission') {
                const registryName = registryPermissionName(item.value)
                await settings.update(PERMISSION_SETTINGS_NAMESPACE, { defaultPreset: registryName })
                appendNotice(t('noticeDefaultPermissionSet', { permission: displayPermissionName(registryName) }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-provider') {
                const defaultSelection = ctx.agentDefaultModel.currentSelection()
                const savedProvider = defaultSelection.provider
                const provider = item.value === CUSTOM_PROVIDER
                  ? await promptCustom(t('modelProvider'))
                  : item.value === EDIT_CUSTOM_PROVIDER
                    ? await promptCustom(t('settingsEditCustomProvider'), savedProvider)
                    : item.value
                if (provider === undefined) return
                const models = await listModelsForProvider(provider)
                if (selectedVersion !== viewVersion || view !== selectedView) return
                pendingProvider = provider
                const savedModel = defaultSelection.provider === provider ? defaultSelection.model : undefined
                pendingModelItems = modelPickerItems(models, savedModel)
                showItems(
                  'default-model',
                  pendingModelItems,
                  t('modelTitle', { provider: pendingProvider }),
                  savedModel,
                )
                return
              }

              if (selectedView === 'default-model') {
                if (pendingProvider === undefined) return
                const defaultSelection = ctx.agentDefaultModel.currentSelection()
                const savedModel = defaultSelection.provider === pendingProvider ? defaultSelection.model : undefined
                const model = item.value === CUSTOM_MODEL
                  ? await promptCustom(t('modelTitle', { provider: pendingProvider }))
                  : item.value === EDIT_CUSTOM_MODEL
                    ? await promptCustom(t('settingsEditCustomModel'), savedModel)
                    : item.value
                if (model === undefined) return
                const selectedModel: ModelSelection = { provider: pendingProvider, model }
                try {
                  const info = await ctx.llm.resolveModelInfo(pendingProvider, model)
                  pendingEfforts = info.reasoning?.efforts ?? []
                } catch {
                  pendingEfforts = []
                }
                if (selectedVersion !== viewVersion || view !== selectedView) return
                pendingModel = selectedModel
                if (pendingEfforts.length > 1) {
                  modelActionsBack = false
                  showItems(
                    'default-model-effort',
                    pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                    t('modelEffort'),
                    defaultSelection.provider === pendingProvider && defaultSelection.model === model
                      ? defaultSelection.reasoningEffort
                      : undefined,
                  )
                } else {
                  await ctx.agentDefaultModel.saveSelection(selectedModel)
                  appendNotice(t('noticeDefaultModelSet', { provider: selectedModel.provider, model: selectedModel.model }), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                }
                return
              }

              if (selectedView === 'default-model-effort') {
                if (pendingModel === undefined) return
                await ctx.agentDefaultModel.saveSelection({
                  ...pendingModel,
                  reasoningEffort: item.value as ModelSelection['reasoningEffort'],
                })
                appendNotice(t('noticeDefaultModelSet', { provider: pendingModel.provider, model: pendingModel.model }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-effort') {
                const currentDefault = ctx.agentDefaultModel.currentSelection()
                await ctx.agentDefaultModel.saveSelection({
                  ...currentDefault,
                  reasoningEffort: item.value as ModelSelection['reasoningEffort'],
                })
                appendNotice(t('noticeDefaultEffortSet', { effort: item.label }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'model-actions') {
                if (pendingModel === undefined) return
                if (item.value === 'set-default') {
                  const selectedModel = pendingModel
                  try {
                    const info = await ctx.llm.resolveModelInfo(selectedModel.provider, selectedModel.model)
                    pendingEfforts = info.reasoning?.efforts ?? []
                  } catch {
                    pendingEfforts = []
                  }
                  if (pendingEfforts.length > 1) {
                    modelActionsBack = true
                    showItems(
                      'default-model-effort',
                      pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                      t('modelEffort'),
                      ctx.agentDefaultModel.currentSelection().provider === selectedModel.provider &&
                        ctx.agentDefaultModel.currentSelection().model === selectedModel.model
                        ? ctx.agentDefaultModel.currentSelection().reasoningEffort
                        : undefined,
                    )
                  } else {
                    await ctx.agentDefaultModel.saveSelection(selectedModel)
                    appendNotice(t('noticeDefaultModelSet', { provider: selectedModel.provider, model: selectedModel.model }), 'info')
                    if (selectedVersion === viewVersion && view === selectedView) showMain()
                  }
                } else if (item.value === 'set-title') {
                  await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, {
                    provider: pendingModel.provider,
                    model: pendingModel.model,
                  })
                  const sessionTitle = ctx.get('sessionTitle')
                  if (sessionTitle !== undefined) void sessionTitle.refresh(current.session).catch(() => undefined)
                  appendNotice(t('noticeTitleModelSet', { provider: pendingModel.provider, model: pendingModel.model }), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                } else if (item.value === 'set-effort') {
                  pendingEfforts = await reasoningEffortsFor(pendingModel)
                  if (pendingEfforts.length === 0) {
                    appendNotice(t('noticeThinkUnsupported'), 'warning')
                    return
                  }
                  modelActionsBack = true
                  showItems(
                    'default-model-effort',
                    pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                    t('modelEffort'),
                    ctx.agentDefaultModel.currentSelection().provider === pendingModel.provider &&
                      ctx.agentDefaultModel.currentSelection().model === pendingModel.model
                      ? ctx.agentDefaultModel.currentSelection().reasoningEffort
                      : undefined,
                  )
                }
              }
            } catch (error: unknown) {
              appendNotice(t('noticeSettingsFailed', { error: errorChain(error) }), 'error')
            } finally {
              busy = false
            }
          }

          screen.onSelect = (item) => {
            void handleSelect(item)
          }
          screen.onBack = handleBack

          const handle = ui.showOverlay(screen, { anchor: 'top-left', width: '100%', maxHeight: '100%', margin: 0 })
          await new Promise<void>((resolve) => {
            screen.onClose = () => {
              handle.hide()
              resolve()
            }
          })
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(t('noticeSettingsFailed', { error: errorChain(error) }), 'error')
        }
        return
      }

      if (line === '/theme' || line.startsWith('/theme ')) {
        const arg = line.slice('/theme'.length).trim()
        if (arg !== '') {
          const known = findTheme(arg)
          if (known === undefined) {
            appendNotice(t('noticeThemeUnknown', { name: arg }), 'warning')
            return
          }
          themeName = known.id
          if (tuiSettings !== undefined) {
            try {
              await tuiSettings.update({ themeName })
            } catch (error: unknown) {
              appendNotice(t('noticeSettingsFailed', { error: errorChain(error) }), 'error')
            }
          }
          Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, themeOverride()))
          Object.assign(mdTheme, markdownTheme(palette))
          rebuildTranscript()
          setStatus(current.status)
          ui.requestRender()
          appendNotice(t('noticeThemeSet', { name: themeName }), 'info')
          return
        }
        const rows = [
          palette.bold(palette.accent(`${t('themeCurrent')}: ${themeName}`)),
          '',
          ...BUILTIN_THEMES.map(theme =>
            ` ${theme.id} — ${theme.label}: ${theme.description}`),
          ...themeCustom === undefined
            ? [palette.dim(` ${t('themeCustomNote')}`)]
            : [palette.dim(` ${t('themeCurrent')}: ${themeName} + custom overrides`), ''],
        ]
        chat.addChild(new StaticCardComponent(rows, palette))
        ui.requestRender()
        return
      }
      if (line === '/help' || line.startsWith('/help ')) {
        const commandRows = ctx.commands.list(current).map(command => {
          const permission = command.name === 'permission'
          const hint = permission ? permissionCommand.argumentHint : command.input?.hint
          const description = permission ? t('helpPermission') : command.description
          return `/${command.name}${hint === undefined ? '' : ` ${hint}`} — ${description}`
        })
        const rows = [
          palette.bold(palette.accent(t('helpShortcuts'))),
          '',
          `${palette.dim('Ctrl+C')}  ${t('helpCtrlC')}`,
          `${palette.dim('Ctrl+O')}  ${t('helpCtrlO')}`,
          `${palette.dim('Ctrl+R')}  ${t('helpCtrlR')}`,
          '',
          palette.bold(palette.accent(t('helpCommands'))),
          `/palette — ${t('helpPalette')}`,
          `/help — ${t('helpHelp')}`,
          `/model — ${t('helpModel')}`,
          `/think [level] — ${t('helpThink')}`,
          `/new — ${t('helpNew')}`,
          `/resume — ${t('helpResume')}`,
          `/details — ${t('helpDetails')}`,
          `/skills — ${t('helpSkills')}`,
          `/skill:<name> — ${t('helpSkillInvoke')}`,
          `/mode — ${t('helpMode')}`,
          `/theme — ${t('helpTheme')}`,
          `/settings — ${t('helpSettings')}`,
          ...commandRows,
        ]
        chat.addChild(new StaticCardComponent(rows, palette))
        ui.requestRender()
        return
      }
      const execution = await ctx.commands.execute(current, line, new AbortController().signal)
      if (execution === undefined) {
        appendNotice(t('noticeUnknownCommand', {
          name: line.slice(1, line.indexOf(' ') === -1 ? undefined : line.indexOf(' ')),
        }), 'warning')
        return
      }
      const result = execution.result
      const resultText = result.text?.replaceAll(FULL_ACCESS_REGISTRY_NAME, FULL_ACCESS_UI_NAME)
      const isWechatCommand = line.startsWith('/wechat-')
      if (isWechatCommand && resultText !== undefined && resultText !== '') {
        // 微信桥命令结果与二维码/日志一样持久化到 transcript，避免自动消失。
        const color = result.kind === 'error' ? palette.error : palette.text
        chat.addChild(new StaticCardComponent(
          displayText(resultText).split('\n').map(row => color(row)),
          palette,
        ))
        ui.requestRender()
        return
      }
      if (result.kind === 'error') {
        appendNotice(resultText ?? '', 'error')
      } else if (resultText !== undefined && resultText !== '') {
        appendNotice(resultText, 'info')
      }
    }

    editor.onSubmit = (text: string): void => {
      const current = agent
      if (current === undefined) return
      const trimmed = text.trim()
      if (trimmed === '') return
      editor.addToHistory(text)
      if (trimmed.startsWith('/')) {
        void runCommand(trimmed)
        return
      }
      const refreshTitle = (): void => {
        const sessionTitle = ctx.get('sessionTitle')
        if (sessionTitle !== undefined && foldSessionTitle(current.session.events) === undefined) {
          void sessionTitle.refresh(current.session).catch(() => undefined)
        }
      }
      // `@[label](dsh-session:…)` mentions lift another session's surface
      // into this one: prepare attaches the snapshot and injects the
      // additional context without a model turn.
      const parsed = parseSessionReferenceText(text)
      if (parsed.references.length > 0) {
        void (async () => {
          try {
            const prepared = await ctx.sessionReferenceResolver.prepare(
              current,
              [{ type: 'text', text: parsed.text }],
              parsed.references,
            )
            // Inject first (queues context without waking), then follow up:
            // the waking driver claims both at the next pre-step, so the
            // model sees the referenced snapshot from the first step.
            if (prepared.additionalContext !== undefined) {
              current.inject(prepared.additionalContext)
            }
            recordActivePreset(current)
            current.followup(createUserMessage({ content: prepared.content, source: { kind: 'user' } }))
            refreshTitle()
          } catch (error: unknown) {
            appendNotice(t('noticeReferenceFailed', { error: errorChain(error) }), 'error')
          }
        })()
        return
      }
      recordActivePreset(current)
      current.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      refreshTitle()
    }

    // First Ctrl+C interrupts the running turn (or hints at the exit path
    // when idle); a second press within the window requests process exit
    // through the launcher's bounded `appExit` hook.
    let exitArmed = false
    let exitArmTimer: NodeJS.Timeout | undefined
    const EXIT_ARM_WINDOW_MS = 2000

    const offKeys = ui.addInputListener((data) => {
      if (matchesKey(data, 'ctrl+c')) {
        if (exitArmed) {
          clearTimeout(exitArmTimer)
          exitArmed = false
          ctx.appExit?.(0)
          return {}
        }
        exitArmed = true
        clearTimeout(exitArmTimer)
        exitArmTimer = setTimeout(() => {
          exitArmed = false
        }, EXIT_ARM_WINDOW_MS)
        if (agent?.status === 'running') {
          agent.cancel({ kind: 'user' })
        } else {
          appendNotice(t('noticeExitHint'), 'info')
        }
        return {}
      }
      if (matchesKey(data, 'ctrl+o')) {
        toggleTools()
        return {}
      }
      if (matchesKey(data, 'ctrl+r')) {
        toggleReasoning()
        return {}
      }
      return undefined
    })

    // --- mount: run once the configured agent is live -------------------------
    let offEvent: (() => void) | undefined
    let offStatus: (() => void) | undefined
    let offScheme: (() => void) | undefined
    let offModelSelection: (() => void) | undefined
    let offWechatOutput: (() => void) | undefined
    let activeHandle: AgentHandle | undefined
    let mounted = false

    const mount = (liveAgent: Agent): void => {
      if (mounted) return
      uiMode = modeForSession(liveAgent.session, resolveDefaultMode())
      mounted = true
      agent = liveAgent

      const selectionFor = (target: Agent): ModelSelection => {
        const configured = ctx.agentDefaultModel.currentSelection()
        const fallback: ModelSelection = {
          provider: target.options.provider ?? configured.provider,
          model: target.options.model ?? configured.model,
          ...configured.reasoningEffort === undefined ? {} : { reasoningEffort: configured.reasoningEffort },
        }
        return resolveSessionModelSelection(
          target.session.requestHeader(),
          fallback,
          resolved.defaultReasoningEffort,
        )
      }

      // A historical session continues its last actual request route. A new
      // session starts from the configured Agent route and persisted default effort.
      const initialSelection = selectionFor(liveAgent)
      const selectionRef: ModelSelectionRef = { current: initialSelection, assembled: undefined }
      offModelSelection = installModelSelection(liveAgent.ctx, selectionRef)
      const commitSelection = async (selection: ModelSelection): Promise<void> => {
        selectionRef.current = selection
        refreshContextEstimate(agent ?? liveAgent, selection)
        await ctx.agentDefaultModel.saveSelection(selection)
      }
      const saveSelection = async (selection: ModelSelection): Promise<void> => {
        await commitSelection(selection)
        appendNotice(t('noticeModelSet', { provider: selection.provider, model: selection.model }), 'info')
      }
      const setReasoningEffort = async (effort: NonNullable<ModelSelection['reasoningEffort']>): Promise<void> => {
        const selection = selectionRef.current
        if (selection === undefined) throw new Error('model selection unavailable')
        await commitSelection({ ...selection, reasoningEffort: effort })
      }

      const updateTitle = (): void => {
        const current = agent
        const folded = current === undefined ? undefined : foldSessionTitle(current.session.events)
        terminal.setTitle(folded === undefined ? resolved.title : `${folded.title} — ${resolved.title}`)
      }

      header = new HeaderComponent(
        liveAgent,
        () => undefined,
        palette,
        resolved.theme.color && truecolor,
        t,
        () => selectionRef.current,
      )

      // Slash commands + @ / path completions (pi-tui's combined provider
      // scans the workspace rooted at the session cwd).
      const workspace = liveAgent.session.header.cwd ?? process.cwd()
      refreshGitBranch(workspace)
      const modeOptions: AutocompleteItem[] = [
        { value: 'standard', label: `standard — ${t('modeStandard')}`, description: t('modeStandardHint') },
        { value: 'minimal', label: `minimal — ${t('modeMinimal')}`, description: t('modeMinimalHint') },
        { value: 'code', label: `code — ${t('modeCode')}`, description: t('modeCodeHint') },
        { value: 'cordis', label: `cordis — ${t('modeCordis')}`, description: t('modeCordisHint') },
      ]
      const themeOptions: AutocompleteItem[] = BUILTIN_THEMES.map(theme => ({
        value: theme.id,
        label: `${theme.id} — ${theme.label}`,
        description: theme.description,
      }))
      const commandEntries: SlashCommand[] = [
        { name: 'palette', description: t('cmdPalette') },
        { name: 'help', description: t('cmdHelp') },
        { name: 'model', description: t('cmdModel') },
        {
          name: 'think',
          description: t('cmdThink'),
          argumentHint: '<level>',
          getArgumentCompletions: async (prefix) => {
            const selection = selectionRef.current
            if (selection === undefined) return null
            try {
              const options: AutocompleteItem[] = (await reasoningEffortsFor(selection)).map(effort => ({
                value: effort.id,
                label: `${effort.id} — ${effort.name}`,
                description: effort.description,
              }))
              return filterCommandOptions(options, prefix)
            } catch {
              return null
            }
          },
        },
        { name: 'new', description: t('cmdNew') },
        {
          name: 'resume',
          description: t('cmdResume'),
          argumentHint: '<sessionId>',
          getArgumentCompletions: async (prefix) => {
            try {
              const records = await ctx.sessionQuery.listSessions()
              const options: AutocompleteItem[] = filterProjectSessions(records, workspace)
                .map(record => {
                  const id = String(record.header.id)
                  const created = new Date(record.header.createdAt ?? 0).toLocaleString()
                  return { value: id, label: id, description: created }
                })
              return filterCommandOptions(options, prefix)
            } catch {
              return null
            }
          },
        },
        { name: 'details', description: t('cmdDetails') },
        { name: 'skills', description: t('cmdSkills') },
        {
          name: 'mode',
          description: t('cmdMode'),
          argumentHint: '<standard|minimal|code|cordis|user preset>',
          getArgumentCompletions: async (prefix) => {
            const roster = ctx.agentPresets
            let extra: AutocompleteItem[] = []
            if (roster !== undefined) {
              try {
                const shipped = new Set(modeOptions.map(option => option.value))
                extra = (await roster.list())
                  .filter(preset => preset.broken === undefined && !shipped.has(preset.id))
                  .map(preset => ({
                    value: preset.id,
                    label: `${preset.id} — ${preset.name ?? preset.id}`,
                    description: preset.description,
                  }))
              } catch {
                // Roster unreadable: shipped set only.
              }
            }
            return filterCommandOptions([...modeOptions, ...extra], prefix)
          },
        },
        {
          name: 'theme',
          description: t('cmdTheme'),
          argumentHint: '<catppuccin|tokyo-night>',
          getArgumentCompletions: prefix => filterCommandOptions(themeOptions, prefix),
        },
        { name: 'settings', description: t('cmdSettings') },
        ...ctx.commands.list(liveAgent).map((command): SlashCommand => {
          if (command.name === 'permission') {
            return {
              name: command.name,
              description: t('cmdPermission'),
              argumentHint: permissionCommand.argumentHint,
              getArgumentCompletions: prefix => filterCommandOptions(permissionCommand.options, prefix),
            }
          }
          return {
            name: command.name,
            description: command.description,
            ...command.input === undefined ? {} : { argumentHint: command.input.hint },
          }
        }),
      ]
      const skillCommandNames = new Set<string>()
      const refreshSkillCommands = async (): Promise<void> => {
        try {
          const snapshot = await ctx.skills.snapshot({ cwd: workspace })
          const seen = new Set<string>()
          for (const skill of snapshot.skills) {
            const name = `skill:${skill.name}`
            seen.add(name)
            if (!skillCommandNames.has(name)) {
              skillCommandNames.add(name)
              commandEntries.push({ name, description: t('helpSkillInvoke') })
            }
          }
          for (let index = commandEntries.length - 1; index >= 0; index--) {
            const entry = commandEntries[index]
            if (entry !== undefined && entry.name.startsWith('skill:') && !seen.has(entry.name)) {
              commandEntries.splice(index, 1)
              skillCommandNames.delete(entry.name)
            }
          }
        } catch {
          // Keep the current skill command list if the snapshot fails.
        }
      }
      const baseAutocomplete = new CombinedAutocompleteProvider(commandEntries, workspace)
      editor.setAutocompleteProvider(new SkillAwareAutocompleteProvider(baseAutocomplete))
      void refreshSkillCommands()
      commandHintText = commandInputHint(editor.getText(), commandEntries)
      editor.onChange = (text: string): void => {
        commandHintText = commandInputHint(text, commandEntries)
        ui.requestRender()
      }

      const offQuestions = ctx.userQuestions.registerProvider({
        ask: async (request) => {
          const bridge = ctx.get('wechat') as WechatBridge | undefined
          if (bridge?.askWithFallback !== undefined) {
            return bridge.askWithFallback(request, async (r) => ({
              answers: await runInlineQuestionFlow(
                ui,
                askSlot,
                palette,
                t,
                r.questions,
                r.signal,
                () => ui.setFocus(editor),
              ),
            }))
          }
          return {
            answers: await runInlineQuestionFlow(
              ui,
              askSlot,
              palette,
              t,
              request.questions,
              request.signal,
              () => ui.setFocus(editor),
            ),
          }
        },
      })

      offEvent = ctx.on('session/event', (session, event) => {
        if (session.id !== liveAgent.session.id) return
        if (event.type === 'session/title') updateTitle()
        renderEvent(event)
        updateStatusValues()
        ui.requestRender()
      })

      offStatus = ctx.on('agent/status', ({ agent: candidate, status }) => {
        if (candidate.id !== liveAgent.id) return
        setStatus(status)
      })

      offScheme = ui.onTerminalColorSchemeChange((scheme) => {
        currentScheme = scheme
        Object.assign(palette, createPalette(resolved.theme.color, scheme, truecolor, themeOverride()))
        Object.assign(mdTheme, markdownTheme(palette))
        rebuildTranscript()
        setStatus(agent?.status ?? 'idle')
        ui.requestRender()
      })

      // Compose fresh sessions from the selected mode without recording an
      // event yet. The persistence gate buffers setup metadata, and the actual
      // preset selection is logged immediately before the first user message.
      async function composeAgentPreset(target: Agent): Promise<void> {
        const presets = ctx.agentPresets
        if (presets === undefined || presets.composedPreset(target.ctx) !== undefined) return
        const recorded = resolveSessionPreset(target.session)
        if (recorded === undefined && hasConversationData(target.session.events)) return
        const wanted = recorded ?? uiMode
        try {
          await presets.mount(target.ctx, wanted)
        } catch (error: unknown) {
          appendNotice(t('noticeModeMountFailed', { error: errorChain(error) }), 'error')
        }
      }

      const activateAgent = (next: Agent, handle: AgentHandle): void => {
        const previousHandle = activeHandle
        offEvent?.()
        offStatus?.()
        offModelSelection?.()
        const nextSelection = selectionFor(next)
        selectionRef.current = nextSelection
        selectionRef.assembled = undefined
        uiMode = modeForSession(next.session, resolveDefaultMode())
        offModelSelection = installModelSelection(next.ctx, selectionRef)
        agent = next
        activeHandle = handle
        tokenTotals = { inputTokens: 0, outputTokens: 0 }
        refreshContextEstimate(next, nextSelection)
        refreshGitBranch(next.session.header.cwd ?? process.cwd())
        header = new HeaderComponent(
          next,
          () => undefined,
          palette,
          resolved.theme.color && truecolor,
          t,
          () => selectionRef.current,
        )
        offEvent = ctx.on('session/event', (session, event) => {
          if (session.id !== next.session.id) return
          if (event.type === 'session/title') updateTitle()
          renderEvent(event)
          updateStatusValues()
          ui.requestRender()
        })
        offStatus = ctx.on('agent/status', ({ agent: candidate, status }) => {
          if (candidate.id !== next.id) return
          setStatus(status)
        })
        rebuildTranscript()
        live = true
        setStatus(next.status)
        updateTitle()
        warnIfFullAccess(next)
        void composeAgentPreset(next)
        if (previousHandle !== undefined && previousHandle !== handle) {
          void previousHandle.dispose().catch(() => undefined)
        }
      }

      const createAgent = async (): Promise<void> => {
        const current = agent ?? liveAgent
        const selection = selectionRef.current ?? selectionFor(current)
        const preset = uiMode
        const id = SessionId(`tui-${crypto.randomUUID()}`)
        const handle = await ctx.agents.create({
          sessionId: id,
          meta: {
            cwd: current.session.header.cwd ?? process.cwd(),
            agentPreset: preset,
          },
          agentOptions: {
            ...current.options,
            provider: selection.provider,
            model: selection.model,
          },
          setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset) },
        })
        // `/new` should continue the current session's permission instead of
        // falling back to the global startup default.
        const currentPermission = ctx.permissionPresets.current(current.session.events)
        if (currentPermission !== 'custom') {
          try {
            ctx.permissionPresets.set(handle.agent.session, currentPermission)
          } catch {
            // If the preset cannot be applied, the new session keeps the default.
          }
        }
        activateAgent(handle.agent, handle)
        appendNotice(t('noticeSessionCreated', { id: String(id) }), 'info')
      }

      const switchAgent = async (targetId: SessionId): Promise<void> => {
        const current = agent ?? liveAgent
        if (current.id === targetId) {
          appendNotice(t('noticeAlreadySession'), 'info')
          return
        }
        try {
          const workspace = current.session.header.cwd ?? process.cwd()
          const records = await ctx.sessionQuery.listSessions()
          const allowed = records.some(record =>
            record.persisted && String(record.header.id) === String(targetId) && sameProject(record.header.cwd, workspace))
          if (!allowed) {
            appendNotice(t('noticeNoSessions'), 'warning')
            return
          }
        } catch (error: unknown) {
          appendNotice(t('noticeSessionListFailed', { error: errorChain(error) }), 'error')
          return
        }
        appendNotice(t('noticeResuming'), 'info')
        const presets = ctx.agentPresets
        const controller = new AbortController()
        const resumePromise = ctx.agents.resume({
          resumeSessionId: targetId,
          agentOptions: current.options,
          signal: controller.signal,
          setup: presets === undefined ? undefined : async (agentCtx) => {
            const resumed = agentCtx.agent
            const recorded = resumed === undefined ? undefined : resolveSessionPreset(resumed.session)
            if (recorded !== undefined) await presets.mount(agentCtx, recorded)
          },
        })
        // Keep the original promise's late rejection from becoming unhandled if
        // the timeout wins the race, and dispose a handle that only arrives late.
        let timedOut = false
        let settled = false
        void resumePromise.then((handle) => {
          if (timedOut) void handle.dispose().catch(() => undefined)
        }).catch(() => undefined)
        let resumeTimer: NodeJS.Timeout | undefined
        const timeoutPromise = new Promise<AgentHandle>((_, reject) => {
          resumeTimer = setTimeout(() => {
            controller.abort()
            if (!settled) {
              timedOut = true
              reject(new DOMException('Session resume timed out', 'AbortError'))
            }
          }, RESUME_TIMEOUT_MS)
        })
        try {
          const handle = await Promise.race([resumePromise, timeoutPromise])
          settled = true
          clearTimeout(resumeTimer)
          activateAgent(handle.agent, handle)
          appendNotice(t('noticeSessionResumed', { id: String(targetId) }), 'info')
        } catch (error: unknown) {
          settled = true
          clearTimeout(resumeTimer)
          const aborted = error instanceof Error && error.name === 'AbortError'
          appendNotice(
            aborted ? t('noticeResumeTimeout') : t('noticeResumeFailed', { error: errorChain(error) }),
            'error',
          )
        }
      }

      // Publish model helpers before the first status render; otherwise the
      // initial frame briefly shows Agent creation defaults instead of the
      // selection that will actually route the next request.
      handles.newAgent = createAgent
      handles.switchAgent = switchAgent
      handles.saveSelection = saveSelection
      handles.setReasoningEffort = setReasoningEffort
      handles.selectionRef = selectionRef
      refreshContextEstimate(liveAgent, initialSelection)

      // Replay the durable log first (constructor seeds never publish), then
      // go live so turn-end notices only surface for fresh work.
      rebuildTranscript()
      // Attach after the transcript rebuild so buffered startup output is not
      // cleared by the replay and stays visible as persistent cards.
      subscribeWechatOutput()
      live = true
      updateTitle()
      setStatus(liveAgent.status)
      void composeAgentPreset(liveAgent)
      void (async () => {
        const presets = ctx.agentPresets
        if (presets === undefined) return
        try {
          for (const preset of await presets.list()) {
            presetNames.set(preset.id, preset.name ?? preset.id)
          }
        } catch {
          // Roster unreadable: keep the shipped labels.
        }
        updateStatusValues()
        ui.requestRender()
      })()
      ui.start()
      warnIfFullAccess(liveAgent)

    }

    const readyAgent = ctx.agents.get(sessionId)
    if (readyAgent !== undefined) {
      mount(readyAgent)
    } else {
      const offCreated = ctx.on('agent/created', ({ agent: candidate }) => {
        if (candidate.id === sessionId) {
          offCreated()
          mount(candidate)
        }
      })
      const timeout = setTimeout(() => {
        if (mounted) return
        offCreated()
        terminal.write(`\r\ntui: session "${sessionId}" never became live (timed out).\r\n`)
        ctx.appExit?.(1)
      }, AGENT_READY_TIMEOUT_MS)
      ctx.effect(() => () => {
        clearTimeout(timeout)
      })
    }

    ctx.effect(() => () => {
      offKeys()
      offEvent?.()
      offStatus?.()
      offScheme?.()
      offModelSelection?.()
      offWechatOutput?.()
      stopSpinner()
      clearTimeout(noticeTimer)
      clearTimeout(exitArmTimer)
      ui.stop()
      terminal.stop()
    })
  }
}

export { SessionId }
export default Tui
