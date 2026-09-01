/**
 * Cordis row that dynamically links `@dsh-std/adapter-dsh` with `discover: false`.
 *
 * The community adapter owns DSH version mapping and std-plugin activation.
 * This TUI only loads it; it does not vendor or reimplement that mapping.
 * Discovery waits until the TUI has published its host participants, then
 * `std-profile-loader` mounts profile components.
 */

import type { Context } from '@deepseek-ai/cordis'
import { importStdAdapter, warnStdAdapter } from './std-link.ts'

export const name = 'dsh-std-adapter'

export async function apply(ctx: Context, config: Record<string, unknown> = {}): Promise<void> {
  const adapter = await importStdAdapter()
  if (adapter === undefined) {
    warnStdAdapter('@dsh-std/adapter-dsh not found; community std plugins will not auto-load')
    return
  }
  try {
    await adapter.apply(ctx, { ...config, discover: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnStdAdapter(`std adapter failed to start (${message}); TUI continues without it`)
  }
}
