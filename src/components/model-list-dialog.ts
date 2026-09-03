import {
  Input,
  getKeybindings,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import type { Translator } from '../i18n.ts'
import { frameBlock, overlayViewportHeight, type Palette } from '../theme.ts'
import {
  defaultEffortOf,
  formatReasoningEffortSetting,
  nextReasoningEffortMap,
  parseReasoningEffortSetting,
  presetIdOf,
  thinkingLevelsOf,
  type ReasoningEffortSetting,
} from '../reasoning-maps.ts'

export interface ProviderModelDraft {
  id: string
  name?: string
  /** Official dsh UI level → wire value (`off: none, high: high, max: max`), or `false` for non-reasoning. */
  reasoningEfforts?: ReasoningEffortSetting
  /** Selected official UI level (`max`, `high`, …), not the wire spelling. */
  reasoningEffort?: string
  contextWindow?: number
  maxTokens?: number
}

type FieldId = 'id' | 'name' | 'efforts' | 'effort' | 'contextWindow' | 'maxTokens'
type ModelRow = { kind: 'model'; index: number }
type FieldRow = { kind: 'field'; index: number; field: FieldId }
type ActionRow = { kind: 'action'; id: 'add' | 'done' | 'cancel' }
type Row = ModelRow | FieldRow | ActionRow

const FIELD_ORDER: FieldId[] = ['id', 'name', 'efforts', 'effort', 'contextWindow', 'maxTokens']

export function parseReasoningEfforts(value: string | readonly string[] | ReasoningEffortSetting | undefined): ReasoningEffortSetting | undefined {
  return parseReasoningEffortSetting(value)
}

export function formatReasoningEfforts(efforts: ReasoningEffortSetting | readonly string[] | undefined): string {
  return formatReasoningEffortSetting(parseReasoningEffortSetting(efforts))
}

function parsePositiveInt(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

export function normalizeProviderModels(
  models: readonly (string | ProviderModelDraft)[],
): ProviderModelDraft[] {
  const seen = new Set<string>()
  const result: ProviderModelDraft[] = []
  for (const entry of models) {
    const id = (typeof entry === 'string' ? entry : entry.id).trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    if (typeof entry === 'string') {
      result.push({ id })
      continue
    }
    const reasoningEfforts = parseReasoningEffortSetting(entry.reasoningEfforts)
    const reasoningEffort = defaultEffortOf(reasoningEfforts, entry.reasoningEffort?.trim())
    const name = entry.name?.trim()
    result.push({
      id,
      ...(name !== undefined && name !== '' && name !== id ? { name } : {}),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(typeof entry.contextWindow === 'number' && entry.contextWindow > 0 ? { contextWindow: entry.contextWindow } : {}),
      ...(typeof entry.maxTokens === 'number' && entry.maxTokens > 0 ? { maxTokens: entry.maxTokens } : {}),
    })
  }
  return result
}

/**
 * Provider model catalog. Enter expands a model into a flat field list
 * (id, display name, thinking levels, default effort, context, max tokens).
 */
export class ModelListDialog implements Component {
  private readonly title: string
  private readonly palette: Palette
  private readonly t: Translator
  private readonly onDone: (models: ProviderModelDraft[] | undefined) => void
  private readonly models: ProviderModelDraft[]
  private rows: Row[] = []
  private activeIndex = 0
  private expandedIndex: number | undefined
  private editingField: FieldId | undefined
  private input = new Input()
  private error: string | undefined

  constructor(
    title: string,
    models: readonly (string | ProviderModelDraft)[],
    palette: Palette,
    t: Translator,
    onDone: (models: ProviderModelDraft[] | undefined) => void,
  ) {
    this.title = title
    this.models = normalizeProviderModels(models)
    this.palette = palette
    this.t = t
    this.onDone = onDone
    this.rebuildRows()
  }

  handleInput(data: string): void {
    if (this.editingField !== undefined) {
      this.input.handleInput(data === '\r' ? '\n' : data)
      return
    }

    const kb = getKeybindings()
    const row = this.rows[this.activeIndex]
    if (
      row?.kind === 'model'
      && (kb.matches(data, 'tui.editor.deleteCharForward')
        || kb.matches(data, 'tui.editor.deleteCharBackward')
        || data === '\x7f')
    ) {
      this.deleteModel(row.index)
      return
    }
    if (kb.matches(data, 'tui.select.cancel')) {
      if (this.expandedIndex !== undefined) {
        this.expandedIndex = undefined
        this.rebuildRows()
        return
      }
      this.onDone(undefined)
      return
    }
    if (kb.matches(data, 'tui.select.up')) {
      this.move(-1)
      return
    }
    if (kb.matches(data, 'tui.select.down')) {
      this.move(1)
      return
    }
    if (kb.matches(data, 'tui.select.pageUp')) {
      this.moveToRow(Math.max(0, this.activeIndex - 8))
      return
    }
    if (kb.matches(data, 'tui.select.pageDown')) {
      this.moveToRow(Math.min(this.rows.length - 1, this.activeIndex + 8))
      return
    }
    if (matchesKey(data, 'home')) {
      this.moveToRow(0)
      return
    }
    if (matchesKey(data, 'end')) {
      this.moveToRow(Math.max(0, this.rows.length - 1))
      return
    }
    if ((data === 'e' || data === 'E') && row?.kind === 'field' && row.field === 'efforts') {
      void this.startEditing(row.index, 'efforts')
      return
    }
    if ((data === 'p' || data === 'P') && row?.kind === 'field' && (row.field === 'efforts' || row.field === 'effort')) {
      this.cycleEffortMap(row.index)
      return
    }
    if (kb.matches(data, 'tui.select.confirm') || data === ' ') {
      this.activate()
    }
  }

  invalidate(): void {
    this.input.invalidate()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(8, width)
    const innerWidth = Math.max(1, safeWidth - 4)
    const rows: string[] = []
    const appendWrapped = (text: string, paint: (value: string) => string, prefix = ''): void => {
      const available = Math.max(1, innerWidth - visibleWidth(prefix))
      rows.push(...wrapTextWithAnsi(text, available).map(line => paint(`${prefix}${line}`)))
    }

    appendWrapped(this.t('settingsModelListHint'), this.palette.dim)
    const activeRow = this.rows[this.activeIndex]
    if (activeRow?.kind === 'field' && (activeRow.field === 'efforts' || activeRow.field === 'effort')) {
      appendWrapped(this.t('settingsModelEffortHint'), this.palette.dim)
    }
    rows.push('')

    if (this.models.length === 0) {
      appendWrapped(this.t('settingsModelListEmpty'), this.palette.dim, '  ')
    }

    for (const [index, row] of this.rows.entries()) {
      const active = index === this.activeIndex
      if (row.kind === 'model') {
        rows.push(this.renderModel(row.index, active, innerWidth))
      } else if (row.kind === 'field') {
        rows.push(this.renderField(row.index, row.field, active, innerWidth))
      } else {
        rows.push(this.renderAction(row.id, active, innerWidth))
      }
    }

    if (this.error !== undefined) {
      rows.push('')
      appendWrapped(this.error, this.palette.error, '  ')
    }
    rows.push('')
    appendWrapped(this.t('settingsSubmenuHint'), this.palette.dim)
    return frameBlock(rows, safeWidth, this.palette.accent, undefined, this.title, undefined, overlayViewportHeight())
  }

  private rebuildRows(): void {
    const rows: Row[] = []
    this.models.forEach((_, index) => {
      rows.push({ kind: 'model', index })
      if (this.expandedIndex === index) {
        for (const field of FIELD_ORDER) rows.push({ kind: 'field', index, field })
      }
    })
    rows.push({ kind: 'action', id: 'add' }, { kind: 'action', id: 'done' }, { kind: 'action', id: 'cancel' })
    this.rows = rows
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.rows.length - 1))
  }

  private move(delta: number): void {
    this.error = undefined
    if (this.rows.length === 0) return
    this.activeIndex = (this.activeIndex + delta + this.rows.length) % this.rows.length
  }

  private moveToRow(index: number): void {
    this.activeIndex = Math.max(0, Math.min(index, this.rows.length - 1))
  }

  private activate(): void {
    this.error = undefined
    const row = this.rows[this.activeIndex]
    if (row === undefined) return
    if (row.kind === 'model') {
      this.expandedIndex = this.expandedIndex === row.index ? undefined : row.index
      this.rebuildRows()
      if (this.expandedIndex !== undefined) {
        const fieldAt = this.rows.findIndex(entry => entry.kind === 'field' && entry.index === row.index)
        if (fieldAt >= 0) this.activeIndex = fieldAt
      }
      return
    }
    if (row.kind === 'field') {
      if (row.field === 'effort') {
        this.cycleDefaultEffort(row.index)
        return
      }
      if (row.field === 'efforts') {
        this.cycleEffortMap(row.index)
        return
      }
      void this.startEditing(row.index, row.field)
      return
    }
    if (row.id === 'add') {
      void this.startEditing(undefined, 'id')
    } else if (row.id === 'done') {
      this.onDone(normalizeProviderModels(this.models))
    } else {
      this.onDone(undefined)
    }
  }

  private cycleEffortMap(index: number): void {
    const model = this.models[index]
    if (model === undefined) return
    const next = nextReasoningEffortMap(model.reasoningEfforts)
    this.models[index] = {
      ...model,
      reasoningEfforts: next.map,
      reasoningEffort: next.defaultEffort,
    }
    if (next.map === undefined) delete this.models[index]!.reasoningEfforts
    if (next.defaultEffort === undefined) delete this.models[index]!.reasoningEffort
  }

  private cycleDefaultEffort(index: number): void {
    const model = this.models[index]
    if (model === undefined) return
    const levels = thinkingLevelsOf(model.reasoningEfforts)
    if (levels.length === 0) {
      this.cycleEffortMap(index)
      return
    }
    const at = levels.findIndex(id => id === model.reasoningEffort)
    this.models[index] = { ...model, reasoningEffort: levels[(at + 1) % levels.length]! }
  }

  private deleteModel(index: number): void {
    this.models.splice(index, 1)
    this.expandedIndex = undefined
    this.rebuildRows()
    this.activeIndex = Math.min(index, Math.max(0, this.rows.length - 1))
  }

  private async startEditing(index: number | undefined, field: FieldId): Promise<void> {
    this.editingField = field
    this.input = new Input()
    let initial = ''
    if (index !== undefined) {
      const model = this.models[index]!
      if (field === 'id') initial = model.id
      else if (field === 'name') initial = model.name ?? ''
      else if (field === 'efforts') initial = presetIdOf(model.reasoningEfforts) ?? formatReasoningEffortSetting(model.reasoningEfforts)
      else if (field === 'contextWindow') initial = model.contextWindow === undefined ? '' : String(model.contextWindow)
      else if (field === 'maxTokens') initial = model.maxTokens === undefined ? '' : String(model.maxTokens)
    }
    if (initial !== '') this.input.handleInput(initial)
    this.input.onSubmit = (value) => {
      this.commitEdit(index, field, value)
    }
    this.input.onEscape = () => {
      this.editingField = undefined
      this.error = undefined
    }
  }

  private commitEdit(index: number | undefined, field: FieldId, value: string): void {
    if (field === 'id') {
      const id = value.trim()
      if (id === '') {
        this.error = this.t('settingsModelRequired')
        return
      }
      const duplicate = this.models.findIndex((entry, entryIndex) => entry.id === id && entryIndex !== index)
      if (duplicate >= 0) {
        this.error = this.t('settingsModelDuplicate')
        return
      }
      if (index === undefined) {
        this.models.push({ id })
        this.expandedIndex = this.models.length - 1
        this.rebuildRows()
        const fieldAt = this.rows.findIndex(entry => entry.kind === 'field' && entry.field === 'name')
        this.activeIndex = fieldAt >= 0 ? fieldAt : this.rows.length - 1
      } else {
        this.models[index] = { ...this.models[index]!, id }
      }
    } else if (index !== undefined) {
      const model = this.models[index]!
      if (field === 'name') {
        const name = value.trim()
        this.models[index] = { ...model, name: name === '' ? undefined : name }
        if (name === '') delete this.models[index]!.name
      } else if (field === 'efforts') {
        const reasoningEfforts = parseReasoningEffortSetting(value)
        const selected = defaultEffortOf(reasoningEfforts, model.reasoningEffort)
        this.models[index] = {
          ...model,
          reasoningEfforts,
          reasoningEffort: selected,
        }
        if (reasoningEfforts === undefined) delete this.models[index]!.reasoningEfforts
        if (selected === undefined) delete this.models[index]!.reasoningEffort
      } else if (field === 'contextWindow') {
        const parsed = parsePositiveInt(value)
        this.models[index] = { ...model, contextWindow: parsed }
        if (parsed === undefined) delete this.models[index]!.contextWindow
      } else if (field === 'maxTokens') {
        const parsed = parsePositiveInt(value)
        this.models[index] = { ...model, maxTokens: parsed }
        if (parsed === undefined) delete this.models[index]!.maxTokens
      }
    }
    this.editingField = undefined
    this.error = undefined
    this.rebuildRows()
  }

  private effortsText(model: ProviderModelDraft): string {
    if (model.reasoningEfforts === false) return this.t('settingsEffortDisabled')
    return presetIdOf(model.reasoningEfforts) ?? formatReasoningEffortSetting(model.reasoningEfforts)
  }

  private summary(model: ProviderModelDraft): string {
    const bits = [model.name === undefined || model.name === '' ? undefined : model.name]
    const efforts = this.effortsText(model)
    if (efforts !== '') bits.push(model.reasoningEffort === undefined ? efforts : `${efforts} → ${model.reasoningEffort}`)
    else if (model.reasoningEffort !== undefined) bits.push(model.reasoningEffort)
    if (model.contextWindow !== undefined) bits.push(`ctx ${model.contextWindow}`)
    const extra = bits.filter((bit): bit is string => bit !== undefined).join(' · ')
    return extra === '' ? model.id : `${model.id}  ${extra}`
  }

  private fieldLabel(field: FieldId): string {
    if (field === 'id') return this.t('settingsModelValue')
    if (field === 'name') return this.t('settingsModelDisplayName')
    if (field === 'efforts') return this.t('settingsModelEffortLevels')
    if (field === 'effort') return this.t('settingsModelEffort')
    if (field === 'contextWindow') return this.t('settingsModelContextWindow')
    return this.t('settingsModelMaxTokens')
  }

  private fieldValue(model: ProviderModelDraft, field: FieldId): string {
    if (field === 'id') return model.id
    if (field === 'name') return model.name ?? ''
    if (field === 'efforts') {
      const formatted = this.effortsText(model)
      return formatted === '' ? this.t('settingsEffortFromAdapter') : formatted
    }
    if (field === 'effort') return model.reasoningEffort ?? this.t('settingsEffortFromAdapter')
    if (field === 'contextWindow') return model.contextWindow === undefined ? '' : String(model.contextWindow)
    return model.maxTokens === undefined ? '' : String(model.maxTokens)
  }

  private renderModel(index: number, active: boolean, width: number): string {
    const expanded = this.expandedIndex === index
    const marker = expanded ? '▾ ' : '▸ '
    const prefix = active ? '→ ' : '  '
    const text = `${prefix}${marker}${index + 1}. ${this.summary(this.models[index]!)}`
    const painted = active ? this.palette.bold(this.palette.accent(text)) : this.palette.text(text)
    return truncateToWidth(painted, width, '')
  }

  private renderField(index: number, field: FieldId, active: boolean, width: number): string {
    const prefix = active ? '→     ' : '      '
    const label = this.fieldLabel(field)
    const editing = active && this.editingField === field
    const value = editing
      ? (this.input.render(Math.max(1, width - visibleWidth(prefix) - visibleWidth(label) - 4))[0] ?? '')
      : this.fieldValue(this.models[index]!, field)
    const shown = value === '' ? '—' : value
    const text = `${prefix}${label}  [ ${shown} ]`
    const painted = active ? this.palette.bold(this.palette.accent(text)) : this.palette.text(text)
    return truncateToWidth(painted, width, '')
  }

  private renderAction(id: ActionRow['id'], active: boolean, width: number): string {
    const label = id === 'add'
      ? this.t('settingsAddModel')
      : id === 'done'
        ? this.t('settingsSave')
        : this.t('settingsCancel')
    const text = `${active ? '→ ' : '  '}[ ${label} ]`
    return truncateToWidth(active ? this.palette.bold(this.palette.accent(text)) : this.palette.dim(text), width, '')
  }
}
