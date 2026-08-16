/**
 * Single-page provider form for the settings screen. It collects the provider
 * name, base URL, API key, and selected model ids. Model discovery and model
 * picking are delegated to callbacks supplied by the caller so the component
 * stays UI-only while the actual dsh/llm work happens in the host flow.
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

export interface ProviderDraft {
  name: string
  api: string
  baseURL: string
  apiKey: string
  models: string[]
}

export interface DiscoveredModel {
  id: string
  name?: string
}

export interface ProviderFormCallbacks {
  /** Probe the upstream endpoint; return discovered models or undefined. */
  discover?: (draft: ProviderDraft) => Promise<readonly DiscoveredModel[] | undefined>
  /** Open a model picker; return the selected model ids or undefined to cancel. */
  pickModels?: (
    draft: ProviderDraft,
    discovered: readonly DiscoveredModel[],
  ) => Promise<string[] | undefined>
  /** Open a manual model-id editor; return the edited model ids or undefined to cancel. */
  editModelsManually?: (draft: ProviderDraft) => Promise<string[] | undefined>
  /** Open an API type picker; return the selected API type or undefined to cancel. */
  pickApi?: (draft: ProviderDraft) => Promise<string | undefined>
}

type EditableField = 'name' | 'baseURL' | 'apiKey'

interface FormField {
  kind: 'text' | 'action' | 'save' | 'cancel'
  id: string
  label: string
}

export class ProviderForm implements Component, Focusable {
  focused = false
  onCancel?: () => void

  private readonly title: string
  private readonly palette: Palette
  private readonly t: Translator
  private readonly draft: ProviderDraft
  private readonly onDone: (draft: ProviderDraft | undefined) => void
  private readonly callbacks: ProviderFormCallbacks
  private readonly fields: FormField[]
  private activeIndex = 0
  private editingField: EditableField | undefined
  private input = new Input()
  private error: string | undefined
  private discovered: DiscoveredModel[] = []
  private busy = false

  constructor(
    title: string,
    palette: Palette,
    t: Translator,
    draft: ProviderDraft,
    onDone: (draft: ProviderDraft | undefined) => void,
    callbacks: ProviderFormCallbacks = {},
  ) {
    this.title = title
    this.palette = palette
    this.t = t
    this.draft = { ...draft, models: [...draft.models] }
    this.onDone = onDone
    this.callbacks = callbacks
    this.fields = [
      { kind: 'text', id: 'name', label: t('settingsProviderName') },
      { kind: 'action', id: 'api', label: t('settingsApi') },
      { kind: 'text', id: 'baseURL', label: t('settingsBaseURL') },
      { kind: 'text', id: 'apiKey', label: t('settingsApiKey') },
      { kind: 'action', id: 'models', label: t('settingsModels') },
      { kind: 'action', id: 'manual-models', label: t('settingsManualModels') },
      { kind: 'action', id: 'discover', label: t('settingsDiscoverModels') },
      { kind: 'save', id: 'save', label: t('settingsSave') },
      { kind: 'cancel', id: 'cancel', label: t('settingsCancel') },
    ]
  }

  handleInput(data: string): void {
    if (this.busy) return
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
      void this.activate()
    }
  }

  invalidate(): void {
    this.input.invalidate()
  }

  render(width: number): string[] {
    const safeWidth = Math.max(30, width)
    const innerWidth = Math.max(1, safeWidth - 4)
    this.input.focused = this.focused
    const rows: string[] = []
    rows.push(this.palette.dim(this.t('providerFormHint')))

    this.fields.forEach((field, index) => {
      rows.push(this.renderField(field, index === this.activeIndex, innerWidth))
    })

    if (this.busy) {
      rows.push('')
      rows.push(this.palette.dim(`  ${this.t('settingsDiscovering')}`))
    }
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

  private async activate(): Promise<void> {
    this.error = undefined
    const field = this.fields[this.activeIndex]
    if (field === undefined) return
    if (field.kind === 'text') {
      this.startEditing(field.id as EditableField)
      return
    }
    if (field.kind === 'action') {
      if (field.id === 'api') {
        await this.pickApi()
      } else if (field.id === 'models') {
        await this.pickModels()
      } else if (field.id === 'manual-models') {
        await this.editModelsManually()
      } else if (field.id === 'discover') {
        await this.discoverModels()
      }
      return
    }
    if (field.kind === 'save') {
      if (this.draft.name.trim() === '') {
        this.error = this.t('providerConfigRequired')
        return
      }
      this.onDone({
        name: this.draft.name.trim(),
        api: this.draft.api.trim(),
        baseURL: this.draft.baseURL.trim(),
        apiKey: this.draft.apiKey.trim(),
        models: [...this.draft.models],
      })
      return
    }
    this.onDone(undefined)
  }

  private async discoverModels(): Promise<void> {
    if (this.callbacks.discover === undefined) {
      this.error = this.t('settingsDiscoveryUnavailable')
      return
    }
    this.busy = true
    try {
      const found = await this.callbacks.discover(this.draft)
      if (found === undefined) {
        this.error = this.t('settingsDiscoveryUnavailable')
        return
      }
      this.discovered = found.map(model => ({ id: model.id, name: model.name }))
      // Keep previously selected models that are no longer advertised; they may
      // still be valid for providers that do not advertise a full catalog.
      const advertised = new Set(this.discovered.map(model => model.id))
      this.draft.models = [
        ...this.discovered.map(model => model.id),
        ...this.draft.models.filter(model => !advertised.has(model)),
      ]
      // Let the user immediately pick a subset of the discovered models.
      await this.pickModels()
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }

  private async pickApi(): Promise<void> {
    if (this.callbacks.pickApi === undefined) {
      this.error = this.t('settingsDiscoveryUnavailable')
      return
    }
    this.busy = true
    try {
      const picked = await this.callbacks.pickApi(this.draft)
      if (picked !== undefined) this.draft.api = picked
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }

  private async pickModels(): Promise<void> {
    if (this.callbacks.pickModels === undefined) {
      this.error = this.t('settingsDiscoveryUnavailable')
      return
    }
    this.busy = true
    try {
      const picked = await this.callbacks.pickModels(this.draft, this.discovered)
      if (picked !== undefined) this.draft.models = picked
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }

  private async editModelsManually(): Promise<void> {
    if (this.callbacks.editModelsManually === undefined) {
      this.error = this.t('settingsDiscoveryUnavailable')
      return
    }
    this.busy = true
    try {
      const edited = await this.callbacks.editModelsManually(this.draft)
      if (edited !== undefined) this.draft.models = edited
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
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
    if (field.kind === 'action') {
      const value = field.id === 'api'
        ? this.draft.api === ''
          ? this.t('settingsApi')
          : this.draft.api
        : field.id === 'models'
          ? this.draft.models.length === 0
            ? this.t('settingsEmpty')
            : this.draft.models.map(model => model).join(', ')
          : field.id === 'manual-models'
            ? this.draft.models.length === 0
              ? this.t('settingsEmpty')
              : this.t('settingsProviderModelCount', { count: this.draft.models.length })
            : this.discovered.length === 0
              ? this.t('settingsDiscoverModels')
              : this.t('settingsDiscoveredCount', { count: this.discovered.length })
      const text = active
        ? this.palette.bold(this.palette.accent(`${field.label}: ${value}`))
        : `${field.label}: ${this.palette.muted(value)}`
      return truncateToWidth(`${prefix}${text}`, width, '')
    }
    const action = active
      ? this.palette.bold(this.palette.accent(`[ ${field.label} ]`))
      : this.palette.dim(`[ ${field.label} ]`)
    return truncateToWidth(`${prefix}${action}`, width, '')
  }

  private valueFor(id: string): string {
    if (id === 'name') return this.draft.name
    if (id === 'baseURL') return this.draft.baseURL
    return this.draft.apiKey
  }
}
