import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultEffortOf,
  formatReasoningEffortMap,
  formatReasoningEffortSetting,
  parseReasoningEffortMap,
  parseReasoningEffortSetting,
} from '../src/reasoning-maps.ts'
import { formatReasoningEfforts, normalizeProviderModels, parseReasoningEfforts } from '../src/components/model-list-dialog.ts'

describe('reasoning effort dsh settings', () => {
  it('parses a dsh dict with a null off value and wire spellings', () => {
    assert.deepEqual(
      parseReasoningEffortMap({ off: null, high: 'high', max: 'ultra' }),
      { off: null, high: 'high', max: 'ultra' },
    )
  })

  it('formats a dsh dict back into a stable editable string', () => {
    assert.equal(
      formatReasoningEffortMap({ off: null, high: 'high', max: 'ultra' }),
      'off:, high: high, max: ultra',
    )
  })

  it('preserves the dsh false non-reasoning marker', () => {
    assert.equal(parseReasoningEffortSetting(false), false)
    assert.equal(parseReasoningEffortSetting('false'), false)
    assert.equal(formatReasoningEffortSetting(false), 'false')
    assert.equal(parseReasoningEffortSetting(formatReasoningEffortSetting(false)), false)
  })

  it('round-trips dsh dicts through the model list helpers', () => {
    const formatted = formatReasoningEfforts({ off: null, high: 'high' })
    assert.equal(parseReasoningEfforts(formatted) !== undefined, true)
    assert.deepEqual(parseReasoningEfforts(formatted), { off: null, high: 'high' })
  })

  it('normalizes saved dsh models without dropping capabilities', () => {
    const models = normalizeProviderModels([
      { id: 'acme-think', reasoningEfforts: { off: null, high: 'high' }, contextWindow: 262144 },
      { id: 'acme-plain', reasoningEfforts: false },
      'acme-string',
    ])
    assert.deepEqual(models, [
      { id: 'acme-think', reasoningEfforts: { off: null, high: 'high' }, reasoningEffort: 'high', contextWindow: 262144 },
      { id: 'acme-plain', reasoningEfforts: false },
      { id: 'acme-string' },
    ])
  })

  it('accepts simple custom input formats', () => {
    assert.deepEqual(parseReasoningEffortSetting('off, high, max'), { off: null, high: 'high', max: 'max' })
    assert.deepEqual(parseReasoningEffortSetting('deepseek'), { off: 'none', high: 'high', max: 'max' })
    assert.deepEqual(parseReasoningEffortSetting('gpt'), { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' })
    assert.deepEqual(parseReasoningEffortSetting('deepseek, max: ultra'), { off: 'none', high: 'high', max: 'ultra' })
    assert.deepEqual(parseReasoningEffortSetting('high: ultra, max'), { high: 'ultra', max: 'max' })
  })

  it('derives the first non-off level as the default effort', () => {
    assert.equal(defaultEffortOf({ off: null, high: 'high', max: 'max' }), 'high')
    assert.equal(defaultEffortOf(false), undefined)
  })
})
