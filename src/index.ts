/**
 * Interactive DeepSeek Harness front door, visually aligned with the local
 * OMP 17.2.15 Catppuccin layout while retaining dsh-native agent, session,
 * command, and persistence contracts.
 * @module dsh-omp-tui
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
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
  type TerminalColorScheme,
} from '@earendil-works/pi-tui'
import type { Agent, AgentHandle, AgentStatus, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { CombinedAutocompleteProvider, type AutocompleteItem, type SlashCommand } from '@earendil-works/pi-tui'
import { createUserMessage, errorChain, type CallId, type LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
// Type-only imports pull in the declaration merges that expose `ctx.commands`,
// `ctx.tokenMeter`, `ctx.llm`, `ctx.userQuestions`, `ctx.sessionQuery`,
// `ctx.agentDefaultModel`, `ctx.skills`, and `ctx.sessionReferenceResolver` on
// the cordis Context, plus the goal/compaction/skill session-event extensions.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-settings'
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
  SelectDialog,
  runModelFlow,
  runQuestionFlow,
  showOverlay,
} from './components/dialogs.ts'
import { contentText } from './components/content.ts'
import { displayInlineText, displayText } from './components/text.ts'
import { filterProjectSessions, sameProject } from './session-filter.ts'
import { hasConversationData, recordConversationPreset } from './session-lifecycle.ts'

export const name = 'tui'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
/** How long to wait for the configured agent to publish before giving up. */
const AGENT_READY_TIMEOUT_MS = 10000
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

/** Restore a session's recorded backend mode, falling back for blank sessions. */
function modeForSession(session: Session, fallback: UiModeKey): UiModeKey {
  const recorded = resolveSessionPreset(session)
  return recorded !== undefined && recorded in MODE_PRESETS ? recorded as UiModeKey : fallback
}

/** The localized label of one mode id. */
function modeLabel(t: Translator, mode: UiModeKey): string {
  return t(MODE_LABEL_KEYS[mode])
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
function readGitBranch(cwd: string): string | undefined {
  const dotGit = join(cwd, '.git')
  let gitDir = dotGit
  try {
    const pointer = readFileSync(dotGit, 'utf8').trim()
    const match = /^gitdir:\s*(.+)$/i.exec(pointer)
    if (match?.[1] !== undefined) {
      gitDir = isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1])
    }
  } catch {
    // A normal checkout exposes `.git` as a directory, not a pointer file.
  }
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref:')) return head.slice(head.lastIndexOf('/') + 1)
    return head === '' ? undefined : head.slice(0, 7)
  } catch {
    return undefined
  }
}

/** The terminal mode's plugin entry: mounts the whole UI in its constructor. */
export class Tui extends Service {
  static inject = ['tuiStartup', 'agents', 'tuiPrompt', 'commands', 'tokenMeter', 'llm', 'userQuestions', 'sessionQuery', 'agentDefaultModel', 'skills', 'sessionReferenceResolver', 'agentPresets', 'settings', 'sessionTitle']
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
    // Runtime theme state; `/theme` and `/settings` repaint in place.
    let themeName = tuiSettings?.get().themeName ?? resolved.theme.name
    const themeCustom: ThemeCustom | undefined = resolved.theme.custom
    let uiMode: UiMode = resolved.mode
    const themeOverride = (): ThemeOverride => ({ name: themeName, custom: themeCustom })
    const palette: Palette = createPalette(resolved.theme.color, 'dark', truecolor, themeOverride())
    const mdTheme = markdownTheme(palette)
    const terminal = new ProcessTerminal()
    const ui = new TUI(terminal, false)
    ui.setClearOnShrink(true)

    // The agent is published asynchronously on the resume path (persistence
    // load), so agent-dependent setup runs in mount() once it is live.
    let agent: Agent | undefined
    let gitBranch: string | undefined
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
    ui.addChild(editor)
    ui.addChild(commandHint)
    ui.addChild(inputBorder)
    ui.addChild(footer)
    ui.setFocus(editor)
    terminal.setTitle(resolved.title)

    // --- prompt values ----------------------------------------------------
    const cwdValue = ctx.tuiPrompt.register('cwd')
    const gitValue = ctx.tuiPrompt.register('git/worktree')
    const modeValue = ctx.tuiPrompt.register('mode')
    const modelValue = ctx.tuiPrompt.register('model')
    const effortValue = ctx.tuiPrompt.register('effort')
    const tokensValue = ctx.tuiPrompt.register('tokens')
    const contextValue = ctx.tuiPrompt.register('context')
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
      gitValue.set(gitBranch === undefined
        ? undefined
        : ` ${palette.statusSep('')}${palette.statusLineBg(` ${palette.git(` ${displayText(gitBranch)}`)} `)}${palette.statusLineTail('')}`)
      modeValue.set(`${palette.accent(modeLabel(t, uiMode))} ${palette.statusSep('')} `)
      const selection = handles.selectionRef?.current
      const model = selection?.model ?? current.options.model
      modelValue.set(model === undefined ? undefined : palette.model(displayText(model)))
      const effort = selection?.reasoningEffort
      effortValue.set(effort === undefined
        ? undefined
        : ` ${palette.muted('·')} ${palette.accent(displayText(effort))}`)
      let inputTokens = 0
      let outputTokens = 0
      for (const event of current.session.events) {
        if (event.type === 'assistant/message' && event.data.usage !== undefined) {
          inputTokens += event.data.usage.inputTokens
          outputTokens += event.data.usage.outputTokens
        }
      }
      tokensValue.set(` ${palette.muted('·')} ${palette.spend(`↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`)}`)
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
      contextValue.set(` ${palette.muted('·')} ${palette.context(`ctx ${formatContextTokens(totalTokens)}/${formatContextTokens(contextWindow)}`)}`)
      queuedValue.set(undefined)
      symbolValue.set(undefined)
      updateInputPrompt()
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
    let showReasoning = resolved.showReasoning
    let live = false
    let header: HeaderComponent | undefined

    const renderEvent = (event: SessionEvent): void => {
      switch (event.type) {
        case 'user/message': {
          const source = event.data.source
          const text = displayText(contentText(event.data.content).trim())
          if (text === '') break
          chat.addChild(new Spacer(1))
          if (source.kind !== 'user') {
            const label = source.kind === 'plugin' ? source.plugin : source.kind
            chat.addChild(new ContextCardComponent(label, text, resolved.maxToolOutputLines, palette))
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
          break
        case 'step/end':
          assistantStream.end()
          break
        case 'tool/call': {
          const card = new ToolCardComponent(
            event.data.name,
            event.data.arguments,
            resolved.maxToolOutputLines,
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
          if (live) appendNotice(t('noticeCompacting'), 'info')
          break
        case 'compaction/end':
          if (live) {
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
          if (live && event.data.reason.kind !== 'completed') {
            appendNotice(t('noticeTurnEnded', { reason: event.data.reason.kind }), 'warning')
          }
          break
        }
        default:
          break
      }
      updateStatusValues()
    }

    const rebuildTranscript = (): void => {
      assistantStream.end()
      toolCards.clear()
      allToolCards.clear()
      chat.clear()
      if (header !== undefined) chat.addChild(header)
      for (const event of agent!.session.events) renderEvent(event)
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
        ?? (target.id === agent?.id ? MODE_PRESETS[uiMode] : undefined)
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
          if (persisted.length === 0) {
            appendNotice(t('noticeNoSessions'), 'warning')
            return
          }
          const titles = await ctx.sessionQuery.readTitleSnapshots(persisted.map(record => record.header.id))
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
        const arg = line.slice('/mode'.length).trim()
        if (arg !== '' && !(arg in MODE_PRESETS)) {
          appendNotice(t('noticeModeUnknown', { name: arg }), 'warning')
          return
        }
        const presets = ctx.agentPresets
        if (presets === undefined) {
          appendNotice(t('noticeModeUnavailable'), 'warning')
          return
        }
        const live = presets.composedPreset(current.ctx) as UiModeKey | undefined
        const currentMode = live ?? uiMode
        const liveIndex = MODE_ORDER.indexOf(currentMode)
        const target: UiModeKey = arg === ''
          ? MODE_ORDER[(liveIndex + 1) % MODE_ORDER.length]!
          : arg as UiModeKey
        if (currentMode === target) {
          appendNotice(t('noticeModeAlready', { mode: modeLabel(t, target) }), 'info')
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
          if (live === undefined) await presets.mount(current.ctx, MODE_PRESETS[target])
          else await presets.recompose(current.ctx, MODE_PRESETS[target])
          uiMode = target
          updateStatusValues()
          ui.requestRender()
          appendNotice(t('noticeModeSet', { mode: modeLabel(t, target) }), 'info')
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
          const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
            provider?: string
            model?: string
          } | undefined
          const titleRoute = titleSettings?.provider === undefined || titleSettings.model === undefined
            ? `${current.options.provider ?? 'auto'}/${current.options.model ?? 'auto'}`
            : `${titleSettings.provider}/${titleSettings.model}`
          const choice = await showOverlay<string>(ui, (done) => new SelectDialog(
            t('settingsTitle'),
            [
              { value: 'theme', label: `${t('settingsTheme')} ·`, description: t('settingsThemeCurrent', { name: themeName }) },
              { value: 'title-model', label: `${t('settingsTitleModel')} ·`, description: t('settingsTitleModelCurrent', { provider: titleRoute.split('/')[0]!, model: titleRoute.split('/').slice(1).join('/') }) },
            ],
            palette,
            done,
          ))
          if (choice === 'theme') {
            const picked = await showOverlay<string>(ui, (done) => new SelectDialog(
              t('settingsTheme'),
              BUILTIN_THEMES.map(theme => ({
                value: theme.id,
                label: `${theme.id} — ${theme.label}`,
                description: theme.description,
              })),
              palette,
              done,
            ))
            if (picked !== undefined) {
              await tuiSettings.update({ themeName: picked })
              themeName = picked
              Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, themeOverride()))
              Object.assign(mdTheme, markdownTheme(palette))
              rebuildTranscript()
              setStatus(current.status)
              ui.requestRender()
              appendNotice(t('noticeSettingsSaved'), 'info')
            }
          } else if (choice === 'title-model') {
            const provider = await showOverlay<string>(ui, (done) => new SelectDialog(
              t('modelProvider'),
              ctx.llm.listProviders().map(entry => ({ value: entry.id, label: entry.name })),
              palette,
              done,
            ))
            if (provider === undefined) return
            const models = await ctx.llm.listModels(provider)
            const model = await showOverlay<string>(ui, (done) => new SelectDialog(
              t('modelTitle', { provider }),
              models.map(entry => ({ value: entry.id, label: entry.id, description: entry.name === undefined ? undefined : displayText(entry.name) })),
              palette,
              done,
            ))
            if (model === undefined) return
            await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, { provider, model })
            const sessionTitle = ctx.get('sessionTitle')
            if (sessionTitle !== undefined) void sessionTitle.refresh(current.session).catch(() => undefined)
            appendNotice(t('noticeTitleModelSet', { provider, model }), 'info')
          }
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
        const commandRows = ctx.commands.list(current).map(command =>
          `/${command.name}${command.input === undefined ? '' : ` ${command.input.hint}`} — ${command.description}`)
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
      if (result.kind === 'error') {
        appendNotice(result.text, 'error')
      } else if (result.text !== undefined && result.text !== '') {
        appendNotice(result.text, 'info')
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
    let activeHandle: AgentHandle | undefined
    let mounted = false

    const mount = (liveAgent: Agent): void => {
      if (mounted) return
      uiMode = modeForSession(liveAgent.session, resolved.mode)
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
      gitBranch = readGitBranch(workspace)
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
          argumentHint: '<standard|minimal|code|cordis>',
          getArgumentCompletions: prefix => filterCommandOptions(modeOptions, prefix),
        },
        {
          name: 'theme',
          description: t('cmdTheme'),
          argumentHint: '<catppuccin|tokyo-night>',
          getArgumentCompletions: prefix => filterCommandOptions(themeOptions, prefix),
        },
        { name: 'settings', description: t('cmdSettings') },
        ...ctx.commands.list(liveAgent).map(command => ({
          name: command.name,
          description: command.description,
          ...command.input === undefined ? {} : { argumentHint: command.input.hint },
        } satisfies SlashCommand)),
      ]
      editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commandEntries, workspace))
      commandHintText = commandInputHint(editor.getText(), commandEntries)
      editor.onChange = (text: string): void => {
        commandHintText = commandInputHint(text, commandEntries)
        ui.requestRender()
      }

      const offQuestions = ctx.userQuestions.registerProvider({
        ask: async (request) => ({
          answers: await runQuestionFlow(ui, palette, t, request.questions, request.signal),
        }),
      })

      offEvent = ctx.on('session/event', (session, event) => {
        if (session.id !== liveAgent.session.id) return
        if (event.type === 'session/title') updateTitle()
        renderEvent(event)
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
        const wanted = recorded ?? MODE_PRESETS[uiMode]
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
        uiMode = modeForSession(next.session, resolved.mode)
        offModelSelection = installModelSelection(next.ctx, selectionRef)
        agent = next
        activeHandle = handle
        refreshContextEstimate(next, nextSelection)
        gitBranch = readGitBranch(next.session.header.cwd ?? process.cwd())
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
        void composeAgentPreset(next)
        if (previousHandle !== undefined && previousHandle !== handle) {
          void previousHandle.dispose().catch(() => undefined)
        }
      }

      const createAgent = async (): Promise<void> => {
        const current = agent ?? liveAgent
        const selection = selectionRef.current ?? selectionFor(current)
        const preset = MODE_PRESETS[uiMode]
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
        const handle = await ctx.agents.resume({
          resumeSessionId: targetId,
          agentOptions: current.options,
          setup: presets === undefined ? undefined : async (agentCtx) => {
            const resumed = agentCtx.agent
            const recorded = resumed === undefined ? undefined : resolveSessionPreset(resumed.session)
            if (recorded !== undefined) await presets.mount(agentCtx, recorded)
          },
        })
        activateAgent(handle.agent, handle)
        appendNotice(t('noticeSessionResumed', { id: String(targetId) }), 'info')
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
      live = true
      updateTitle()
      setStatus(liveAgent.status)
      void composeAgentPreset(liveAgent)
      ui.start()

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
