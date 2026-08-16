import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ProviderForm, SUPPORTED_PROVIDER_APIS, type ProviderDraft } from '../src/components/provider-form.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

const DRAFT: ProviderDraft = {
  id: 'local-gateway',
  name: 'Local Gateway',
  api: 'openai-completions',
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
  it('renders provider id, fields, model list and discovery action on one page', () => {
    const { form } = makeForm()
    const rows = form.render(80).join('\n')
    assert.ok(rows.includes('Provider ID'))
    assert.ok(rows.includes('Provider name'))
    assert.ok(rows.includes('API type'))
    assert.ok(rows.includes('Base URL'))
    assert.ok(rows.includes('API Key'))
    assert.ok(rows.includes('Manage model list'))
    assert.ok(!rows.includes('Edit models manually'))
    assert.ok(rows.includes('Save'))
    assert.ok(rows.includes('Cancel'))
  })
  it('keeps the official dsh protocol identifiers centralized', () => {
    assert.deepEqual(SUPPORTED_PROVIDER_APIS, [
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
    ])
  })
  it('uses the predefined WebUI API type picker', async () => {
    let picked = false
    const form = new ProviderForm('Add provider', palette, t, DRAFT, () => {}, {
      pickApi: async () => {
        picked = true
        return 'openai-responses'
      },
    })
    // id -> name -> api
    form.handleInput('\x1b[B')
    form.handleInput('\x1b[B')
    form.handleInput('\r')
    await Promise.resolve()
    assert.equal(picked, true)
    assert.ok(form.render(80).join('\n').includes('openai-responses'))
  })
  it('rejects a custom route without an official API type', () => {
    const form = new ProviderForm('Add provider', palette, t, { ...DRAFT, api: '' }, () => {}, {}, {
      requireApi: true,
      requireBaseURL: true,
      requireModels: true,
    })
    for (let index = 0; index < 7; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    assert.ok(form.render(80).join('\n').includes('supported API type'))
  })

  it('saves the draft when the provider id and base URL are present', () => {
    const { form, state } = makeForm()
    // id -> name -> api -> baseURL -> apiKey -> models -> discover -> save
    for (let index = 0; index < 7; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    assert.deepEqual(state.done, DRAFT)
  })

  it('shows a validation error when required fields are missing', () => {
    const { form } = makeForm({
      id: '',
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

  it('manages models through the CRUD callback', async () => {
    let managed = false
    const form = new ProviderForm('Add provider', palette, t, DRAFT, () => {}, {
      manageModels: async () => {
        managed = true
        return ['model-x', 'model-y']
      },
    })
    // id -> name -> api -> baseURL -> apiKey -> models
    for (let index = 0; index < 5; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    await Promise.resolve()
    assert.equal(managed, true)
    assert.ok(form.render(80).join('\n').includes('2 models'))
  })
  it('keeps the existing model list when the editor is cancelled', async () => {
    let saved: ProviderDraft | undefined
    const managed = new ProviderForm('Add provider', palette, t, DRAFT, value => {
      if (value !== undefined) saved = value
    }, { manageModels: async () => undefined })
    for (let index = 0; index < 5; index++) managed.handleInput('\x1b[B')
    managed.handleInput('\r')
    await Promise.resolve()
    for (let index = 0; index < 2; index++) managed.handleInput('\x1b[B')
    managed.handleInput('\r')
    assert.deepEqual(saved, DRAFT)
  })

  it('runs discovery and shows the discovered count', async () => {
    let discovered = false
    const form = new ProviderForm('Add provider', palette, t, DRAFT, () => {}, {
      discover: async () => {
        discovered = true
        return [{ id: 'model-c' }, { id: 'model-d' }]
      },
    })
    // id -> name -> api -> baseURL -> apiKey -> models -> discover
    for (let index = 0; index < 6; index++) form.handleInput('\x1b[B')
    form.handleInput('\r')
    await Promise.resolve()
    assert.equal(discovered, true)
    assert.ok(form.render(80).join('\n').includes('2 models discovered'))
  })

  it('shows a long Base URL in a wrapped detail block', () => {
    const baseURL = 'https://gateway.example/company/region/v1/chat/completions'
    const { form } = makeForm({ ...DRAFT, baseURL })
    for (let index = 0; index < 3; index++) form.handleInput('\x1b[B')
    const rows = form.render(40).join('\n')
    assert.ok(rows.includes('https://gateway.example'))
    assert.ok(rows.includes('chat/completions'))
  })
})
