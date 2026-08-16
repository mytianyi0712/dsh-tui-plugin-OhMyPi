// Per-account getUpdates long-poll monitor.
// All errors are contained here; the plugin never lets a rejection escape.
// 【职责】getUpdates 长轮询接收循环（每账号一个实例）。

import {
  getUpdates,
  notifyStart,
  STALE_TOKEN_ERRCODE,
} from './api.ts'
import type { WeixinMessage } from './api.ts'
import type { Account } from './state.ts'
import { loadSyncBuf, saveSyncBuf } from './state.ts'

const PAUSE_DURATION_MS = 60 * 60 * 1000
const DEDUP_CAP = 1000

export interface MonitorStatus {
  running: boolean
  lastEventAt?: number
  lastInboundAt?: number
  pausedUntil?: number
  lastError?: string
  consecutiveFailures: number
}

export interface MonitorHooks {
  onMessage: (account: Account, msg: WeixinMessage) => Promise<void>
  onStatus?: (id: string, status: MonitorStatus) => void
  log: (msg: string) => void
}

export class Monitor {
  private account: Account
  private hooks: MonitorHooks
  private abort = new AbortController()
  private dedup = new Set<string>()
  private status: MonitorStatus = {
    running: false,
    consecutiveFailures: 0,
  }
  private loopPromise: Promise<void> | null = null

  constructor(account: Account, hooks: MonitorHooks) {
    this.account = account
    this.hooks = hooks
  }

  get id(): string {
    return this.account.id
  }

  getStatus(): MonitorStatus {
    return { ...this.status }
  }

  /** Start the loop (idempotent). Returns immediately. */
  start(): void {
    if (this.loopPromise) return
    this.abort = new AbortController()
    this.loopPromise = this.run().catch((err) => {
      this.hooks.log(`wechat monitor crashed for ${this.account.id}: ${String(err)}`)
    })
  }

  /** Stop the loop; best-effort. */
  async stop(): Promise<void> {
    this.abort.abort()
    if (this.loopPromise) {
      try {
        await this.loopPromise
      } catch {
        // ignore
      }
      this.loopPromise = null
    }
  }

  private touch(patch: Partial<MonitorStatus>): void {
    Object.assign(this.status, patch)
    this.hooks.onStatus?.(this.account.id, this.getStatus())
  }

  private async run(): Promise<void> {
    const { account, hooks, abort } = this
    hooks.log(`wechat monitor started for ${account.id} (${account.baseUrl})`)

    // Announce presence to the backend.
    try {
      await notifyStart(account.baseUrl, account.token)
    } catch {
      // Non-fatal.
    }

    let buf = loadSyncBuf(account.id) || ''
    let consecutiveFailures = 0
    let pausedAt: number | undefined

    this.touch({ running: true, pausedUntil: undefined, lastError: undefined })

    while (!abort.signal.aborted) {
      let resp
      try {
        resp = await getUpdates({
          baseUrl: account.baseUrl,
          token: account.token,
          buf,
          signal: abort.signal,
        })
      } catch (err) {
        if (abort.signal.aborted) break
        // Retry immediately; the failing request itself paces the loop.
        consecutiveFailures += 1
        if (consecutiveFailures === 1) {
          this.hooks.log(`getUpdates error: ${String(err)}`)
        }
        this.touch({ lastError: `getUpdates error: ${String(err)}`, consecutiveFailures })
        continue
      }

      if (abort.signal.aborted) break

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0)

      if (isApiError) {
        const stale =
          resp.errcode === STALE_TOKEN_ERRCODE || resp.ret === STALE_TOKEN_ERRCODE
        if (stale) {
          if (pausedAt === undefined) {
            pausedAt = Date.now()
            this.hooks.log(
              `wechat token for ${account.id} is stale (errcode -14); pausing 60 min`,
            )
            this.touch({ pausedUntil: pausedAt + PAUSE_DURATION_MS, consecutiveFailures: 0, lastError: 'stale token (-14)' })
          }
          await sleep(15_000, abort.signal).catch(() => {})
          if (Date.now() - pausedAt >= PAUSE_DURATION_MS) {
            pausedAt = undefined
            this.touch({ pausedUntil: undefined })
            this.hooks.log(`wechat monitor resuming for ${account.id} after stale-token pause`)
          }
          continue
        }
        consecutiveFailures += 1
        if (consecutiveFailures === 1) {
          this.hooks.log(
            `getUpdates ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ''}`,
          )
        }
        this.touch({
          lastError: `getUpdates ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ''}`,
          consecutiveFailures,
        })
        continue
      }

      if (pausedAt !== undefined) pausedAt = undefined
      consecutiveFailures = 0
      this.touch({ consecutiveFailures, lastError: undefined, lastEventAt: Date.now() })

      if (resp.get_updates_buf) {
        buf = resp.get_updates_buf
        saveSyncBuf(account.id, buf)
      }

      for (const msg of resp.msgs ?? []) {
        if (abort.signal.aborted) break
        if (!this.allowDedup(msg)) continue
        this.touch({ lastInboundAt: Date.now() })
        try {
          await hooks.onMessage(account, msg)
        } catch (err) {
          this.hooks.log(`wechat message handling error: ${String(err)}`)
        }
      }
    }

    this.touch({ running: false })
    hooks.log(`wechat monitor ended for ${account.id}`)
  }

  private allowDedup(msg: WeixinMessage): boolean {
    const key =
      msg.message_id !== undefined
        ? `id:${msg.message_id}`
        : msg.seq !== undefined
          ? `seq:${msg.seq}`
          : null
    if (key === null) return true
    if (this.dedup.has(key)) return false
    this.dedup.add(key)
    if (this.dedup.size > DEDUP_CAP) {
      const first = this.dedup.values().next().value
      if (first !== undefined) this.dedup.delete(first)
    }
    return true
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const t = setTimeout(resolve, ms)
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    },
    { once: true },
  )
  return promise
}
