/**
 * Session preset reconstruction. dsh 0.2 records the preset a session runs
 * under as the `agentPreset` session projection, initialized from the creation
 * header and advanced by `agent-preset/selected` events logged when a blank
 * session switches composition. The projection is the authoritative read; the
 * header is the fallback when the projection registry is absent.
 */

import type { Context, Session } from './dsh-host/index.ts'

export function resolveSessionPreset(ctx: Context, session: Session): string | undefined {
  // Read the projection registry through `ctx.get`: the agent setup context does
  // not declare `sessionProjections` in its inject list, and a direct property
  // read on a Cordis context throws without it.
  const registry = ctx.get('sessionProjections') as
    | { stateOf: (session: Session, key: string) => unknown }
    | undefined
  const projected = registry?.stateOf(session, 'agentPreset')
  if (typeof projected === 'string' && projected !== '') return projected
  return session.header.agentPreset
}
