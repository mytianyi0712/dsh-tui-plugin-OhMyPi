import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * WeChat bridge core unit tests. State modules read `DSH_WECHAT_ILINK_STATE`
 * at import time, so the env var is set before any dynamic import below.
 */

const stateDir = mkdtempSync(join(tmpdir(), 'dsh-wechat-test-'))
process.env.DSH_WECHAT_ILINK_STATE = stateDir

after(() => {
  rmSync(stateDir, { recursive: true, force: true })
})

describe('wechat chunkText', () => {
  it('keeps short text intact', async () => {
    const { chunkText } = await import('../src/wechat/core/send.ts')
    assert.deepEqual(chunkText('hello'), ['hello'])
  })

  it('splits long text at sentence boundaries and respects the limit', async () => {
    const { chunkText, TEXT_CHUNK_LIMIT } = await import('../src/wechat/core/send.ts')
    const sentence = 'a'.repeat(50)
    const text = `${sentence}。\n${sentence}！\n${sentence}`
    for (const chunk of chunkText(text, 60)) {
      assert.ok(chunk.length <= 60, `chunk too long: ${chunk.length}`)
    }
    assert.ok(chunkText(text, 60).length >= 3)
    assert.ok(TEXT_CHUNK_LIMIT > 0)
  })
})

describe('wechat @dsh command parsing', () => {
  it('dispatches @dsh commands without the local command registry and ignores normal messages', async () => {
    const { handleDshMessage } = await import('../src/wechat/dsh/commands.ts')
    const { setActiveAgent } = await import('../src/wechat/dsh/session.ts')

    const localExecutions: string[] = []
    const agent = {
      id: 'agent-1',
      options: { provider: 'p', model: 'm' },
      session: { id: 's1', header: { cwd: '/' }, events: [], requestContext: () => undefined },
    } as never
    setActiveAgent(agent)

    const ctx = {
      commands: {
        execute: async (_agent: unknown, line: string) => {
          localExecutions.push(line)
          return { result: { text: 'local' } }
        },
      },
      get: () => undefined,
    } as never
    const account = { id: 'acct-1', token: 't', baseUrl: 'http://example.invalid' } as never

    // @dsh 命令不应再通过本地命令注册表执行（发送失败被 safeSend 吞掉）。
    assert.equal(await handleDshMessage(ctx, account, 'user-1', '@dsh status'), true)
    assert.deepEqual(localExecutions, [])

    assert.equal(await handleDshMessage(ctx, account, 'user-1', '@dsh help think'), true)
    assert.deepEqual(localExecutions, [])

    assert.equal(await handleDshMessage(ctx, account, 'user-1', '普通消息'), false)
    assert.deepEqual(localExecutions, [])

    setActiveAgent(undefined)
  })
})

describe('wechat notify switch persistence', () => {
  it('persists notify toggles through the runtime config', async () => {
    const { getConfig, setConfig, reloadConfig } = await import('../src/wechat/core/runtime.ts')
    setConfig({ ...getConfig(), notify: true })
    assert.equal(getConfig().notify, true)
    assert.equal(reloadConfig().notify, true)

    setConfig({ ...getConfig(), notify: false })
    assert.equal(getConfig().notify, false)
    assert.equal(reloadConfig().notify, false)
  })
})
