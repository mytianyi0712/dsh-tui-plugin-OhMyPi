import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drainBootNotices } from '../src/boot-notices.ts'
import { importStdAdapter, importStdProfileLoader, STD_ADAPTER_PACKAGE } from '../src/dsh-adapter/std-link.ts'
import { apply as applyStdAdapter } from '../src/dsh-adapter/std-adapter.ts'
import { apply as applyProfileLoader } from '../src/dsh-adapter/std-profile-loader.ts'

describe('std adapter dynamic link', () => {
  it('exports the public adapter package id', () => {
    assert.equal(STD_ADAPTER_PACKAGE, '@dsh-std/adapter-dsh')
  })

  it('returns undefined when the adapter is not installed', async () => {
    const adapter = await importStdAdapter()
    const loader = await importStdProfileLoader()
    if (adapter !== undefined) {
      assert.equal(typeof adapter.apply, 'function')
    } else {
      assert.equal(adapter, undefined)
      assert.equal(loader, undefined)
    }
  })

  it('std-adapter apply degrades when the adapter is missing or fails', async () => {
    const ctx = { get() { return undefined } }
    await applyStdAdapter(ctx as never)
    await applyProfileLoader(ctx as never)
    drainBootNotices()
  })
})
