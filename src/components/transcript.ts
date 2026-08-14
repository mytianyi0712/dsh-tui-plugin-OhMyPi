/**
 * Transcript components: the banner, user/assistant message blocks, streamed
 * reasoning, and tool cards — all painted with the omp-titanium palette and
 * omp-style rounded frames with per-status background fills.
 */

import {
  Container,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'
import { frameBlock, gradientText, type MarkdownTheme, type Palette } from '../theme.ts'
import { contentText, parseArguments, pretty, type ParsedArguments } from './content.ts'
import { displayInlineText, displayText } from './text.ts'

/** A bold underlined role header, the omp signature for message labels. */
function messageHeader(label: string, color: (text: string) => string, palette: Palette): string {
  return palette.bold(palette.underline(color(displayText(label))))
}

/**
 * Rounded-frame startup banner: product name in the top border, session id and
 * optional subtitle inside. The frame reads like the omp welcome banner.
 */
export class HeaderComponent implements Component {
  private readonly revealWidth: number | undefined

  constructor(
    private readonly agent: Agent,
    private readonly subtitle: () => string | undefined,
    private readonly palette: Palette,
    private readonly gradient: boolean,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const inner = Math.max(1, width - 4)
    const name = this.gradient
      ? this.palette.bold(gradientText('dsh'))
      : this.palette.bold(this.palette.accent('dsh'))
    const title = `${name} ${this.palette.bold('HARNESS')}`
    const subtitle = this.subtitle()
    const body = [
      this.palette.dim(displayText(this.agent.session.id)),
      ...subtitle === undefined ? [] : [this.palette.dim(displayText(subtitle))],
    ]
    const wrapped = body.flatMap(line => wrapTextWithAnsi(line, inner))
    return frameBlock(wrapped, width, this.palette.border, undefined, title)
  }
}

/**
 * A user or steering prompt in the transcript: an accent role header inside a
 * rounded frame with the omp `userMessageBg` fill.
 */
export class UserMessageComponent extends Container {
  private readonly palette: Palette

  constructor(text: string, palette: Palette, mdTheme: MarkdownTheme, label = 'User') {
    super()
    this.palette = palette
    this.addChild(new Text(messageHeader(label, palette.accent, palette), 0, 0))
    this.addChild(new Markdown(displayText(text), 0, 0, mdTheme, {
      color: (value: string) => palette.text(value),
    }, {
      preserveOrderedListMarkers: true,
      preserveBackslashEscapes: true,
    }))
  }

  override render(width: number): string[] {
    const inner = Math.max(1, width - 4)
    const rows = super.render(inner)
    return frameBlock(rows, width, this.palette.border, this.palette.userMessageBg)
  }
}

/**
 * A reasoning block: `Reasoning` label and body with a thinking-colored left
 * border column, matching the omp thinking-block presentation.
 */
export class ThinkingBlock extends Container {
  private readonly palette: Palette

  constructor(reasoning: string, palette: Palette, mdTheme: MarkdownTheme) {
    super()
    this.palette = palette
    this.addChild(new Text(palette.italic(palette.thinking('Reasoning')), 0, 0))
    this.addChild(new Markdown(displayText(reasoning), 0, 0, mdTheme, {
      color: (value: string) => palette.dim(value),
      italic: true,
    }))
  }

  override render(width: number): string[] {
    const inner = Math.max(1, width - 2)
    const rows = super.render(inner)
    return rows.map(row => `${this.palette.thinking('│')} ${row}`)
  }
}

/** Children of an assistant message: optional reasoning block then the response text. */
function assistantMessageChildren(
  content: readonly ContentBlock[],
  showReasoning: boolean,
  palette: Palette,
  mdTheme: MarkdownTheme,
): Component[] {
  const reasoning = displayText(textBlocks(content, 'reasoning').trim())
  const text = displayText(textBlocks(content, 'text').trim())
  const children: Component[] = [new Spacer(1)]
  children.push(new Text(messageHeader('Assistant', palette.accent, palette), 0, 0))
  if (reasoning !== '' && showReasoning) {
    children.push(new ThinkingBlock(reasoning, palette, mdTheme))
  }
  if (text !== '') {
    children.push(new Markdown(text, 0, 0, mdTheme, {
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
 * A tool call and its result, rendered as a collapsible omp-style card: a
 * rounded frame whose top border carries the status-colored header and whose
 * rows fill the per-status background (pending / success / error).
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
    const inner = Math.max(1, width - 2)
    const isError = this.result?.isError ?? false
    const glyph = this.result === undefined ? '○' : '●'
    const statusColor = this.result === undefined
      ? this.palette.warning
      : isError ? this.palette.error : this.palette.success
    const statusBg = this.result === undefined
      ? this.palette.toolPendingBg
      : isError ? this.palette.toolErrorBg : this.palette.toolSuccessBg
    const header = `${glyph} Tool / ${displayText(this.name)}`
    let body: string[]
    if (this.result === undefined) {
      const parsed = parseArguments(this.argumentsJson)
      const args = parsed.valid ? pretty(parsed.value) : parsed.raw
      body = args === '' ? [] : [`$ ${displayInlineText(args)}`]
    } else {
      body = displayText(contentText(this.result.content).trim()).split('\n')
    }
    if (body.length === 0) body = [this.palette.dim('(no output)')]
    if (this.visibility === 'collapsed' && body.length > this.maxOutputLines) {
      body = [
        ...body.slice(0, this.maxOutputLines),
        this.palette.dim(`… +${body.length - this.maxOutputLines} lines (Ctrl+O to expand)`),
      ]
    }
    const dimBody = body.map(line => this.palette.dim(line))
    // The blank first row is the card's own paragraph gap.
    return ['', ...frameBlock(dimBody, width, statusColor, statusBg, header)]
  }
}

/** Ctrl+O card-visibility cycle: hidden, collapsed preview, expanded. */
export type ToolCardVisibility = 'hidden' | 'collapsed' | 'expanded'

/**
 * An injected-context card (plugin/goal sources): a dim header plus dim body,
 * deliberately quieter than a human message.
 */
export class ContextCardComponent extends Container {
  private readonly palette: Palette

  constructor(
    label: string,
    text: string,
    private readonly maxOutputLines: number,
    palette: Palette,
  ) {
    super()
    this.palette = palette
    this.addChild(new Text(palette.dim(`Context · ${displayText(label)}`), 0, 0))
    const lines = displayText(text).split('\n')
    const visible = lines.length > maxOutputLines
      ? [...lines.slice(0, maxOutputLines), palette.dim(`… +${lines.length - maxOutputLines} lines (Ctrl+O to expand)`)]
      : lines
    if (visible.length > 0) this.addChild(new Text(visible.map(line => palette.dim(line)).join('\n'), 0, 0))
  }

  override render(width: number): string[] {
    return super.render(Math.max(1, width - 2))
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
    return ['', ...frameBlock(this.rows, width, this.palette.border, this.palette.toolPendingBg)]
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
    const lines: string[] = [this.palette.bold(this.palette.accent('Plan'))]
    if (this.goal !== undefined) {
      lines.push(this.palette.dim(`Goal · ${this.goal.phase}: ${displayText(this.goal.objective)}`))
    }
    for (const todo of this.todos) {
      const mark = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◐' : '○'
      const color = todo.status === 'completed'
        ? this.palette.dim
        : todo.status === 'in_progress' ? this.palette.accent : this.palette.text
      lines.push(color(`${mark} ${displayText(todo.content)}`))
    }
    return lines.map(line => truncateToWidth(line, Math.max(1, width), ''))
  }
}
