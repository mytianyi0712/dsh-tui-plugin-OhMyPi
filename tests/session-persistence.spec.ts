import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BlockAssembler, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { sanitizeToolCallChunk, sanitizeToolCallDeltaStream } from '../src/session-persistence.ts'

describe('tool-call stream sanitizer', () => {
  it('synthesizes only empty ids and preserves absent names', () => {
    const delta = sanitizeToolCallChunk({
      type: 'tool-call-delta',
      index: 0,
      id: ToolCallId(''),
      name: undefined,
      argumentsDelta: '{}',
    } as StreamChunk)

    assert.equal(delta.type, 'tool-call-delta')
    if (delta.type === 'tool-call-delta') {
      assert.equal(delta.id, 'call-0')
      assert.equal(delta.name, undefined)
    }

    const end = sanitizeToolCallChunk({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: ToolCallId(''), name: 'bash', arguments: '{}' },
    } as StreamChunk)

    assert.equal(end.type, 'block-end')
    if (end.type === 'block-end' && end.block.type === 'tool-call') {
      assert.equal(end.block.id, 'call-0')
      assert.equal(end.block.name, 'bash')
    }
  })

  it('lets the assembler keep the first-seen name when continuation deltas omit it', () => {
    const assembler = new BlockAssembler()
    assembler.push({ type: 'block-start', index: 0, blockType: 'tool-call' })
    for (const chunk of [
      {
        type: 'tool-call-delta',
        index: 0,
        id: ToolCallId('call_1'),
        name: 'bash',
        argumentsDelta: '{"command":"',
      },
      {
        type: 'tool-call-delta',
        index: 0,
        id: ToolCallId('call_1'),
        name: undefined,
        argumentsDelta: 'ls"}',
      },
    ] as StreamChunk[]) {
      assembler.push(sanitizeToolCallChunk(chunk))
    }

    const [block] = assembler.blocks()
    assert.equal(block?.type, 'tool-call')
    if (block?.type === 'tool-call') {
      assert.equal(block.id, 'call_1')
      assert.equal(block.name, 'bash')
      assert.equal(block.arguments, '{"command":"ls"}')
    }
  })

  it('keeps the first-seen id and name when later deltas and block-end are empty', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 1,
        id: ToolCallId('call_a3badaf0132c4e3e82b87e1f'),
        name: 'pwsh',
        argumentsDelta: '',
      },
      {
        type: 'tool-call-delta',
        index: 1,
        id: ToolCallId(''),
        name: null,
        argumentsDelta: '{"command":"Get-Command dsh"}',
      } as StreamChunk,
      {
        type: 'block-end',
        index: 1,
        block: { type: 'tool-call', id: ToolCallId(''), name: '', arguments: '{"command":"Get-Command dsh"}' },
      },
    ]

    const assembler = new BlockAssembler()
    for await (const chunk of sanitizeToolCallDeltaStream(chunks as unknown as AsyncIterable<StreamChunk>)) {
      assembler.push(chunk)
    }

    const [block] = assembler.blocks()
    assert.equal(block?.type, 'tool-call')
    if (block?.type === 'tool-call') {
      assert.equal(block.id, 'call_a3badaf0132c4e3e82b87e1f')
      assert.equal(block.name, 'pwsh')
      assert.equal(block.arguments, '{"command":"Get-Command dsh"}')
    }
  })
})
