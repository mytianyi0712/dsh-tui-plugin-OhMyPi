import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Events proving that a session contains model-facing conversation data. */
const CONVERSATION_EVENT_TYPES: Readonly<Record<string, true>> = {
  'user/message': true,
  'assistant/message': true,
  'tool/call': true,
}

/** Whether a session has crossed the blank-session boundary. */
export function hasConversationData(events: readonly SessionEvent[]): boolean {
  return events.some(event => CONVERSATION_EVENT_TYPES[event.type] === true)
}

/**
 * Persist a runtime preset immediately before the first user message. Keeping
 * this out of blank-session setup preserves the persistence backend's lazy
 * materialization contract: an abandoned session leaves no artifact.
 */
export function recordConversationPreset(session: Session, preset: string): void {
  if (resolveSessionPreset(session) === preset) return
  session.append('agent-preset/selected', { agentPreset: preset })
}
