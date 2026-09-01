import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHostDescriptor,
  ManifestValidationError,
  negotiate,
  parseManifest,
  profileDigest,
  validateHostDescriptor,
} from '../src/plugin-spec/index.ts'

const validManifest = {
  $schema: 'https://dsh.community/schemas/dsh-plugin-0.15.json',
  manifestVersion: '0.15',
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  facets: { host: { entry: './lib/index.js', apiVersion: 'v1alpha1' } },
  requires: {
    contracts: [
      { apiVersion: 'tui.dsh/v1alpha1', kind: 'DecisionEvents', optional: true, fallback: 'decision events unavailable' },
      { apiVersion: 'storage.dsh/v1alpha1', kind: 'LocalStorage', optional: true, fallback: 'storage unavailable' },
    ],
  },
}

describe('plugin manifest parser', () => {
  it('accepts a v0.15 host-facet manifest', () => {
    const manifest = parseManifest(validManifest)
    assert.equal(manifest.id, 'test-plugin')
  })

  it('rejects client facets', () => {
    try {
      parseManifest({
        ...validManifest,
        facets: { host: { entry: './lib/index.js', apiVersion: 'v1alpha1' }, client: {} },
      })
      assert.fail('expected ManifestValidationError')
    } catch (error) {
      assert.ok(error instanceof ManifestValidationError)
      assert.match(error.message, /client|additional|unknown|exact/i)
    }
  })

  it('rejects optional requirements without fallback', () => {
    try {
      parseManifest({
        ...validManifest,
        requires: { contracts: [{ apiVersion: 'commands.dsh/v1alpha1', kind: 'Command', optional: true }] },
      })
      assert.fail('expected ManifestValidationError')
    } catch (error) {
      const details = (error as Error & { details?: string[] }).details ?? []
      assert.match(`${error instanceof Error ? error.message : ''} ${details.join(' ')}`, /fallback/)
    }
  })
})

describe('negotiation', () => {
  it('reports unknown for coordinates outside the registry', () => {
    const result = negotiate(parseManifest({
      ...validManifest,
      requires: { contracts: [{ apiVersion: 'example.dsh/v1alpha1', kind: 'Mystery' }] },
    }))
    assert.equal(result.status, 'unknown')
  })

  it('reports compatible_degraded when optional contracts lack grants', () => {
    const manifest = parseManifest(validManifest)
    const result = negotiate(manifest)
    assert.equal(result.status, 'compatible_degraded')
  })

  it('reports waiting_authorization when a required contract lacks grants', () => {
    const manifest = parseManifest({
      ...validManifest,
      requires: {
        contracts: [
          { apiVersion: 'storage.dsh/v1alpha1', kind: 'LocalStorage' },
        ],
      },
    })
    const result = negotiate(manifest)
    assert.equal(result.status, 'waiting_authorization')
  })

  it('reports compatible when all required grants are present', () => {
    const manifest = parseManifest(validManifest)
    const result = negotiate(manifest, {
      grantedPermissions: new Set(['storage.local.read', 'storage.local.write', 'session.input.intercept', 'session.rewind.intercept', 'session.switch.intercept', 'session.compact.intercept']),
    })
    assert.equal(result.status, 'compatible')
  })
})

describe('host descriptor', () => {
  it('builds a stable descriptor with private digest', () => {
    const descriptor = buildHostDescriptor({
      hostId: 'dsh-omp-tui',
      hostVersion: '0.0.0',
      generationId: 'test-generation',
      headless: true,
      commandsMounted: false,
    })
    assert.equal(descriptor.hostId, 'dsh-omp-tui')
    assert.equal(descriptor.trustLevel, 'trusted-in-process')
    assert.ok(!descriptor.contracts.some(contract => contract.coordinate === 'commands.dsh/v1alpha1#Command'))
    assert.deepEqual(validateHostDescriptor(descriptor), [])
    assert.ok(profileDigest().length === 64)
  })

  it('advertises commands when mounted', () => {
    const descriptor = buildHostDescriptor({
      hostId: 'dsh-omp-tui',
      hostVersion: '0.0.0',
      generationId: 'test-generation',
      headless: true,
      commandsMounted: true,
    })
    assert.ok(descriptor.contracts.some(contract => contract.coordinate === 'commands.dsh/v1alpha1#Command'))
  })
})
