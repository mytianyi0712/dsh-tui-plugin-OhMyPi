import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { PresetOption } from '@deepseek-ai/dsh-permission-presets'
import type { MessageKey, Translator } from './i18n.ts'

/** Read-only surface of the host permission-preset registry. */
export interface PermissionPresetSource {
  readonly names: readonly string[]
  optionOf(name: string): PresetOption
}

export interface PermissionCommandMetadata {
  /** User-facing preset values rendered in the editor and `/help` argument hint. */
  argumentHint: string
  /** Completion entries in the registry's declaration order. */
  options: AutocompleteItem[]
}

/** Upstream registry key for the unrestricted preset. */
export const FULL_ACCESS_REGISTRY_NAME = 'danger-full-access'
/** User-facing name used by this TUI instead of the upstream "danger" key. */
export const FULL_ACCESS_UI_NAME = 'full-access'

/** Map a registry preset name to the TUI's user-facing name. */
export function displayPermissionName(name: string): string {
  return name === FULL_ACCESS_REGISTRY_NAME ? FULL_ACCESS_UI_NAME : name
}

/** Map a TUI user-facing preset name back to the host registry name. */
export function registryPermissionName(name: string): string {
  return name === FULL_ACCESS_UI_NAME ? FULL_ACCESS_REGISTRY_NAME : name
}

type PermissionCopy = {
  name: MessageKey
  description: MessageKey
}

/** Localized copy for the three presets shipped by dsh-base. */
const BUILTIN_PERMISSION_COPY: Readonly<Record<string, PermissionCopy>> = {
  'read-only': {
    name: 'permissionReadOnly',
    description: 'permissionReadOnlyHint',
  },
  'workspace-write': {
    name: 'permissionWorkspaceWrite',
    description: 'permissionWorkspaceWriteHint',
  },
  [FULL_ACCESS_REGISTRY_NAME]: {
    name: 'permissionFullAccess',
    description: 'permissionFullAccessHint',
  },
}

/**
 * Adapt the deployment's permission table to the TUI command surface.
 * Unknown/custom presets retain their service-provided name and description.
 */
export function permissionCommandMetadata(
  source: PermissionPresetSource,
  t: Translator,
): PermissionCommandMetadata {
  const options = source.names.map((name): AutocompleteItem => {
    const option = source.optionOf(name)
    const copy = BUILTIN_PERMISSION_COPY[name]
    const displayName = copy !== undefined && option.name === name ? t(copy.name) : option.name
    const displayValue = displayPermissionName(option.value)
    const description = option.description ?? (copy === undefined ? undefined : t(copy.description))
    return {
      value: displayValue,
      label: `${displayValue} — ${displayName}`,
      ...description === undefined ? {} : { description },
    }
  })
  const values = options.map(option => option.value)
  return {
    argumentHint: values.length === 0 ? '<preset>' : `<${values.join('|')}>`,
    options,
  }
}
