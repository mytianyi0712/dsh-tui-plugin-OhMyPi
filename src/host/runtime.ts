/**
 * Host-plane runtime singletons shared by the plugin-host rows. These are
 * process-wide on purpose: grants, ledger and generation identity must be
 * identical for every service a plugin touches.
 */

import { randomUUID } from 'node:crypto'
import { GrantStore } from './grants.ts'
import { EffectLedger } from './effect-ledger.ts'

function log(level: 'warn' | 'info', message: string): void {
  if (process.env.DSH_TUI_DEBUG === undefined && process.env.DSH_OMP_TUI_DEBUG === undefined) return
  process.stderr.write(`[dsh-omp-tui:host] ${level}: ${message}\n`)
}

/** Process-wide component → activation-instance map filled by plugin-host admission. */
const activations = new Map<string, string>()

/** Process-wide component → admitted manifest map filled by plugin-host admission. */
const manifests = new Map<string, unknown>()

export const hostRuntime = {
  generationId: randomUUID(),
  grants: new GrantStore(),
  ledger: new EffectLedger(),
  log,
  activations,
  activationInstanceOf(componentId: string): string | undefined {
    return activations.get(componentId)
  },
  recordActivation(componentId: string, activationInstance: string): void {
    activations.set(componentId, activationInstance)
  },
  manifests,
  manifestOf(componentId: string): unknown | undefined {
    return manifests.get(componentId)
  },
  recordManifest(componentId: string, manifest: unknown): void {
    manifests.set(componentId, manifest)
  },
}

export type HostRuntime = typeof hostRuntime
