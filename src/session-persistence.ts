/** Conversation-aware write gate installed over the profile's JSONL backend. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { hasConversationData } from './session-lifecycle.ts'

export const name = 'session-persistence-conversation-gate'

export interface DeferredWrite {
  readonly events: readonly SessionEvent[]
  readonly isMaterialized: boolean
}

/** Keeps pre-conversation metadata in memory until the first dialogue batch. */
export class ConversationWriteGate {
  private readonly pending = new Map<SessionId, readonly SessionEvent[]>()

  stage(
    id: SessionId,
    events: readonly SessionEvent[],
    coordinatorMaterialized: boolean,
  ): DeferredWrite | undefined {
    const pending = this.pending.get(id)
    if (pending === undefined && coordinatorMaterialized) {
      return { events, isMaterialized: true }
    }
    const combined = pending === undefined ? events : [...pending, ...events]
    if (!hasConversationData(combined)) {
      this.pending.set(id, combined)
      return undefined
    }
    this.pending.delete(id)
    return { events: combined, isMaterialized: false }
  }

  drop(id: SessionId): void {
    this.pending.delete(id)
  }
}

interface BatchBackend {
  appendBatch(
    meta: SessionHeader,
    events: readonly SessionEvent[],
    isMaterialized: boolean,
  ): Promise<void>
}

/**
 * Installs before agent-loop startup and wraps the JSONL backend's physical
 * append seam. The persistence coordinator still observes every event and its
 * contiguous cursor; only artifact creation waits for conversation data.
 */
export class ConversationPersistenceGate extends Service {
  static inject = ['sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'conversationPersistenceGate')
    const backend = ctx.sessionPersistence as unknown as BatchBackend
    if (typeof backend.appendBatch !== 'function') {
      throw new Error('conversation persistence gate requires an appendBatch backend')
    }
    const gate = new ConversationWriteGate()
    const original = backend.appendBatch
    const hadOwnMethod = Object.hasOwn(backend, 'appendBatch')
    backend.appendBatch = async function appendConversationBatch(meta, events, isMaterialized) {
      const write = gate.stage(meta.id, events, isMaterialized)
      if (write === undefined) return
      await original.call(this, meta, write.events, write.isMaterialized)
    }
    ctx.on('session/disposed', session => gate.drop(session.id))
    ctx.effect(() => () => {
      if (hadOwnMethod) backend.appendBatch = original
      else delete (backend as Partial<BatchBackend>).appendBatch
    })
  }
}

export default ConversationPersistenceGate
