/** OMP-style composer chrome: status segments embedded in a horizontal top rail. */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { ReasoningEffortId, type LlmReasoningEffortInfo } from '../dsh-host/index.ts'
import type { ModelSelection } from '../dsh-host/index.ts'
import type { EpochHeader } from '../dsh-host/index.ts'
import { renderTuiPromptTemplate, type TuiPromptToken } from '../prompt.ts'
import type { Palette } from '../theme.ts'

const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g

/** Strip SGR color codes so we can re-wrap a segment with a different budget. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR_PATTERN, '')
}

/** Remove a leading separator carried by full (non-compact) prompt values. */
function cleanSegment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = value.replace(/^\s*·\s*/u, '')
  return cleaned === '' ? undefined : cleaned
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

/** Fallback cycle when a model does not advertise selectable efforts. */
export const FALLBACK_REASONING_EFFORTS = ['off', 'low', 'high', 'max'] as const

/**
 * Cycle one model's stored thinking level: inherit (undefined) then advertised
 * ids, or the common off/low/high/max ladder when the adapter exposes none.
 */
export function nextModelReasoningEffort(
  current: string | undefined,
  advertisedIds: readonly string[],
): string | undefined {
  const ids = advertisedIds.length > 0 ? [...advertisedIds] : [...FALLBACK_REASONING_EFFORTS]
  const cycle: Array<string | undefined> = [undefined, ...ids]
  const index = cycle.findIndex(id => id === current)
  const from = index >= 0 ? index : 0
  return cycle[(from + 1) % cycle.length]
}

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
 * The row below the editor: directory/status content on the left and, pinned
 * to the right, the selected edit mode followed by the current permission
 * preset. The right group always keeps permission visible; when width is
 * scarce the mode is collapsed before the left content gives way.
 */
export class ComposerDirectoryComponent implements Component {
  constructor(
    private readonly leftTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const inset = safeWidth > 4 ? '  ' : ''
    const contentWidth = Math.max(1, safeWidth - visibleWidth(inset) * 2)
    const right = this.renderRight(contentWidth)
    const rightWidth = visibleWidth(right)
    if (rightWidth >= contentWidth) return [`${inset}${right}${inset}`]

    const leftBudget = right === '' ? contentWidth : Math.max(0, contentWidth - rightWidth - 1)
    const left = leftBudget === 0 ? '' : this.renderLeft(leftBudget)
    const gapWidth = Math.max(0, contentWidth - visibleWidth(left) - rightWidth)
    return [`${inset}${left}${' '.repeat(gapWidth)}${right}${inset}`]
  }

  private renderRight(width: number): string {
    const mode = this.resolve('mode/compact') ?? this.resolve('mode')
    const permission = this.resolve('permission/compact')
    const separator = ` ${this.palette.muted('·')} `
    if (mode === undefined && permission === undefined) return ''
    if (mode === undefined) return truncateToWidth(permission ?? '', width, '')
    if (permission === undefined) return truncateToWidth(mode, width, '…')
    const full = `${mode}${separator}${permission}`
    if (visibleWidth(full) <= width) return full
    const permissionWidth = visibleWidth(permission)
    if (permissionWidth >= width) return truncateToWidth(permission, width, '')
    const modeBudget = width - permissionWidth - visibleWidth(separator)
    if (modeBudget >= 4) return `${truncateToWidth(mode, modeBudget, '…')}${separator}${permission}`
    return truncateToWidth(permission, width, '')
  }

  private resolveForRender(name: string): string | undefined {
    // Mode lives on the right next to permission; permission is right-only.
    if (name === 'permission' || name === 'permission/compact' || name === 'mode' || name === 'mode/compact') return undefined
    return this.resolve(name)
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

  /** Compact only the built-in default status segments left of the mode. */
  private renderCompact(width: number): string | undefined {
    const values = this.leftTemplate.filter(token => token.type === 'value')
    if (this.leftTemplate.length !== values.length || values.length !== 2) return undefined
    if (values[0]?.name !== 'cwd' || values[1]?.name !== 'git/worktree') return undefined

    const segments = [
      this.resolveForRender('cwd/compact'),
      this.resolveForRender('git/worktree/compact'),
    ]
    const separator = ` ${this.palette.statusSep('')} `
    const join = (items: readonly (string | undefined)[]): string =>
      items.filter((item): item is string => item !== undefined && item !== '').join(separator)
    if (segments[0] === undefined) return segments[1] === undefined ? undefined : truncateToWidth(segments[1], width, '…')
    const all = join(segments)
    if (visibleWidth(all) <= width) return all
    if (segments[1] === undefined) return truncateToWidth(segments[0], width, '…')
    const gitWidth = visibleWidth(segments[1])
    const cwdBudget = width - gitWidth - visibleWidth(separator)
    if (cwdBudget >= 4) return `${truncateToWidth(segments[0], cwdBudget, '…')}${separator}${segments[1]}`
    return truncateToWidth(segments[0], width, '…')
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

/** Model + effort left, context + cache-hit right, below the directory row. */
export class ComposerFooterComponent implements Component {
  constructor(
    private readonly rightTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    const inset = safeWidth > 4 ? '  ' : ''
    const contentWidth = Math.max(1, safeWidth - visibleWidth(inset) * 2)
    const tokenNames = new Set(
      this.rightTemplate.filter(token => token.type === 'value').map(token => token.name),
    )
    const shows = (name: string): boolean => tokenNames.has(name) || tokenNames.has(`${name}/compact`)
    const leftItems = [
      ...shows('model') ? [cleanSegment(this.resolve('model/compact') ?? this.resolve('model'))] : [],
      ...shows('effort') ? [cleanSegment(this.resolve('effort/compact') ?? this.resolve('effort'))] : [],
      ...tokenNames.has('queued') ? [cleanSegment(this.resolve('queued'))] : [],
    ].filter((item): item is string => item !== undefined && item !== '')
    // Cache-hit is paired with the context segment; it never renders alone.
    const rightItems = [
      ...shows('context') ? [cleanSegment(this.resolve('context/compact') ?? this.resolve('context'))] : [],
      ...shows('context') ? [cleanSegment(this.resolve('cache/compact') ?? this.resolve('cache'))] : [],
    ].filter((item): item is string => item !== undefined && item !== '')

    if (leftItems.length === 0 && rightItems.length === 0) return ['']

    const right = this.renderRight(rightItems, contentWidth)
    const rightWidth = visibleWidth(right)
    const leftBudget = right === '' ? contentWidth : Math.max(0, contentWidth - rightWidth - 1)
    const left = leftItems.length === 0 || leftBudget === 0 ? '' : this.renderLeft(leftItems, leftBudget)
    const gapWidth = Math.max(0, contentWidth - visibleWidth(left) - rightWidth)
    return [`${inset}${left}${' '.repeat(gapWidth)}${right}${inset}`]
  }

  private join(items: readonly string[]): string {
    return items.join(` ${this.palette.muted('·')} `)
  }

  private renderRight(items: readonly string[], width: number): string {
    if (items.length === 0) return ''
    const full = this.join(items)
    if (visibleWidth(full) <= width) return full
    const context = items[0]
    const cache = items[1]
    if (cache !== undefined) {
      const contextNoCtx = stripAnsi(context ?? '').replace(/^ctx\s+/, '')
      const withoutCtxPrefix = this.palette.context(contextNoCtx)
      const joined = cache === '' ? withoutCtxPrefix : this.join([withoutCtxPrefix, cache])
      if (visibleWidth(joined) <= width) return joined
    }
    if (context !== undefined) return truncateToWidth(context, width, '')
    return truncateToWidth(cache ?? '', width, '')
  }

  private renderLeft(items: readonly string[], width: number): string {
    const full = this.join(items)
    if (visibleWidth(full) <= width) return full

    const [model, effort, queued] = [items[0], items[1], items[2]]
    const tryJoin = (candidate: readonly (string | undefined)[]): string | undefined => {
      const text = this.join(candidate.filter((item): item is string => item !== undefined && item !== ''))
      return text !== '' && visibleWidth(text) <= width ? text : undefined
    }

    if (queued !== undefined) {
      const withoutQueued = tryJoin([model, effort])
      if (withoutQueued !== undefined) return withoutQueued
    }

    const modelPlain = model === undefined ? undefined : stripAnsi(model)
    const other = this.join([effort, queued].filter((item): item is string => item !== undefined && item !== ''))
    const hasOther = other !== ''
    const modelBudget = modelPlain === undefined
      ? 0
      : width - (hasOther ? visibleWidth(` ${this.palette.muted('·')} `) : 0) - visibleWidth(other)
    const compressedModel = modelPlain === undefined
      ? undefined
      : this.palette.model(middleEllipsize(modelPlain, Math.max(1, modelBudget), '…'))
    const withCompressedModel = tryJoin([compressedModel, effort, queued])
    if (withCompressedModel !== undefined) return withCompressedModel

    if (effort !== undefined) {
      const modelOnly = tryJoin([compressedModel ?? model])
      if (modelOnly !== undefined) return modelOnly
    }
    return truncateToWidth(compressedModel ?? model ?? effort ?? queued ?? '', width, '…')
  }
}
