/**
 * Effect ledger (C-060): append-only JSONL at
 * `~/.dsh-tui/effect-ledger.jsonl`. Records carry the lifecycle triple
 * (pluginId / activationInstance / runtimeGenerationId), are validated against
 * an allowlist before write, and never throw to callers.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import ledgerSchema from './effect-ledger-record.schema.json' with { type: 'json' }
import type { Context } from '../dsh-host/index.ts'
import { hostRuntime } from './runtime.ts'

export const EFFECT_LEDGER_FILE = join(homedir(), '.dsh-tui', 'effect-ledger.jsonl')

export type LedgerOperation = 'create' | 'bind' | 'replace' | 'release' | 'cleanup-failed'

export interface LedgerEntry {
  operation: LedgerOperation
  scope: string
  resource: string
  componentId?: string
  activationInstance?: string
  runtimeGenerationId?: string
  note?: string
}

export interface LedgerRecord {
  seq: number
  ts: number
  operation: LedgerOperation
  scope: string
  resource: string
  pluginId: string
  activationInstance: string
  runtimeGenerationId: string
  note?: string
}

const ALLOWED_OPERATIONS: ReadonlySet<string> = new Set<LedgerOperation>(['create', 'bind', 'replace', 'release', 'cleanup-failed'])

type SchemaProperty = {
  type?: string
  minimum?: number
  maxLength?: number
  enum?: string[]
}

const RECORD_SCHEMA = ledgerSchema as {
  additionalProperties: boolean
  required: string[]
  properties: Record<string, SchemaProperty>
}

function validateRecord(record: Record<string, unknown>): boolean {
  const schema = RECORD_SCHEMA
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in schema.properties)) return false
    }
  }
  for (const required of schema.required) {
    if (!(required in record)) return false
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in record)) continue
    const value = record[key]
    if (property.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) return false
      if (property.minimum !== undefined && value < property.minimum) return false
    } else if (property.type === 'string') {
      if (typeof value !== 'string' || value === '') return false
      if (property.maxLength !== undefined && value.length > property.maxLength) return false
      if (property.enum !== undefined && !property.enum.includes(value)) return false
    }
  }
  return true
}

function cleanScalar(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  if (cleaned === '') return undefined
  return cleaned.slice(0, max)
}

function buildRecord(seq: number, entry: LedgerEntry, identity: LedgerIdentity): LedgerRecord | undefined {
  const scope = cleanScalar(entry.scope, 128)
  const resource = cleanScalar(entry.resource, 256)
  if (scope === undefined || resource === undefined) return undefined
  if (!ALLOWED_OPERATIONS.has(entry.operation)) return undefined
  const note = entry.note === undefined ? undefined : cleanScalar(entry.note, 200)
  const record: Record<string, unknown> = {
    seq,
    ts: Date.now(),
    operation: entry.operation,
    scope,
    resource,
    pluginId: identity.pluginId,
    activationInstance: identity.activationInstance,
    runtimeGenerationId: identity.runtimeGenerationId,
    ...note === undefined ? {} : { note },
  }
  if (!validateRecord(record)) return undefined
  return record as unknown as LedgerRecord
}

export interface LedgerIdentity {
  pluginId: string
  activationInstance: string
  runtimeGenerationId: string
}

export class EffectLedger {
  private nextSeq = 1
  private ready: Promise<void>

  constructor(
    readonly file: string = EFFECT_LEDGER_FILE,
    private readonly hostIdentity: () => LedgerIdentity = () => ({
      pluginId: 'host',
      activationInstance: 'root',
      runtimeGenerationId: 'host',
    }),
  ) {
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        if (line.trim() === '') continue
        try {
          const record = JSON.parse(line) as { seq?: unknown }
          if (typeof record.seq === 'number' && record.seq >= this.nextSeq) {
            this.nextSeq = record.seq + 1
          }
        } catch {
          // Corrupt lines are skipped and never rewritten.
        }
      }
    } catch {
      // First run.
    }
  }

  record(entry: LedgerEntry, identity?: Partial<LedgerIdentity>): void {
    const host = this.hostIdentity()
    const resolved: LedgerIdentity = {
      pluginId: identity?.pluginId ?? host.pluginId,
      activationInstance: identity?.activationInstance ?? host.activationInstance,
      runtimeGenerationId: identity?.runtimeGenerationId ?? host.runtimeGenerationId,
    }
    const record = buildRecord(this.nextSeq, entry, resolved)
    if (record === undefined) return
    const line = `${JSON.stringify(record)}\n`
    this.nextSeq++
    void this.ready.then(async () => {
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await appendFile(this.file, line, 'utf8')
      } catch {
        // Ledger writes are best effort by contract.
      }
    })
  }

  async tail(limit: number): Promise<LedgerRecord[]> {
    await this.ready
    try {
      const raw = await readFile(this.file, 'utf8')
      const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '')
      const records: LedgerRecord[] = []
      for (const line of lines.slice(-limit)) {
        try {
          records.push(JSON.parse(line) as LedgerRecord)
        } catch {
          // skip corrupt
        }
      }
      return records
    } catch {
      return []
    }
  }
}

export const name = 'tui-effect-ledger'

export function apply(ctx: Context): void {
  // The host-plane rows must share one ledger instance so plugin-host records
  // and /plugins diagnostics read the same sequence.
  ctx.provide('tuiEffectLedger', hostRuntime.ledger)
}
