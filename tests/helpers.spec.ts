import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseTuiPromptTemplate, renderTuiPromptTemplate } from '../src/prompt.ts'
import { contentText, parseArguments } from '../src/components/content.ts'
import { displayInlineText, displayText } from '../src/components/text.ts'

describe('parseTuiPromptTemplate', () => {
  it('parses ${name} value tokens and literal text', () => {
    const tokens = parseTuiPromptTemplate('${cwd}  ${model}')
    assert.deepEqual(tokens, [
      { type: 'value', name: 'cwd' },
      { type: 'text', text: '  ' },
      { type: 'value', name: 'model' },
    ])
  })

  it('keeps an unterminated or empty ${ as literal text', () => {
    // The unterminated `${` stays literal; adjacent text tokens render identically.
    assert.deepEqual(parseTuiPromptTemplate('a${b'), [
      { type: 'text', text: 'a' },
      { type: 'text', text: '${b' },
    ])
    assert.deepEqual(parseTuiPromptTemplate('${}x'), [
      { type: 'text', text: '${}' },
      { type: 'text', text: 'x' },
    ])
  })

  it('renders missing values as nothing', () => {
    const tokens = parseTuiPromptTemplate('a${missing}b')
    assert.equal(renderTuiPromptTemplate(tokens, () => undefined), 'ab')
  })
})

describe('contentText', () => {
  it('joins text and reasoning blocks, skipping other block types', () => {
    const text = contentText([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'answer' },
      { type: 'image', attachment: {} as never },
    ])
    assert.equal(text, 'think\n\nanswer')
  })
})

describe('parseArguments', () => {
  it('accepts valid JSON and rejects malformed input', () => {
    assert.deepEqual(parseArguments('{"a":1}'), { valid: true, value: { a: 1 } })
    assert.deepEqual(parseArguments(''), { valid: true, value: {} })
    assert.deepEqual(parseArguments('nope'), { valid: false, raw: 'nope' })
  })
})

describe('text sanitizers', () => {
  it('strips control characters and collapses newlines inline', () => {
    assert.equal(displayText('a\u0007b'), 'ab')
    assert.equal(displayInlineText('a\r\nb'), 'a b')
  })
})
