/** OMP-style composer chrome: status segments embedded in a horizontal top rail. */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { ReasoningEffortId, type LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { renderTuiPromptTemplate, type TuiPromptToken } from '../prompt.ts'
import type { Palette } from '../theme.ts'

/** Cap the mode segment to 4 CJK / 8 ASCII columns so long preset ids stay compact. */
const MODE_MAX_VISIBLE_WIDTH = 8

const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g

/** Strip SGR color codes so we can re-wrap a segment with a different budget. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, '')
}

/** Keep the start and end of a long value, with an ellipsis in the middle. */
function middleEllipsize(text: string, maxWidth: number, ellipsis = '…'): string {
  if (visibleWidth(text) <= maxWidth) return text
  const ellipsisWidth = visibleWidth(ellipsis)
  const available = Math.max(1, maxWidth - ellipsisWidth)
  const chars = Array.from(text)
  let prefix = ''
  let prefixWidth = 0
  const prefixTarget = Math.ceil(available / 2)
  for (const char of chars) {
    const width = visibleWidth(char)
    if (prefixWidth + width > prefixTarget) break
    prefix += char
    prefixWidth += width
  }
  let suffix = ''
  let suffixWidth = 0
  const suffixTarget = available - prefixWidth
  for (let index = chars.length - 1; index >= 0; index--) {
    const char = chars[index]!
    const width = visibleWidth(char)
    if (suffixWidth + width > suffixTarget) break
    suffix = char + suffix
    suffixWidth += width
  }
  if (suffix === '') return ellipsisWidth <= maxWidth ? ellipsis : ''
  return prefix + ellipsis + suffix
}

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
 * The composer's inset top rail. Wide terminals keep the configured
 * mode/path/Git prompt. When that surface no longer fits, the built-in
 * segments switch to compact values and drop the directory before truncating
 * mode or branch; separators are rebuilt between complete segments, so a
 * narrow sidebar never shows a dangling Powerline fragment.
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

  private capMode(value: string | undefined): string | undefined {
    return value === undefined ? undefined : truncateToWidth(value, MODE_MAX_VISIBLE_WIDTH, '…')
  }

  private resolveForRender(name: string): string | undefined {
    return name === 'mode/compact'
      ? this.capMode(this.resolve(name))
      : this.resolve(name)
  }

  private renderLeft(width: number): string {
    const full = renderTuiPromptTemplate(this.leftTemplate, name => this.resolveForRender(name))
    if (visibleWidth(full) <= width) return full

    const compact = this.renderCompact(width)
    if (compact !== undefined) return compact

    const withoutCwd = renderTuiPromptTemplate(
      this.leftTemplate,
      name => name === 'cwd' ? undefined : this.resolveForRender(name),
    )
    const cwdBudget = Math.max(0, width - visibleWidth(withoutCwd))
    const cwd = this.resolveForRender('cwd')
    const collapsedCwd = cwd === undefined ? undefined : truncateToWidth(cwd, cwdBudget, '…')
    const rendered = renderTuiPromptTemplate(
      this.leftTemplate,
      name => name === 'cwd' ? collapsedCwd : this.resolveForRender(name),
    )
    return truncateToWidth(rendered, width, '')
  }

  /** Compact only the built-in default three-segment status prompt. */
  private renderCompact(width: number): string | undefined {
    const values = this.leftTemplate.filter(token => token.type === 'value')
    if (this.leftTemplate.length !== values.length || values.length !== 3) return undefined
    if (values[0]?.name !== 'mode' || values[1]?.name !== 'cwd' || values[2]?.name !== 'git/worktree') {
      return undefined
    }

    const segments = [
      this.resolveForRender('mode/compact'),
      this.resolveForRender('cwd/compact'),
      this.resolveForRender('git/worktree/compact'),
    ]
    const separator = ` ${this.palette.statusSep('')} `
    const join = (items: readonly (string | undefined)[]): string =>
      items.filter((item): item is string => item !== undefined && item !== '').join(separator)
    if (segments[0] === undefined || segments[1] === undefined) return undefined
    const all = join(segments)
    if (visibleWidth(all) <= width) return all

    const withoutCwd = join([segments[0], segments[2]])
    if (visibleWidth(withoutCwd) <= width) return withoutCwd

    const mode = segments[0]
    const git = segments[2]
    if (mode !== undefined && git !== undefined) {
      const modeBudget = width - visibleWidth(separator) - visibleWidth(git)
      if (modeBudget >= 4) return `${truncateToWidth(mode, modeBudget, '…')}${separator}${git}`
      return truncateToWidth(mode, width, '…')
    }

    return truncateToWidth(mode ?? git ?? segments[1] ?? '', width, '…')
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

/** Model, reasoning effort, context, and permission below the bottom rail. */
export class ComposerFooterComponent implements Component {
  constructor(
    private readonly rightTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const contentWidth = safeWidth <= 2 ? safeWidth : safeWidth - 2
    const full = renderTuiPromptTemplate(this.rightTemplate, this.resolve)
    const text = visibleWidth(full) <= contentWidth
      ? full
      : this.renderCompact(contentWidth) ?? truncateToWidth(full, contentWidth, '')
    return safeWidth <= 2 ? [text] : [`  ${text}`]
  }

  /** Compress the footer in stages: model, then ctx prefix, then dropping segments. */
  private renderCompact(width: number): string | undefined {
    const values = this.rightTemplate.filter(token => token.type === 'value')
    if (this.rightTemplate.length !== values.length || values.length !== 4) return undefined
    if (values[0]?.name !== 'model' || values[1]?.name !== 'effort'
      || values[2]?.name !== 'context' || values[3]?.name !== 'permission') {
      return undefined
    }

    const segments = [
      this.resolve('model/compact'),
      this.resolve('effort/compact'),
      this.resolve('context/compact'),
      this.resolve('permission/compact'),
    ]
    if (segments.every(segment => segment === undefined)) return undefined
    const separator = ` ${this.palette.muted('·')} `
    const join = (items: readonly (string | undefined)[]): string =>
      items.filter((item): item is string => item !== undefined && item !== '').join(separator)
    const tryJoin = (items: readonly (string | undefined)[]): string | undefined => {
      const text = join(items)
      return text !== '' && visibleWidth(text) <= width ? text : undefined
    }

    const original = tryJoin(segments)
    if (original !== undefined) return original

    // Stage 1: compress the model with a middle ellipsis (deep…flash).
    const other = join([segments[1], segments[2], segments[3]])
    const hasOther = segments[1] !== undefined || segments[2] !== undefined || segments[3] !== undefined
    const modelBudget = width - (hasOther ? visibleWidth(separator) : 0) - visibleWidth(other)
    const modelPlain = segments[0] === undefined ? undefined : stripAnsi(segments[0])
    const compressedModel = modelPlain === undefined
      ? undefined
      : this.palette.model(middleEllipsize(modelPlain, Math.max(1, modelBudget), '…'))
    const withCompressedModel = tryJoin([compressedModel, segments[1], segments[2], segments[3]])
    if (withCompressedModel !== undefined) return withCompressedModel

    // Stage 2: drop the "ctx " prefix from the context segment.
    const contextPlain = segments[2] === undefined ? undefined : stripAnsi(segments[2]).replace(/^ctx\s+/, '')
    const contextNoCtx = contextPlain === undefined
      ? undefined
      : this.palette.context(contextPlain)
    const withNoCtx = tryJoin([compressedModel, segments[1], contextNoCtx, segments[3]])
    if (withNoCtx !== undefined) return withNoCtx

    // Stage 3: delete lower-priority content, preserving the compressed form.
    const base = [compressedModel, segments[1], contextNoCtx, segments[3]]
    for (const candidate of [base, base.slice(1), base.slice(2), base.slice(3)]) {
      const text = tryJoin(candidate)
      if (text !== undefined) return text
    }
    return truncateToWidth(join([segments[3] ?? segments[2] ?? segments[1] ?? segments[0] ?? '']), width, '…')
  }
}
