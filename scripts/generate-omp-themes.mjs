#!/usr/bin/env node
/**
 * Regenerate src/theme-data.ts from the OMP executable bundled on this machine.
 *
 * OMP ships its theme defaults inside the single-file `omp.exe`/`omp` binary as
 * small JavaScript object literals. This script finds those literals, evaluates
 * them, resolves each theme's `colors` entries through its `vars`, and writes a
 * compact TypeScript data module with the exact RGB roles this TUI consumes.
 *
 * Usage:
 *   node scripts/generate-omp-themes.mjs
 *
 * The executable path is read from $OMP_EXE. When unset, common locations are
 * probed:
 *   - Windows: %LOCALAPPDATA%\omp\omp.exe
 *   - macOS/Linux: $HOME/.local/bin/omp, $HOME/.cache/omp/omp, /usr/local/bin/omp
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The color roles in src/theme.ts, mapped from OMP theme-schema names. */
const ROLE_MAP = {
  text: 'text',
  muted: 'muted',
  dim: 'dim',
  accent: 'accent',
  code: 'mdCode',
  success: 'success',
  warning: 'warning',
  error: 'error',
  border: 'border',
  borderMuted: 'borderMuted',
  toolTitle: 'toolTitle',
  toolOutput: 'toolOutput',
  path: 'statusLinePath',
  git: 'statusLineGitClean',
  model: 'statusLineModel',
  context: 'statusLineContext',
  spend: 'statusLineSpend',
  statusSep: 'statusLineSep',
  thinking: 'thinkingText',
  userMessageBg: 'userMessageBg',
  toolPendingBg: 'toolPendingBg',
  toolSuccessBg: 'toolSuccessBg',
  toolErrorBg: 'toolErrorBg',
  statusLineBg: 'statusLineBg',
}

function resolveOmpExecutable() {
  if (process.env.OMP_EXE && existsSync(process.env.OMP_EXE)) return process.env.OMP_EXE
  const candidates = []
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'omp', 'omp.exe'))
  }
  const home = homedir()
  candidates.push(
    join(home, '.local', 'bin', 'omp'),
    join(home, '.cache', 'omp', 'omp'),
    '/usr/local/bin/omp',
  )
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'Could not locate the OMP executable. Set OMP_EXE to the path of the omp binary.',
  )
}

function ansi256ToRgb(index) {
  if (index < 16) {
    const basic = [
      [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
      [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
      [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
      [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
    ]
    return basic[index]
  }
  if (index < 232) {
    const value = index - 16
    const levels = [0, 95, 135, 175, 215, 255]
    const r = Math.floor(value / 36)
    const g = Math.floor((value % 36) / 6)
    const b = value % 6
    return [levels[r], levels[g], levels[b]]
  }
  const gray = 8 + (index - 232) * 10
  return [gray, gray, gray]
}

function parseHex(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) throw new Error(`Unsupported hex color ${hex}`)
  const value = Number.parseInt(match[1], 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function resolveValue(value, vars, colors, seen = new Set()) {
  if (typeof value === 'number') return ansi256ToRgb(value)
  if (typeof value !== 'string') throw new Error(`Unsupported color value ${JSON.stringify(value)}`)
  if (value.startsWith('#')) return parseHex(value)
  if (value === '') return [0, 0, 0] // text uses the terminal default; theme.ts skips it
  const name = value.startsWith('$') ? value.slice(1) : value
  if (name in vars || name in colors) {
    if (seen.has(name)) throw new Error(`Circular color variable ${name}`)
    const next = new Set(seen)
    next.add(name)
    const target = name in vars ? vars[name] : colors[name]
    return resolveValue(target, vars, colors, next)
  }
  throw new Error(`Unknown color variable ${value}`)
}

function extractThemes(exePath) {
  const text = readFileSync(exePath, 'utf8')
  const fileRe = /\/\/ packages\/coding-agent\/src\/modes\/theme\/defaults\/([A-Za-z0-9_.-]+)\.json/g
  const themes = []
  let match
  while ((match = fileRe.exec(text))) {
    const file = match[1]
    const start = match.index + match[0].length
    const open = text.indexOf('= {', start)
    if (open < 0) continue
    const bodyStart = text.indexOf('{', open + 1)
    if (bodyStart < 0) continue
    const endMarker = '\n  };\n});'
    const end = text.indexOf(endMarker, bodyStart)
    if (end < 0) continue
    // endMarker begins with the outer object's closing `}`; include that brace.
    const literal = text.slice(bodyStart, end + 4)
    let theme
    try {
      theme = Function('return (' + literal + ')')()
    } catch (error) {
      console.warn(`Skipping ${file}: ${error.message}`)
      continue
    }
    themes.push({ file, ...theme })
  }
  return themes
}

function schemeFor(name) {
  if (name.startsWith('dark-')) return 'dark'
  if (name.startsWith('light-')) return 'light'
  return 'neutral'
}

function labelFor(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function main() {
  const exePath = resolveOmpExecutable()
  const themes = extractThemes(exePath)
  if (themes.length === 0) throw new Error(`No OMP themes found in ${exePath}`)

  const entries = themes.map(theme => {
    const roles = {}
    for (const [role, ompKey] of Object.entries(ROLE_MAP)) {
      if (!(ompKey in theme.colors)) throw new Error(`${theme.name} is missing colors.${ompKey}`)
      const value = resolveValue(theme.colors[ompKey], theme.vars, theme.colors)
      roles[role] = value
    }
    return {
      id: theme.name,
      scheme: schemeFor(theme.name),
      label: labelFor(theme.name),
      description: `OMP theme ${theme.name}`,
      roles,
    }
  })

  const lines = []
  lines.push('/**')
  lines.push(' * Generated by scripts/generate-omp-themes.mjs — do not edit by hand.')
  lines.push(' *')
  lines.push(' * All OMP theme defaults shipped with the local OMP executable,')
  lines.push(' * resolved to the RGB color roles used by dsh-omp-tui.')
  lines.push(' */')
  lines.push('')
  lines.push('export type ThemeScheme = \'dark\' | \'light\' | \'neutral\'')
  lines.push('')
  lines.push('export type Rgb = readonly [number, number, number]')
  lines.push('')
  lines.push('export interface ThemeData {')
  lines.push('  readonly id: string')
  lines.push('  readonly scheme: ThemeScheme')
  lines.push('  readonly label: string')
  lines.push('  readonly description: string')
  lines.push('  readonly roles: Readonly<Record<string, Rgb>>')
  lines.push('}')
  lines.push('')
  lines.push('export const THEME_DATA: readonly ThemeData[] = [')
  for (const entry of entries) {
    lines.push('  {')
    lines.push(`    id: ${JSON.stringify(entry.id)},`)
    lines.push(`    scheme: ${JSON.stringify(entry.scheme)},`)
    lines.push(`    label: ${JSON.stringify(entry.label)},`)
    lines.push(`    description: ${JSON.stringify(entry.description)},`)
    lines.push('    roles: {')
    for (const [role, rgb] of Object.entries(entry.roles)) {
      lines.push(`      ${role}: [${rgb.join(', ')}],`)
    }
    lines.push('    },')
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')

  const output = lines.join('\n')
  writeFileSync(join(ROOT, 'src', 'theme-data.ts'), output)
  console.log(`Wrote ${entries.length} themes to src/theme-data.ts`)
}

main()
