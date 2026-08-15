import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth } from '@earendil-works/pi-tui'
import { createPalette, frameBlock } from '../src/theme.ts'

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
})

describe('palette spec selection', () => {
  it('emits truecolor SGR on dark truecolor terminals', () => {
    const enabled = createPalette(true, 'dark', true)
    assert.equal(enabled.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
  })

  it('falls back to ANSI on light schemes or non-truecolor terminals', () => {
    const ansi = createPalette(true, 'dark', false)
    assert.equal(ansi.accent('x'), '\u001b[93mx\u001b[39m')
    const light = createPalette(true, 'light', true)
    assert.equal(light.accent('x'), '\u001b[93mx\u001b[39m')
  })

  it('emits nothing for background roles on the ANSI fallback', () => {
    const ansi = createPalette(true, 'dark', false)
    assert.equal(ansi.toolSuccessBg('x'), 'x')
  })
})

describe('theme selection and overrides', () => {
  it('switches accents between built-in themes', () => {
    const catppuccin = createPalette(true, 'dark', true, { name: 'catppuccin' })
    assert.equal(catppuccin.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
    const tokyo = createPalette(true, 'dark', true, { name: 'tokyo-night' })
    assert.equal(tokyo.accent('x'), '\u001b[38;2;122;162;247mx\u001b[39m')
  })

  it('applies per-role custom overrides on top of the built-in theme', () => {
    const custom = createPalette(true, 'dark', true, {
      name: 'catppuccin',
      custom: { accent: [255, 0, 0], border: [0, 255, 0] },
    })
    assert.equal(custom.accent('x'), '\u001b[38;2;255;0;0mx\u001b[39m')
    assert.equal(custom.border('x'), '\u001b[38;2;0;255;0mx\u001b[39m')
    // Untouched roles keep the built-in value.
    assert.equal(custom.success('x'), '\u001b[38;2;166;227;161mx\u001b[39m')
  })

  it('drops malformed overrides and unknown theme names', () => {
    const malformed = createPalette(true, 'dark', true, {
      name: 'catppuccin',
      custom: { accent: [1, 2], bogus: [1, 2, 3] },
    })
    assert.equal(malformed.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
    const unknown = createPalette(true, 'dark', true, { name: 'does-not-exist' })
    assert.equal(unknown.accent('x'), '\u001b[38;2;250;179;135mx\u001b[39m')
  })
})
