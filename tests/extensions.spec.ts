import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cellWidth, isValidContributionKey, sanitizeCellText, truncateByCell } from '../src/render-safe.ts'
import { DialogsService, RenderersService, ShortcutsService, StatusService } from '../src/extensions/services.ts'

describe('sanitize', () => {
  it('counts CJK characters as two cells', () => {
    assert.equal(cellWidth('ab'), 2)
    assert.equal(cellWidth('中文'), 4)
  })

  it('strips control characters and folds whitespace', () => {
    assert.equal(sanitizeCellText('a\x00b\n  c', 10), 'ab c')
  })

  it('rejects non-scalar render inputs', () => {
    assert.equal(sanitizeCellText({ text: 'nope' }, 10), undefined)
    assert.equal(sanitizeCellText(['nope'], 10), undefined)
  })

  it('truncates by terminal cells', () => {
    assert.equal(truncateByCell('中中中', 4), '中中')
    assert.equal(truncateByCell('abcdef', 3), 'abc')
  })

  it('validates contribution keys', () => {
    assert.equal(isValidContributionKey('my-plugin'), true)
    assert.equal(isValidContributionKey('my-plugin:sub'), true)
    assert.equal(isValidContributionKey('MyPlugin'), false)
    assert.equal(isValidContributionKey('plugin/sub'), false)
  })
})

describe('status service', () => {
  it('sets, replaces and clears keyed contributions', () => {
    const status = new StatusService()
    const dispose = status.set('my-plugin', 'building')
    assert.deepEqual(status.snapshot(), ['building'])
    status.set('my-plugin', 'done')
    assert.deepEqual(status.snapshot(), ['done'])
    // A disposer only clears the exact value it set; the replacement survives.
    dispose()
    assert.deepEqual(status.snapshot(), ['done'])
    status.set('my-plugin', undefined)
    assert.deepEqual(status.snapshot(), [])
  })

  it('rejects invalid keys and non-scalar values', () => {
    const status = new StatusService()
    status.set('bad/key', 'x')
    assert.deepEqual(status.snapshot(), [])
    status.set('ok', { nested: true } as unknown as string)
    assert.deepEqual(status.snapshot(), [])
  })
})

describe('shortcuts service', () => {
  it('accepts ctrl/alt combos and rejects reserved keys', async () => {
    const shortcuts = new ShortcutsService()
    let called = 0
    const dispose = shortcuts.register('ctrl+shift+p', { description: 'palette', handler: () => { called++ } })
    assert.ok(dispose !== undefined)
    assert.equal(shortcuts.dispatch('shift+ctrl+p'), true)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(called, 1)
    shortcuts.register('ctrl+c', { description: 'reserved', handler: () => undefined })
    assert.equal(shortcuts.dispatch('ctrl+c'), false)
  })
})

describe('renderers service', () => {
  it('sanitizes and renders plugin entries', () => {
    const renderers = new RenderersService()
    const dispose = renderers.register('my-plugin/note', payload => ({
      title: 'note',
      lines: [(payload as { text: string }).text, 42, { bad: true }],
    }))
    const rendered = renderers.render('my-plugin/note', { text: 'hello' })
    assert.deepEqual(rendered, { title: 'note', lines: ['hello', '42'] })
    dispose()
    assert.equal(renderers.render('my-plugin/note', { text: 'gone' }), undefined)
  })
})

describe('dialogs service', () => {
  it('settles queued dialogs FIFO through the backend', async () => {
    const dialogs = new DialogsService()
    const order: string[] = []
    dialogs.installBackend({
      select: async request => { order.push(`select:${request.title}`); return 'picked' },
      confirm: async request => { order.push(`confirm:${request.title}`); return true },
      input: async request => { order.push(`input:${request.title}`); return 'typed' },
    })
    const [selected, confirmed, inputted] = await Promise.all([
      dialogs.select({ title: 'one', options: [{ id: 'a', label: 'A' }] }),
      dialogs.confirm({ title: 'two' }),
      dialogs.input({ title: 'three' }),
    ])
    assert.equal(selected, 'picked')
    assert.equal(confirmed, true)
    assert.equal(inputted, 'typed')
    assert.deepEqual(order, ['select:one', 'confirm:two', 'input:three'])
  })
})
