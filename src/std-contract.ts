/**
 * Adapter contract: the single source of truth for which community std
 * packages this host is validated against.
 *
 * DSH harness version drift is the std adapter's job (`@dsh-std/adapter-dsh`,
 * dynamically linked from the profile). Published adapter-dsh 0.1.1-rc.2 peers
 * `>=0.1.2-alpha.2 <0.1.3`, so 0.1.2-alpha.3 is in range. This file tracks the
 * protocol packages we compile against and, when present, the linked adapter.
 * Keep in sync with `package.json` dependencies / optional peerDependencies.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STD_ADAPTER_PACKAGE } from './dsh-adapter/std-link.ts'

/** Protocol packages this host compiles against. */
export const STD_PROTOCOL_PACKAGES: readonly { name: string; minimum: string }[] = [
  { name: '@dsh-std/core', minimum: '0.1.1-rc.1' },
  { name: '@dsh-std/manifest', minimum: '0.1.1-rc.2' },
  { name: '@dsh-std/command', minimum: '0.1.1-rc.1' },
  { name: '@dsh-std/storage', minimum: '0.1.1-rc.1' },
  { name: '@dsh-std/messages', minimum: '0.1.1-rc.1' },
  { name: '@dsh-std/presentation', minimum: '0.1.1-rc.1' },
]

/** Community adapter dynamically linked from the profile. Optional at build time. */
export const STD_ADAPTER_MINIMUM = '0.1.1-rc.2'

/** Peer range advertised for the dynamically-linked adapter. */
export const STD_ADAPTER_PEER_RANGE = '>=0.1.1-rc.2 <0.2.0'

/** Framework packages are validated by MAJOR only. */
export const FRAMEWORK_PACKAGES: readonly { name: string; major: number }[] = [
  { name: '@deepseek-ai/cordis', major: 4 },
  { name: '@deepseek-ai/schemastery', major: 3 },
]

/**
 * Direct harness packages this host compiles against. The host facade
 * (`src/dsh-host/`) imports these product seams directly; the std adapter only
 * absorbs drift for the Community v0.15 plugin surface. Keep in sync with
 * `package.json` optional peerDependencies.
 */
export const HARNESS_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-session-reference',
  '@deepseek-ai/dsh-session-title',
  '@deepseek-ai/dsh-session-title-llm',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-user-questions',
]

/** Versions this host has been type- and smoke-verified against. */
export const UPSTREAM_VALIDATED_VERSIONS: readonly string[] = [
  '0.1.2-alpha.2',
  '0.1.2-alpha.3',
]

export interface ContractDrift {
  package: string
  kind: 'missing' | 'std-protocol-version' | 'std-adapter-version' | 'framework-major' | 'upstream-version'
  found?: string
  expected: string
}

/** Split `1.2.3-rc.4` into comparable numeric parts across pre-release channels. */
function parseVersionParts(version: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(version)
  if (match === null) return []
  const [, major, minor, patch, channel, channelNumber] = match
  const channelRank = channel === undefined ? 3 : channel === 'rc' ? 2 : channel === 'beta' ? 1 : 0
  return [
    Number(major),
    Number(minor),
    Number(patch),
    channelRank,
    Number(channelNumber ?? 0),
  ]
}

/** Cross-family, cross-pre-release-channel comparison used by feature gates. */
export function installedMeetsVersion(found: string, expected: string): boolean {
  const foundParts = parseVersionParts(found)
  const expectedParts = parseVersionParts(expected)
  if (foundParts.length === 0 || expectedParts.length === 0) return found === expected
  const length = Math.max(foundParts.length, expectedParts.length)
  for (let index = 0; index < length; index++) {
    const left = foundParts[index] ?? 0
    const right = expectedParts[index] ?? 0
    if (left !== right) return left > right
  }
  return true
}

async function readInstalledVersion(packageRoot: string, packageName: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'node_modules', packageName, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export async function verifyContract(packageRoot: string): Promise<ContractDrift[]> {
  const drift: ContractDrift[] = []
  for (const { name, minimum } of STD_PROTOCOL_PACKAGES) {
    const found = await readInstalledVersion(packageRoot, name)
    if (found === undefined) {
      drift.push({ package: name, kind: 'missing', expected: `>= ${minimum}` })
      continue
    }
    if (!installedMeetsVersion(found, minimum)) {
      drift.push({ package: name, kind: 'std-protocol-version', found, expected: `>= ${minimum}` })
    }
  }

  const adapterVersion = await readInstalledVersion(packageRoot, STD_ADAPTER_PACKAGE)
  if (adapterVersion !== undefined && !installedMeetsVersion(adapterVersion, STD_ADAPTER_MINIMUM)) {
    drift.push({
      package: STD_ADAPTER_PACKAGE,
      kind: 'std-adapter-version',
      found: adapterVersion,
      expected: `>= ${STD_ADAPTER_MINIMUM}`,
    })
  }

  for (const { name, major } of FRAMEWORK_PACKAGES) {
    const found = await readInstalledVersion(packageRoot, name)
    if (found === undefined) {
      drift.push({ package: name, kind: 'missing', expected: `major ${major}` })
      continue
    }
    if (parseVersionParts(found)[0] !== major) {
      drift.push({ package: name, kind: 'framework-major', found, expected: `major ${major}` })
    }
  }

  for (const name of HARNESS_PACKAGES) {
    const found = await readInstalledVersion(packageRoot, name)
    if (found === undefined) continue // optional peers may be absent at runtime
    if (!UPSTREAM_VALIDATED_VERSIONS.includes(found)) {
      drift.push({ package: name, kind: 'upstream-version', found, expected: UPSTREAM_VALIDATED_VERSIONS.join(' | ') })
    }
  }

  return drift
}

export function formatContractDrift(drift: ContractDrift[]): string[] {
  return drift.map(item => {
    const found = item.found === undefined ? 'not installed' : item.found
    return `${item.package}: ${item.kind} (found ${found}, expected ${item.expected})`
  })
}

/** Human-readable warnings for harness packages outside the validated lines. */
export async function upstreamDriftWarnings(packageRoot: string): Promise<string[]> {
  const warnings: string[] = []
  for (const name of HARNESS_PACKAGES) {
    const found = await readInstalledVersion(packageRoot, name)
    if (found !== undefined && !UPSTREAM_VALIDATED_VERSIONS.includes(found)) {
      warnings.push(`${name} ${found} is outside validated upstream line ${UPSTREAM_VALIDATED_VERSIONS.join(' | ')}`)
    }
  }
  return warnings
}

