import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth } from '@earendil-works/pi-tui'
import {
  BUILTIN_THEMES,
  COLOR_ROLES,
  createPalette,
  findTheme,
  findThemeForScheme,
  frameBlock,
  frameBlockSections,
  resolveThemeId,
} from '../src/theme.ts'
import { THEME_DATA } from '../src/theme-data.ts'

/** Colors disabled so rows are plain text and visibleWidth measures exactly. */
const palette = createPalette(false, 'dark', true)

describe('frameBlock', () => {
  it('never renders a row wider than the requested width', () => {
    for (const width of [5, 10, 40, 80, 120]) {
      const rows = frameBlock(['short', 'a very long line that will definitely exceed the inner width of the frame'], width, palette.border, palette.toolPendingBg, 'Title')
      for (const row of rows) {
        assert.ok(visibleWidth(row) <= width, `width=${width} row=${JSON.stringify(row)}`)
      }
    }
  })

  it('spans exactly the requested width on corner rows', () => {
    for (const width of [5, 10, 40, 80, 120]) {
      const rows = frameBlock(['body'], width, palette.border, undefined)
      assert.equal(visibleWidth(rows[0]!), width)
      assert.equal(visibleWidth(rows[rows.length - 1]!), width)
    }
  })

  it('truncates an overlong title instead of widening the frame', () => {
    const rows = frameBlock([], 20, palette.border, undefined, 'x'.repeat(100))
    assert.equal(visibleWidth(rows[0]!), 20)
  })

  it('uses the three-cell OMP title cap and optional section divider', () => {
    const rows = frameBlock(['body'], 24, palette.border, undefined, 'Read file', 'Output')
    assert.equal(rows[0], '╭─── Read file ────────╮')
    assert.equal(rows[1], '├─── Output ───────────┤')
    assert.equal(rows.at(-1), '╰──────────────────────╯')
  })

  it('paints the background across every row when supplied', () => {
    const bg = (text: string) => `<bg>${text}</bg>`
    const border = (text: string) => `<b>${text}</b>`
    const rows = frameBlock(['x'], 10, border, bg, 'T')
    for (const row of rows) {
      assert.ok(row.startsWith('<bg>'))
      assert.ok(row.endsWith('</bg>'))
    }
  })

  it('renders multiple labelled sections in order', () => {
    const rows = frameBlockSections(24, palette.border, undefined, 'Pwsh', [
      { title: 'Input', lines: ['Get-Process'] },
      { title: 'Output', lines: ['result'] },
    ])
    assert.equal(rows[0], '╭─── Pwsh ─────────────╮')
    assert.equal(rows[1], '├─── Input ────────────┤')
    assert.equal(rows[2], '│ Get-Process          │')
    assert.equal(rows[3], '├─── Output ───────────┤')
    assert.equal(rows[4], '│ result               │')
    assert.equal(rows.at(-1), '╰──────────────────────╯')
  })
})

describe('palette spec selection', () => {
  it('emits truecolor SGR on dark truecolor terminals', () => {
    const enabled = createPalette(true, 'dark', true)
    assert.equal(enabled.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
  })

  it('falls back to ANSI when truecolor is unavailable', () => {
    const ansi = createPalette(true, 'dark', false)
    assert.equal(ansi.accent('x'), '\u001b[93mx\u001b[39m')
  })

  it('uses the adaptive light truecolor theme on light schemes', () => {
    const light = createPalette(true, 'light', true)
    assert.equal(light.accent('x'), '\u001b[38;2;136;57;239mx\u001b[39m')
  })

  it('emits nothing for background roles on the ANSI fallback', () => {
    const ansi = createPalette(true, 'dark', false)
    assert.equal(ansi.toolSuccessBg('x'), 'x')
  })
})

describe('theme selection and overrides', () => {
  it('resolves a selected theme independently of the terminal scheme', () => {
    const dark = createPalette(true, 'dark', true, { mode: 'selected', selectedId: 'dark-catppuccin' })
    assert.equal(dark.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
    const light = createPalette(true, 'light', true, { mode: 'selected', selectedId: 'dark-catppuccin' })
    assert.equal(light.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
  })

  it('resolves dynamic dark and light slots independently', () => {
    const dark = createPalette(true, 'dark', true, { mode: 'dynamic', darkId: 'dark-tokyo-night', lightId: 'light-catppuccin' })
    assert.equal(dark.accent('x'), '\u001b[38;2;187;154;247mx\u001b[39m')
    const light = createPalette(true, 'light', true, { mode: 'dynamic', darkId: 'dark-tokyo-night', lightId: 'light-catppuccin' })
    assert.equal(light.accent('x'), '\u001b[38;2;136;57;239mx\u001b[39m')
  })

  it('allows a light theme in the dark slot and vice versa', () => {
    const dark = createPalette(true, 'dark', true, { mode: 'dynamic', darkId: 'light-catppuccin', lightId: 'dark-catppuccin' })
    assert.equal(dark.accent('x'), '\u001b[38;2;136;57;239mx\u001b[39m')
    const light = createPalette(true, 'light', true, { mode: 'dynamic', darkId: 'light-catppuccin', lightId: 'dark-catppuccin' })
    assert.equal(light.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
  })

  it('falls back to a valid theme when the requested id is unknown', () => {
    const unknown = createPalette(true, 'dark', true, { mode: 'selected', selectedId: 'does-not-exist' })
    assert.equal(unknown.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
    const unknownSlot = createPalette(true, 'light', true, { mode: 'dynamic', darkId: 'dark-catppuccin', lightId: 'does-not-exist' })
    assert.equal(unknownSlot.accent('x'), '\u001b[38;2;136;57;239mx\u001b[39m')
  })

  it('ports every concrete OMP theme and exposes no preset families', () => {
    assert.equal(BUILTIN_THEMES.length, THEME_DATA.length)
    for (const theme of THEME_DATA) {
      assert.deepEqual(Object.keys(theme.roles).sort(), [...COLOR_ROLES].sort(), theme.id)
      assert.equal(findTheme(theme.id)?.id, theme.id)
    }
    assert.equal(findTheme('catppuccin'), undefined)
    assert.equal(findThemeForScheme('dark-catppuccin', 'light').id, 'dark-catppuccin')
    assert.equal(resolveThemeId({ mode: 'dynamic', darkId: 'dark-catppuccin', lightId: 'light-catppuccin' }, 'dark'), 'dark-catppuccin')
    assert.equal(resolveThemeId({ mode: 'dynamic', darkId: 'dark-catppuccin', lightId: 'light-catppuccin' }, 'light'), 'light-catppuccin')
  })

  it('applies per-role custom overrides on top of the selected theme', () => {
    const custom = createPalette(true, 'dark', true, {
      mode: 'selected',
      selectedId: 'dark-catppuccin',
      custom: { accent: [255, 0, 0], border: [0, 255, 0] },
    })
    assert.equal(custom.accent('x'), '\u001b[38;2;255;0;0mx\u001b[39m')
    assert.equal(custom.border('x'), '\u001b[38;2;0;255;0mx\u001b[39m')
    // Untouched roles keep the selected theme's value.
    assert.equal(custom.success('x'), '\u001b[38;2;166;227;161mx\u001b[39m')
  })

  it('drops malformed overrides', () => {
    const malformed = createPalette(true, 'dark', true, {
      mode: 'selected',
      selectedId: 'dark-catppuccin',
      custom: { accent: [1, 2], bogus: [1, 2, 3] },
    })
    assert.equal(malformed.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
  })
})
