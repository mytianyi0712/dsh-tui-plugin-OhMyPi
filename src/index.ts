/**
 * Interactive pi-tui front door for DeepSeek Harness agents, styled after the
 * local omp harness (titanium palette, rounded frames, status line). Renders
 * the durable session transcript, drives one configured agent, and provides
 * keyboard-driven commands without owning agent lifecycle.
 * @module dsh-omp-tui
 */

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
import { createUserMessage, errorChain, type CallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
// Type-only imports pull in the declaration merges that expose `ctx.commands`,
// `ctx.tokenMeter`, `ctx.llm`, `ctx.userQuestions`, `ctx.sessionQuery`, and
// `ctx.agentDefaultModel` on the cordis Context.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
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
  StreamingAssistantComponent,
  ToolCardComponent,
  UserMessageComponent,
  type ToolCardVisibility,
} from './components/transcript.ts'
import { StatusLineComponent } from './components/status.ts'
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

/** The terminal mode's plugin entry: mounts the whole UI in its constructor. */
export class Tui extends Service {
  static inject = ['tuiStartup', 'agents', 'tuiPrompt', 'commands', 'tokenMeter', 'llm', 'userQuestions', 'sessionQuery', 'agentDefaultModel']
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
    // Agent-scoped helpers handed to the command surface by mount().
    const handles: {
      switchAgent: ((id: SessionId) => Promise<void>) | undefined
      saveSelection: ((selection: ModelSelection) => Promise<void>) | undefined
      selectionRef: ModelSelectionRef | undefined
    } = { switchAgent: undefined, saveSelection: undefined, selectionRef: undefined }

    // --- components -------------------------------------------------------
    const chat = new Container()
    const editor = new Editor(ui, {
      borderColor: (text: string) => palette.border(text),
      selectList: selectTheme(palette),
    } satisfies EditorTheme, {
      paddingX: 1,
      frame: 'none',
      prompt: { first: '> ', continuation: '  ' },
    })
    const statusLine = new StatusLineComponent(
      parseTuiPromptTemplate(displayInlineText(resolved.theme.leftPrompt)),
      parseTuiPromptTemplate(displayInlineText(resolved.theme.rightPrompt)),
      (valueName: string) => ctx.tuiPrompt.get(valueName),
      palette,
    )
    const notice = new Text('', 0, 0)
    let noticeMounted = false
    let noticeTimer: ReturnType<typeof setTimeout> | undefined

    ui.addChild(chat)
    ui.addChild(notice)
    ui.addChild(statusLine)
    ui.addChild(editor)
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
      const symbol = ctx.tuiPrompt.get('symbol') ?? ''
      const indicator = ctx.tuiPrompt.get('indicator') ?? ''
      const first = `${symbol} ${indicator}`
      const firstWidth = visibleWidth(first)
      editor.setPrompt({ first, continuation: ' '.repeat(firstWidth) })
    }

    const appendNotice = (text: string, kind: 'info' | 'warning' | 'error'): void => {
      const color = kind === 'error'
        ? palette.error
        : kind === 'warning' ? palette.warning : palette.dim
      notice.setText(color(displayInlineText(text)))
      if (!noticeMounted) {
        ui.addChild(notice)
        noticeMounted = true
      }
      clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => {
        if (noticeMounted) {
          ui.removeChild(notice)
          noticeMounted = false
        }
        ui.requestRender()
      }, 5000)
      ui.requestRender()
    }

    // --- status -----------------------------------------------------------
    let currentScheme: TerminalColorScheme = 'dark'
    let spinnerTimer: ReturnType<typeof setInterval> | undefined
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
      cwdValue.set(palette.bold(palette.accent(displayText(current.session.header.cwd ?? process.cwd()))))
      gitValue.set(undefined)
      const model = handles.selectionRef?.current?.model ?? current.options.model
      modelValue.set(model === undefined ? undefined : `  ${palette.model(displayText(model))}`)
      let inputTokens = 0
      let outputTokens = 0
      for (const event of current.session.events) {
        if (event.type === 'assistant/message' && event.data.usage !== undefined) {
          inputTokens += event.data.usage.inputTokens
          outputTokens += event.data.usage.outputTokens
        }
      }
      tokensValue.set(`  ${palette.spend(`↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`)}`)
      const contextWindow = current.session.requestContext()?.contextWindow
      if (contextWindow !== undefined) {
        const totalTokens = ctx.tokenMeter.measure(current.session).totalTokens
        const percent = Math.min(100, Math.round(totalTokens / contextWindow * 100))
        contextValue.set(`  ${palette.context(`${percent}% context`)}`)
      } else {
        contextValue.set(undefined)
      }
      queuedValue.set(undefined)
      symbolValue.set(palette.bold(palette.accent('>')))
      updateInputPrompt()
    }

    const setStatus = (status: AgentStatus): void => {
      editor.borderColor = status === 'running'
        ? (text: string) => palette.accent(text)
        : (text: string) => palette.border(text)
      if (status === 'running') startSpinner()
      else stopSpinner()
      terminal.setProgress(status === 'running')
      updateStatusValues()
      ui.requestRender()
    }

    // --- transcript ---------------------------------------------------------
    let streaming: StreamingAssistantComponent | undefined
    const toolCards = new Map<CallId, ToolCardComponent>()
    const allToolCards = new Set<ToolCardComponent>()
    let toolsVisibility: ToolCardVisibility = 'collapsed'
    let showReasoning = resolved.showReasoning
    let live = false

    const renderEvent = (event: SessionEvent): void => {
      switch (event.type) {
        case 'user/message': {
          const source = event.data.source
          const text = displayText(contentText(event.data.content).trim())
          if (text === '') break
          chat.addChild(new Spacer(1))
          if (source.kind !== 'user') {
            const label = typeof source.kind === 'string' ? source.kind : 'context'
            chat.addChild(new ContextCardComponent(label, text, resolved.maxToolOutputLines, palette))
          } else {
            chat.addChild(new UserMessageComponent(text, palette, mdTheme))
          }
          break
        }
        case 'step/start':
          streaming = new StreamingAssistantComponent(palette, mdTheme, showReasoning)
          chat.addChild(streaming)
          break
        case 'assistant/chunk':
          if (streaming !== undefined) streaming.update(event.data.chunk)
          break
        case 'assistant/message':
          if (streaming !== undefined) streaming.settle(event.data.message.content)
          break
        case 'step/end':
          streaming = undefined
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
        case 'turn/end': {
          // Detach the live streaming slot so straggler chunks that arrive
          // after an abort cannot keep appending to the interrupted step;
          // its rendered partial content stays in the transcript.
          streaming = undefined
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
      streaming = undefined
      toolCards.clear()
      allToolCards.clear()
      chat.clear()
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
        const folded = foldSessionTitle(liveAgent.session.events)
        terminal.setTitle(folded === undefined ? resolved.title : `${folded.title} — ${resolved.title}`)
      }

      const header = new HeaderComponent(liveAgent, () => undefined, palette, truecolor)
      ui.addChild(header)

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
