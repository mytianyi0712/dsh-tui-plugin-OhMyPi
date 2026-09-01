/**
 * Notices produced before the TUI renderer is live. Callers enqueue; the TUI
 * drains this queue after `ui.start()` so startup stays visually silent.
 */

export type BootNoticeKind = 'info' | 'warning' | 'error'

export interface BootNotice {
  readonly text: string
  readonly kind: BootNoticeKind
}

const queue: BootNotice[] = []

export function enqueueBootNotice(text: string, kind: BootNoticeKind = 'info'): void {
  const trimmed = text.trim()
  if (trimmed === '') return
  queue.push({ text: trimmed, kind })
}

export function drainBootNotices(): BootNotice[] {
  return queue.splice(0)
}
