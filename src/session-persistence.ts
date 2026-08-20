/** Conversation-aware write gate and legacy session repair installed over the profile's JSONL backend. */

import { Service, type Context } from '@deepseek-ai/cordis'
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
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

interface StoredSession {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly revision?: unknown
  readonly tornMarker?: unknown
}

interface RepairableBackend extends BatchBackend {
  loadStored?(id: SessionId, signal?: AbortSignal): Promise<StoredSession | undefined>
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Repair legacy tool-call identity damage caused by models/adapters that emit
 * empty tool call ids or names. DSH persists `tool/call` and `tool/result`
 * without validating these fields at append time, but restore-time validation
 * rejects empty call ids, which makes the whole session unrecoverable.
 * This pass normalizes:
 * - `tool/call`: `callId` must be a non-empty string; `name` falls back to
 *   `unknown`; `arguments` falls back to `{}`.
 * - `assistant/message`: `tool-call` content blocks get the same repaired ids
 *   and a non-empty name so derived history can be replayed upstream.
 * - `tool/result`: `source.callId` and `toolCallId` are aligned with the
 *   referenced `tool/call` event (or generated when the reference is absent).
 */
export function repairLegacyToolEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  const callIdsBySeq = new Map<number, string>()
  const callIdsByTurnStep = new Map<string, string[]>()
  let changed = false

  const firstPass = events.map((event) => {
    if (event.type !== 'tool/call') return event
    const data = event.data as {
      turn?: unknown
      step?: unknown
      callId?: unknown
      name?: unknown
      arguments?: unknown
    }
    const callId = nonEmptyString(data.callId, `call-${event.seq}`)
    const name = typeof data.name === 'string' && data.name.trim() !== '' ? data.name : 'unknown'
    const args = typeof data.arguments === 'string' && data.arguments.trim() !== '' ? data.arguments : '{}'
    if (callId !== data.callId || name !== data.name || args !== data.arguments) changed = true
    callIdsBySeq.set(event.seq, callId)
    const key = `${String(data.turn)}:${String(data.step)}`
    const list = callIdsByTurnStep.get(key) ?? []
    list.push(callId)
    callIdsByTurnStep.set(key, list)
    return {
      ...event,
      data: { ...data, callId, name, arguments: args },
    }
  })

  const source = changed ? firstPass : events
  const secondPass = source.map((event) => {
    if (event.type === 'assistant/message') {
      const data = event.data as {
        turn?: unknown
        step?: unknown
        message?: { content?: unknown }
      }
      const content = data.message?.content
      if (!Array.isArray(content)) return event
      const stepCallIds = callIdsByTurnStep.get(`${String(data.turn)}:${String(data.step)}`) ?? []
      let toolIndex = 0
      let contentChanged = false
      const repairedContent = content.map((block) => {
        if (!isRecord(block) || block.type !== 'tool-call') return block
        const fallbackId = stepCallIds[toolIndex] ?? `call-${event.seq}-${toolIndex}`
        toolIndex += 1
        const id = nonEmptyString(block.id, fallbackId)
        const name = nonEmptyString(block.name, 'unknown')
        const args = typeof block.arguments === 'string' && block.arguments.trim() !== '' ? block.arguments : '{}'
        if (id === block.id && name === block.name && args === block.arguments) return block
        contentChanged = true
        return { ...block, id, name, arguments: args }
      })
      if (!contentChanged) return event
      changed = true
      return {
        ...event,
        data: {
          ...data,
          message: { ...(data.message as object), content: repairedContent },
        },
      }
    }

    if (event.type === 'tool/result') {
      const data = event.data as {
        message?: {
          source?: { callId?: unknown }
          content?: unknown
        }
      }
      const source = data.message?.source
      const content = data.message?.content
      if (!isRecord(source) || !Array.isArray(content) || content.length !== 1) return event
      const block = content[0]
      if (!isRecord(block)) return event
      const sourceSeq = (event as SessionEvent & { sourceEventSeqs?: readonly number[] }).sourceEventSeqs?.[0]
      const callId = sourceSeq !== undefined
        ? callIdsBySeq.get(sourceSeq) ?? nonEmptyString(source.callId, `call-${event.seq}`)
        : nonEmptyString(source.callId, `call-${event.seq}`)
      if (callId === source.callId && callId === block.toolCallId) return event
      changed = true
      return {
        ...event,
        data: {
          ...data,
          message: {
            ...(data.message as object),
            source: { ...source, callId },
            content: [{ ...block, toolCallId: callId }],
          },
        },
      }
    }

    return event
  })

  return (changed ? secondPass : events) as readonly SessionEvent[]
}

/** Make empty tool-call delta ids/names harmless before the LLM assembler sees them. */
function sanitizeToolCallChunk(chunk: StreamChunk): StreamChunk {
  if (chunk.type === 'tool-call-delta') {
    const id = nonEmptyString(chunk.id, `call-${chunk.index}`)
    const name = nonEmptyString(chunk.name, 'unknown')
    if (id === chunk.id && name === chunk.name) return chunk
    return { ...chunk, id: CallId(id), name } as StreamChunk
  }

  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
    const block = chunk.block
    const id = nonEmptyString(block.id, `call-${chunk.index}`)
    const name = nonEmptyString(block.name, 'unknown')
    if (id === block.id && name === block.name) return chunk
    return {
      ...chunk,
      block: { ...block, id: CallId(id), name },
    } as StreamChunk
  }

  return chunk
}

async function* sanitizeToolCallDeltaStream(source: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  for await (const chunk of source) yield sanitizeToolCallChunk(chunk)
}

/**
 * Installs before agent-loop startup and wraps the JSONL backend's physical
 * append/read seams. The persistence coordinator still observes every event
 * and its contiguous cursor; only artifact creation waits for conversation
 * data. Legacy events with empty tool call ids are repaired before they can
 * fail restore-time validation.
 */
export class ConversationPersistenceGate extends Service {
  static inject = ['sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'conversationPersistenceGate')
    const backend = ctx.sessionPersistence as unknown as RepairableBackend
    if (typeof backend.appendBatch !== 'function') {
      throw new Error('conversation persistence gate requires an appendBatch backend')
    }
    const gate = new ConversationWriteGate()

    const originalAppendBatch = backend.appendBatch
    const hadAppendBatch = Object.hasOwn(backend, 'appendBatch')
    backend.appendBatch = async function appendConversationBatch(meta, events, isMaterialized) {
      const write = gate.stage(meta.id, repairLegacyToolEvents(events), isMaterialized)
      if (write === undefined) return
      await originalAppendBatch.call(this, meta, write.events, write.isMaterialized)
    }

    const originalLoadStored = backend.loadStored
    const hadLoadStored = typeof originalLoadStored === 'function' && Object.hasOwn(backend, 'loadStored')
    if (typeof originalLoadStored === 'function') {
      backend.loadStored = async function loadRepairedStored(id, signal) {
        const stored = await originalLoadStored.call(this, id, signal)
        if (stored === undefined) return undefined
        const events = repairLegacyToolEvents(stored.events)
        return events === stored.events ? stored : { ...stored, events }
      }
    }

    // DeepSeek V4 Flash occasionally emits tool-call deltas with empty id/name.
    // Sanitize those chunks at the stream seam so the assembled assistant
    // message and its tool/call + tool/result events never carry empty ids.
    ctx.on('llm/stream', (_options, next) => sanitizeToolCallDeltaStream(next()), { global: true })

    ctx.on('session/disposed', session => gate.drop(session.id))
    ctx.effect(() => () => {
      if (hadAppendBatch) backend.appendBatch = originalAppendBatch
      else delete (backend as Partial<RepairableBackend>).appendBatch
      if (hadLoadStored && originalLoadStored !== undefined) backend.loadStored = originalLoadStored
      else delete (backend as Partial<RepairableBackend>).loadStored
    })
  }
}

export default ConversationPersistenceGate
