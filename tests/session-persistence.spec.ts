import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { BlockAssembler, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ConversationWriteGate, repairLegacyToolEvents, sanitizeToolCallChunk, sanitizeToolCallDeltaStream } from '../src/session-persistence.ts'

function event(seq: number, type: string): SessionEvent {
  return { seq, time: seq, type, data: {} } as SessionEvent
}

describe('conversation-gated persistence', () => {
  it('buffers metadata and releases the complete prefix on first conversation data', () => {
    const gate = new ConversationWriteGate()
    const id = SessionId('fresh')
    assert.equal(gate.stage(id, [event(0, 'permission/preset')], false), undefined)
    assert.equal(gate.stage(id, [event(1, 'sandbox/mode')], true), undefined)

    const released = gate.stage(id, [event(2, 'user/message')], true)
    assert.equal(released?.isMaterialized, false)
    assert.deepEqual(released?.events.map(item => [item.seq, item.type]), [
      [0, 'permission/preset'],
      [1, 'sandbox/mode'],
      [2, 'user/message'],
    ])

    const later = gate.stage(id, [event(3, 'turn/start')], true)
    assert.equal(later?.isMaterialized, true)
    assert.deepEqual(later?.events.map(item => item.seq), [3])
  })

  it('passes writes for an already materialized resumed session through', () => {
    const gate = new ConversationWriteGate()
    const write = gate.stage(SessionId('resumed'), [event(4, 'turn/start')], true)
    assert.equal(write?.isMaterialized, true)
    assert.deepEqual(write?.events.map(item => item.seq), [4])
  })

  it('drops abandoned metadata when a blank session is disposed', () => {
    const gate = new ConversationWriteGate()
    const id = SessionId('abandoned')
    assert.equal(gate.stage(id, [event(0, 'approval/policy')], false), undefined)
    gate.drop(id)
    const write = gate.stage(id, [event(1, 'turn/start')], true)
    assert.deepEqual(write?.events.map(item => item.seq), [1])
  })

  it('repairs legacy empty tool call ids so a stored session can be restored', () => {
    const id = SessionId('repair-empty-tool-call')
    const events = [
      {
        type: 'tool/call',
        seq: 0,
        time: 0,
        data: { turn: 0, step: 0, callId: '', name: '', arguments: '' },
      },
      {
        type: 'tool/result',
        seq: 1,
        time: 1,
        data: {
          turn: 0,
          step: 0,
          message: {
            id: 'm1',
            role: 'user',
            source: { kind: 'tool', callId: '' },
            content: [{ type: 'tool-result', toolCallId: '', content: [{ type: 'text', text: 'ok' }] }],
          },
        },
        surfaceOp: 'append',
        sourceEventSeqs: [0],
      },
    ] as unknown as SessionEvent[]

    const repaired = repairLegacyToolEvents(events) as SessionEvent[]
    const session = Session.fromRestore(id, repaired, {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 0,
    })

    assert.equal(session.events.length, 3) // tool/call + tool/result + session/end-seed
    const call = session.events[0] as { data: { callId: string; name: string; arguments: string } }
    assert.equal(call.data.callId, 'call-0')
    assert.equal(call.data.name, 'unknown')
    assert.equal(call.data.arguments, '{}')
    const result = session.events[1] as { data: { message: { source: { callId: string }; content: [{ toolCallId: string }] } } }
    assert.equal(result.data.message.source.callId, 'call-0')
    assert.equal(result.data.message.content[0].toolCallId, 'call-0')
  })
})

describe('tool-call stream sanitizer', () => {
  it('synthesizes only empty ids and preserves absent names', () => {
    const delta = sanitizeToolCallChunk({
      type: 'tool-call-delta',
      index: 0,
      id: ToolCallId(''),
      name: undefined,
      argumentsDelta: '{}',
    } as StreamChunk)

    assert.equal(delta.type, 'tool-call-delta')
    if (delta.type === 'tool-call-delta') {
      assert.equal(delta.id, 'call-0')
      assert.equal(delta.name, undefined)
    }

    const end = sanitizeToolCallChunk({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: ToolCallId(''), name: 'bash', arguments: '{}' },
    } as StreamChunk)

    assert.equal(end.type, 'block-end')
    if (end.type === 'block-end' && end.block.type === 'tool-call') {
      assert.equal(end.block.id, 'call-0')
      assert.equal(end.block.name, 'bash')
    }
  })

  it('lets the assembler keep the first-seen name when continuation deltas omit it', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'block-start', index: 0, blockType: 'tool-call' })
    for (const chunk of [
      {
        type: 'tool-call-delta',
        index: 0,
        id: ToolCallId('call_1'),
        name: 'bash',
        argumentsDelta: '{"command":"',
      },
      {
        type: 'tool-call-delta',
        index: 0,
        id: ToolCallId('call_1'),
        name: undefined,
        argumentsDelta: 'ls"}',
      },
    ] as StreamChunk[]) {
      assembler.push(sanitizeToolCallChunk(chunk))
    }

    const [block] = assembler.blocks()
    assert.equal(block?.type, 'tool-call')
    if (block?.type === 'tool-call') {
      assert.equal(block.id, 'call_1')
      assert.equal(block.name, 'bash')
      assert.equal(block.arguments, '{"command":"ls"}')
    }
  })

  it('keeps the first-seen id and name when later deltas and block-end are empty', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 1,
        id: ToolCallId('call_a3badaf0132c4e3e82b87e1f'),
        name: 'pwsh',
        argumentsDelta: '',
      },
      {
        type: 'tool-call-delta',
        index: 1,
        id: ToolCallId(''),
        name: null,
        argumentsDelta: '{"command":"Get-Command dsh"}',
      } as StreamChunk,
      {
        type: 'block-end',
        index: 1,
        block: { type: 'tool-call', id: ToolCallId(''), name: '', arguments: '{"command":"Get-Command dsh"}' },
      },
    ]

    const assembler = new BlockAssembler()
    for await (const chunk of sanitizeToolCallDeltaStream(chunks as unknown as AsyncIterable<StreamChunk>)) {
      assembler.push(chunk)
    }

    const [block] = assembler.blocks()
    assert.equal(block?.type, 'tool-call')
    if (block?.type === 'tool-call') {
      assert.equal(block.id, 'call_a3badaf0132c4e3e82b87e1f')
      assert.equal(block.name, 'pwsh')
      assert.equal(block.arguments, '{"command":"Get-Command dsh"}')
    }
  })
})
