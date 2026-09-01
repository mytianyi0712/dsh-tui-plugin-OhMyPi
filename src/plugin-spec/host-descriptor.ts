/**
 * Host Descriptor builder (TUI-HOST-001). Builds a descriptor that only
 * advertises contracts the running host actually provides. Commands support is
 * declared only when the caller reports `commandsMounted`; private definitions
 * are pinned by the registry profile digest and dropped (fail closed) when the
 * digest is unavailable.
 */

import type { HostDescriptor } from './types.ts'
import { catalogContracts, profileDigest } from './registry.ts'

export interface BuildHostDescriptorOptions {
  hostId: string
  hostVersion: string
  generationId: string
  headless: boolean
  commandsMounted?: boolean
  location?: 'local' | 'remote'
}

export function buildHostDescriptor(options: BuildHostDescriptorOptions): HostDescriptor {
  let contracts = catalogContracts()
  if (options.commandsMounted !== true) {
    contracts = contracts.filter(contract => contract.coordinate !== 'commands.dsh/v1alpha1#Command')
  }

  const digest = profileDigest()
  if (digest === undefined) {
    // Fail closed: no private contract surface without an intact profile.
    contracts = contracts.filter(contract => contract.source !== 'tui-profile')
  }

  return {
    $schema: 'urn:omp-tui:host-descriptor:0.15',
    hostId: options.hostId,
    hostVersion: options.hostVersion,
    facetApiVersions: ['v1alpha1'],
    contracts,
    runtime: {
      location: options.location ?? 'local',
      generationId: options.generationId,
      headless: options.headless,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    trustLevel: 'trusted-in-process',
  }
}

export function validateHostDescriptor(descriptor: HostDescriptor): string[] {
  const errors: string[] = []
  if (descriptor.$schema !== 'urn:omp-tui:host-descriptor:0.15') errors.push('$schema: unsupported descriptor schema')
  if (descriptor.hostId.trim() === '') errors.push('hostId: empty')
  if (descriptor.trustLevel !== 'trusted-in-process') errors.push('trustLevel: must be trusted-in-process')
  if (!Array.isArray(descriptor.contracts)) {
    errors.push('contracts: array required')
  } else {
    for (const contract of descriptor.contracts) {
      if (contract.coordinate === 'tui.dsh/v1alpha1#DecisionEvents') {
        if (contract.definitionDigest !== profileDigest()) {
          errors.push(`${contract.coordinate}: profile digest mismatch`)
        }
      }
    }
  }
  return errors
}

/** Cheap structural check for arbitrary JSON claiming to be a host descriptor. */
export function checkHostDescriptorShape(input: unknown): string[] {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['descriptor must be an object']
  }
  const descriptor = input as Record<string, unknown>
  if (typeof descriptor.$schema !== 'string') errors.push('$schema: string required')
  if (typeof descriptor.hostId !== 'string') errors.push('hostId: string required')
  if (typeof descriptor.contracts !== 'object' || descriptor.contracts === null || !Array.isArray(descriptor.contracts)) {
    errors.push('contracts: array required')
  }
  if (typeof descriptor.runtime !== 'object' || descriptor.runtime === null) errors.push('runtime: object required')
  return errors
}
