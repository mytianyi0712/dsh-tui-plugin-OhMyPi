import { resolve } from 'node:path'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

/** Compare session cwd values using the host platform's path semantics. */
export function sameProject(left: string | null | undefined, right: string): boolean {
  if (left === undefined || left === null) return false
  const leftPath = resolve(left)
  const rightPath = resolve(right)
  return process.platform === 'win32'
    ? leftPath.toLocaleLowerCase() === rightPath.toLocaleLowerCase()
    : leftPath === rightPath
}

/** Keep only persisted sessions whose cwd belongs to the active project. */
export function filterProjectSessions(records: readonly SessionRecord[], workspace: string): SessionRecord[] {
  return records.filter(record => record.persisted && sameProject(record.header.cwd, workspace))
}
