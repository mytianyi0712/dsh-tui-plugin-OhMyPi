/**
 * Single-page custom model/provider form. All fields are visible at once:
 * up/down (and left/right) move between rows, Enter edits a text row or toggles
 * a checkbox row, and the bottom row contains Save/Cancel actions.
 */

import {
  Input,
  getKeybindings,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { Translator } from '../i18n.ts'
import { frameBlock, type Palette } from '../theme.ts'

export interface CustomModelDraft {
  provider: string
  model: string
  reasoningEffort: string
  saveDefault: boolean
  saveTitle: boolean
}

type EditableField = 'provider' | 'model' | 'reasoningEffort'

interface FormField {
  kind: 'text' | 'boolean' | 'save' | 'cancel'
  id: string
  label: string
}

export class CustomModelForm implements Component, Focusable {
  focused = false
  onCancel?: () => void

  private readonly title: string
  private readonly palette: Palette
  private readonly t: Translator
  private readonly draft: CustomModelDraft
  private readonly onDone: (draft: CustomModelDraft | undefined) => void
  private readonly fields: FormField[]
  private activeIndex = 0
  private editingField: EditableField | undefined
  private input = new Input()
  private error: string | undefined

  constructor(
    title: string,
    palette: Palette,
    t: Translator,
    draft: CustomModelDraft,
    onDone: (draft: CustomModelDraft | undefined) => void,
  ) {
    this.title = title
    this.palette = palette
    this.t = t
    this.draft = { ...draft }
    this.onDone = onDone
    this.fields = [
      { kind: 'text', id: 'provider', label: t('settingsProvider') },
      { kind: 'text', id: 'model', label: t('settingsModel') },
      { kind: 'text', id: 'reasoningEffort', label: t('settingsDefaultEffort') },
      { kind: 'boolean', id: 'saveDefault', label: t('settingsSaveDefault') },
      { kind: 'boolean', id: 'saveTitle', label: t('settingsSaveTitle') },
      { kind: 'save', id: 'save', label: t('settingsSave') },
      { kind: 'cancel', id: 'cancel', label: t('settingsCancel') },
    ]
  }

  handleInput(data: string): void {
    if (this.editingField !== undefined) {
      this.input.focused = this.focused
      this.input.handleInput(data)
      return
    }

    const kb = getKeybindings()
    if (kb.matches(data, 'tui.select.cancel')) {
      this.onDone(undefined)
      return
    }
    if (kb.matches(data, 'tui.select.up') || kb.matches(data, 'tui.editor.cursorLeft')) {
      this.move(-1)
      return
    }
    if (kb.matches(data, 'tui.select.down') || kb.matches(data, 'tui.editor.cursorRight')) {
      this.move(1)
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
    const safeWidth = Math.max(24, width)
    const innerWidth = Math.max(1, safeWidth - 4)
    this.input.focused = this.focused
    const rows: string[] = []
    rows.push(this.palette.dim(this.t('customConfigHint')))

    this.fields.forEach((field, index) => {
      rows.push(this.renderField(field, index === this.activeIndex, innerWidth))
    })

    if (this.error !== undefined) {
      rows.push('')
      rows.push(this.palette.error(`  ${this.error}`))
    }
    rows.push('')
    rows.push(this.palette.dim(this.t('settingsSubmenuHint')))
    return frameBlock(rows, safeWidth, this.palette.accent, undefined, this.title)
  }

  private move(delta: number): void {
    this.error = undefined
    this.activeIndex = (this.activeIndex + delta + this.fields.length) % this.fields.length
  }

  private activate(): void {
    this.error = undefined
    const field = this.fields[this.activeIndex]
    if (field === undefined) return
    if (field.kind === 'text') {
      this.startEditing(field.id as EditableField)
    } else if (field.kind === 'boolean') {
      if (field.id === 'saveDefault') this.draft.saveDefault = !this.draft.saveDefault
      if (field.id === 'saveTitle') this.draft.saveTitle = !this.draft.saveTitle
    } else if (field.kind === 'save') {
      if (this.draft.provider.trim() === '' || this.draft.model.trim() === '') {
        this.error = this.t('customConfigRequired')
        return
      }
      if (!this.draft.saveDefault && !this.draft.saveTitle) {
        this.error = this.t('customConfigTarget')
        return
      }
      this.onDone({
        provider: this.draft.provider.trim(),
        model: this.draft.model.trim(),
        reasoningEffort: this.draft.reasoningEffort.trim(),
        saveDefault: this.draft.saveDefault,
        saveTitle: this.draft.saveTitle,
      })
    } else {
      this.onDone(undefined)
    }
  }

  private startEditing(field: EditableField): void {
    this.editingField = field
    this.input = new Input()
    this.input.setValue(this.draft[field])
    ;(this.input as unknown as { cursor: number }).cursor = this.draft[field].length
    this.input.onSubmit = (value) => {
      this.draft[field] = value
      this.editingField = undefined
    }
    this.input.onEscape = () => {
      this.editingField = undefined
    }
  }

  private renderField(field: FormField, active: boolean, width: number): string {
    const prefix = active ? '→ ' : '  '
    const label = active ? this.palette.bold(this.palette.accent(field.label)) : this.palette.text(field.label)
    if (field.kind === 'text') {
      const value = this.editingField === field.id
        ? `${this.input.render(Math.max(1, width - visibleWidth(prefix) - visibleWidth(field.label) - 2))[0] ?? ''}`
        : `[ ${this.valueFor(field.id)} ]`
      return truncateToWidth(`${prefix}${label}  ${value}`, width, '')
    }
    if (field.kind === 'boolean') {
      const checked = field.id === 'saveDefault' ? this.draft.saveDefault : this.draft.saveTitle
      const box = checked ? '[✓]' : '[ ]'
      const text = active
        ? this.palette.bold(this.palette.accent(`${box} ${field.label}`))
        : `${box} ${this.palette.text(field.label)}`
      return truncateToWidth(`${prefix}${text}`, width, '')
    }
    const action = active
      ? this.palette.bold(this.palette.accent(`[ ${field.label} ]`))
      : this.palette.dim(`[ ${field.label} ]`)
    return truncateToWidth(`${prefix}${action}`, width, '')
  }

  private valueFor(id: string): string {
    if (id === 'provider') return this.draft.provider
    if (id === 'model') return this.draft.model
    return this.draft.reasoningEffort
  }
}
