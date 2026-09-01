/**
 * Cordis row that dynamically links `@dsh-std/adapter-dsh/profile-loader`
 * after this host has published its built-in participants.
 */

import type { Context } from '@deepseek-ai/cordis'
import { importStdProfileLoader, warnStdAdapter } from './std-link.ts'

export const name = 'dsh-std-profile-loader'

export async function apply(ctx: Context, config: Record<string, unknown> = {}): Promise<void> {
  const dshStd = ctx.get('dshStd', false)
  if (dshStd === undefined) return

  const loader = await importStdProfileLoader()
  if (loader === undefined) return

  try {
    const profileBaseUrl = typeof config.profileBaseUrl === 'string' ? config.profileBaseUrl : undefined
    await loader.apply(ctx, profileBaseUrl === undefined ? {} : { profileBaseUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnStdAdapter(`std profile loader failed (${message}); installed std plugins were not activated`)
  }
}
