import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth } from '@earendil-works/pi-tui'
import { ModelListDialog } from '../src/components/model-list-dialog.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

function dialog(models: string[]) {
  const state = { saved: undefined as string[] | undefined, cancelled: false }
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
  it('adds a model and commits the complete list', () => {
    const { view, state } = dialog([])
    view.handleInput('\r')
    view.handleInput('gateway-model')
    view.handleInput('\n')
    down(view, 2)
    view.handleInput('\r')
    assert.deepEqual(state.saved, ['gateway-model'])
  })

  it('edits the selected model', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\r')
    view.handleInput('-edited')
    view.handleInput('\n')
    down(view, 2)
    view.handleInput('\r')
    assert.deepEqual(state.saved, ['model-a-edited'])
  })

  it('deletes the currently highlighted model, not the last model', () => {
    const { view, state } = dialog(['model-a', 'model-b', 'model-c'])
    down(view, 1)
    view.handleInput('\x7f')
    down(view, 2)
    view.handleInput('\r')
    assert.deepEqual(state.saved, ['model-a', 'model-c'])
  })

  it('deletes a model before saving', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\x7f')
    down(view, 1)
    view.handleInput('\r')
    assert.deepEqual(state.saved, [])
  })

  it('cancels without returning destructive edits', () => {
    const { view, state } = dialog(['model-a'])
    view.handleInput('\x7f')
    view.handleInput('\x1b')
    assert.equal(state.cancelled, true)
    assert.equal(state.saved, undefined)
  })


  it('wraps help and model rows within a narrow frame', () => {
    const { view } = dialog(['company/region/very-long-model-name-with-capabilities'])
    const rendered = view.render(28)
    const text = rendered.join('\n')
    assert.ok(text.includes('Delete/Backspace'))
    assert.ok(text.replace(/[│\s]/g, '').includes('company/region/very-long-model-name-with-capabilities'))
    assert.ok(rendered.every(row => visibleWidth(row) === 28))
  })

  it('shows the full selected model id below the compact list row', () => {
    const longModel = 'company/region/very-long-model-name-with-capabilities'
    const { view } = dialog([longModel])
    const rendered = view.render(40).join('\n')
    assert.ok(rendered.includes('company/region'))
    assert.ok(rendered.includes('capabilities'))
  })
})
