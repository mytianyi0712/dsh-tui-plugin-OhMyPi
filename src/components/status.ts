/** OMP-style composer chrome: status segments embedded in a horizontal top rail. */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { ReasoningEffortId, type LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { renderTuiPromptTemplate, type TuiPromptToken } from '../prompt.ts'
import type { Palette } from '../theme.ts'

/** Select the route a session will actually continue with. */
export function resolveSessionModelSelection(
  header: EpochHeader | undefined,
  fallback: ModelSelection,
  defaultReasoningEffort: string,
): ModelSelection {
  if (header === undefined) {
    return {
      provider: fallback.provider,
      model: fallback.model,
      reasoningEffort: fallback.reasoningEffort ?? ReasoningEffortId(defaultReasoningEffort),
    }
  }
  return {
    provider: header.config.provider,
    model: header.config.model,
    reasoningEffort: header.config.reasoningEffort ?? ReasoningEffortId(defaultReasoningEffort),
  }
}

export type ReasoningEffortChoice =
  | { kind: 'unsupported' }
  | { kind: 'unknown'; requested: string }
  | { kind: 'already'; effort: LlmReasoningEffortInfo }
  | { kind: 'selected'; effort: LlmReasoningEffortInfo }

/** Resolve an explicit effort or cycle through the model's advertised order. */
export function chooseReasoningEffort(
  efforts: readonly LlmReasoningEffortInfo[],
  current: ModelSelection['reasoningEffort'],
  requested: string,
): ReasoningEffortChoice {
  if (efforts.length === 0) return { kind: 'unsupported' }
  let target: LlmReasoningEffortInfo | undefined
  if (requested === '') {
    const currentIndex = efforts.findIndex(effort => effort.id === current)
    target = efforts[(currentIndex + 1) % efforts.length]
  } else {
    target = efforts.find(effort => effort.id === requested)
    if (target === undefined) return { kind: 'unknown', requested }
  }
  if (target === undefined) return { kind: 'unsupported' }
  return target.id === current ? { kind: 'already', effort: target } : { kind: 'selected', effort: target }
}

/** Compact token counts for the footer: 100000 → `100k`, 1000000 → `1m`. */
export function formatContextTokens(count: number): string {
  const safe = Math.max(0, Math.floor(count))
  if (safe >= 1_000_000) return `${compactUnit(safe / 1_000_000)}m`
  if (safe >= 1_000) return `${compactUnit(safe / 1_000)}k`
  return String(safe)
}

function compactUnit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

/**
 * The composer's inset top rail. The complete mode/path/Git prompt is rendered
 * on one theme surface with a Powerline tail. When space is tight only `cwd`
 * collapses, so the branch and mode remain visible.
 */
export class StatusLineComponent implements Component {
  constructor(
    private readonly leftTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth <= 2) return [this.palette.border('─'.repeat(safeWidth))]

    const innerWidth = safeWidth - 2
    const capWidth = Math.min(3, innerWidth)
    const segmentOverhead = 3 // leading/trailing padding plus the Powerline tail
    const promptBudget = Math.max(0, innerWidth - capWidth - segmentOverhead)
    const left = this.renderLeft(promptBudget)
    const segment = left === ''
      ? ''
      : `${this.palette.statusLineBg(` ${left} `)}${this.palette.statusLineTail('')}`
    const fillWidth = Math.max(0, innerWidth - capWidth - visibleWidth(segment))
    return [` ${this.palette.border('─'.repeat(capWidth))}${segment}${this.palette.border('─'.repeat(fillWidth))} `]
  }

  private renderLeft(width: number): string {
    const withoutCwd = renderTuiPromptTemplate(
      this.leftTemplate,
      name => name === 'cwd' ? undefined : this.resolve(name),
    )
    const cwdBudget = Math.max(0, width - visibleWidth(withoutCwd))
    const cwd = this.resolve('cwd')
    const collapsedCwd = cwd === undefined ? undefined : truncateToWidth(cwd, cwdBudget, '…')
    const rendered = renderTuiPromptTemplate(
      this.leftTemplate,
      name => name === 'cwd' ? collapsedCwd : this.resolve(name),
    )
    return truncateToWidth(rendered, width, '')
  }
}

/** Faint expected-argument hint shown directly below command input. */
export class CommandHintComponent implements Component {
  constructor(
    private readonly resolve: () => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const hint = this.resolve()
    if (hint === undefined || width <= 0) return []
    return [truncateToWidth(this.palette.dim(`  ${hint}`), width, '')]
  }
}

/** Bottom rail closing the borderless editor body, inset one cell like OMP. */
export class InputBorderComponent implements Component {
  constructor(private readonly palette: Palette) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth <= 2) return [this.palette.border('─'.repeat(safeWidth))]
    return [` ${this.palette.border('─'.repeat(safeWidth - 2))} `]
  }
}

/** Model, reasoning effort, and context below the bottom rail. */
export class ComposerFooterComponent implements Component {
  constructor(
    private readonly rightTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const text = renderTuiPromptTemplate(this.rightTemplate, this.resolve)
    if (safeWidth <= 2) return [truncateToWidth(text, safeWidth, '')]
    return [`  ${truncateToWidth(text, safeWidth - 2, '')}`]
  }
}
