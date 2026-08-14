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
import type { Agent, AgentStatus, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { CombinedAutocompleteProvider } from '@earendil-works/pi-tui'
import { createUserMessage, errorChain, type CallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
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
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-compaction'
import {
  TuiConfigSchema,
  resolveTuiConfig,
  type Config,
  type ResolvedTuiConfig,
} from './config.ts'
import type { TuiStartup } from './startup.ts'
import { parseTuiPromptTemplate } from './prompt.ts'
import {
  createPalette,
  detectTruecolor,
  markdownTheme,
  renderPalette,
  selectTheme,
  type Palette,
} from './theme.ts'
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
import { InputBorderComponent, StatusLineComponent } from './components/status.ts'
import {
  SelectDialog,
  runModelFlow,
  runQuestionFlow,
  showOverlay,
} from './components/dialogs.ts'
import { contentText } from './components/content.ts'
import { displayInlineText, displayText } from './components/text.ts'

export const name = 'tui'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
/** How long to wait for the configured agent to publish before giving up. */
const AGENT_READY_TIMEOUT_MS = 10000

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
  static inject = ['tuiStartup', 'agents', 'tuiPrompt', 'commands', 'tokenMeter', 'llm', 'userQuestions', 'sessionQuery', 'agentDefaultModel', 'skills', 'sessionReferenceResolver']
  static Config = TuiConfigSchema

  constructor(ctx: Context, config: Config) {
    super(ctx, 'tui')

    const startup: TuiStartup = ctx.tuiStartup
    const sessionId = startup.sessionId ?? startup.resumeSessionId
    if (sessionId === undefined) {
      throw new Error('tui: no session identity available')
    }

    const resolved: ResolvedTuiConfig = resolveTuiConfig(config)
    const truecolor = resolved.theme.truecolor || detectTruecolor()
    const palette: Palette = createPalette(resolved.theme.color, 'dark', truecolor)
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
      switchAgent: ((id: SessionId) => Promise<void>) | undefined
      saveSelection: ((selection: ModelSelection) => Promise<void>) | undefined
      selectionRef: ModelSelectionRef | undefined
    } = { switchAgent: undefined, saveSelection: undefined, selectionRef: undefined }

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
    const statusLine = new StatusLineComponent(
      parseTuiPromptTemplate(displayInlineText(resolved.theme.leftPrompt)),
      parseTuiPromptTemplate(displayInlineText(resolved.theme.rightPrompt)),
      (valueName: string) => ctx.tuiPrompt.get(valueName),
      palette,
    )
    const todoPanel = new TodoPanelComponent(palette)
    const noticeSlot = new Container()
    const notice = new Text('', 1, 0)
    const inputBorder = new InputBorderComponent(palette)
    let noticeMounted = false
    let noticeTimer: NodeJS.Timeout | undefined

    ui.addChild(chat)
    ui.addChild(todoPanel)
    ui.addChild(noticeSlot)
    ui.addChild(statusLine)
    ui.addChild(editor)
    ui.addChild(inputBorder)
    ui.setFocus(editor)
    terminal.setTitle(resolved.title)

    // --- prompt values ----------------------------------------------------
    const cwdValue = ctx.tuiPrompt.register('cwd')
    const gitValue = ctx.tuiPrompt.register('git/worktree')
    const modelValue = ctx.tuiPrompt.register('model')
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
      cwdValue.set(palette.path(` ${cwd}`))
      gitValue.set(gitBranch === undefined
        ? undefined
        : ` ${palette.statusSep('')} ${palette.git(` ${displayText(gitBranch)}`)}`)
      const model = handles.selectionRef?.current?.model ?? current.options.model
      modelValue.set(model === undefined ? undefined : palette.model(`󰚩 ${displayText(model)}`))
      let inputTokens = 0
      let outputTokens = 0
      for (const event of current.session.events) {
        if (event.type === 'assistant/message' && event.data.usage !== undefined) {
          inputTokens += event.data.usage.inputTokens
          outputTokens += event.data.usage.outputTokens
        }
      }
      tokensValue.set(` ${palette.statusSep('')} ${palette.spend(`↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`)}`)
      const contextWindow = current.session.requestContext()?.contextWindow
      if (contextWindow !== undefined) {
        const totalTokens = ctx.tokenMeter.measure(current.session).totalTokens
        const percent = Math.min(100, Math.round(totalTokens / contextWindow * 100))
        contextValue.set(` ${palette.statusSep('')} ${palette.context(`󰁨 ${percent}%`)}`)
      } else {
        contextValue.set(undefined)
      }
      queuedValue.set(undefined)
      symbolValue.set(undefined)
      updateInputPrompt()
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
          if (live) appendNotice('Context being compacted…', 'info')
          break
        case 'compaction/end':
          if (live) {
            appendNotice(
              event.data.error === undefined ? 'Compaction finished.' : `Compaction failed: ${event.data.error}`,
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
            appendNotice(`Turn ended: ${event.data.reason.kind}.`, 'warning')
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
      appendNotice(`Tool cards ${toolsVisibility}.`, 'info')
    }

    const toggleReasoning = (): void => {
      showReasoning = !showReasoning
      appendNotice(`Reasoning blocks ${showReasoning ? 'shown' : 'hidden'}.`, 'info')
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
          await runModelFlow(ui, palette, ctx.llm, save)
        } catch (error: unknown) {
          appendNotice(`Model selection failed: ${errorChain(error)}`, 'error')
        }
        ui.requestRender()
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
          const persisted = records
            .filter(record => record.persisted)
            .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
          if (persisted.length === 0) {
            appendNotice('No persisted sessions.', 'warning')
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
            'Resume session',
            persisted.map(record => ({
              value: String(record.header.id),
              label: titleById.get(String(record.header.id)) ?? '(untitled)',
              description: `${record.header.id} · ${new Date(record.header.createdAt ?? 0).toLocaleString()}`,
            })),
            palette,
            done,
          ))
          if (picked !== undefined) await switcher(SessionId(picked))
        } catch (error: unknown) {
          appendNotice(`Session listing failed: ${errorChain(error)}`, 'error')
        }
        return
      }
      if (line === '/skills' || line.startsWith('/skills ')) {
        try {
          const snapshot = await ctx.skills.snapshot({ cwd: current.session.header.cwd ?? process.cwd() })
          if (snapshot.skills.length === 0) {
            appendNotice('No skills available.', 'info')
            return
          }
          const rows = snapshot.skills.map(skill =>
            `/${skill.name} — ${skill.description}${skill.source === undefined ? '' : ` (${skill.source})`}`)
          chat.addChild(new StaticCardComponent(rows, palette))
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(`Skill listing failed: ${errorChain(error)}`, 'error')
        }
        return
      }
      if (line.startsWith('/skill:')) {
        const name = line.slice('/skill:'.length).trim()
        if (name === '') {
          appendNotice('Usage: /skill:<name>', 'warning')
          return
        }
        try {
          const definition = await ctx.skills.get(name, { cwd: current.session.header.cwd ?? process.cwd() })
          if (definition === undefined) {
            appendNotice(`Unknown skill: ${name}`, 'warning')
            return
          }
          current.followup(createUserMessage({
            content: [{ type: 'text', text: renderSkillContent(definition) }],
            source: { kind: 'skill-invocation', name, form: 'instructions' },
          }))
        } catch (error: unknown) {
          appendNotice(`Skill "${name}" failed to load: ${errorChain(error)}`, 'error')
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
      if (line === '/help' || line.startsWith('/help ')) {
        const commandRows = ctx.commands.list(current).map(command =>
          `/${command.name}${command.input === undefined ? '' : ` ${command.input.hint}`} — ${command.description}`)
        const rows = [
          palette.bold(palette.accent('Keyboard shortcuts')),
          '',
          `${palette.dim('Ctrl+C')}  interrupt the running turn`,
          `${palette.dim('Ctrl+O')}  cycle tool cards: collapsed → expanded → hidden`,
          `${palette.dim('Ctrl+R')}  toggle reasoning blocks`,
          '',
          palette.bold(palette.accent('Commands')),
          '/palette — show the palette role table',
          '/help — this listing',
          '/model — pick a provider/model/reasoning effort',
          '/resume — resume a persisted session',
          '/details — show session diagnostics',
          '/skills — list available skills',
          '/skill:<name> — invoke a skill as instructions',
          ...commandRows,
        ]
        chat.addChild(new StaticCardComponent(rows, palette))
        ui.requestRender()
        return
      }
      const execution = await ctx.commands.execute(current, line, new AbortController().signal)
      if (execution === undefined) {
        appendNotice(`Unknown command: ${line.slice(1, line.indexOf(' ') === -1 ? undefined : line.indexOf(' '))}`, 'warning')
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
            current.followup(createUserMessage({ content: prepared.content, source: { kind: 'user' } }))
          } catch (error: unknown) {
            appendNotice(`Session reference failed: ${errorChain(error)}`, 'error')
          }
        })()
        return
      }
      current.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    }

    const offKeys = ui.addInputListener((data) => {
      if (matchesKey(data, 'ctrl+c')) {
        if (agent?.status === 'running') agent.cancel({ kind: 'user' })
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
    let mounted = false

    const mount = (liveAgent: Agent): void => {
      if (mounted) return
      mounted = true
      agent = liveAgent

      // Couple one mutable selection to prompt assembly and request routing;
      // `/model` swaps `selectionRef.current` for the next step.
      const selectionRef: ModelSelectionRef = { current: undefined, assembled: undefined }
      installModelSelection(liveAgent.ctx, selectionRef)
      const saveSelection = async (selection: ModelSelection): Promise<void> => {
        selectionRef.current = selection
        await ctx.agentDefaultModel.saveSelection(selection)
        updateStatusValues()
        appendNotice(`Model set to ${selection.provider}/${selection.model}.`, 'info')
      }

      const updateTitle = (): void => {
        const current = agent
        const folded = current === undefined ? undefined : foldSessionTitle(current.session.events)
        terminal.setTitle(folded === undefined ? resolved.title : `${folded.title} — ${resolved.title}`)
      }

      header = new HeaderComponent(liveAgent, () => undefined, palette, resolved.theme.color && truecolor)

      // Slash commands + @ / path completions (pi-tui's combined provider
      // scans the workspace rooted at the session cwd).
      const workspace = liveAgent.session.header.cwd ?? process.cwd()
      gitBranch = readGitBranch(workspace)
      const commandEntries: Array<{ name: string; description: string; argumentHint?: string }> = [
        { name: 'palette', description: 'Show the palette role table' },
        { name: 'help', description: 'Show keyboard shortcuts and commands' },
        { name: 'model', description: 'Pick a provider/model/reasoning effort' },
        { name: 'resume', description: 'Resume a persisted session', argumentHint: '[sessionId]' },
        { name: 'details', description: 'Show session diagnostics' },
        { name: 'skills', description: 'List available skills' },
        ...ctx.commands.list(liveAgent).map(command => ({
          name: command.name,
          description: command.description,
          ...command.input === undefined ? {} : { argumentHint: command.input.hint },
        })),
      ]
      editor.setAutocompleteProvider(new CombinedAutocompleteProvider(commandEntries, workspace))

      const offQuestions = ctx.userQuestions.registerProvider({
        ask: async (request) => ({
          answers: await runQuestionFlow(ui, palette, request.questions, request.signal),
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
        Object.assign(palette, createPalette(resolved.theme.color, scheme, truecolor))
        Object.assign(mdTheme, markdownTheme(palette))
        rebuildTranscript()
        setStatus(liveAgent.status)
        ui.requestRender()
      })

      const switchAgent = async (targetId: SessionId): Promise<void> => {
        if (liveAgent.id === targetId) {
          appendNotice('Already on this session.', 'info')
          return
        }
        appendNotice('Resuming session…', 'info')
        const handle = await ctx.agents.resume({
          resumeSessionId: targetId,
          agentOptions: liveAgent.options,
        })
        const resumed = handle.agent
        offEvent?.()
        offStatus?.()
        agent = resumed
        gitBranch = readGitBranch(resumed.session.header.cwd ?? process.cwd())
        header = new HeaderComponent(resumed, () => undefined, palette, resolved.theme.color && truecolor)
        offEvent = ctx.on('session/event', (session, event) => {
          if (session.id !== resumed.session.id) return
          if (event.type === 'session/title') updateTitle()
          renderEvent(event)
          ui.requestRender()
        })
        offStatus = ctx.on('agent/status', ({ agent: candidate, status }) => {
          if (candidate.id !== resumed.id) return
          setStatus(status)
        })
        rebuildTranscript()
        live = true
        setStatus(resumed.status)
        updateTitle()
        appendNotice(`Session ${targetId} resumed.`, 'info')
      }

      // Replay the durable log first (constructor seeds never publish), then
      // go live so turn-end notices only surface for fresh work.
      rebuildTranscript()
      live = true
      updateTitle()
      setStatus(liveAgent.status)
      ui.start()

      // Store the switcher and helpers for the command surface below.
      handles.switchAgent = switchAgent
      handles.saveSelection = saveSelection
      handles.selectionRef = selectionRef
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
      stopSpinner()
      clearTimeout(noticeTimer)
      ui.stop()
      terminal.stop()
    })
  }
}

export { SessionId }
export default Tui
