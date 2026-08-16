import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CustomModelForm, type CustomModelDraft } from '../src/components/custom-model-form.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

const DRAFT: CustomModelDraft = {
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'max',
  saveDefault: true,
  saveTitle: false,
}

function makeForm(draft: CustomModelDraft = DRAFT) {
  const state = {
    done: undefined as CustomModelDraft | undefined,
    cancelled: false,
  }
  const form = new CustomModelForm('Custom model config', palette, t, draft, (value) => {
    if (value === undefined) state.cancelled = true
    else state.done = value
  })
  return { form, state }
}

describe('CustomModelForm', () => {
  it('renders every field on one page', () => {
    const { form } = makeForm()
    const rows = form.render(80)
    const text = rows.join('\n')
    assert.ok(text.includes('Provider'))
    assert.ok(text.includes('Model'))
    assert.ok(text.includes('Default reasoning effort'))
    assert.ok(text.includes('Save as default model'))
    assert.ok(text.includes('Save as title model'))
    assert.ok(text.includes('Save'))
    assert.ok(text.includes('Cancel'))
  })

  it('toggles checkboxes with Enter and saves the draft', () => {
    const { form, state } = makeForm()
    // provider -> model -> effort -> saveDefault -> saveTitle
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\r')
    // saveTitle is now checked; move to Save and submit.
    form.handleInput('\x1b[B')
    form.handleInput('\r')
    assert.deepEqual(state.done, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
      saveDefault: true,
      saveTitle: true,
    })
  })

  it('cancels on Escape without a draft', () => {
    const { form, state } = makeForm()
    form.handleInput('\x1b')
    assert.equal(state.cancelled, true)
  })

  it('shows a validation error when required fields are empty', () => {
    const { form } = makeForm({
      provider: '',
      model: '',
      reasoningEffort: '',
      saveDefault: true,
      saveTitle: false,
    })
    // provider -> model -> effort -> saveDefault -> saveTitle -> save
    for (let index = 0; index < 5; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    const rows = form.render(80)
    assert.ok(rows.join('\n').includes('required'))
  })
})
