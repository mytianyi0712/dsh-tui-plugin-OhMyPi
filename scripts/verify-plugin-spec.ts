/**
 * Plugin-spec gate: validates this package's `dsh-plugin.json`, builds a Host
 * Descriptor, and runs a small conformance fixture battery against the
 * upstream dsh-ecosystem-spec fixtures vendored under
 * `vendor/dsh-ecosystem-spec/conformance/fixtures`.
 *
 * Run as `node scripts/verify-plugin-spec.ts`.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  buildHostDescriptor,
  checkHostDescriptorShape,
  formatNegotiation,
  negotiate,
  parseManifest,
  validateHostDescriptor,
} from '../src/plugin-spec/index.ts'

const packageRoot = join(import.meta.dirname, '..')
const fixturesDir = join(packageRoot, 'vendor', 'dsh-ecosystem-spec', 'conformance', 'fixtures')

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixturesDir, name), 'utf8')) as unknown
}

interface FixtureExpectation {
  file: string
  parse: 'ok' | 'fail'
  status?: 'compatible' | 'compatible_degraded' | 'waiting_authorization' | 'unknown'
}

const FIXTURES: FixtureExpectation[] = [
  { file: 'valid-plugin.json', parse: 'ok', status: 'compatible_degraded' },
  { file: 'valid-tui-contributions.json', parse: 'ok', status: 'compatible' },
  { file: 'valid-private-protocol-plugin.json', parse: 'ok', status: 'waiting_authorization' },
  { file: 'waiting-authorization-plugin.json', parse: 'ok', status: 'waiting_authorization' },
  { file: 'invalid-plugin-unknown-coordinate.json', parse: 'ok', status: 'unknown' },
  { file: 'invalid-plugin-optional-no-fallback.json', parse: 'fail' },
  { file: 'invalid-plugin-client-facet.json', parse: 'fail' },
  { file: 'invalid-plugin-provides.json', parse: 'fail' },
]

async function runFixtures(): Promise<void> {
  for (const fixture of FIXTURES) {
    const source = await readFixture(fixture.file)
    try {
      const manifest = parseManifest(source)
      if (fixture.parse === 'fail') {
        throw new Error(`${fixture.file}: expected parse failure but parsed`)
      }
      if (fixture.status !== undefined) {
        const result = negotiate(manifest)
        if (result.status !== fixture.status) {
          throw new Error(`${fixture.file}: expected ${fixture.status}, got ${result.status} (${formatNegotiation(result).join('; ')})`)
        }
      }
    } catch (error) {
      if (fixture.parse === 'fail') continue
      throw error
    }
  }
  console.log(`verify:plugin-spec conformance ok (${FIXTURES.length} fixtures)`)
}

const raw = await readFile(join(packageRoot, 'dsh-plugin.json'), 'utf8')
let manifest
try {
  manifest = parseManifest(JSON.parse(raw))
} catch (error) {
  console.error('verify:plugin-spec failed — dsh-plugin.json is invalid:')
  if (error instanceof Error) {
    console.error(error.message)
    const details = (error as Error & { details?: string[] }).details
    if (details !== undefined) for (const detail of details) console.error(`  ${detail}`)
  } else {
    console.error(String(error))
  }
  process.exit(1)
}

const negotiation = negotiate(manifest)
if (negotiation.status === 'rejected' || negotiation.status === 'unknown') {
  console.error('verify:plugin-spec failed — manifest negotiation did not pass:')
  for (const line of formatNegotiation(negotiation)) console.error(`  ${line}`)
  process.exit(1)
}

const descriptor = buildHostDescriptor({
  hostId: manifest.id,
  hostVersion: manifest.version,
  generationId: randomUUID(),
  headless: true,
  commandsMounted: false,
})
const shapeErrors = checkHostDescriptorShape(descriptor)
const descriptorErrors = validateHostDescriptor(descriptor)
if (shapeErrors.length > 0 || descriptorErrors.length > 0) {
  console.error('verify:plugin-spec failed — host descriptor is invalid:')
  for (const line of [...shapeErrors, ...descriptorErrors]) console.error(`  ${line}`)
  process.exit(1)
}

await runFixtures()

console.log(`verify:plugin-spec ok (manifest ${manifest.id}@${manifest.version}, negotiation ${negotiation.status}, ${descriptor.contracts.length} contracts advertised)`)
