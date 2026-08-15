import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTranslator, MESSAGES, type MessageKey } from '../src/i18n.ts'

describe('i18n dictionaries', () => {
  it('keeps every locale on the exact same key set', () => {
    const zh = Object.keys(MESSAGES['zh-CN']).sort()
    const en = Object.keys(MESSAGES.en).sort()
    assert.deepEqual(zh, en)
    assert.ok(zh.length > 0)
  })

  it('has no empty or placeholder-only templates', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        assert.ok(value.trim() !== '', `${locale}.${key} is empty`)
        assert.ok(!/^\{\w+\}$/.test(value), `${locale}.${key} is only a placeholder`)
      }
    }
  })
})

describe('translator', () => {
  it('resolves zh-CN by default and substitutes parameters', () => {
    const t = createTranslator('zh-CN')
    assert.equal(t('noticeSessionResumed', { id: 's-1' }), '会话 s-1 已恢复。')
    assert.equal(t('helpCtrlC'), '中断当前回合')
  })

  it('switches to English when requested', () => {
    const t = createTranslator('en')
    assert.equal(t('noticeSessionResumed', { id: 's-1' }), 'Session s-1 resumed.')
  })

  it('leaves unknown placeholders untouched and keeps missing keys safe', () => {
    const t = createTranslator('en')
    assert.equal(t('noticeUnknownCommand', { name: 'foo' }), 'Unknown command: foo')
    // Cast is intentional: the key set is compile-time enforced.
    assert.equal(t('noticeTurnEnded' as MessageKey, { reason: 'aborted' }), 'Turn ended: aborted.')
  })
})
