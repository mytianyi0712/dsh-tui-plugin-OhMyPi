/**
 * Manifest validation for Community v0.15.
 *
 * Shape checking is the official `@dsh-std/manifest` parser (linked from the
 * profile, not vendored). This module adds TUI Admission extras: optional
 * requirements must carry a displayable fallback, then five-state negotiate.
 */

import { createHash } from 'node:crypto'
import { parseManifest as parseStdManifest, projectManifest, type PluginManifest } from '@dsh-std/manifest'
import { SHARED_MANIFEST_CATALOG, SHARED_PROTOCOL_CATALOG } from './catalog.ts'
import { ADMISSION_PRIORITY, contractCoordinate, type AdmissionStatus, type DshPluginManifest, type NegotiationResult } from './types.ts'
import { DEFAULT_PERMISSIONS, permissionsForCoordinate, resolveCoordinate } from './registry.ts'

export class ManifestValidationError extends Error {
  readonly details: string[]

  constructor(message: string, details: string[] = []) {
    super(details.length === 0 ? message : `${message}: ${details.join('; ')}`)
    this.name = 'ManifestValidationError'
    this.details = details
  }
}

/**
 * Parse an untrusted manifest. Accepts a JSON string or a plain object.
 * Throws `ManifestValidationError` on structural failure.
 */
export function parseManifest(input: unknown): DshPluginManifest {
  const source = typeof input === 'string' ? input : JSON.stringify(input)
  let parsed: PluginManifest
  try {
    parsed = parseStdManifest(source)
  } catch (error) {
    throw new ManifestValidationError(error instanceof Error ? error.message : String(error))
  }

  const errors: string[] = []
  const contracts = parsed.requires?.contracts ?? []
  contracts.forEach((contract, index) => {
    if (contract.optional === true && (contract.fallback === undefined || contract.fallback.trim() === '')) {
      errors.push(`requires.contracts[${index}].fallback: optional requirement needs a displayable fallback`)
    }
  })

  try {
    const projected = projectManifest(parsed)
    const report = SHARED_MANIFEST_CATALOG.validate(projected, SHARED_PROTOCOL_CATALOG, { source: 'dsh-plugin.json' })
    if (!report.compatible) {
      for (const issue of report.issues) {
        errors.push(`${issue.path ?? issue.code}: ${issue.message}`)
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  if (errors.length > 0) throw new ManifestValidationError('manifest validation failed', errors)
  return parsed
}

export function manifestDigest(manifest: DshPluginManifest): string {
  const canonical = JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    facets: manifest.facets,
    requires: manifest.requires,
    permissions: manifest.permissions,
    subscriptions: manifest.subscriptions,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export interface NegotiateOptions {
  /** Set of granted permission names (already evaluated by the grant store). */
  grantedPermissions?: ReadonlySet<string>
  /** Permission names explicitly denied (overrides default-allow). */
  deniedPermissions?: ReadonlySet<string>
}

function permissionGranted(name: string, granted: ReadonlySet<string>, denied: ReadonlySet<string>): boolean {
  if (denied.has(name)) return false
  if (granted.has(name)) return true
  return DEFAULT_PERMISSIONS.get(name)?.default === 'allow'
}

/**
 * Five-state negotiation. Missing catalog references are `unknown`, missing
 * grants are `waiting_authorization`, structural problems are `rejected`.
 */
export function negotiate(manifest: DshPluginManifest, options: NegotiateOptions = {}): NegotiationResult {
  const reasons: string[] = []
  const contractDecisions: NegotiationResult['contractDecisions'] = []
  const granted = options.grantedPermissions ?? new Set<string>()
  const denied = options.deniedPermissions ?? new Set<string>()
  const contracts = manifest.requires?.contracts ?? []

  if (contracts.length === 0) {
    return { status: 'compatible', reasons: [], contractDecisions: [] }
  }

  let worst: AdmissionStatus = 'compatible'

  for (const contract of contracts) {
    const coordinate = contractCoordinate(contract.apiVersion, contract.kind)
    const definition = resolveCoordinate(coordinate)
    if (definition === undefined || !SHARED_PROTOCOL_CATALOG.understands({ apiVersion: contract.apiVersion, kind: contract.kind })) {
      contractDecisions.push({ coordinate, status: 'unknown', reason: 'coordinate not in protocol catalog' })
      worst = worse(worst, 'unknown')
      continue
    }

    if (contract.optional === true) {
      if (contract.fallback === undefined || contract.fallback.trim() === '') {
        contractDecisions.push({ coordinate, status: 'rejected', reason: 'optional contract is missing a displayable fallback' })
        worst = worse(worst, 'rejected')
        continue
      }
      const missingPermissions = permissionsForCoordinate(coordinate).filter(name => !permissionGranted(name, granted, denied))
      if (missingPermissions.length > 0) {
        contractDecisions.push({
          coordinate,
          status: 'compatible_degraded',
          reason: `optional contract unavailable: missing grants ${missingPermissions.join(', ')}`,
        })
        worst = worse(worst, 'compatible_degraded')
      } else {
        contractDecisions.push({ coordinate, status: 'compatible' })
      }
      continue
    }

    const missingPermissions = permissionsForCoordinate(coordinate).filter(name => !permissionGranted(name, granted, denied))
    if (missingPermissions.length > 0) {
      contractDecisions.push({
        coordinate,
        status: 'waiting_authorization',
        reason: `missing grants: ${missingPermissions.join(', ')}`,
      })
      worst = worse(worst, 'waiting_authorization')
      continue
    }

    contractDecisions.push({ coordinate, status: 'compatible' })
  }

  if (worst === 'compatible') return { status: 'compatible', reasons, contractDecisions }
  if (worst === 'compatible_degraded') return { status: 'compatible_degraded', reasons, contractDecisions }
  return { status: worst, reasons, contractDecisions }
}

function worse(left: AdmissionStatus, right: AdmissionStatus): AdmissionStatus {
  return ADMISSION_PRIORITY[left] <= ADMISSION_PRIORITY[right] ? left : right
}

export function formatNegotiation(result: NegotiationResult): string[] {
  const lines = [`negotiation: ${result.status}`]
  for (const decision of result.contractDecisions) {
    lines.push(`  ${decision.coordinate}: ${decision.status}${decision.reason === undefined ? '' : ` (${decision.reason})`}`)
  }
  return lines
}
