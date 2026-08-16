import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ProviderForm, type ProviderDraft } from '../src/components/provider-form.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

const DRAFT: ProviderDraft = {
  name: 'local-gateway',
  api: 'chat',
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'secret',
  models: ['model-a', 'model-b'],
}

function makeForm(draft: ProviderDraft = DRAFT) {
  const state = {
    done: undefined as ProviderDraft | undefined,
    cancelled: false,
  }
  const form = new ProviderForm('Add provider', palette, t, draft, (value) => {
    if (value === undefined) state.cancelled = true
    else state.done = value
  })
  return { form, state }
}

describe('ProviderForm', () => {
  it('renders provider fields, model list and discovery action on one page', () => {
    const { form } = makeForm()
    const rows = form.render(80).join('\n')
    assert.ok(rows.includes('Provider name'))
    assert.ok(rows.includes('API type'))
    assert.ok(rows.includes('Base URL'))
    assert.ok(rows.includes('API Key'))
    assert.ok(rows.includes('Models'))
    assert.ok(rows.includes('Edit models manually'))
    assert.ok(rows.includes('Discover upstream models'))
    assert.ok(rows.includes('Save'))
    assert.ok(rows.includes('Cancel'))
  })

  it('saves the draft when name and base URL are present', () => {
    const { form, state } = makeForm()
    // name -> api -> baseURL -> apiKey -> models -> manual-models -> discover -> save
    for (let index = 0; index < 7; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    assert.deepEqual(state.done, DRAFT)
  })

  it('shows a validation error when required fields are missing', () => {
    const { form } = makeForm({
      name: '',
      api: '',
      baseURL: '',
      apiKey: '',
      models: [],
    })
    for (let index = 0; index < 7; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    const rows = form.render(80).join('\n')
    assert.ok(rows.includes('required'))
  })

  it('cancels on Escape without a draft', () => {
    const { form, state } = makeForm()
    form.handleInput('\x1b')
    assert.equal(state.cancelled, true)
  })

  it('edits models manually through the callback', async () => {
    let edited = false
    const form = new ProviderForm('Add provider', palette, t, DRAFT, () => {}, {
      editModelsManually: async () => {
        edited = true
        return ['model-x', 'model-y']
      },
    })
    // name -> api -> baseURL -> apiKey -> models -> manual-models
    for (let index = 0; index < 5; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(edited, true)
    assert.ok(form.render(80).join('\n').includes('2 models'))
  })

  it('runs discovery and shows the discovered count', async () => {
    let discovered = false
    const form = new ProviderForm('Add provider', palette, t, DRAFT, () => {}, {
      discover: async () => {
        discovered = true
        return [{ id: 'model-c' }, { id: 'model-d' }]
      },
    })
    // name -> api -> baseURL -> apiKey -> models -> manual-models -> discover
    for (let index = 0; index < 6; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(discovered, true)
    assert.ok(form.render(80).join('\n').includes('2 models discovered'))
  })
})
