import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fillOverlayLines } from '../src/components/dialogs.ts'

describe('fillOverlayLines', () => {
  it('pads short overlay content to the terminal height and width', () => {
    const lines = fillOverlayLines(['hello'], 10, 4)
    assert.equal(lines.length, 4)
    assert.equal(lines[0], 'hello     ')
    assert.equal(lines[1], '          ')
    assert.equal(lines[3], '          ')
  })
})
