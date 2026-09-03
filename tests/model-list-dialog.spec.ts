import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth } from '@earendil-works/pi-tui'
import { ModelListDialog, type ProviderModelDraft } from '../src/components/model-list-dialog.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

function dialog(models: Array<string | ProviderModelDraft>) {
  const state = { saved: undefined as ProviderModelDraft[] | undefined, cancelled: false }
  const view = new ModelListDialog('Models', models, palette, t, value => {
    if (value === undefined) state.cancelled = true
    else state.saved = value
  })
  return { view, state }
}

const down = (view: ModelListDialog, count: number): void => {
  for (let index = 0; index < count; index++) view.handleInput('\x1b[B')
}

describe('ModelListDialog', () => {
  it('adds a model, expands fields, and commits', () => {
    const { view, state } = dialog([])
    view.handleInput('\r')
    view.handleInput('gateway-model')
    view.handleInput('\n')
    const text = view.render(80).join('\n')
    assert.ok(text.includes('Display name'))
    assert.ok(text.includes('Thinking levels'))
    assert.ok(text.includes('Context window'))
    down(view, 6)
    view.handleInput('\r')
    assert.deepEqual(state.saved, [{ id: 'gateway-model' }])
  })

  it('expands a model into a flat editable field list on Enter', () => {
    const { view } = dialog(['model-a'])
    view.handleInput('\r')
    const text = view.render(80).join('\n')
    assert.ok(text.includes('Full model ID'))
    assert.ok(text.includes('Display name'))
    assert.ok(text.includes('Thinking levels'))
    assert.ok(text.includes('Thinking level'))
    assert.ok(text.includes('Context window'))
    assert.ok(text.includes('Max output tokens'))
  })

  it('cycles thinking level presets with Enter on the thinking levels row', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\r')
    down(view, 2)
    view.handleInput('\r') // inherit -> DeepSeek preset
    view.handleInput('\r') // DeepSeek -> OpenAI preset
    down(view, 5)
    view.handleInput('\r')
    assert.deepEqual(state.saved, [{
      id: 'model-a',
      reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
      reasoningEffort: 'medium',
    }])
  })

  it('edits custom thinking levels with e using the simple list format', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\r')
    down(view, 2)
    view.handleInput('e')
    view.handleInput('off, high, max')
    view.handleInput('\n')
    down(view, 5)
    view.handleInput('\r')
    assert.deepEqual(state.saved, [{
      id: 'model-a',
      reasoningEfforts: { off: null, high: 'high', max: 'max' },
      reasoningEffort: 'high',
    }])
  })

  it('cycles through all presets to non-reasoning and back to inherit', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\r')
    down(view, 2)
    for (let index = 0; index < 5; index++) view.handleInput('\r')
    down(view, 5)
    view.handleInput('\r')
    assert.deepEqual(state.saved, [{ id: 'model-a', reasoningEfforts: false }])

    const { view: back, state: backState } = dialog(['model-a'])
    back.handleInput('\r')
    down(back, 2)
    for (let index = 0; index < 6; index++) back.handleInput('\r')
    down(back, 5)
    back.handleInput('\r')
    assert.deepEqual(backState.saved, [{ id: 'model-a' }])
  })

  it('collapses the expanded model on Esc then cancels on a second Esc', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\r')
    assert.ok(view.render(80).join('\n').includes('Display name'))
    view.handleInput('\x1b')
    assert.ok(!view.render(80).join('\n').includes('Display name'))
    view.handleInput('\x1b')
    assert.equal(state.cancelled, true)
  })

  it('deletes the currently highlighted model, not the last model', () => {
    const { view, state } = dialog(['model-a', 'model-b', 'model-c'])
    down(view, 1)
    view.handleInput('\x7f')
    down(view, 2)
    view.handleInput('\r')
    assert.deepEqual(state.saved, [{ id: 'model-a' }, { id: 'model-c' }])
  })

  it('wraps help and model rows within a narrow frame', () => {
    const { view } = dialog(['company/region/very-long-model-name-with-capabilities'])
    const rendered = view.render(28)
    assert.ok(rendered.every(row => visibleWidth(row) === 28))
  })
})
