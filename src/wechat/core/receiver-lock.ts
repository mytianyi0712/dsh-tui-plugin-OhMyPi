// Exclusive receiver lock: only ONE dsh process may long-poll getUpdates
// (multiple pollers on the same sync cursor steal messages from each other).
// Sending is unrestricted — any process may push via sendmessage.
// 【职责】多进程接收互斥锁（持有者才能长轮询）。

import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from './state.ts'

const LOCK_PATH = path.join(stateDir, 'receiver.lock')

interface ReceiverLock {
  pid: number
  startedAt: string
}

function readLock(): ReceiverLock | null {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.pid === 'number') {
        return {
          pid: record.pid,
          startedAt: typeof record.startedAt === 'string' ? record.startedAt : '',
        }
      }
    }
  } catch {
    // unreadable/corrupt lock: treated as stale below
  }
  return null
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = no such process; EPERM = exists (just not ours)
    return (err as NodeJS.ErrnoException)?.code !== 'ESRCH'
  }
}

/**
 * Try to become the receiver. Atomic via `wx` (O_CREAT|O_EXCL): exactly one
 * process wins. A lock whose holder PID is gone is stale and taken over.
 */
export function tryAcquireReceiverLock(): boolean {
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    const fd = fs.openSync(LOCK_PATH, 'wx')
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    } finally {
      fs.closeSync(fd)
    }
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') return false
    const holder = readLock()
    if (holder === null || !isProcessAlive(holder.pid)) {
      try {
        fs.unlinkSync(LOCK_PATH)
      } catch {
        // raced with another taker: the winner owns it now
      }
      return tryAcquireReceiverLock()
    }
    return false
  }
}

/** Release the lock only if we own it (never delete another holder's). */
export function releaseReceiverLock(): void {
  const holder = readLock()
  if (holder && holder.pid === process.pid) {
    try {
      fs.unlinkSync(LOCK_PATH)
    } catch {
      // ignore
    }
  }
}

/** Read the current holder's pid (0 when free). */
export function receiverHolderPid(): number {
  return readLock()?.pid ?? 0
}
