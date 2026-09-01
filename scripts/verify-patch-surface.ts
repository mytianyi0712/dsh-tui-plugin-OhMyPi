/**
 * Patch-surface gate.
 *
 * Snapshot the structural surface of `cordis.patch.yml` (top-level override
 * ids and the ids inserted by the bundle). Upstream DSH releases change the
 * base row set; CI fails when the patch surface drifts so the diff is
 * reviewed before it reaches users.
 *
 * Usage:
 *   node scripts/verify-patch-surface.ts            # verify against snapshot
 *   node scripts/verify-patch-surface.ts --snapshot # regenerate snapshot
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const packageRoot = join(import.meta.dirname, '..')
const PATCH_FILE = join(packageRoot, 'cordis.patch.yml')
const SNAPSHOT_FILE = join(packageRoot, 'patch-surface.snapshot.json')

interface SnapshotEntry {
  id: string
  keys: string[]
}

interface PatchSurface {
  overrides: SnapshotEntry[]
  inserts: SnapshotEntry[]
}

async function parsePatchSurface(): Promise<PatchSurface> {
  const lines = (await readFile(PATCH_FILE, 'utf8')).split(/\r?\n/)
  const overrides: SnapshotEntry[] = []
  const inserts: SnapshotEntry[] = []
  let mode: 'top' | 'override' | 'insert' = 'top'

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ')
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const trimmed = line.trim()

    if (trimmed === '- insert:') {
      mode = 'insert'
      continue
    }
    if (trimmed.startsWith('- id:')) {
      const id = trimmed.slice('- id:'.length).trim().replace(/^['"]|['"]$/g, '')
      if (indent === 0) {
        mode = 'override'
        overrides.push({ id, keys: [] })
      } else {
        mode = 'insert'
        inserts.push({ id, keys: [] })
      }
      continue
    }

    const keyMatch = /^([A-Za-z0-9_-]+):/.exec(trimmed)
    if (keyMatch !== null) {
      const key = keyMatch[1] ?? ''
      if (mode === 'override' && overrides.length > 0) {
        const entry = overrides[overrides.length - 1]
        if (entry !== undefined && !entry.keys.includes(key)) entry.keys.push(key)
      } else if (mode === 'insert' && inserts.length > 0) {
        const entry = inserts[inserts.length - 1]
        if (entry !== undefined && !entry.keys.includes(key)) entry.keys.push(key)
      }
    }
  }

  return { overrides, inserts }
}

function equal(left: PatchSurface, right: PatchSurface): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const current = await parsePatchSurface()

if (process.argv.includes('--snapshot')) {
  await writeFile(SNAPSHOT_FILE, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`patch-surface.snapshot.json regenerated (${current.overrides.length} overrides, ${current.inserts.length} inserts)`)
} else {
  let snapshot: PatchSurface
  try {
    snapshot = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8')) as PatchSurface
  } catch {
    console.error('verify:patch-surface failed — snapshot missing or unreadable. Run: node scripts/verify-patch-surface.ts --snapshot')
    process.exit(1)
  }
  if (!equal(current, snapshot)) {
    console.error('verify:patch-surface failed — cordis.patch.yml surface drifted from patch-surface.snapshot.json')
    console.error('Review the diff, then run: node scripts/verify-patch-surface.ts --snapshot')
    console.error(`current: ${current.overrides.length} overrides, ${current.inserts.length} inserts`)
    console.error(`snapshot: ${snapshot.overrides.length} overrides, ${snapshot.inserts.length} inserts`)
    process.exit(1)
  }
  console.log(`verify:patch-surface ok (${current.overrides.length} overrides, ${current.inserts.length} inserts)`)
}
