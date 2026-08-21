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
import { frameBlock, type Palette } from '../theme.ts'

type ModelRow = { kind: 'model'; index: number }
type ActionRow = { kind: 'action'; id: 'add' | 'done' | 'cancel' }
type Row = ModelRow | ActionRow

/**
 * In-memory model catalog editor used by the provider form.
 *
 * Changes are only returned on Save, so deleting a model is reversible with
 * Cancel and cannot leave a half-written provider profile behind.
 */
export class ModelListDialog implements Component {
  private readonly title: string
  private readonly palette: Palette
  private readonly t: Translator
  private readonly onDone: (models: string[] | undefined) => void
  private readonly models: string[]
  private rows: Row[] = []
  private activeIndex = 0
  private selectedIndex: number | undefined
  private editingIndex: number | undefined
  private isEditing = false
  private input = new Input()
  private error: string | undefined

  constructor(
    title: string,
    models: readonly string[],
    palette: Palette,
    t: Translator,
    onDone: (models: string[] | undefined) => void,
  ) {
    this.title = title
    this.models = [...new Set(models.map(model => model.trim()).filter(Boolean))]
    this.palette = palette
    this.t = t
    this.onDone = onDone
    this.selectedIndex = this.models.length > 0 ? 0 : undefined
    this.rebuildRows()
  }
  handleInput(data: string): void {
    if (this.isEditing) {
      this.input.handleInput(data === '\r' ? '\n' : data)
      return
    }

    const kb = getKeybindings()
    if (
      this.selectedModelIndex() !== undefined
      && (kb.matches(data, 'tui.editor.deleteCharForward')
        || kb.matches(data, 'tui.editor.deleteCharBackward')
        || data === '\x7f')
    ) {
      this.deleteSelectedModel()
      return
    }
    if (kb.matches(data, 'tui.select.cancel')) {
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
      this.movePage(-8)
      return
    }
    if (kb.matches(data, 'tui.select.pageDown')) {
      this.movePage(8)
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
    const appendWrapped = (
      text: string,
      paint: (value: string) => string,
      prefix = '',
    ): void => {
      const available = Math.max(1, innerWidth - visibleWidth(prefix))
      rows.push(...wrapTextWithAnsi(text, available).map(line => paint(`${prefix}${line}`)))
    }

    appendWrapped(this.t('settingsModelListHint'), this.palette.dim)
    rows.push('')

    if (this.models.length === 0) {
      appendWrapped(this.t('settingsModelListEmpty'), this.palette.dim, '  ')
    } else {
      this.models.forEach((model, index) => {
        rows.push(...this.renderModel(index, index === this.selectedModelIndex(), innerWidth))
      })
    }

    rows.push('')
    for (const [index, row] of this.rows.entries()) {
      if (row.kind !== 'action') continue
      rows.push(this.renderAction(row.id, index === this.activeIndex, innerWidth))
    }

    const selected = this.selectedModelIndex()
    if (this.isEditing) {
      rows.push('')
      appendWrapped(`${this.t('settingsModelValue')}:`, this.palette.dim, '  ')
      appendWrapped(this.input.getValue(), value => value, '  ')
    } else if (selected !== undefined) {
      rows.push('')
      appendWrapped(`${this.t('settingsModelValue')}:`, this.palette.dim, '  ')
      appendWrapped(this.models[selected]!, value => value, '  ')
    }

    if (this.error !== undefined) {
      rows.push('')
      appendWrapped(this.error, this.palette.error, '  ')
    }
    rows.push('')
    appendWrapped(this.t('settingsSubmenuHint'), this.palette.dim)
    return frameBlock(rows, safeWidth, this.palette.accent, undefined, this.title)
  }

  private rebuildRows(): void {
    const modelRows: ModelRow[] = this.models.map((_, index) => ({ kind: 'model', index }))
    const actionRows: ActionRow[] = [{ kind: 'action', id: 'add' }]
    actionRows.push({ kind: 'action', id: 'done' }, { kind: 'action', id: 'cancel' })
    this.rows = [...modelRows, ...actionRows]
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.rows.length - 1))
  }

  private selectedModelIndex(): number | undefined {
    return this.selectedIndex !== undefined && this.selectedIndex < this.models.length
      ? this.selectedIndex
      : undefined
  }

  private move(delta: number): void {
    this.error = undefined
    if (this.rows.length === 0) return
    this.activeIndex = (this.activeIndex + delta + this.rows.length) % this.rows.length
    const row = this.rows[this.activeIndex]
    if (row?.kind === 'model') this.selectedIndex = row.index
  }

  private movePage(delta: number): void {
    this.error = undefined
    if (this.rows.length === 0) return
    this.moveToRow(Math.max(0, Math.min(this.rows.length - 1, this.activeIndex + delta)))
  }

  private moveToRow(index: number): void {
    this.activeIndex = index
    const row = this.rows[this.activeIndex]
    if (row?.kind === 'model') this.selectedIndex = row.index
  }

  private activate(): void {
    this.error = undefined
    const row = this.rows[this.activeIndex]
    if (row === undefined) return
    if (row.kind === 'model') {
      this.startEditing(row.index)
      return
    }
    if (row.id === 'add') {
      this.startEditing(undefined)
    } else if (row.id === 'done') {
      this.onDone([...this.models])
    } else {
      this.onDone(undefined)
    }
  }
  private deleteSelectedModel(): void {
    const selected = this.selectedModelIndex()
    if (selected === undefined) return
    this.models.splice(selected, 1)
    this.selectedIndex = this.models.length === 0 ? undefined : Math.min(selected, this.models.length - 1)
    this.rebuildRows()
    this.activeIndex = Math.min(selected, Math.max(0, this.rows.length - 1))
  }

  private startEditing(index: number | undefined): void {
    this.isEditing = true
    this.editingIndex = index
    if (index !== undefined) this.selectedIndex = index
    this.input = new Input()
    const initial = index === undefined ? '' : this.models[index] ?? ''
    if (initial !== '') this.input.handleInput(initial)
    this.input.onSubmit = (value) => {
      const model = value.trim()
      if (model === '') {
        this.error = this.t('settingsModelRequired')
        return
      }
      const duplicate = this.models.findIndex((entry, entryIndex) => entry === model && entryIndex !== index)
      if (duplicate >= 0) {
        this.error = this.t('settingsModelDuplicate')
        return
      }
      if (index === undefined) {
        this.models.push(model)
        this.selectedIndex = this.models.length - 1
        this.activeIndex = this.models.length - 1
      } else {
        this.models[index] = model
        this.selectedIndex = index
        this.activeIndex = index
      }
      this.isEditing = false
      this.editingIndex = undefined
      this.error = undefined
      this.rebuildRows()
      this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.rows.length - 1))
    }
    this.input.onEscape = () => {
      this.isEditing = false
      this.editingIndex = undefined
      this.error = undefined
    }
  }

  private renderModel(index: number, active: boolean, width: number): string[] {
    const prefix = active ? '→ ' : '  '
    const labelPrefix = `${prefix}${index + 1}. `
    const prefixWidth = visibleWidth(labelPrefix)
    const model = this.isEditing && this.editingIndex === index
      ? this.input.render(Math.max(1, width - prefixWidth))[0] ?? ''
      : this.models[index]!
    const modelLines = wrapTextWithAnsi(model, Math.max(1, width - prefixWidth))
    const continuationPrefix = ' '.repeat(Math.min(width, prefixWidth))
    return modelLines.map((line, lineIndex) => {
      const text = `${lineIndex === 0 ? labelPrefix : continuationPrefix}${line}`
      const painted = active ? this.palette.bold(this.palette.accent(text)) : this.palette.text(text)
      return truncateToWidth(painted, width, '')
    })
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
