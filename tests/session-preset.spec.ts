import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSessionPreset } from '../src/session-preset.ts'

describe('resolveSessionPreset', () => {
  it('returns undefined when the session never named a preset', () => {
    assert.equal(resolveSessionPreset({ header: {}, events: [] }), undefined)
  })

  it('uses the creation header when no selection event exists', () => {
    assert.equal(resolveSessionPreset({ header: { agentPreset: 'standard' }, events: [] }), 'standard')
  })

  it('lets the newest agent-preset/selected event win', () => {
    assert.equal(resolveSessionPreset({
      header: { agentPreset: 'standard' },
      events: [
        { type: 'user/message', data: { text: 'hi' } },
        { type: 'agent-preset/selected', data: { agentPreset: 'code' } },
        { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } },
      ],
    }), 'minimal')
  })
})
