import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { hasConversationData, recordConversationPreset } from '../src/session-lifecycle.ts'

function blankSession(idValue: string, agentPreset?: string): Session {
  const id = SessionId(idValue)
  return Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    ...(agentPreset === undefined ? {} : { agentPreset }),
  })
}

describe('session lifecycle', () => {
  it('keeps preset metadata out of a blank conversation check', () => {
    const session = blankSession('blank')
    assert.equal(hasConversationData(session.events), false)

    recordConversationPreset(session, 'standard')
    assert.equal(session.events.length, 1)
    assert.equal(session.events[0]?.type, 'agent-preset/selected')
    assert.equal(hasConversationData(session.events), false)

    assert.equal(hasConversationData([{ type: 'user/message' } as SessionEvent]), true)
  })

  it('does not append when the creation header already records the preset', () => {
    const session = blankSession('header-preset', 'minimal')
    recordConversationPreset(session, 'minimal')
    assert.equal(session.events.length, 0)
  })

  it('records one latest selection when a blank session changes preset', () => {
    const session = blankSession('switched-preset', 'standard')
    recordConversationPreset(session, 'minimal')
    recordConversationPreset(session, 'minimal')
    assert.equal(session.events.length, 1)
    assert.deepEqual(session.events[0]?.data, { agentPreset: 'minimal' })
  })
})
