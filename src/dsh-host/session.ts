/**
 * Session and todo seams.
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

// `SessionSeq` and `SessionLogOffset` are branded call signatures: re-exporting
// the value carries its type alias with it, so listing them twice is a duplicate
// identifier.
export { SessionId, SessionSeq, SessionLogOffset } from '@deepseek-ai/dsh-session'
export type {
  EpochHeader,
  Session,
  SessionEvent,
  SessionHeader,
} from '@deepseek-ai/dsh-session'
export type { TodoItem } from '@deepseek-ai/dsh-tool-todo'

/**
 * The immutable snapshot of a session's append-only log.
 *
 * dsh 0.2 removed the `Session.events` getter: the log is read through
 * `snapshotEvents()` (whole log when called with no arguments). A full current
 * snapshot is reused until the next append, so identity comparison still detects
 * log growth. This seam keeps one call site spelling for every consumer that
 * folds durable history.
 */
export function sessionEvents(session: Session): readonly SessionEvent[] {
  return session.snapshotEvents()
}
