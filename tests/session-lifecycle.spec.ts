import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '../src/dsh-host/index.ts'
import { hasConversationData, recordConversationPreset } from '../src/session-lifecycle.ts'

function blankSession(idValue: string, agentPreset?: string): Session {
  const id = SessionId(idValue)
  return Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    isSeeded: false,
    ...(agentPreset === undefined ? {} : { agentPreset }),
  })
}

/** Mirrors `agentPresetProjectionDefinition`: header init, selection events advance the state. */
function contextWithPresetProjection(session: Session): Context {
  const registry = {
    stateOf: (target: Session) => {
      let state: string | null = target.header.agentPreset ?? null
      for (const event of target.snapshotEvents()) {
        if (event.type === 'agent-preset/selected') state = event.data.agentPreset
      }
      return state
    },
  }
  return {
    sessionProjections: registry,
    get: (name: string) => (name === 'sessionProjections' ? registry : undefined),
  } as unknown as Context
}

describe('session lifecycle', () => {
  it('keeps preset metadata out of a blank conversation check', () => {
    const session = blankSession('blank')
    const ctx = contextWithPresetProjection(session)
    assert.equal(hasConversationData(session.snapshotEvents()), false)

    recordConversationPreset(ctx, session, 'standard')
    const events = session.snapshotEvents()
    assert.equal(events.length, 1)
    assert.equal(events[0]?.type, 'agent-preset/selected')
    assert.equal(hasConversationData(events), false)

    assert.equal(hasConversationData([{ type: 'user/message' } as SessionEvent]), true)
  })

  it('does not append when the creation header already records the preset', () => {
    const session = blankSession('header-preset', 'minimal')
    recordConversationPreset(contextWithPresetProjection(session), session, 'minimal')
    assert.equal(session.snapshotEvents().length, 0)
  })

  it('records one latest selection when a blank session changes preset', () => {
    const session = blankSession('switched-preset', 'standard')
    const ctx = contextWithPresetProjection(session)
    recordConversationPreset(ctx, session, 'minimal')
    recordConversationPreset(ctx, session, 'minimal')
    const events = session.snapshotEvents()
    assert.equal(events.length, 1)
    assert.deepEqual(events[0]?.data, { agentPreset: 'minimal' })
  })
})
