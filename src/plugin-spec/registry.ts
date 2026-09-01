/**
 * Protocol catalog for the omp-tui admission profile (Community v0.15).
 *
 * Definitions are loaded from vendored JSON assets next to this module:
 * - `registry-0.15.json`: upstream dsh-ecosystem-spec registry (imported
 *   dsh-std coordinates + private capability definitions).
 * - `extensions-0.15.json`: TUI private extension definitions (SettingsSection
 *   and Scene live in dsh-ecosystem-spec `tui-contributions`).
 * - `permissions-0.15.json`: upstream 8 permission definitions and defaults.
 *
 * These files are bundled with the package; private-definition drift is
 * detected through a SHA-256 digest over the canonical private coordinates.
 */

import { createHash } from 'node:crypto'
import extensionsRegistry from './extensions-0.15.json' with { type: 'json' }
import permissionsRegistry from './permissions-0.15.json' with { type: 'json' }
import registry from './registry-0.15.json' with { type: 'json' }
import type { ContractCoordinate, HostDescriptorContract } from './types.ts'

export interface PermissionDefinition {
  name: string
  /** Default when no grant store rule exists for the permission. */
  default: 'allow' | 'deny'
  revocable?: boolean
  scope?: string
  rationale?: string
}

export interface ProtocolDefinition {
  coordinate: string
  apiVersion: string
  kind: string
  source: 'dsh-std' | 'tui-profile'
  /** For dsh-std imports, the package identity that carries the definition. */
  package?: string
  /** Human-readable permission requirements, evaluated by the grant store. */
  permissions?: readonly string[]
  /** Capability/event/extension shape; informational for diagnostics. */
  shape?: 'capability' | 'extension' | 'event'
}

type JsonCoordinates = {
  apiVersion: string
  kind: string
}

type JsonImport = {
  name: string
  coordinates: JsonCoordinates
  package: string
  kind: string
  permissions?: string[]
}

type JsonDefinition = {
  name: string
  authority: string
  coordinates: JsonCoordinates
  kind: string
  permissions?: string[]
}

const PERMISSIONS = (permissionsRegistry.permissions as PermissionDefinition[]).map(permission => ({ ...permission }))

export const DEFAULT_PERMISSIONS: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSIONS.map(permission => [permission.name, permission]),
)

export const PRIVATE_NAMESPACE = 'tui.dsh'

function toShape(kind: string): ProtocolDefinition['shape'] {
  if (kind === 'event') return 'event'
  if (kind === 'extension') return 'extension'
  return 'capability'
}

/** Private TUI definitions, kept in a stable order for digesting. */
export const PRIVATE_DEFINITIONS: readonly ProtocolDefinition[] = [
  ...(registry.definitions as JsonDefinition[]).map(item => ({
    coordinate: `${item.coordinates.apiVersion}#${item.coordinates.kind}`,
    apiVersion: item.coordinates.apiVersion,
    kind: item.coordinates.kind,
    source: 'tui-profile' as const,
    shape: toShape(item.kind),
    permissions: item.permissions,
  })),
  ...(extensionsRegistry.definitions as JsonDefinition[]).map(item => ({
    coordinate: `${item.coordinates.apiVersion}#${item.coordinates.kind}`,
    apiVersion: item.coordinates.apiVersion,
    kind: item.coordinates.kind,
    source: 'tui-profile' as const,
    shape: toShape(item.kind),
    permissions: item.permissions,
  })),
]

/** dsh-std imported definitions the host supports. */
export const IMPORTED_DEFINITIONS: readonly ProtocolDefinition[] = (registry.imports as JsonImport[]).map(item => ({
  coordinate: `${item.coordinates.apiVersion}#${item.coordinates.kind}`,
  apiVersion: item.coordinates.apiVersion,
  kind: item.coordinates.kind,
  source: 'dsh-std' as const,
  package: item.package,
  shape: toShape(item.kind),
  permissions: item.permissions,
}))

export const PROTOCOL_CATALOG: ReadonlyMap<string, ProtocolDefinition> = new Map(
  [...IMPORTED_DEFINITIONS, ...PRIVATE_DEFINITIONS].map(definition => [definition.coordinate, definition]),
)

let cachedProfileDigest: string | undefined

/** SHA-256 over the canonical private definitions. Drift = digest mismatch. */
export function profileDigest(): string {
  if (cachedProfileDigest === undefined) {
    const canonical = JSON.stringify(PRIVATE_DEFINITIONS.map(definition => ({
      apiVersion: definition.apiVersion,
      kind: definition.kind,
      shape: definition.shape,
      permissions: definition.permissions ?? [],
    })))
    cachedProfileDigest = createHash('sha256').update(canonical).digest('hex')
  }
  return cachedProfileDigest
}

export function resolveCoordinate(coordinate: string): ProtocolDefinition | undefined {
  return PROTOCOL_CATALOG.get(coordinate)
}

/** Parse `apiVersion#Kind` coordinates back into their pieces. */
export function parseCoordinate(coordinate: string): ContractCoordinate | undefined {
  const index = coordinate.lastIndexOf('#')
  if (index <= 0 || index === coordinate.length - 1) return undefined
  return {
    coordinate,
    apiVersion: coordinate.slice(0, index),
    kind: coordinate.slice(index + 1),
  }
}

export function catalogContracts(): HostDescriptorContract[] {
  return [...PROTOCOL_CATALOG.values()].map(definition => ({
    coordinate: definition.coordinate,
    apiVersion: definition.apiVersion,
    kind: definition.kind,
    source: definition.source,
    ...definition.package === undefined ? {} : { package: definition.package },
    ...definition.source === 'tui-profile' ? { definitionDigest: profileDigest() } : {},
    supported: true,
  }))
}

export function permissionsForCoordinate(coordinate: string): readonly string[] {
  return PROTOCOL_CATALOG.get(coordinate)?.permissions ?? []
}

export function isPrivateCoordinate(coordinate: string): boolean {
  return coordinate.startsWith(`${PRIVATE_NAMESPACE}/`)
}
