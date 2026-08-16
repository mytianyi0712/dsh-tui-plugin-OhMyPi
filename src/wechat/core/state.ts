// Persistent state: accounts, sync cursors, context tokens, allowlist, config.
// Root: ~/.dsh/wechat-ilink (override with DSH_WECHAT_ILINK_STATE)
// 【职责】账号/配置/游标/白名单的持久化（磁盘 IO 集中地）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Account {
  id: string
  token: string
  baseUrl: string
  userId?: string
  savedAt: string
}

export interface BridgeConfig {
  policy: 'pairing' | 'allowlist' | 'open'
  /**
   * Auto-push: after a WeChat-triggered turn completes, call the model once
   * more to summarize and push the result; every `interval` model rounds during
   * a WeChat turn, inject a progress-report instruction.
   */
  progress: { enabled: boolean; interval: number }
  /**
   * notify=true: also push progress/results for terminal-initiated turns
   * (not just WeChat-initiated ones). Default false.
   */
  notify: boolean
}

export const DEFAULT_CONFIG: BridgeConfig = {
  policy: 'pairing',
  progress: { enabled: true, interval: 25 },
  notify: false,
}

function resolveStateDir(): string {
  return (
    process.env.DSH_WECHAT_ILINK_STATE?.trim() ||
    path.join(os.homedir(), '.dsh', 'wechat-ilink')
  )
}

export const stateDir = resolveStateDir()

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8')
  } catch {
    // best-effort persistence
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function accountsPath(): string {
  return path.join(stateDir, 'accounts.json')
}

export function loadAccounts(): Account[] {
  const list = readJson<Account[]>(accountsPath(), [])
  return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string') : []
}

export function saveAccount(account: Account): void {
  const list = loadAccounts().filter((a) => a.id !== account.id)
  list.push(account)
  writeJson(accountsPath(), list)
}

export function removeAccount(id: string): void {
  writeJson(accountsPath(), loadAccounts().filter((a) => a.id !== id))
}

export function loadAccount(id: string): Account | undefined {
  return loadAccounts().find((a) => a.id === id)
}

// ---------------------------------------------------------------------------
// Per-account files
// ---------------------------------------------------------------------------

function accountFile(id: string, name: string): string {
  return path.join(stateDir, 'accounts', `${id}.${name}`)
}

export function loadSyncBuf(id: string): string {
  return readJson<string>(accountFile(id, 'sync.json'), '')
}

export function saveSyncBuf(id: string, buf: string): void {
  writeJson(accountFile(id, 'sync.json'), buf)
}

export function loadAllowlist(id: string): string[] {
  const data = readJson<{ version?: number; allowFrom?: string[] }>(
    accountFile(id, 'allow.json'),
    {},
  )
  return Array.isArray(data.allowFrom)
    ? data.allowFrom.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : []
}

export function saveAllowlist(id: string, list: string[]): void {
  writeJson(accountFile(id, 'allow.json'), { version: 1, allowFrom: list })
}

export function loadContextTokens(id: string): Record<string, string> {
  const data = readJson<Record<string, string>>(accountFile(id, 'context-tokens.json'), {})
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

export function saveContextTokens(id: string, tokens: Record<string, string>): void {
  writeJson(accountFile(id, 'context-tokens.json'), tokens)
}

export function removeAccountFiles(id: string): void {
  for (const name of ['sync.json', 'allow.json', 'context-tokens.json']) {
    try {
      fs.unlinkSync(accountFile(id, name))
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function configPath(): string {
  return path.join(stateDir, 'config.json')
}

export function loadConfig(): BridgeConfig {
  const cfg = readJson<Partial<BridgeConfig>>(configPath(), {})
  return {
    policy: cfg.policy ?? DEFAULT_CONFIG.policy,
    progress: { ...DEFAULT_CONFIG.progress, ...(cfg.progress ?? {}) },
    notify: cfg.notify ?? DEFAULT_CONFIG.notify,
  }
}

export function saveConfig(cfg: BridgeConfig): void {
  writeJson(configPath(), cfg)
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function writeLoginQrFile(text: string): string {
  const file = path.join(stateDir, 'login-qr.txt')
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(file, text, 'utf-8')
  } catch {
    // ignore
  }
  return file
}
