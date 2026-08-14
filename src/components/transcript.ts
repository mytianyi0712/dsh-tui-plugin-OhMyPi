/**
 * OMP-compatible transcript components adapted to DeepSeek Harness events:
 * responsive welcome panel, full-width user surfaces, unlabelled assistant
 * prose/reasoning, and lifecycle-aware tool output blocks.
 */

import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import { frameBlock, gradientLogo, type MarkdownTheme, type Palette } from '../theme.ts'
import { contentText, parseArguments } from './content.ts'
import { displayText } from './text.ts'

const DSH_LOGO = [
  '██████╗ ███████╗██╗  ██╗',
  '██╔══██╗██╔════╝██║  ██║',
  '██║  ██║███████╗███████║',
  '██║  ██║╚════██║██╔══██║',
  '██████╔╝███████║██║  ██║',
]

function fitWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(0, width), '')
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)))
}

function center(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, '')
  const space = Math.max(0, width - visibleWidth(clipped))
  const left = Math.floor(space / 2)
  return `${' '.repeat(left)}${clipped}${' '.repeat(space - left)}`
}

/** Responsive two-column welcome panel following OMP's startup composition. */
export class HeaderComponent implements Component {
  constructor(
    private readonly agent: Agent,
    private readonly subtitle: () => string | undefined,
    private readonly palette: Palette,
    private readonly gradient: boolean,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const boxWidth = Math.min(100, Math.max(0, width - 2))
    if (boxWidth < 4) return []

    const showRight = boxWidth >= 64
    const leftWidth = showRight ? Math.min(28, Math.floor((boxWidth - 3) * 0.36)) : boxWidth - 2
    const rightWidth = showRight ? boxWidth - leftWidth - 3 : 0
    const logo = this.gradient
      ? gradientLogo(DSH_LOGO)
      : DSH_LOGO.map(line => this.palette.accent(line))
    const model = displayText(String(this.agent.options.model ?? 'No model'))
    const provider = displayText(String(this.agent.options.provider ?? 'DeepSeek'))
    const leftLines = [
      '',
      center(this.palette.bold('Welcome back!'), leftWidth),
      '',
      ...logo.map(line => center(line, leftWidth)),
      '',
      center(this.palette.muted(model), leftWidth),
      center(this.palette.dim(provider), leftWidth),
      '',
    ]

    const separator = ` ${this.palette.dim('─'.repeat(Math.max(0, rightWidth - 2)))}`
    const session = displayText(String(this.agent.session.id))
    const workspace = displayText(this.agent.session.header.cwd ?? process.cwd())
    const extra = this.subtitle()
    const rightLines = [
      ` ${this.palette.bold(this.palette.accent('Tips'))}`,
      ` ${this.palette.dim('/')} ${this.palette.muted('for commands')}`,
      ` ${this.palette.dim('@')} ${this.palette.muted('for sessions and files')}`,
      ` ${this.palette.dim('Tab')} ${this.palette.muted('to complete')}`,
      ` ${this.palette.dim('Ctrl+O')} ${this.palette.muted('to expand tool output')}`,
      separator,
      ` ${this.palette.bold(this.palette.accent('Session'))}`,
      ` ${this.palette.muted(session)}`,
      ` ${this.palette.dim('Workspace')}`,
      ` ${this.palette.muted(workspace)}`,
      ...extra === undefined ? [] : [` ${this.palette.dim(displayText(extra))}`],
      '',
    ]

    const horizontal = '─'
    const title = truncateToWidth('─── dsh ', Math.max(0, boxWidth - 2), '')
    const top = this.palette.dim(
      `╭${title}${horizontal.repeat(Math.max(0, boxWidth - 2 - visibleWidth(title)))}╮`,
    )
    const vertical = this.palette.dim('│')
    const lines = [top]
    const rows = showRight ? Math.max(leftLines.length, rightLines.length) : leftLines.length
    for (let index = 0; index < rows; index++) {
      const left = fitWidth(leftLines[index] ?? '', leftWidth)
      if (showRight) {
        const right = fitWidth(rightLines[index] ?? '', rightWidth)
        lines.push(`${vertical}${left}${vertical}${right}${vertical}`)
      } else {
        lines.push(`${vertical}${left}${vertical}`)
      }
    }
    const bottom = showRight
      ? `╰${horizontal.repeat(leftWidth)}┴${horizontal.repeat(rightWidth)}╯`
      : `╰${horizontal.repeat(leftWidth)}╯`
    lines.push(this.palette.dim(bottom))
    if (boxWidth >= 24) {
      const tip = this.palette.italic(
        ` ${this.palette.accent('Tip:')} ${this.palette.muted('Use /help to discover the migrated command surface.')}`,
      )
      lines.push(truncateToWidth(tip, boxWidth, ''))
    }
    return lines
  }
}

/** OMP user bubble: padded Markdown on a full-width mantle surface, no label or outline. */
export class UserMessageComponent extends Container {
  constructor(text: string, private readonly palette: Palette, mdTheme: MarkdownTheme) {
    super()
    this.addChild(new Markdown(displayText(text), 1, 1, mdTheme, {
      color: (value: string) => palette.text(value),
    }, {
      preserveOrderedListMarkers: true,
      preserveBackslashEscapes: true,
    }))
  }

  override render(width: number): string[] {
    return super.render(width).map((row) => {
      const fill = ' '.repeat(Math.max(0, width - visibleWidth(row)))
      return this.palette.userMessageBg(`${row}${fill}`)
    })
  }
}

/** OMP reasoning prose: inset, muted, italic, and deliberately unlabelled. */
export class ThinkingBlock extends Container {
  constructor(reasoning: string, palette: Palette, mdTheme: MarkdownTheme) {
    super()
    this.addChild(new Markdown(displayText(reasoning), 1, 0, mdTheme, {
      color: (value: string) => palette.thinking(value),
      italic: true,
    }))
  }
}

/** Children of an assistant message: optional reasoning, then response prose. */
function assistantMessageChildren(
  content: readonly ContentBlock[],
  showReasoning: boolean,
  palette: Palette,
  mdTheme: MarkdownTheme,
): Component[] {
  const reasoning = displayText(textBlocks(content, 'reasoning').trim())
  const text = displayText(textBlocks(content, 'text').trim())
  const children: Component[] = []
  if (reasoning !== '' && showReasoning) children.push(new ThinkingBlock(reasoning, palette, mdTheme))
  if (text !== '') {
    if (children.length > 0) children.push(new Spacer(1))
    children.push(new Markdown(text, 1, 0, mdTheme, {
      color: (value: string) => palette.text(value),
    }))
  }
  return children
}

/** Concatenate the text of every block of one type, separated by blank lines. */
function textBlocks(content: readonly ContentBlock[], type: 'text' | 'reasoning'): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: typeof type }> => block.type === type)
    .map(block => block.text)
    .join('\n\n')
}

interface StreamingBlock {
  type: string
  text: string
}

/** A live assistant step: streamed reasoning/text blocks until the message settles. */
export class StreamingAssistantComponent extends Container {
  private readonly blocks = new Map<number, StreamingBlock>()
  private settledContent: readonly ContentBlock[] | undefined

  constructor(
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
    private showReasoning: boolean,
  ) {
    super()
    this.rebuild()
  }

  /** Replace the streamed blocks with the step's settled content. */
  settle(content: readonly ContentBlock[]): void {
    this.settledContent = content
    this.rebuild()
  }

  /** Toggle whether reasoning blocks render, then re-render. */
  setShowReasoning(show: boolean): void {
    if (this.showReasoning === show) return
    this.showReasoning = show
    this.rebuild()
  }

  /** Fold one streamed chunk into the live block buffer and re-render. */
  update(chunk: StreamChunk): void {
    if (chunk.type === 'block-start') {
      this.blocks.set(chunk.index, { type: chunk.blockType, text: '' })
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
      const block = this.blocks.get(chunk.index) ?? { type, text: '' }
      block.text += chunk.text
      this.blocks.set(chunk.index, block)
    } else if (chunk.type === 'block-end' && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) {
      this.blocks.set(chunk.index, { type: chunk.block.type, text: chunk.block.text })
    }
    this.rebuild()
  }

  private rebuild(): void {
    this.clear()
    const children = assistantMessageChildren(
      this.presentedContent(),
      this.showReasoning,
      this.palette,
      this.mdTheme,
    )
    for (const child of children) this.addChild(child)
  }

  /** The settled content when available, otherwise the streamed blocks in model order. */
  private presentedContent(): readonly ContentBlock[] {
    return this.settledContent ?? [...this.blocks.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap<ContentBlock>(([, block]) => {
        if (block.type === 'text') return [{ type: 'text', text: block.text }]
        if (block.type === 'reasoning') return [{ type: 'reasoning', text: block.text }]
        return []
      })
  }
}

/**
 * Owns one live assistant step without mounting it at `step/start`.
 * DSH emits `step/start` before the turn's entered `user/message` events, so
 * the component joins the transcript only when assistant content materializes.
 */
export class AssistantStreamController {
  private current: StreamingAssistantComponent | undefined
  private mounted = false

  constructor(
    private readonly transcript: Container,
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
  ) {}

  /** Prepare an assistant step while preserving space for its input messages. */
  start(showReasoning: boolean): void {
    this.current = new StreamingAssistantComponent(this.palette, this.mdTheme, showReasoning)
    this.mounted = false
  }

  /** Append streamed content after every user/context message entered for this step. */
  update(chunk: StreamChunk): void {
    if (this.current === undefined) return
    this.current.update(chunk)
    this.mountCurrent()
  }

  /** Materialize providers that commit a message without publishing chunks. */
  settle(content: readonly ContentBlock[]): void {
    if (this.current === undefined) return
    this.current.settle(content)
    this.mountCurrent()
  }

  /** Detach controller state; already-mounted transcript content remains durable. */
  end(): void {
    this.current = undefined
    this.mounted = false
  }

  private mountCurrent(): void {
    if (this.current === undefined || this.mounted) return
    this.transcript.addChild(this.current)
    this.mounted = true
  }
}

function toolLabel(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function toolSummary(name: string, argumentsJson: string): string {
  const label = toolLabel(displayText(name))
  const parsed = parseArguments(argumentsJson)
  if (!parsed.valid || typeof parsed.value !== 'object' || parsed.value === null) return label
  const args = parsed.value as Record<string, unknown>
  const intent = typeof args.i === 'string' ? args.i.trim() : ''
  if (intent !== '') return `${label}: ${displayText(intent)}`
  const detailKeys = name === 'bash' || name === 'powershell'
    ? ['command']
    : ['path', 'file', 'pattern', 'query', 'action', 'op']
  for (const key of detailKeys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return `${label}: ${displayText(value.replace(/\s+/g, ' ').trim())}`
    }
  }
  return label
}

/**
 * OMP tool lifecycle: pending calls are one quiet status row; settled calls
 * become rounded output blocks with a titled `Output` separator.
 */
export class ToolCardComponent implements Component {
  private result: { content: ContentBlock[]; isError: boolean } | undefined
  private visibility: ToolCardVisibility = 'collapsed'

  constructor(
    private readonly name: string,
    private readonly argumentsJson: string,
    private readonly maxOutputLines: number,
    private readonly palette: Palette,
  ) {}

  /** Record the tool result. */
  updateResult(event: Extract<SessionEvent, { type: 'tool/result' }>['data']): void {
    const result = event.message.content[0]
    this.result = {
      content: [...result.content],
      isError: result.isError === true,
    }
  }

  /** Set the card's visibility state. */
  setVisibility(visibility: ToolCardVisibility): void {
    this.visibility = visibility
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.visibility === 'hidden') return []
    const summary = toolSummary(this.name, this.argumentsJson)
    if (this.result === undefined) {
      const pending = `${this.palette.warning('')} ${this.palette.toolTitle(summary)}`
      return ['', truncateToWidth(pending, Math.max(1, width), '')]
    }

    const isError = this.result.isError
    const statusColor = isError ? this.palette.error : this.palette.dim
    const statusBg = isError ? this.palette.toolErrorBg : this.palette.toolSuccessBg
    const glyph = isError ? '' : '•'
    const header = isError
      ? this.palette.error(`${glyph} ${summary}`)
      : `${this.palette.dim(glyph)} ${this.palette.toolTitle(summary)}`
    const output = displayText(contentText(this.result.content).trim())
    let body = output === '' ? [this.palette.dim('(no output)')] : output.split('\n')
    if (this.visibility === 'collapsed' && body.length > this.maxOutputLines) {
      const hidden = body.length - this.maxOutputLines
      body = [
        ...body.slice(0, this.maxOutputLines),
        this.palette.dim(`… +${hidden} lines (Ctrl+O to expand)`),
      ]
    }
    return [
      '',
      ...frameBlock(
        body.map(line => this.palette.toolOutput(line)),
        width,
        statusColor,
        statusBg,
        header,
        'Output',
      ),
    ]
  }
}

/** Ctrl+O card-visibility cycle: hidden, collapsed preview, expanded. */
export type ToolCardVisibility = 'hidden' | 'collapsed' | 'expanded'

/**
 * A non-human prompt contribution (plugin/goal sources), framed so it cannot
 * be mistaken for the assistant's unframed italic reasoning prose.
 */
export class ContextCardComponent implements Component {
  private readonly body: Text
  private readonly title: string

  constructor(
    label: string,
    text: string,
    maxOutputLines: number,
    private readonly palette: Palette,
  ) {
    const lines = displayText(text).split('\n')
    const visible = lines.length > maxOutputLines
      ? [...lines.slice(0, maxOutputLines), `… +${lines.length - maxOutputLines} lines`]
      : lines
    this.title = `${palette.context('Injected context')} ${palette.dim(`· ${displayText(label)}`)}`
    this.body = new Text(visible.map((line, index) =>
      index >= maxOutputLines ? palette.dim(line) : palette.muted(line)).join('\n'), 0, 0)
  }

  invalidate(): void {
    this.body.invalidate?.()
  }

  render(width: number): string[] {
    const rows = this.body.render(Math.max(1, width - 4))
    return frameBlock(rows, width, this.palette.borderMuted, this.palette.toolPendingBg, this.title)
  }
}

/** A static framed block of pre-rendered rows (e.g. the `/palette` listing). */
export class StaticCardComponent implements Component {
  constructor(
    private readonly rows: readonly string[],
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return ['', ...frameBlock(this.rows, width, this.palette.borderMuted, this.palette.toolSuccessBg)]
  }
}

/**
 * The plan/todo panel rendered above the status line: the current goal plus
 * the whole-list `todo/write` snapshot, omp `Plan` style. Renders nothing
 * while there is neither a goal nor any todo.
 */
export class TodoPanelComponent implements Component {
  private todos: readonly TodoItem[] = []
  private goal: { readonly objective: string; readonly phase: string } | undefined

  constructor(private readonly palette: Palette) {}

  invalidate(): void {}

  /** Replace the whole todo list (last `todo/write` wins). */
  setTodos(todos: readonly TodoItem[]): void {
    this.todos = todos
  }

  /** Replace the current goal snapshot, or clear it. */
  setGoal(goal: { readonly objective: string; readonly phase: string } | undefined): void {
    this.goal = goal
  }

  render(width: number): string[] {
    if (this.todos.length === 0 && this.goal === undefined) return []
    const lines: string[] = [this.palette.bold(this.palette.accent(' Plan'))]
    if (this.goal !== undefined) {
      lines.push(this.palette.dim(`Goal · ${this.goal.phase}: ${displayText(this.goal.objective)}`))
    }
    for (const todo of this.todos) {
      const mark = todo.status === 'completed' ? '󰄲' : todo.status === 'in_progress' ? '' : ''
      const color = todo.status === 'completed'
        ? this.palette.dim
        : todo.status === 'in_progress' ? this.palette.accent : this.palette.text
      lines.push(color(`${mark} ${displayText(todo.content)}`))
    }
    return lines.map(line => truncateToWidth(line, Math.max(1, width), ''))
  }
}
