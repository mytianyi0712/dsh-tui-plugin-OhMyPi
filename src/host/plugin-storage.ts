/**
 * Plugin private storage (C-040 / storage.dsh LocalStorage).
 *
 * Backend: `~/.dsh-tui/plugin-storage/<namespace>.json` (atomic write, in-
 * process serial chain per namespace). 256 keys / 256 KiB quota. Values must
 * be exact JSON values — inputs that JSON.stringify would silently deform
 * (undefined, NaN/±Infinity, functions, symbols, BigInt, class instances,
 * sparse arrays, cycles) are rejected with INVALID_VALUE. Keys are plain data
 * even when they collide with Object.prototype names.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '../dsh-host/index.ts'
import { hostRuntime } from './runtime.ts'

function componentIdOf(pluginCtx: Context): string {
  const name = (pluginCtx as Context & { name?: string }).name
  return typeof name === 'string' && name !== '' ? name : 'undeclared'
}

export const PLUGIN_STORAGE_ROOT = join(homedir(), '.dsh-tui', 'plugin-storage')

export const STORAGE_ERRORS = {
  PERMISSION_NOT_GRANTED: 'PERMISSION_NOT_GRANTED',
  INVALID_KEY: 'INVALID_KEY',
  INVALID_VALUE: 'INVALID_VALUE',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
} as const

export type StorageErrorCode = (typeof STORAGE_ERRORS)[keyof typeof STORAGE_ERRORS]

export class StorageContractError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message)
    this.name = 'StorageContractError'
  }
}

export interface StorageHandle {
  get(params: { key: string }): Promise<{ value: unknown }>
  set(params: { key: string; value: unknown }): Promise<{ stored: true }>
  delete(params: { key: string }): Promise<{ deleted: boolean }>
  close(): void
}

const MAX_KEYS = 256
const MAX_BYTES = 256 * 1024

function isExactJsonValue(value: unknown): boolean {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return false
  if (Array.isArray(value)) {
    // Sparse arrays are not exact JSON values.
    if (value.length !== Object.keys(value).filter(key => /^\d+$/.test(key)).length) return false
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) return false
      if (!isExactJsonValue(value[index])) return false
    }
    return true
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    for (const key of Object.keys(value)) {
      if (!isExactJsonValue((value as Record<string, unknown>)[key])) return false
    }
    return true
  }
  return false
}

function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > 128) {
    throw new StorageContractError(STORAGE_ERRORS.INVALID_KEY, 'key must be a non-empty string of at most 128 bytes')
  }
}

function assertValidValue(value: unknown): void {
  if (!isExactJsonValue(value)) {
    throw new StorageContractError(STORAGE_ERRORS.INVALID_VALUE, 'value must be an exact JSON value (no undefined/NaN/Infinity/function/symbol/BigInt/instance/sparse array/cycle)')
  }
}

export class PluginStorageService {
  private readonly handles = new Map<string, PluginStorageNamespace>()

  open(pluginCtx: Context): StorageHandle {
    const namespace = componentIdOf(pluginCtx)
    if (namespace === 'undeclared' || !/^[a-z][a-z0-9_-]*$/.test(namespace)) {
      throw new StorageContractError(STORAGE_ERRORS.INVALID_KEY, 'plugin storage owner identity is invalid; open(ctx) requires an admitted plugin context')
    }
    let handle = this.handles.get(namespace)
    if (handle === undefined) {
      handle = new PluginStorageNamespace(namespace)
      this.handles.set(namespace, handle)
    }
    return handle.wrap(namespace)
  }

  /** Diagnostic: namespaces with a live handle. */
  activeNamespaces(): string[] {
    return [...this.handles.keys()]
  }
}

class PluginStorageNamespace {
  private store: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  private loaded = false
  private chain: Promise<void> = Promise.resolve()
  private openHandles = 0

  constructor(readonly namespace: string) {}

  get file(): string {
    return join(PLUGIN_STORAGE_ROOT, `${this.namespace}.json`)
  }

  wrap(componentId: string): StorageHandle {
    this.openHandles++
    let closed = false
    const guard = <T>(operation: () => Promise<T>): Promise<T> => {
      if (closed) return Promise.reject(new StorageContractError(STORAGE_ERRORS.STORAGE_UNAVAILABLE, 'storage handle is closed'))
      return operation()
    }
    const requireGrant = (permission: 'storage.local.read' | 'storage.local.write'): void => {
      if (!hostRuntime.grants.check(componentId, permission).granted) {
        throw new StorageContractError(STORAGE_ERRORS.PERMISSION_NOT_GRANTED, `${permission} is not granted for ${componentId}`)
      }
    }
    return {
      get: params => guard(() => this.enqueue(async () => {
        requireGrant('storage.local.read')
        await this.load()
        assertValidKey(params.key)
        return { value: structuredClone(this.store[params.key] ?? null) }
      })),
      set: params => guard(() => this.enqueue(async () => {
        requireGrant('storage.local.write')
        await this.load()
        assertValidKey(params.key)
        assertValidValue(params.value)
        const next = Object.create(null) as Record<string, unknown>
        for (const [key, value] of Object.entries(this.store)) next[key] = value
        next[params.key] = structuredClone(params.value)
        await this.persist(next)
        return { stored: true as const }
      })),
      delete: params => guard(() => this.enqueue(async () => {
        requireGrant('storage.local.write')
        await this.load()
        assertValidKey(params.key)
        if (!(params.key in this.store)) return { deleted: false }
        const next = Object.create(null) as Record<string, unknown>
        for (const [key, value] of Object.entries(this.store)) {
          if (key !== params.key) next[key] = value
        }
        await this.persist(next)
        return { deleted: true }
      })),
      close: () => {
        if (closed) return
        closed = true
        this.openHandles--
        if (this.openHandles <= 0) this.openHandles = 0
      },
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('storage root must be an object')
      }
      const next = Object.create(null) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        next[key] = value
      }
      this.store = next
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.store = Object.create(null) as Record<string, unknown>
      } else {
        throw new StorageContractError(STORAGE_ERRORS.STORAGE_UNAVAILABLE, 'plugin storage file is corrupt or unreadable; it was not modified')
      }
    }
    this.loaded = true
  }

  private async persist(next: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(next)
    if (entries.length > MAX_KEYS) {
      throw new StorageContractError(STORAGE_ERRORS.QUOTA_EXCEEDED, `plugin storage quota exceeded (${MAX_KEYS} keys)`)
    }
    const payload = JSON.stringify(next)
    if (Buffer.byteLength(payload, 'utf8') > MAX_BYTES) {
      throw new StorageContractError(STORAGE_ERRORS.QUOTA_EXCEEDED, 'plugin storage quota exceeded (256 KiB)')
    }
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, payload, 'utf8')
    try {
      await rename(temp, this.file)
    } catch (error) {
      // Atomic rename is not available on some filesystems; fall back to write.
      await writeFile(this.file, payload, 'utf8')
    }
    this.store = next
    this.loaded = true
  }
}

export const name = 'tui-plugin-storage'

export function apply(ctx: Context): void {
  const service = new PluginStorageService()
  ctx.provide('tuiPluginStorage', service)
  ctx.effect(() => () => {
    // Handles are plugin-owned; the service itself has nothing to flush.
  })
}
