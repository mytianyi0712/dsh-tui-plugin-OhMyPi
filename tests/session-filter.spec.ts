import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterProjectSessions, sameProject } from '../src/session-filter.ts'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

function record(cwd: string | null, persisted: boolean, id: string): SessionRecord {
  return {
    header: { cwd, id } as unknown as SessionRecord['header'],
    live: false,
    persisted,
  }
}

describe('project session filtering', () => {
  it('keeps only persisted sessions from the active project', () => {
    const workspace = process.cwd()
    const records = [
      record(workspace, true, 'same'),
      record(workspace, false, 'live-only'),
      record('D:/other-project', true, 'other'),
      record(null, true, 'unknown'),
    ]
    assert.deepEqual(filterProjectSessions(records, workspace).map(item => String(item.header.id)), ['same'])
  })

  it('uses case-insensitive comparison on Windows', () => {
    const workspace = process.cwd()
    const equivalent = process.platform === 'win32' ? workspace.toUpperCase() : workspace
    assert.equal(sameProject(equivalent, workspace), true)
    assert.equal(sameProject('D:/definitely-not-this-project', workspace), false)
  })
})
