/**
 * Community v0.15 plugin-spec types.
 *
 * Manifest shape comes from `@dsh-std/manifest` (dynamically linked, not
 * vendored). This module keeps the host-side admission types: five-state
 * negotiation, Host Descriptor, and TUI-private coordinates.
 */

import type { PluginManifest } from '@dsh-std/manifest'

export type { PluginManifest }
export type DshPluginManifest = PluginManifest
export type ManifestVersion = '0.15'

export interface ContractCoordinate {
  /** `apiVersion + '#' + kind`, e.g. `tui.dsh/v1alpha1#DecisionEvents`. */
  coordinate: string
  apiVersion: string
  kind: string
}

export interface PermissionRule {
  name: string
  scope?: string
  reason?: string
  activationId?: string
}

export interface ContractRequirement {
  apiVersion: string
  kind: string
  optional?: boolean
  /** Optional requirements must describe a fallback the host can display. */
  fallback?: string
}

export interface HostFacet {
  entry: string
  apiVersion: string
}

export interface NegotiationResult {
  status: 'compatible' | 'compatible_degraded' | 'waiting_authorization' | 'rejected' | 'unknown'
  reasons: string[]
  contractDecisions: Array<{ coordinate: string; status: string; reason?: string }>
}

export interface HostDescriptorContract {
  coordinate: string
  apiVersion: string
  kind: string
  source: 'dsh-std' | 'tui-profile'
  definitionDigest?: string
  supported: boolean
}

export interface HostDescriptor {
  $schema: string
  hostId: string
  hostVersion: string
  facetApiVersions: string[]
  contracts: HostDescriptorContract[]
  runtime: {
    location: 'local' | 'remote'
    generationId: string
    headless: boolean
    platform: string
    arch: string
    node: string
  }
  trustLevel: 'trusted-in-process'
}

export const ADMISSION_STATUSES = [
  'compatible',
  'compatible_degraded',
  'waiting_authorization',
  'rejected',
  'unknown',
] as const

export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number]

/** Priority used for merging multiple contract decisions (unknown > rejected > …). */
export const ADMISSION_PRIORITY: Record<AdmissionStatus, number> = {
  unknown: 0,
  rejected: 1,
  waiting_authorization: 2,
  compatible_degraded: 3,
  compatible: 4,
}

export function contractCoordinate(apiVersion: string, kind: string): string {
  return `${apiVersion}#${kind}`
}
