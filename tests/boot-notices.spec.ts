import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drainBootNotices, enqueueBootNotice } from '../src/boot-notices.ts'

describe('boot notices', () => {
  it('drops blank text and drains queued notices in order', () => {
    drainBootNotices()
    enqueueBootNotice('   ')
    enqueueBootNotice('adapter missing', 'warning')
    enqueueBootNotice('adapter failed', 'error')
    assert.deepEqual(drainBootNotices(), [
      { text: 'adapter missing', kind: 'warning' },
      { text: 'adapter failed', kind: 'error' },
    ])
    assert.deepEqual(drainBootNotices(), [])
  })
})
