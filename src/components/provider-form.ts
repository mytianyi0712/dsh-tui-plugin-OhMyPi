/**
 * Single-page provider form for the settings screen. It collects the provider
 * name, base URL, API key, and a fully editable model catalog. Enter cycles the
 * three official API types in place; model discovery merges into the draft
 * without opening another editor.
 */

import {
  Input,
  getKeybindings,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { Translator } from '../i18n.ts'
import { frameBlock, overlayViewportHeight, type Palette } from '../theme.ts'
import { formatReasoningEffortSetting, presetIdOf } from '../reasoning-maps.ts'
import { normalizeProviderModels, type ProviderModelDraft } from './model-list-dialog.ts'

export type { ProviderModelDraft } from './model-list-dialog.ts'

/** Protocol identifiers accepted by dsh-llm-pi-ai for hand-declared routes. */
export const SUPPORTED_PROVIDER_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

export type SupportedProviderApi = typeof SUPPORTED_PROVIDER_APIS[number]

const PROVIDER_API_LABEL_KEYS = {
  'openai-completions': 'settingsApiOpenAiCompletions',
  'openai-responses': 'settingsApiOpenAiResponses',
  'anthropic-messages': 'settingsApiAnthropicMessages',
} as const

/** Advance through the three official protocol identifiers, wrapping at the end. */
export function nextSupportedProviderApi(current: string): SupportedProviderApi {
  const index = SUPPORTED_PROVIDER_APIS.indexOf(current as SupportedProviderApi)
  return SUPPORTED_PROVIDER_APIS[(index + 1) % SUPPORTED_PROVIDER_APIS.length]!
}

/** Localized label for an official protocol id; unknown values pass through. */
export function providerApiLabel(api: string, t: Translator): string {
  if (api === 'openai-completions' || api === 'openai-responses' || api === 'anthropic-messages') {
    return t(PROVIDER_API_LABEL_KEYS[api])
  }
  return api
}


export interface ProviderDraft {
  /** Permanent dsh route id; lowercase kebab-case. */
  id: string
  /** Human-readable provider display name. */
  name: string
  /** dsh WebUI-compatible protocol type. */
  api: string
  baseURL: string
  /** New key value; an empty value keeps an existing credential. */
  apiKey: string
  /** Credential reference persisted in the provider profile. */
  apiKeyEnv?: string
  /** Whether the existing credential reference currently resolves. */
  apiKeyConfigured?: boolean
  models: ProviderModelDraft[]
}

export interface DiscoveredModel {
  id: string
  name?: string
}
export interface ProviderFormCallbacks {
  /** Probe the upstream endpoint; return discovered models or undefined. */
  discover?: (draft: ProviderDraft) => Promise<readonly DiscoveredModel[] | undefined>
  /** Open the full model catalog editor; undefined cancels without changing the draft. */
  manageModels?: (
    draft: ProviderDraft,
    discovered: readonly DiscoveredModel[],
  ) => Promise<ProviderModelDraft[] | undefined>
}


type EditableField = 'id' | 'name' | 'baseURL' | 'apiKey'

interface FormField {
  kind: 'text' | 'readonly' | 'action' | 'save' | 'cancel'
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
  private notice: string | undefined
  private discovered: DiscoveredModel[] = []
  private busy = false

  constructor(
    title: string,
    palette: Palette,
    t: Translator,
    draft: ProviderDraft,
    onDone: (draft: ProviderDraft | undefined) => void,
    callbacks: ProviderFormCallbacks = {},
    options: { idEditable?: boolean; requireModels?: boolean; requireApi?: boolean; requireBaseURL?: boolean } = {},
  ) {
    this.title = title
    this.palette = palette
    this.t = t
    this.draft = { ...draft, models: normalizeProviderModels(draft.models) }
    this.onDone = onDone
    this.callbacks = callbacks
    this.fields = [
      ...(options.idEditable === false
        ? [{ kind: 'readonly' as const, id: 'id', label: t('settingsProviderId') }]
        : [{ kind: 'text' as const, id: 'id', label: t('settingsProviderId') }]),
      { kind: 'text', id: 'name', label: t('settingsProviderName') },
      { kind: 'action', id: 'api', label: t('settingsApi') },
      { kind: 'text', id: 'baseURL', label: t('settingsBaseURL') },
      { kind: 'text', id: 'apiKey', label: t('settingsApiKey') },
      { kind: 'action', id: 'models', label: t('settingsManageModels') },
      { kind: 'action', id: 'discover', label: t('settingsDiscoverModels') },
      { kind: 'save', id: 'save', label: t('settingsSave') },
      { kind: 'cancel', id: 'cancel', label: t('settingsCancel') },
    ]
    this.requireModels = options.requireModels === true
    this.requireBaseURL = options.requireBaseURL === true
    this.requireApi = options.requireApi === true
  }

  private readonly requireModels: boolean
  private readonly requireBaseURL: boolean
  private readonly requireApi: boolean


  handleInput(data: string): void {
    if (this.busy) return
    if (this.editingField !== undefined) {
      this.input.focused = this.focused
      this.input.handleInput(data === '\r' ? '\n' : data)
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
    if (kb.matches(data, 'tui.select.pageUp')) {
      this.move(-6)
      return
    }
    if (kb.matches(data, 'tui.select.pageDown')) {
      this.move(6)
      return
    }
    if (matchesKey(data, 'home')) {
      this.activeIndex = 0
      return
    }
    if (matchesKey(data, 'end')) {
      this.activeIndex = Math.max(0, this.fields.length - 1)
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
      if (field.id === 'models' || field.id === 'save') rows.push('')
      rows.push(this.renderField(field, index === this.activeIndex, innerWidth))
    })
    const activeField = this.fields[this.activeIndex]
    if (activeField?.kind === 'text' && activeField.id !== 'apiKey') {
      const fullValue = this.editingField === activeField.id ? this.input.getValue() : this.valueFor(activeField.id)
      if (fullValue !== '') {
        rows.push('')
        rows.push(this.palette.dim(`  ${activeField.label}:`))
        rows.push(...wrapTextWithAnsi(fullValue, Math.max(1, innerWidth - 2)).map(line => `  ${line}`))
      }
    } else if (activeField?.id === 'api' && this.draft.api !== '') {
      rows.push('')
      rows.push(this.palette.dim(`  ${this.draft.api}`))
    } else if (activeField?.id === 'models' && this.draft.models.length > 0) {
      rows.push('')
      rows.push(this.palette.dim(`  ${activeField.label}:`))
      const preview = this.draft.models.map(model => {
        const formatted = presetIdOf(model.reasoningEfforts) ?? formatReasoningEffortSetting(model.reasoningEfforts)
        const map = formatted === '' ? undefined : formatted
        if (map === undefined && model.reasoningEffort === undefined) return model.id
        if (map === undefined) return `${model.id} (${model.reasoningEffort})`
        return model.reasoningEffort === undefined ? `${model.id} [${map}]` : `${model.id} [${map} → ${model.reasoningEffort}]`
      }).join(', ')
      rows.push(...wrapTextWithAnsi(preview, Math.max(1, innerWidth - 2)).map(line => `  ${line}`))
    }

    if (this.busy) {
      rows.push('')
      rows.push(this.palette.dim(`  ${this.t('settingsDiscovering')}`))
    }
    if (this.notice !== undefined) {
      rows.push('')
      rows.push(this.palette.dim(`  ${this.notice}`))
    }
    if (this.error !== undefined) {
      rows.push('')
      rows.push(this.palette.error(`  ${this.error}`))
    }
    rows.push('')
    rows.push(this.palette.dim(this.t('settingsSubmenuHint')))
    return frameBlock(rows, safeWidth, this.palette.accent, undefined, this.title, undefined, overlayViewportHeight())
  }

  private move(delta: number): void {
    this.error = undefined
    this.notice = undefined
    this.activeIndex = (this.activeIndex + delta + this.fields.length) % this.fields.length
  }

  private async activate(): Promise<void> {
    this.error = undefined
    this.notice = undefined
    const field = this.fields[this.activeIndex]
    if (field === undefined) return
    if (field.kind === 'text') {
      this.startEditing(field.id as EditableField)
      return
    }
    if (field.kind === 'action') {
      if (field.id === 'api') {
        this.draft.api = nextSupportedProviderApi(this.draft.api)
      } else if (field.id === 'models') {
        await this.manageModels()
      } else if (field.id === 'discover') {
        await this.discoverModels()
      }
      return
    }
    if (field.kind === 'save') {
      const id = this.draft.id.trim()
      if (id === '') {
        this.error = this.t('providerIdRequired')
        return
      }
      if (!/^[a-z][a-z0-9-]*$/.test(id)) {
        this.error = this.t('providerIdInvalid')
        return
      }
      if (this.requireBaseURL && this.draft.baseURL.trim() === '') {
        this.error = this.t('providerBaseURLRequired')
        return
      }
      if (this.requireApi && !SUPPORTED_PROVIDER_APIS.includes(this.draft.api as SupportedProviderApi)) {
        this.error = this.t('providerApiRequired')
        return
      }
      if (this.draft.api !== '' && !SUPPORTED_PROVIDER_APIS.includes(this.draft.api as SupportedProviderApi)) {
        this.error = this.t('providerApiRequired')
        return
      }
      if (this.requireModels && this.draft.models.length === 0) {
        this.error = this.t('providerModelsRequired')
        return
      }
      this.onDone({
        id,
        name: this.draft.name.trim() || id,
        api: this.draft.api.trim(),
        baseURL: this.draft.baseURL.trim(),
        apiKey: this.draft.apiKey.trim(),
        ...this.draft.apiKeyEnv === undefined ? {} : { apiKeyEnv: this.draft.apiKeyEnv },
        ...this.draft.apiKeyConfigured === undefined ? {} : { apiKeyConfigured: this.draft.apiKeyConfigured },
        models: normalizeProviderModels(this.draft.models),
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
      const before = new Set(this.draft.models.map(model => model.id))
      const merged = [...this.draft.models]
      for (const model of this.discovered) {
        if (!before.has(model.id)) merged.push({ id: model.id })
      }
      this.draft.models = normalizeProviderModels(merged)
      const added = this.draft.models.filter(model => !before.has(model.id)).length
      this.error = undefined
      this.notice = added > 0
        ? this.t('settingsDiscoverMerged', { count: added })
        : this.t('settingsDiscoveredCount', { count: this.discovered.length })
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }



  private async manageModels(): Promise<void> {
    if (this.callbacks.manageModels === undefined) {
      this.error = this.t('settingsDiscoveryUnavailable')
      return
    }
    this.busy = true
    try {
      const edited = await this.callbacks.manageModels(this.draft, this.discovered)
      if (edited !== undefined) this.draft.models = normalizeProviderModels(edited)
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }

  private startEditing(field: EditableField): void {
    this.editingField = field
    this.input = new Input()
    const initial = this.draft[field]
    if (initial !== '') this.input.handleInput(initial)
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
    if (field.kind === 'readonly') {
      return truncateToWidth(`${prefix}${label}: ${this.palette.muted(this.valueFor(field.id))}`, width, '')
    }
    if (field.kind === 'action') {
      const value = field.id === 'api'
        ? this.draft.api === ''
          ? this.t('settingsApi')
          : providerApiLabel(this.draft.api, this.t)
        : field.id === 'models'
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
    if (id === 'id') return this.draft.id
    if (id === 'name') return this.draft.name
    if (id === 'api') return this.draft.api
    if (id === 'baseURL') return this.draft.baseURL
    if (id === 'apiKey') {
      return this.draft.apiKey === '' && this.draft.apiKeyConfigured !== true
        ? ''
        : this.draft.apiKey === ''
          ? this.t('settingsCredentialConfigured')
          : this.draft.apiKey
    }
    return ''
  }
}
