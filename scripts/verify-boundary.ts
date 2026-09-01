/**
 * Boundary gate.
 *
 * - Community std adapter (`@dsh-std/adapter-dsh`) may only be imported inside
 *   `src/dsh-adapter/` — that tree is the public adapter surface.
 * - Official `@deepseek-ai/*` domain packages may only be imported inside
 *   `src/dsh-host/` — that tree is the host rendering shell, not an adapter.
 * - Protocol packages (`@dsh-std/manifest`, `@dsh-std/core`, …) may be used
 *   anywhere (plugin-spec, host seams).
 *
 * Run as `node scripts/verify-boundary.ts`.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const SRC_DIR = join(import.meta.dirname, '..', 'src')
const ADAPTER_DIR = join(SRC_DIR, 'dsh-adapter')
const HOST_DIR = join(SRC_DIR, 'dsh-host')
const UPSTREAM_RE = /from ['"]@deepseek-ai\//
const STD_ADAPTER_RE = /from ['"]@dsh-std\/adapter-dsh/

interface Violation {
  file: string
  line: number
  text: string
}

async function walk(dir: string, violations: Violation[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, violations)
    } else if (entry.name.endsWith('.ts')) {
      await scan(full, violations)
    }
  }
}

async function scan(file: string, violations: Violation[]): Promise<void> {
  const insideAdapter = file === ADAPTER_DIR || file.startsWith(ADAPTER_DIR + sep)
  const insideHost = file === HOST_DIR || file.startsWith(HOST_DIR + sep)
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const text = line.trim()
    if (UPSTREAM_RE.test(line) && !insideAdapter && !insideHost) {
      violations.push({ file: relative(SRC_DIR, file), line: index + 1, text })
    }
    if (STD_ADAPTER_RE.test(line) && !insideAdapter) {
      violations.push({ file: relative(SRC_DIR, file), line: index + 1, text })
    }
  }
}

const violations: Violation[] = []
for (const entry of await readdir(SRC_DIR, { withFileTypes: true })) {
  const full = join(SRC_DIR, entry.name)
  if (entry.isDirectory()) {
    await walk(full, violations)
  } else if (entry.name.endsWith('.ts')) {
    await scan(full, violations)
  }
}

if (violations.length > 0) {
  console.error('verify:boundary failed:')
  console.error('  @deepseek-ai/* only in src/dsh-host/; @dsh-std/adapter-dsh only in src/dsh-adapter/')
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.text}`)
  }
  process.exit(1)
}

console.log('verify:boundary ok (public adapter in src/dsh-adapter, host shell in src/dsh-host)')
