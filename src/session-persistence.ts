/** Tool-call identity sanitizer installed over the profile's LLM stream seam. */

import { Service, type Context } from './dsh-host/index.ts'
import { ToolCallId, type StreamChunk } from './dsh-host/index.ts'

export const name = 'session-persistence-tool-call-sanitizer'

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/**
 * Make empty tool-call delta/block ids harmless before the LLM assembler sees
 * them. Names are deliberately left untouched: DeepSeek/OpenAI-compatible
 * adapters may omit `name` on continuation deltas, and the assembler keeps the
 * first non-empty name it saw. Replacing an absent name with `unknown` here
 * would overwrite that remembered name and make valid calls fail as unknown
 * tools, so only the call identity is synthesized.
 */
export function sanitizeToolCallChunk(chunk: StreamChunk): StreamChunk {
  if (chunk.type === 'tool-call-delta') {
    const id = nonEmptyString(chunk.id, `call-${chunk.index}`)
    if (id === chunk.id) return chunk
    return { ...chunk, id: ToolCallId(id) } as StreamChunk
  }

  if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
    const block = chunk.block
    const id = nonEmptyString(block.id, `call-${chunk.index}`)
    if (id === block.id) return chunk
    return {
      ...chunk,
      block: { ...block, id: ToolCallId(id) },
    } as StreamChunk
  }

  return chunk
}

export async function* sanitizeToolCallDeltaStream(source: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  // Continuation deltas may omit `name`/`id` after the first delta, and some
  // adapters close blocks with an empty name/id. Keep the first non-empty
  // identity per block index and fall back to it so the assembler never
  // overwrites a valid tool identity with an empty or synthesized one.
  const toolIds = new Map<number, ToolCallId>()
  const toolNames = new Map<number, string>()
  for await (const chunk of source) {
    if (chunk.type === 'tool-call-delta') {
      if (typeof chunk.name === 'string' && chunk.name.trim() !== '') toolNames.set(chunk.index, chunk.name)
      if (typeof chunk.id === 'string' && chunk.id.trim() !== '') toolIds.set(chunk.index, chunk.id)
      const id = nonEmptyString(chunk.id, toolIds.get(chunk.index) ?? `call-${chunk.index}`)
      if (!toolIds.has(chunk.index)) toolIds.set(chunk.index, ToolCallId(id))
      if (id === chunk.id) {
        yield chunk
      } else {
        yield { ...chunk, id: ToolCallId(id) } as StreamChunk
      }
      continue
    }

    if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
      const block = chunk.block
      const id = nonEmptyString(block.id, toolIds.get(chunk.index) ?? `call-${chunk.index}`)
      const name = typeof block.name === 'string' && block.name.trim() !== ''
        ? block.name
        : toolNames.get(chunk.index) ?? ''
      if (id === block.id && name === block.name) {
        yield chunk
      } else {
        yield {
          ...chunk,
          block: { ...block, id: ToolCallId(id), name },
        } as StreamChunk
      }
      continue
    }

    yield chunk
  }
}

/**
 * Synthesizes tool-call ids at the stream seam so the assembler never sees an
 * empty identity. dsh 0.2 persists `tool/call` and `tool/result` without
 * validating call ids at append time, but restore-time validation rejects empty
 * ids and makes the whole session unrecoverable, so the fix has to happen before
 * the message is built.
 *
 * dsh 0.2's persistence backends materialize a session artifact on the first
 * physical append and on the durability barrier (`SessionHandle.flush`), and the
 * backend routes live session events straight to its own handle. A write gate
 * above the handle cannot keep a blank session off disk — the barrier writes the
 * header regardless — so the earlier conversation-gated deferral is dropped: the
 * backend's own lazy materialization already keeps a session that never reaches
 * a checkpoint out of storage.
 */
export class ToolCallIdSanitizer extends Service {
  static inject = ['llm']

  constructor(ctx: Context) {
    super(ctx, 'toolCallIdSanitizer')
    ctx.on('llm/stream', (_options, next) => sanitizeToolCallDeltaStream(next()), { global: true })
  }
}

export default ToolCallIdSanitizer
