/**
 * Renderer-coupled extension seams. These services are pure: they validate,
 * queue, sanitize and store contributions, but never render. The TUI row
 * provides them on `ctx` and registers a pi-tui backend through
 * `installBackends`.
 */

import { isValidContributionKey, sanitizeCellText, sanitizeLines } from '../render-safe.ts'

// --- Dialogs ----------------------------------------------------------------------

export interface SelectOption {
  id: string
  label: string
  description?: string
}

export interface SelectRequest {
  title: string
  options: SelectOption[]
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface InputRequest {
  title: string
  placeholder?: string
  initial?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface DialogBackend {
  select(request: SelectRequest): Promise<string | undefined>
  confirm(request: ConfirmRequest): Promise<boolean>
  input(request: InputRequest): Promise<string | undefined>
}

type PendingDialog =
  | { kind: 'select'; request: SelectRequest; resolve: (value: string | undefined) => void }
  | { kind: 'confirm'; request: ConfirmRequest; resolve: (value: boolean) => void }
  | { kind: 'input'; request: InputRequest; resolve: (value: string | undefined) => void }

const DIALOG_TIMEOUT_MS = 30_000

export class DialogsService {
  private backend: DialogBackend | undefined
  private queue: PendingDialog[] = []
  private active = false

  installBackend(backend: DialogBackend): () => void {
    this.backend = backend
    void this.pump()
    return () => {
      if (this.backend === backend) this.backend = undefined
      this.settleAll()
    }
  }

  select(request: SelectRequest): Promise<string | undefined> {
    return new Promise(resolve => {
      const cleaned = this.cleanSelect(request)
      if (cleaned === undefined) {
        resolve(undefined)
        return
      }
      this.queue.push({ kind: 'select', request: cleaned, resolve })
      void this.pump()
    })
  }

  confirm(request: ConfirmRequest): Promise<boolean> {
    return new Promise(resolve => {
      const cleaned = this.cleanConfirm(request)
      if (cleaned === undefined) {
        resolve(false)
        return
      }
      this.queue.push({ kind: 'confirm', request: cleaned, resolve })
      void this.pump()
    })
  }

  input(request: InputRequest): Promise<string | undefined> {
    return new Promise(resolve => {
      const cleaned = this.cleanInput(request)
      if (cleaned === undefined) {
        resolve(undefined)
        return
      }
      this.queue.push({ kind: 'input', request: cleaned, resolve })
      void this.pump()
    })
  }

  private async pump(): Promise<void> {
    if (this.active || this.backend === undefined) return
    const next = this.queue.shift()
    if (next === undefined) return
    this.active = true
    try {
      const timeout = next.request.timeoutMs ?? DIALOG_TIMEOUT_MS
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new DOMException('dialog timeout', 'AbortError')), timeout)
      })
      switch (next.kind) {
        case 'select': {
          const result = await Promise.race([this.backend.select(next.request), timeoutPromise])
          next.resolve(result)
          break
        }
        case 'confirm': {
          const result = await Promise.race([this.backend.confirm(next.request), timeoutPromise])
          next.resolve(result)
          break
        }
        case 'input': {
          const result = await Promise.race([this.backend.input(next.request), timeoutPromise])
          next.resolve(result)
          break
        }
      }
    } catch {
      if (next.kind === 'confirm') next.resolve(false)
      else next.resolve(undefined)
    } finally {
      this.active = false
      void this.pump()
    }
  }

  private settleAll(): void {
    while (this.queue.length > 0) {
      const pending = this.queue.shift()
      if (pending === undefined) break
      if (pending.kind === 'confirm') pending.resolve(false)
      else pending.resolve(undefined)
    }
  }

  private cleanSelect(request: SelectRequest): SelectRequest | undefined {
    const title = sanitizeCellText(request.title, 120)
    if (title === undefined) return undefined
    const options = request.options.slice(0, 100).map(option => ({
      id: option.id,
      label: sanitizeCellText(option.label, 120) ?? '',
      ...option.description === undefined ? {} : { description: sanitizeCellText(option.description, 240) },
    })).filter(option => option.label !== '')
    if (options.length === 0) return undefined
    return { title, options, ...request.signal === undefined ? {} : { signal: request.signal }, ...request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs } }
  }

  private cleanConfirm(request: ConfirmRequest): ConfirmRequest | undefined {
    const title = sanitizeCellText(request.title, 120)
    if (title === undefined) return undefined
    const message = request.message === undefined ? undefined : sanitizeCellText(request.message, 400)
    const confirmLabel = request.confirmLabel === undefined ? undefined : sanitizeCellText(request.confirmLabel, 40)
    const cancelLabel = request.cancelLabel === undefined ? undefined : sanitizeCellText(request.cancelLabel, 40)
    return { title, ...message === undefined ? {} : { message }, ...confirmLabel === undefined ? {} : { confirmLabel }, ...cancelLabel === undefined ? {} : { cancelLabel }, ...request.signal === undefined ? {} : { signal: request.signal }, ...request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs } }
  }

  private cleanInput(request: InputRequest): InputRequest | undefined {
    const title = sanitizeCellText(request.title, 120)
    if (title === undefined) return undefined
    const placeholder = request.placeholder === undefined ? undefined : sanitizeCellText(request.placeholder, 120)
    const initial = request.initial === undefined ? undefined : sanitizeCellText(request.initial, 500)
    return { title, ...placeholder === undefined ? {} : { placeholder }, ...initial === undefined ? {} : { initial }, ...request.signal === undefined ? {} : { signal: request.signal }, ...request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs } }
  }
}

// --- Status -----------------------------------------------------------------------

export class StatusService {
  private readonly entries = new Map<string, string>()

  set(key: string, text: unknown): () => void {
    const normalized = key.toLowerCase()
    if (!isValidContributionKey(normalized)) return () => undefined
    if (text === undefined || text === '') {
      this.entries.delete(normalized)
      return () => undefined
    }
    const cleaned = sanitizeCellText(text, 200)
    if (cleaned === undefined) return () => undefined
    if (this.entries.size >= 20 && !this.entries.has(normalized)) return () => undefined
    this.entries.set(normalized, cleaned)
    return () => {
      if (this.entries.get(normalized) === cleaned) this.entries.delete(normalized)
    }
  }

  /** Ordered by first-set time. */
  snapshot(): string[] {
    return [...this.entries.values()]
  }
}

// --- Shortcuts ---------------------------------------------------------------------

export interface ShortcutRegistration {
  combo: string
  description: string
  handler: () => void | Promise<void>
}

const RESERVED_KEYS: readonly string[] = [
  'ctrl+c', 'ctrl+d', 'ctrl+t', 'ctrl+r', 'ctrl+g', 'ctrl+o', 'ctrl+l',
  'ctrl+e', 'ctrl+v', 'ctrl+a', 'ctrl+u', 'ctrl+k', 'ctrl+w',
  'ctrl+left', 'ctrl+right', 'ctrl+enter', 'alt+enter', 'alt+up',
  'escape', 'tab', 'shift+tab',
]

const COMBO_RE = /^(ctrl|alt|meta|option|shift)(\+(ctrl|alt|meta|option|shift))*\+[a-z0-9]+$/i

function normalizeCombo(combo: string): string {
  return combo.toLowerCase().replace(/\bmeta\b/g, 'alt').replace(/\boption\b/g, 'alt').split('+').sort().join('+')
}

export class ShortcutsService {
  private readonly registrations = new Map<string, ShortcutRegistration>()

  register(combo: string, registration: Omit<ShortcutRegistration, 'combo'>): () => void {
    const raw = combo.trim().toLowerCase()
    if (!COMBO_RE.test(raw) || raw.startsWith('escape+') || raw === 'escape') return () => undefined
    if (!/(^|\+)(ctrl|alt)(\+|$)/.test(raw)) return () => undefined
    const normalized = normalizeCombo(raw)
    const description = sanitizeCellText(registration.description, 120)
    if (description === undefined) return () => undefined
    if (RESERVED_KEYS.some(key => {
      const reserved = normalizeCombo(key)
      return normalized === reserved || normalized.startsWith(`${reserved}+`)
    })) return () => undefined
    if (this.registrations.has(normalized)) return () => undefined
    const record: ShortcutRegistration = { combo: normalized, description, handler: registration.handler }
    this.registrations.set(normalized, record)
    return () => {
      if (this.registrations.get(normalized) === record) this.registrations.delete(normalized)
    }
  }

  snapshot(): ShortcutRegistration[] {
    return [...this.registrations.values()]
  }

  dispatch(normalizedCombo: string): boolean {
    const registration = this.registrations.get(normalizeCombo(normalizedCombo))
    if (registration === undefined) return false
    void Promise.resolve()
      .then(() => registration.handler())
      .catch(() => undefined)
    return true
  }
}

// --- Renderers --------------------------------------------------------------------

export interface RenderedEntry {
  title?: string
  lines: string[]
}

export type EntryRenderer = (payload: unknown) => RenderedEntry | undefined

const EVENT_TYPE_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/

export class RenderersService {
  private readonly renderers = new Map<string, EntryRenderer>()

  register(eventType: string, renderer: EntryRenderer): () => void {
    if (!EVENT_TYPE_RE.test(eventType)) return () => undefined
    if (this.renderers.has(eventType)) return () => undefined
    this.renderers.set(eventType, renderer)
    return () => {
      if (this.renderers.get(eventType) === renderer) this.renderers.delete(eventType)
    }
  }

  render(eventType: string, payload: unknown): RenderedEntry | undefined {
    const renderer = this.renderers.get(eventType)
    if (renderer === undefined) return undefined
    let raw: RenderedEntry | undefined
    try {
      raw = renderer(payload)
    } catch {
      return undefined
    }
    if (raw === undefined) return undefined
    const title = raw.title === undefined ? undefined : sanitizeCellText(raw.title, 120)
    if (raw.title !== undefined && title === undefined) return undefined
    const lines = sanitizeLines(raw.lines, 100, 400)
    return { ...title === undefined ? {} : { title }, lines }
  }
}

// --- Settings sections -------------------------------------------------------------

export interface SettingsField {
  path: string[]
  label: string
  kind: 'text' | 'number' | 'boolean' | 'select'
  hint?: string
  options?: Array<{ value: string; label: string }>
  secret?: { ref: string }
}

export interface SettingsSection {
  ns: string
  title: string
  descriptions?: Record<string, string>
  fields: SettingsField[]
}

const SETTINGS_NS_RE = /^[a-z][a-z0-9_-]*$/

export class SettingsSectionsService {
  private readonly sections = new Map<string, SettingsSection>()

  register(section: SettingsSection): () => void {
    if (!SETTINGS_NS_RE.test(section.ns)) return () => undefined
    if (this.sections.has(section.ns)) return () => undefined
    const title = sanitizeCellText(section.title, 120)
    if (title === undefined) return () => undefined
    const fields = section.fields.slice(0, 64).map(field => ({
      path: field.path,
      label: sanitizeCellText(field.label, 120) ?? field.label,
      kind: field.kind,
      ...field.hint === undefined ? {} : { hint: sanitizeCellText(field.hint, 240) },
      ...field.options === undefined ? {} : { options: field.options.slice(0, 100).map(option => ({ value: option.value, label: sanitizeCellText(option.label, 120) ?? option.label })) },
      ...field.secret === undefined ? {} : { secret: field.secret },
    }))
    if (fields.length === 0) return () => undefined
    const record: SettingsSection = { ns: section.ns, title, ...section.descriptions === undefined ? {} : { descriptions: section.descriptions }, fields }
    this.sections.set(section.ns, record)
    return () => {
      if (this.sections.get(section.ns) === record) this.sections.delete(section.ns)
    }
  }

  snapshot(): SettingsSection[] {
    return [...this.sections.values()]
  }
}

// --- Scenes ------------------------------------------------------------------------

export interface SceneRegistration {
  id: string
  title?: string
  component: unknown
}

const SCENE_ID_RE = /^[a-z][a-z0-9-]*$/

export interface SceneBackend {
  open(registration: SceneRegistration): boolean
  close(id: string): void
}

export class ScenesService {
  private readonly scenes = new Map<string, SceneRegistration>()
  private currentId: string | undefined
  private backend: SceneBackend | undefined

  installBackend(backend: SceneBackend): () => void {
    this.backend = backend
    return () => {
      if (this.backend === backend) this.backend = undefined
    }
  }

  register(registration: SceneRegistration): () => void {
    const id = registration.id
    if (!SCENE_ID_RE.test(id)) throw new Error(`scene id ${JSON.stringify(id)} is invalid (kebab-case required)`)
    if (this.scenes.has(id)) throw new Error(`scene id ${id} is already registered`)
    const title = registration.title === undefined ? undefined : sanitizeCellText(registration.title, 120)
    const record: SceneRegistration = { id, ...title === undefined ? {} : { title }, component: registration.component }
    this.scenes.set(id, record)
    return () => {
      if (this.scenes.get(id) === record) {
        if (this.currentId === id) this.close(id)
        this.scenes.delete(id)
      }
    }
  }

  open(id: string): boolean {
    const registration = this.scenes.get(id)
    if (registration === undefined || this.backend === undefined) return false
    if (!this.backend.open(registration)) return false
    this.currentId = id
    return true
  }

  close(id: string): void {
    if (this.currentId !== id) return
    this.currentId = undefined
    this.backend?.close(id)
  }

  get activeSceneId(): string | undefined {
    return this.currentId
  }

  snapshot(): SceneRegistration[] {
    return [...this.scenes.values()]
  }
}

export interface ExtensionServices {
  dialogs: DialogsService
  status: StatusService
  shortcuts: ShortcutsService
  renderers: RenderersService
  settingsSections: SettingsSectionsService
  scenes: ScenesService
}

export function createExtensionServices(): ExtensionServices {
  return {
    dialogs: new DialogsService(),
    status: new StatusService(),
    shortcuts: new ShortcutsService(),
    renderers: new RenderersService(),
    settingsSections: new SettingsSectionsService(),
    scenes: new ScenesService(),
  }
}
