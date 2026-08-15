import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ConversationWriteGate } from '../src/session-persistence.ts'

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
})
