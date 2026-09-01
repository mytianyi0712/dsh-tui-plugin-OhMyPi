/**
 * Session preset reconstruction that works on both 0.1.1-rc.2 (where
 * `@deepseek-ai/dsh-agent-presets` exported `resolveSessionPreset`) and
 * 0.1.2-alpha.x (where that helper was replaced by the `agentPreset`
 * session projection). Newest `agent-preset/selected` event wins; the
 * creation header is the fallback.
 */

export interface PresetBearingSession {
  readonly header: { readonly agentPreset?: string }
  readonly events: readonly { readonly type: string; readonly data?: unknown }[]
}

export function resolveSessionPreset(session: PresetBearingSession): string | undefined {
  let preset = typeof session.header.agentPreset === 'string' && session.header.agentPreset !== ''
    ? session.header.agentPreset
    : undefined
  for (const event of session.events) {
    if (event.type !== 'agent-preset/selected') continue
    const data = event.data
    if (data === null || typeof data !== 'object' || !('agentPreset' in data)) continue
    const value = data.agentPreset
    if (typeof value === 'string' && value !== '') preset = value
  }
  return preset
}
