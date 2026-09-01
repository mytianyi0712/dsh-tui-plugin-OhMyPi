/**
 * Dynamic linker for the community std adapter (`@dsh-std/adapter-dsh`).
 *
 * The adapter is resolved at runtime from the active profile's node_modules
 * and is never bundled. Updating the adapter package is therefore a profile
 * install, not a rebuild of this TUI. Missing or incompatible adapters degrade
 * to a no-op so the TUI still boots.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { enqueueBootNotice } from '../boot-notices.ts'

export const STD_ADAPTER_PACKAGE = '@dsh-std/adapter-dsh'
export const STD_PROFILE_LOADER_PACKAGE = '@dsh-std/adapter-dsh/profile-loader'

export interface StdAdapterApplyConfig {
  readonly profile?: string
  readonly profileBaseUrl?: string
  readonly runtimeId?: string
  readonly discover?: boolean
}

export interface StdAdapterModule {
  readonly name?: string
  apply(ctx: unknown, config?: StdAdapterApplyConfig): void | Promise<void>
}

export interface StdProfileLoaderModule {
  readonly name?: string
  apply(ctx: unknown, config?: { readonly profileBaseUrl?: string }): void | Promise<void>
}

function warn(message: string): void {
  enqueueBootNotice(message, 'warning')
}

async function importSpecifier(specifier: string): Promise<unknown | undefined> {
  // Runtime registry: the adapter is an independently-updated profile package
  // and is not a compile-time dependency of this TUI.
  try {
    return await import(specifier)
  } catch {
    try {
      const require = createRequire(join(process.cwd(), 'package.json'))
      const resolved = require.resolve(specifier)
      return await import(pathToFileURL(resolved).href)
    } catch {
      return undefined
    }
  }
}

function asApplyModule<T extends { apply?: unknown }>(loaded: unknown): T | undefined {
  if (loaded === null || typeof loaded !== 'object') return undefined
  const candidate = loaded as T & { default?: unknown }
  if (typeof candidate.apply === 'function') return candidate
  const fallback = candidate.default
  if (fallback !== null && typeof fallback === 'object' && typeof (fallback as T).apply === 'function') {
    return fallback as T
  }
  if (typeof fallback === 'function') return { apply: fallback } as T
  return undefined
}

/** Resolve `@dsh-std/adapter-dsh` from the profile. `undefined` = not installed. */
export async function importStdAdapter(): Promise<StdAdapterModule | undefined> {
  const loaded = await importSpecifier(STD_ADAPTER_PACKAGE)
  if (loaded === undefined) return undefined
  const module = asApplyModule<StdAdapterModule>(loaded)
  if (module === undefined) {
    warn(`${STD_ADAPTER_PACKAGE} is installed but has no apply() export`)
    return undefined
  }
  return module
}

/** Resolve the profile-loader subpath. `undefined` = adapter not installed. */
export async function importStdProfileLoader(): Promise<StdProfileLoaderModule | undefined> {
  const loaded = await importSpecifier(STD_PROFILE_LOADER_PACKAGE)
  if (loaded === undefined) return undefined
  const module = asApplyModule<StdProfileLoaderModule>(loaded)
  if (module === undefined) {
    warn(`${STD_PROFILE_LOADER_PACKAGE} is installed but has no apply() export`)
    return undefined
  }
  return module
}

export { warn as warnStdAdapter }
