/**
 * Unified grant store for the 8 registered extension permissions.
 *
 * File: `~/.dsh-tui/extension-grants.json` (shared location with dsh-TUI so
 * a plugin admitted by both hosts has one authorization story). Three file
 * states are strictly distinguished:
 * - missing (ENOENT) = all defaults;
 * - unparseable/structurally invalid = fail closed (even default-allow
 *   permissions are denied);
 * - other read failures (EACCES/EISDIR/IO) = fail closed as well — never
 *   silently fall back to defaults, or a single I/O error would disable a
 *   user's `denies`.
 */

import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PERMISSIONS } from '../plugin-spec/registry.ts'
import type { PermissionRule } from '../plugin-spec/types.ts'

export const GRANTS_FILE = join(homedir(), '.dsh-tui', 'extension-grants.json')

export interface GrantPolicy {
  grants: Record<string, PermissionRule[]>
  denies: Record<string, PermissionRule[]>
}

const EMPTY_POLICY: GrantPolicy = { grants: {}, denies: {} }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRule(value: unknown, path: string): PermissionRule | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.name !== 'string' || value.name.trim() === '') return undefined
  const rule: PermissionRule = { name: value.name }
  if (typeof value.scope === 'string') rule.scope = value.scope
  if (typeof value.activationId === 'string') rule.activationId = value.activationId
  return rule
}

function parsePolicy(input: unknown): GrantPolicy | undefined {
  if (!isRecord(input)) return undefined
  const grants: GrantPolicy['grants'] = {}
  const denies: GrantPolicy['denies'] = {}
  for (const [section, target] of [['grants', grants], ['denies', denies]] as const) {
    const raw = input[section]
    if (raw === undefined) continue
    if (!isRecord(raw)) return undefined
    for (const [componentId, rules] of Object.entries(raw)) {
      if (!Array.isArray(rules)) return undefined
      const parsed: PermissionRule[] = []
      for (let index = 0; index < rules.length; index++) {
        const rule = parseRule(rules[index], `${section}.${componentId}[${index}]`)
        if (rule === undefined) return undefined
        if (DEFAULT_PERMISSIONS.get(rule.name) === undefined) return undefined
        parsed.push(rule)
      }
      target[componentId] = parsed
    }
  }
  return { grants, denies }
}

export interface GrantCheck {
  permission: string
  granted: boolean
  explicit: boolean
}

export class GrantStore {
  private policy: GrantPolicy = EMPTY_POLICY
  private failedClosed = false
  private lastMtimeMs = 0
  private readonly watchers = new Set<() => void>()

  constructor(readonly file: string = GRANTS_FILE) {}

  /** Returns true when the file is currently unreadable/invalid (fail closed). */
  get isFailedClosed(): boolean {
    return this.failedClosed
  }

  /** Force a synchronous reload. */
  async refresh(): Promise<void> {
    let mtimeMs: number
    try {
      mtimeMs = (await stat(this.file)).mtimeMs
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        if (this.policy !== EMPTY_POLICY || this.failedClosed) {
          this.policy = EMPTY_POLICY
          this.failedClosed = false
          this.notify()
        }
        return
      }
      // EACCES/EISDIR/IO: fail closed, never silently reset to defaults.
      if (!this.failedClosed) {
        this.failedClosed = true
        this.policy = EMPTY_POLICY
        this.notify()
      }
      return
    }
    if (mtimeMs === this.lastMtimeMs && this.policy !== EMPTY_POLICY) return
    this.lastMtimeMs = mtimeMs
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = parsePolicy(JSON.parse(raw))
      if (parsed === undefined) {
        if (!this.failedClosed) {
          this.failedClosed = true
          this.policy = EMPTY_POLICY
          this.notify()
        }
        return
      }
      this.policy = parsed
      this.failedClosed = false
      this.notify()
    } catch {
      if (!this.failedClosed) {
        this.failedClosed = true
        this.policy = EMPTY_POLICY
        this.notify()
      }
    }
  }

  /** Evaluate one permission for one component. */
  check(componentId: string, permission: string, scope?: string): GrantCheck {
    const definition = DEFAULT_PERMISSIONS.get(permission)
    if (definition === undefined) return { permission, granted: false, explicit: false }
    if (this.failedClosed) return { permission, granted: false, explicit: false }

    const denyRules = this.policy.denies[componentId] ?? []
    const deny = denyRules.find(rule => rule.name === permission && (scope === undefined || rule.scope === undefined || rule.scope === scope))
    if (deny !== undefined) return { permission, granted: false, explicit: true }

    const grantRules = this.policy.grants[componentId] ?? []
    const grant = grantRules.find(rule => rule.name === permission && (scope === undefined || rule.scope === undefined || rule.scope === scope))
    if (grant !== undefined) return { permission, granted: true, explicit: true }

    return { permission, granted: definition.default === 'allow', explicit: false }
  }

  /** All permissions that currently evaluate to allow for a component. */
  grantedPermissions(componentId: string): Set<string> {
    const granted = new Set<string>()
    for (const permission of DEFAULT_PERMISSIONS.keys()) {
      if (this.check(componentId, permission).granted) granted.add(permission)
    }
    return granted
  }

  /** Watch the backing file; `listener` fires after every policy change. */
  watch(listener: () => void): () => void {
    this.watchers.add(listener)
    const timer = setInterval(() => {
      void this.refresh().catch(() => undefined)
    }, 2500)
    return () => {
      clearInterval(timer)
      this.watchers.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.watchers) {
      try {
        listener()
      } catch {
        // Policy-change listeners are best effort.
      }
    }
  }

  /** Diagnostic snapshot (for `/plugins`). */
  snapshot(): GrantPolicy & { failedClosed: boolean } {
    return {
      grants: structuredClone(this.policy.grants),
      denies: structuredClone(this.policy.denies),
      failedClosed: this.failedClosed,
    }
  }
}

export function createActivationId(): string {
  return randomUUID()
}
