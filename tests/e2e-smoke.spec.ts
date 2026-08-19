import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Minimal end-to-end smoke test for the real `omdsh` launcher:
 *
 *   1. bootstrap the tui profile into a fresh DSH_HOME
 *   2. start `dsh --profile tui` inside a pseudo-tty
 *   3. type `/help` and wait for the rendered help card
 *   4. send Ctrl+C twice to exit
 *
 * The test only runs on Linux where `script` can allocate a pty and `dsh` is
 * available (CI installs it). Windows/macOS keep the fast unit-suite path.
 */

function dshAvailable(): boolean {
  if (process.env.DSH_E2E === '1') return true
  const probe = spawnSync('dsh', ['--version'], { stdio: 'ignore' })
  return probe.status === 0
}

const smokeIt = process.platform === 'linux' && dshAvailable() ? it : it.skip

async function collectUntil(
  child: import('node:child_process').ChildProcessWithoutNullStreams,
  predicate: (text: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  let buffer = ''
  const deadline = Date.now() + timeoutMs
  return await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const text = buffer
      if (predicate(text)) {
        clearInterval(timer)
        resolve(text)
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error(`Timed out waiting for TUI output.\n${text}`))
      }
    }, 250)
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
    })
  })
}

describe('e2e smoke', () => {
  smokeIt('bootstraps the tui profile, renders /help, and exits', async () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-e2e-'))
    const session = `e2e-${Date.now()}`
    const command = `node scripts/omdsh.js --session ${session}`
    const child = spawn('script', ['-qec', command, '/dev/null'], {
      cwd: process.cwd(),
      env: { ...process.env, DSH_HOME: dshHome, DSH_DEBUG: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      // omdsh prints bootstrap messages before the TUI welcome screen.
      const ready = await collectUntil(
        child,
        text => text.includes('/help') || text.includes('欢迎回来') || text.includes('Welcome back'),
        30_000,
      )
      assert.match(ready, /\/help|欢迎回来|Welcome back/)

      child.stdin.write('/help\n')
      const help = await collectUntil(
        child,
        text => text.includes('键盘快捷键') || text.includes('Shortcuts') || text.includes('/palette'),
        15_000,
      )
      assert.match(help, /键盘快捷键|Shortcuts|\/palette/)

      // First Ctrl+C interrupts / exits an idle turn; a second one quits.
      child.stdin.write('\x03')
      await new Promise(resolve => setTimeout(resolve, 400))
      child.stdin.write('\x03')

      const exitCode: number | null = await new Promise(resolve => {
        const timer = setTimeout(() => {
          child.kill('SIGTERM')
          resolve(null)
        }, 10_000)
        child.on('exit', (code) => {
          clearTimeout(timer)
          resolve(code)
        })
      })
      assert.ok(exitCode === null || exitCode === 0 || exitCode === 130, `exit code ${exitCode}`)
    } finally {
      child.kill('SIGTERM')
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
})
