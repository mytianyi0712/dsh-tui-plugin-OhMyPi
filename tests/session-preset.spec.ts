import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Context, Session } from '../src/dsh-host/index.ts'
import { resolveSessionPreset } from '../src/session-preset.ts'

/** A context whose projection registry serves one fixed `agentPreset` state. */
function contextWithProjection(state: string | null | undefined): Context {
  const registry = state === undefined
    ? undefined
    : { stateOf: (_session: Session, key: string) => (key === 'agentPreset' ? state : undefined) }
  return {
    sessionProjections: registry,
    get: (name: string) => (name === 'sessionProjections' ? registry : undefined),
  } as unknown as Context
}

describe('resolveSessionPreset', () => {
  it('returns undefined when the session never named a preset', () => {
    const session = { header: {} } as Session
    assert.equal(resolveSessionPreset(contextWithProjection(null), session), undefined)
  })

  it('uses the creation header when no selection event exists', () => {
    const session = { header: { agentPreset: 'standard' } } as Session
    assert.equal(resolveSessionPreset(contextWithProjection('standard'), session), 'standard')
  })

  it('lets the projection win over the creation header', () => {
    const session = { header: { agentPreset: 'standard' } } as Session
    assert.equal(resolveSessionPreset(contextWithProjection('minimal'), session), 'minimal')
  })

  it('falls back to the header when no projection registry is mounted', () => {
    const session = { header: { agentPreset: 'code' } } as Session
    assert.equal(resolveSessionPreset(contextWithProjection(undefined), session), 'code')
  })
})
