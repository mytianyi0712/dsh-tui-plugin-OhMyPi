import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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

  it('targets 50-100 characters while balancing sentence units', async () => {
    const { chunkText, TEXT_SEGMENT_MAX, TEXT_SEGMENT_MIN } = await import('../src/wechat/core/send.ts')
    const sentence = (char: string) => `${char.repeat(26)}。`
    const text = ['甲', '乙', '丙', '丁'].map(sentence).join('')
    const chunks = chunkText(text)

    assert.deepEqual(chunks.map(chunk => chunk.length), [54, 54])
    assert.ok(chunks.every(chunk => chunk.length >= TEXT_SEGMENT_MIN && chunk.length <= TEXT_SEGMENT_MAX))
    assert.equal(chunks.join(''), text)
  })

  it('keeps fenced code and Markdown tables atomic', async () => {
    const { chunkText } = await import('../src/wechat/core/send.ts')
    const code = '```ts\n' + 'const answer = 42\n'.repeat(8) + '```\n'
    const table = '| 名称 | 值 |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n'
    const text = `说明。\n${code}结果。\n${table}结束。`
    const chunks = chunkText(text)

    assert.ok(chunks.some(chunk => chunk === code))
    assert.ok(chunks.some(chunk => chunk === table))
    assert.equal(chunks.join(''), text)
  })

  it('holds incomplete sentences and protected blocks during streaming', async () => {
    const { readyChunkText } = await import('../src/wechat/core/send.ts')
    const sentence = `${'甲'.repeat(55)}。`
    const tail = '尚未结束'
    assert.deepEqual(readyChunkText(sentence + tail), { chunks: [sentence], remainder: tail })

    const code = '```ts\nconst answer = 42\n'
    assert.deepEqual(readyChunkText(code), { chunks: [], remainder: code })
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

  it('passes an empty image batch through the @dsh compress command path', async () => {
    const { handleDshMessage } = await import('../src/wechat/dsh/commands.ts')
    const { setActiveAgent } = await import('../src/wechat/dsh/session.ts')

    const calls: Array<{ line: string; images: unknown[]; signal: AbortSignal }> = []
    const agent = {
      id: 'agent-1',
      options: { provider: 'p', model: 'm' },
      session: { id: 's1', header: { cwd: '/' }, events: [], requestContext: () => undefined },
    } as never
    setActiveAgent(agent)

    const ctx = {
      commands: {
        execute: async (_agent: unknown, line: string, images: unknown[], signal: AbortSignal) => {
          calls.push({ line, images, signal })
          return { result: { kind: 'success' as const, text: 'compacted' } }
        },
      },
      get: () => undefined,
    } as never
    const account = { id: 'acct-1', token: 't', baseUrl: 'http://example.invalid' } as never

    assert.equal(await handleDshMessage(ctx, account, 'user-1', '@dsh compress'), true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.line, '/compact')
    assert.deepEqual(calls[0]?.images, [])
    assert.ok(calls[0]?.signal instanceof AbortSignal)

    setActiveAgent(undefined)
  })

  it('switches the persistent mode without injecting a command prompt', async () => {
    const { handleDshMessage } = await import('../src/wechat/dsh/commands.ts')
    const { getWechatMode, setWechatMode } = await import('../src/wechat/core/runtime.ts')
    const account = { id: 'acct-mode', token: 't', baseUrl: 'http://127.0.0.1:1', savedAt: new Date().toISOString() } as never

    setWechatMode('work')
    try {
      assert.equal(await handleDshMessage({} as never, account, 'user-mode', '@dsh chat'), true)
      assert.equal(getWechatMode(), 'chat')

      assert.equal(await handleDshMessage({} as never, account, 'user-mode', '@dsh work'), true)
      assert.equal(getWechatMode(), 'work')

      assert.equal(await handleDshMessage({} as never, account, 'user-mode', '@dsh chat 发送这个'), true)
      assert.equal(getWechatMode(), 'work')
    } finally {
      setWechatMode('work')
    }
  })

  it('passes the active mode through ordinary inbound messages', async () => {
    const { handleInbound } = await import('../src/wechat/core/bridge.ts')
    const { getWechatMode, setWechatMode } = await import('../src/wechat/core/runtime.ts')
    const calls: Array<{ accountId: string; userId: string; text: string; mode: string }> = []
    const account = { id: 'acct-inbound', token: 't', baseUrl: 'http://127.0.0.1:1', savedAt: new Date().toISOString() } as never
    const message = {
      message_type: 1,
      from_user_id: 'user-inbound',
      item_list: [{ type: 1, text_item: { text: '普通消息' } }],
    } as never

    setWechatMode('chat')
    try {
      await handleInbound({
        policy: 'open',
        sendUserMessage: async (receivedAccount, userId, text) => {
          calls.push({ accountId: receivedAccount.id, userId, text, mode: getWechatMode() })
          return getWechatMode()
        },
        log: () => {},
      }, account, message)
      assert.deepEqual(calls, [{ accountId: 'acct-inbound', userId: 'user-inbound', text: '普通消息', mode: 'chat' }])
    } finally {
      setWechatMode('work')
    }
  })

  it('streams chat deltas without a duplicate completion message', async () => {
    const { registerProgressHooks } = await import('../src/wechat/dsh/progress.ts')
    const { saveAccount } = await import('../src/wechat/core/state.ts')
    const { clearWechatPending, consumeWechatTurn, markWechatPending } = await import('../src/wechat/core/runtime.ts')
    const { setActiveAgent } = await import('../src/wechat/dsh/session.ts')
    let sessionHook: ((session: unknown, event: unknown) => void) | undefined
    const ctx = {
      on: (event: string, hook: unknown) => {
        if (event === 'session/event') sessionHook = hook as (session: unknown, event: unknown) => void
      },
    } as never
    const delivered = Promise.withResolvers<void>()
    const texts: string[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        if (req.url?.endsWith('/sendmessage')) {
          const payload = JSON.parse(body) as { msg?: { item_list?: Array<{ text_item?: { text?: string } }> } }
          const text = payload.msg?.item_list?.[0]?.text_item?.text
          if (text) {
            texts.push(text)
            delivered.resolve()
          }
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ret":0}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    const account = {
      id: 'acct-stream',
      token: 't',
      baseUrl: `http://127.0.0.1:${address.port}`,
      savedAt: new Date().toISOString(),
    }
    saveAccount(account)
    const agent = {
      id: 'agent-stream',
      session: {
        id: 's-stream',
        events: [{
          type: 'assistant/message',
          data: { turn: 1, message: { content: [{ type: 'text', text: '完整回复' }] } },
        }],
      },
    } as never
    const streamedText = '实时内容'.repeat(14) + '。'
    const timeout = setTimeout(() => delivered.reject(new Error('timed out waiting for streamed WeChat text')), 3_000)

    setActiveAgent(agent)
    registerProgressHooks(ctx)
    try {
      markWechatPending({ mode: 'chat', accountId: account.id, userId: 'user-stream' })
      sessionHook?.(agent.session, { type: 'turn/start', data: { turn: 1 } })
      sessionHook?.(agent.session, {
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: streamedText } },
      })
      await delivered.promise
      assert.deepEqual(texts, [streamedText])
      sessionHook?.(agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.deepEqual(texts, [streamedText])
    } finally {
      clearTimeout(timeout)
      clearWechatPending()
      consumeWechatTurn()
      setActiveAgent(undefined)
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('injects progress reports for work but not chat', async () => {
    const { registerProgressHooks } = await import('../src/wechat/dsh/progress.ts')
    const { setActiveAgent } = await import('../src/wechat/dsh/session.ts')
    const {
      clearWechatPending,
      consumeWechatTurn,
      getConfig,
      markTurnStarted,
      markWechatPending,
      setConfig,
    } = await import('../src/wechat/core/runtime.ts')
    let requestHook: ((payload: { agent: unknown }, next: () => Promise<unknown>) => Promise<unknown>) | undefined
    const ctx = {
      on: (event: string, hook: unknown) => {
        if (event === 'agent/request') {
          requestHook = hook as (payload: { agent: unknown }, next: () => Promise<unknown>) => Promise<unknown>
        }
      },
    } as never
    const steers: unknown[] = []
    const agent = { id: 'agent-progress', steer: (message: unknown) => steers.push(message) } as never
    const original = getConfig()

    setActiveAgent(agent)
    registerProgressHooks(ctx)
    setConfig({ ...original, progress: { enabled: true, interval: 1 }, notify: false })
    try {
      markWechatPending({ mode: 'work' })
      markTurnStarted()
      await requestHook?.({ agent }, async () => undefined)
      assert.equal(steers.length, 1)
      consumeWechatTurn()

      steers.length = 0
      markWechatPending({ mode: 'chat' })
      markTurnStarted()
      await requestHook?.({ agent }, async () => undefined)
      assert.equal(steers.length, 0)
    } finally {
      clearWechatPending()
      consumeWechatTurn()
      setConfig(original)
      setActiveAgent(undefined)
    }
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
