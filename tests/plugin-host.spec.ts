import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PluginHost } from '../src/host/plugin-host.ts'
import { hostRuntime } from '../src/host/runtime.ts'

const noContractManifest = {
  $schema: 'https://dsh.community/schemas/dsh-plugin-0.15.json',
  manifestVersion: '0.15',
  id: 'test-admitted-plugin',
  name: 'Test Admitted Plugin',
  version: '1.0.0',
  facets: { host: { entry: './lib/index.js', apiVersion: 'v1alpha1' } },
}

describe('plugin host admission', () => {
  it('admits a no-contract manifest and records identity', () => {
    const host = new PluginHost()
    const result = host.admit({ name: 'test-admitted-plugin' } as never, noContractManifest)
    assert.equal(result.ok, true)
    assert.equal(result.status, 'compatible')
    assert.equal(hostRuntime.activationInstanceOf('test-admitted-plugin'), result.activationInstance)
    assert.equal(hostRuntime.manifestOf('test-admitted-plugin'), result.admission.manifest)
  })
})
