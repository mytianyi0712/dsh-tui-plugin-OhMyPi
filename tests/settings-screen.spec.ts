import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth, type SelectItem } from '@earendil-works/pi-tui'
import { SettingsScreen, type SettingsTab } from '../src/components/settings-screen.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

const TEST_TABS: SettingsTab[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    items: [
      { value: 'theme', label: 'Theme', currentValue: 'catppuccin' },
      { value: 'cursor', label: 'Cursor', currentValue: 'visible' },
    ],
  },
  {
    id: 'model',
    label: 'Model',
    items: [
      { value: 'title-model', label: 'Title model', currentValue: 'deepseek/chat' },
    ],
  },
]

describe('SettingsScreen', () => {
  it('renders an OMP-style full-screen frame at the requested size', () => {
    const screen = new SettingsScreen([], 'Settings', palette, t, 10, 14)
    screen.setTabs(TEST_TABS, 'Settings')

    const rows = screen.render(80)

    assert.equal(rows.length, 14)
    assert.ok(rows[0]!.startsWith('╭─ Settings '))
    assert.ok(rows.some(row => row.includes('Appearance') && row.includes('Model')))
    assert.ok(rows.some(row => row.includes('Theme') && row.includes('catppuccin')))
    assert.ok(rows.some(row => row.includes('switch tabs')))
    assert.ok(rows.every(row => visibleWidth(row) === 80))
  })

  it('switches tabs and preserves each tab cursor', () => {
    const screen = new SettingsScreen([], 'Settings', palette, t)
    screen.setTabs(TEST_TABS, 'Settings')
    let selected: { item: SelectItem; tabId: string | undefined } | undefined
    screen.onSelect = (item, tabId) => {
      selected = { item, tabId }
    }

    screen.handleInput('\x1b[B')
    screen.handleInput('\x1b[C')
    screen.handleInput('\x1b[D')
    screen.handleInput('\r')

    assert.equal(selected?.tabId, 'appearance')
    assert.equal(selected?.item.value, 'cursor')

    screen.handleInput('\x1b[C')
    screen.handleInput('\r')
    assert.equal(selected?.tabId, 'model')
    assert.equal(selected?.item.value, 'title-model')
  })

  it('preselects submenu values and sends Escape back instead of closing', () => {
    const screen = new SettingsScreen([], 'Settings', palette, t)
    const items: SelectItem[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]
    let selected: string | undefined
    let backCount = 0
    let closeCount = 0
    screen.onSelect = item => {
      selected = item.value
    }
    screen.onBack = () => {
      backCount++
    }
    screen.onClose = () => {
      closeCount++
    }

    screen.setItems(items, 'Choose', 'b')
    screen.handleInput('\x1b[C')
    screen.handleInput('\r')
    screen.handleInput('\x1b')

    assert.equal(selected, 'b')
    assert.equal(backCount, 1)
    assert.equal(closeCount, 0)

    screen.setTabs(TEST_TABS, 'Settings')
    screen.handleInput('\x1b')
    assert.equal(closeCount, 1)
  })

  it('wraps row navigation like the OMP selectors', () => {
    const screen = new SettingsScreen([], 'Settings', palette, t)
    screen.setItems([
      { value: 'first', label: 'First' },
      { value: 'last', label: 'Last' },
    ], 'Choose')
    let selected: string | undefined
    screen.onSelect = item => {
      selected = item.value
    }

    screen.handleInput('\x1b[A')
    screen.handleInput('\r')

    assert.equal(selected, 'last')
  })
})
