/**
 * omp-titanium palette and derived pi-tui themes for the terminal front door.
 *
 * The role set mirrors the local omp harness's `titanium` dark theme tokens
 * (Tokyo-Night family): accent `#7aa2f7`, model `#bb9af7`, context `#2ac3de`,
 * spend `#7dcfff`, borders `#4c566a`, and the per-status tool background
 * fills. On non-truecolor terminals (and light schemes) the palette falls
 * back to the scheme-adaptive 16-color ANSI spec so the TUI stays legible on
 * any background; background roles emit nothing there.
 */

import type {
  MarkdownTheme,
  SelectListTheme,
  TerminalColorScheme,
} from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

export type { MarkdownTheme, SelectListTheme, TerminalColorScheme }

/** One color role: applies one foreground/background SGR span. */
export type ColorRole = (text: string) => string

/** One attribute role: composes with any color and preserves it. */
export type AttributeRole = (text: string) => string

/** Theme-agnostic role colors and SGR attribute wrappers. */
export interface Palette {
  accent: ColorRole
  /** DeepSeek brand ink; the startup gradient overrides it on truecolor terminals. */
  brand: ColorRole
  /** The terminal's own default foreground; still a role, so it does not stack. */
  text: ColorRole
  /** The one recessed tone: tool bodies, chrome, footers. */
  dim: ColorRole
  success: ColorRole
  warning: ColorRole
  error: ColorRole
  code: ColorRole
  /** Frame chrome: card borders, dialog edges. */
  border: ColorRole
  /** Status-line model segment. */
  model: ColorRole
  /** Status-line context segment. */
  context: ColorRole
  /** Status-line token/spend segment. */
  spend: ColorRole
  /** Reasoning label and border column. */
  thinking: ColorRole
  /** Block backgrounds, applied as full-row spans behind framed content. */
  userMessageBg: ColorRole
  toolPendingBg: ColorRole
  toolSuccessBg: ColorRole
  toolErrorBg: ColorRole
  statusLineBg: ColorRole
  bold: AttributeRole
  italic: AttributeRole
  underline: AttributeRole
  strike: AttributeRole
  /** Reverse video for the active selection. */
  selected: AttributeRole
}

/** Names of the palette's color roles, in the order `/palette` prints them. */
export const COLOR_ROLES = [
  'text', 'dim', 'accent', 'brand', 'code', 'success', 'warning', 'error',
  'border', 'model', 'context', 'spend', 'thinking',
  'userMessageBg', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg', 'statusLineBg',
] as const

/** Names of the palette's attribute roles, in the order `/palette` prints them. */
export const ATTRIBUTE_ROLES = ['bold', 'italic', 'underline', 'strike', 'selected'] as const

/** One role's SGR parameters and the reason it carries them. */
export interface RoleSpec {
  /** SGR parameters that open the span, without the `ESC [` prefix or `m` suffix. */
  readonly open: string
  /** SGR parameters that close it; MUST reset every group `open` sets. */
  readonly close: string
  /** What the role means, shown by `/palette`. */
  readonly purpose: string
}

type SpecTable = {
  readonly colors: Readonly<Record<typeof COLOR_ROLES[number], RoleSpec>>
  readonly attributes: Readonly<Record<typeof ATTRIBUTE_ROLES[number], RoleSpec>>
}

/**
 * Every SGR code the TUI is allowed to emit, keyed by role. This table is the
 * single source: {@link createPalette} derives the wrappers from it and
 * `/palette` prints it, so a role cannot exist in one and not the other, and
 * no component hand-writes an escape.
 *
 * Two specs exist:
 * - the omp-titanium truecolor spec, applied on dark-scheme truecolor
 *   terminals (values copied from the omp harness `titanium` theme);
 * - the 16-color ANSI spec, kept as the fallback on light schemes and
 *   non-truecolor terminals. There, background roles emit nothing and a
 *   terminal-remapped ANSI hue stands in for each foreground role.
 *
 * @param scheme - active terminal color scheme; the titanium spec is dark-only.
 * @param truecolor - whether the terminal supports 24-bit color.
 */
export function paletteSpec(scheme: TerminalColorScheme, truecolor = false): SpecTable {
  return truecolor && scheme === 'dark' ? titaniumSpec() : ansiSpec(scheme)
}

/** The titanium (omp dark theme) truecolor spec. */
function titaniumSpec(): SpecTable {
  const fg = (rgb: readonly [number, number, number], purpose: string): RoleSpec => ({
    open: `38;2;${rgb.join(';')}`,
    close: '39',
    purpose,
  })
  const bg = (rgb: readonly [number, number, number], purpose: string): RoleSpec => ({
    open: `48;2;${rgb.join(';')}`,
    close: '49',
    purpose,
  })
  return {
    colors: {
      text: { open: '', close: '', purpose: 'Body text, the terminal default foreground' },
      dim: fg([169, 177, 214], 'The one recessed tone: tool bodies, chrome, footers'),
      accent: fg([122, 162, 247], 'The one emphasis color: role headers, prompt, borders'),
      brand: fg([77, 107, 254], 'DeepSeek brand art when the gradient is unavailable'),
      code: fg([192, 202, 245], 'Inline code and code blocks in prose'),
      success: fg([158, 206, 106], "Succeeded calls, and a diff's added lines"),
      warning: fg([224, 175, 104], 'Pending calls and warnings'),
      error: fg([247, 118, 142], "Failures, signals, and a diff's removed lines"),
      border: fg([76, 86, 106], 'Frame chrome: card borders, dialog edges'),
      model: fg([187, 154, 247], 'Status-line model segment'),
      context: fg([42, 195, 222], 'Status-line context segment'),
      spend: fg([125, 207, 255], 'Status-line token/spend segment'),
      thinking: fg([122, 162, 247], 'Reasoning label and border column'),
      userMessageBg: bg([31, 35, 53], 'User message block background'),
      toolPendingBg: bg([31, 35, 53], 'Pending tool-card background'),
      toolSuccessBg: bg([31, 45, 42], 'Succeeded tool-card background'),
      toolErrorBg: bg([45, 31, 42], 'Failed tool-card background'),
      statusLineBg: bg([22, 22, 30], 'Status-line row background'),
    },
    attributes: {
      bold: { open: '1', close: '22', purpose: 'Emphasis; composes with any color' },
      italic: { open: '3', close: '23', purpose: 'Reasoning text' },
      underline: { open: '4', close: '24', purpose: 'Role-header banding' },
      strike: { open: '9', close: '29', purpose: 'Struck-through Markdown' },
      selected: { open: '7', close: '27', purpose: 'Reverse video for the active selection' },
    },
  }
}

/** The scheme-adaptive 16-color ANSI spec, used when truecolor is unavailable. */
function ansiSpec(scheme: TerminalColorScheme): SpecTable {
  return {
    colors: {
      text: { open: '', close: '', purpose: 'Body text, the terminal default foreground' },
      dim: { open: '2;39', close: '22;39', purpose: 'The one recessed tone: tool bodies, chrome, footers' },
      accent: { open: '95', close: '39', purpose: 'The one emphasis color: role headers, prompt, borders' },
      brand: { open: '34', close: '39', purpose: 'DeepSeek brand art when truecolor is unavailable' },
      code: scheme === 'light'
        ? { open: '34', close: '39', purpose: 'Inline code and code blocks in prose' }
        : { open: '36', close: '39', purpose: 'Inline code and code blocks in prose' },
      success: { open: '32', close: '39', purpose: "Succeeded calls, and a diff's added lines" },
      warning: { open: '33', close: '39', purpose: 'Pending calls and warnings' },
      error: { open: '31', close: '39', purpose: "Failures, signals, and a diff's removed lines" },
      border: { open: '2;39', close: '22;39', purpose: 'Frame chrome: card borders, dialog edges' },
      model: { open: '95', close: '39', purpose: 'Status-line model segment' },
      context: { open: '36', close: '39', purpose: 'Status-line context segment' },
      spend: { open: '96', close: '39', purpose: 'Status-line token/spend segment' },
      thinking: { open: '95', close: '39', purpose: 'Reasoning label and border column' },
      userMessageBg: { open: '', close: '', purpose: 'User message block background (none on ANSI fallback)' },
      toolPendingBg: { open: '', close: '', purpose: 'Pending tool-card background (none on ANSI fallback)' },
      toolSuccessBg: { open: '', close: '', purpose: 'Succeeded tool-card background (none on ANSI fallback)' },
      toolErrorBg: { open: '', close: '', purpose: 'Failed tool-card background (none on ANSI fallback)' },
      statusLineBg: { open: '', close: '', purpose: 'Status-line row background (none on ANSI fallback)' },
    },
    attributes: {
      bold: { open: '1', close: '22', purpose: 'Emphasis; composes with any color' },
      italic: { open: '3', close: '23', purpose: 'Reasoning text' },
      underline: { open: '4', close: '24', purpose: 'Role-header banding' },
      strike: { open: '9', close: '29', purpose: 'Struck-through Markdown' },
      selected: { open: '7', close: '27', purpose: 'Reverse video for the active selection' },
    },
  }
}

/**
 * Detect 24-bit color support, mirroring the omp harness's `detectColorMode`:
 * `COLORTERM=truecolor|24bit` or a Windows Terminal session admit truecolor;
 * `TERM` `dumb`/`linux`/empty deny it; anything else assumes truecolor.
 */
export function detectTruecolor(): boolean {
  const colorterm = process.env.COLORTERM
  if (colorterm === 'truecolor' || colorterm === '24bit') return true
  if (process.env.WT_SESSION !== undefined) return true
  const term = process.env.TERM ?? ''
  return term !== '' && term !== 'dumb' && term !== 'linux'
}

/** Wrap text in an SGR pair, or pass it through when color is disabled. */
function ansi(spec: RoleSpec, enabled: boolean): (text: string) => string {
  if (!enabled || spec.open === '') return (text: string) => text
  return (text: string) => `\x1b[${spec.open}m${text}\x1b[${spec.close}m`
}

/**
 * Palette derived from {@link paletteSpec}. On dark truecolor terminals the
 * omp-titanium roles apply; elsewhere the scheme-adaptive ANSI fallback keeps
 * the TUI legible.
 *
 * @param enabled - whether ANSI is emitted at all.
 * @param scheme - active terminal color scheme; the titanium spec applies to dark schemes only.
 * @param truecolor - terminal 24-bit support; omitted to auto-detect like omp's `detectColorMode`.
 */
export function createPalette(enabled: boolean, scheme: TerminalColorScheme = 'dark', truecolor?: boolean): Palette {
  const spec = paletteSpec(scheme, truecolor ?? detectTruecolor())
  const roles = {} as Record<string, unknown>
  for (const name of COLOR_ROLES) roles[name] = ansi(spec.colors[name], enabled)
  for (const name of ATTRIBUTE_ROLES) roles[name] = ansi(spec.attributes[name], enabled)
  return roles as unknown as Palette
}

/**
 * Derive the pi-tui Markdown theme from a role palette.
 * @param palette - active role palette.
 */
export function markdownTheme(palette: Palette): MarkdownTheme {
  return {
    heading: (text: string) => palette.accent(text),
    link: (text: string) => palette.accent(text),
    linkUrl: (text: string) => palette.dim(text),
    code: (text: string) => palette.code(text),
    codeBlock: (text: string) => palette.code(text),
    codeBlockBorder: (text: string) => palette.border(text),
    quote: (text: string) => palette.dim(text),
    quoteBorder: (text: string) => palette.accent(text),
    hr: (text: string) => palette.border(text),
    listBullet: (text: string) => palette.accent(text),
    bold: (text: string) => palette.bold(text),
    italic: (text: string) => palette.italic(text),
    strikethrough: (text: string) => palette.strike(text),
    underline: (text: string) => palette.underline(text),
  }
}

/** Derive the pi-tui select-list theme from a role palette. */
export function selectTheme(palette: Palette): SelectListTheme {
  return {
    selectedPrefix: palette.accent,
    selectedText: palette.accent,
    description: palette.dim,
    scrollInfo: palette.dim,
    noMatch: palette.warning,
  }
}

/**
 * Frame `lines` in a rounded omp-style box: `╭─…╮` / `│ … │` / `╰…╯`.
 * The optional `title` rides the top border; `background` fills every row.
 * Body rows carry `│ ` / ` │` side borders, so they wrap to `width - 4`;
 * corner rows span exactly `width`.
 */
export function frameBlock(
  lines: readonly string[],
  width: number,
  border: ColorRole,
  background: ColorRole | undefined,
  title?: string,
): string[] {
  const bodyInner = Math.max(1, width - 4)
  const paint = (row: string): string => background === undefined ? row : background(row)
  const body = lines.map((line) => {
    const clipped = truncateToWidth(line, bodyInner, '')
    const pad = ' '.repeat(Math.max(0, bodyInner - visibleWidth(clipped)))
    return paint(`${border('│')} ${clipped}${pad} ${border('│')}`)
  })
  const dashes = Math.max(0, width - 2)
  const top = title === undefined
    ? paint(border(`╭${'─'.repeat(dashes)}╮`))
    : (() => {
      const clippedTitle = truncateToWidth(title, Math.max(1, width - 4), '')
      const tail = Math.max(0, width - 4 - visibleWidth(clippedTitle))
      return paint(border(`╭─ ${clippedTitle}${'─'.repeat(tail)}╮`))
    })()
  return [top, ...body, paint(border(`╰${'─'.repeat(dashes)}╯`))]
}

/** Sample text every `/palette` row renders, long enough to judge a tone against its neighbours. */
const PALETTE_SAMPLE = 'The quick brown fox 0123'

/**
 * Render every palette role as a labelled sample row, each painted by the role
 * it names, so a reader compares the actual tones their terminal produces.
 */
export function renderPalette(
  palette: Palette,
  scheme: TerminalColorScheme,
  colorEnabled: boolean,
  truecolor: boolean,
): string[] {
  const spec = paletteSpec(scheme, truecolor)
  const width = Math.max(...[...COLOR_ROLES, ...ATTRIBUTE_ROLES].map(name => name.length))
  const head = (name: string, role: RoleSpec, sample: string): string => {
    const pair = role.open === '' ? 'no escape' : `ESC[${role.open}m ESC[${role.close}m`
    return `  ${sample}  ${palette.dim(`${name.padEnd(width)} ${pair}`)}`
  }
  const purpose = (role: RoleSpec): string => `  ${palette.dim(`    ${role.purpose}`)}`
  const rows = [
    palette.bold(palette.accent('Palette')),
    palette.dim(`${scheme} scheme · color ${colorEnabled ? 'on' : 'off'}`),
    '',
    palette.dim('Colors — exactly one per span; they never nest inside each other.'),
  ]
  for (const name of COLOR_ROLES) {
    rows.push(head(name, spec.colors[name], palette[name](PALETTE_SAMPLE)), purpose(spec.colors[name]))
  }
  rows.push('', palette.dim('Attributes — compose with any color, in either order.'))
  for (const name of ATTRIBUTE_ROLES) {
    rows.push(head(name, spec.attributes[name], palette[name](PALETTE_SAMPLE)), purpose(spec.attributes[name]))
  }
  return rows
}

/** Official DeepSeek icon ink from the shipped 24x24 SVG. */
const DEEPSEEK_BRAND_RGB: readonly [number, number, number] = [77, 107, 254] // #4D6BFE

/**
 * Paint trusted static DeepSeek brand art with the official `#4D6BFE` ink.
 * @param text - static brand text or raster cells.
 */
export function brandText(text: string): string {
  return `\x1b[38;2;${DEEPSEEK_BRAND_RGB.join(';')}m${text}\x1b[39m`
}

/** DeepSeek brand gradient stops (indigo → light blue) from the logo. */
const BRAND_GRADIENT = [
  [77, 107, 254], // #4D6BFE
  [57, 130, 255], // #3982FF
  [36, 152, 255], // #2498FF
] as const

/**
 * Paint `text` left-to-right in the DeepSeek brand gradient with per-character
 * truecolor spans. Used by the startup banner's product name on truecolor
 * terminals; fixed brand identity, deliberately outside the theme-adaptive
 * {@link Palette}.
 */
export function gradientText(text: string): string {
  const stops = BRAND_GRADIENT.length - 1
  let out = ''
  for (let index = 0; index < text.length; index++) {
    const t = stops === 0 ? 0 : index / (text.length - 1)
    const scaled = t * stops
    const segment = Math.min(stops, Math.floor(scaled))
    const frac = scaled - segment
    const from = BRAND_GRADIENT[segment] ?? BRAND_GRADIENT[0]!
    const to = BRAND_GRADIENT[Math.min(stops, segment + 1)] ?? from
    const rgb = from.map((channel, channelIndex) =>
      Math.round(channel + (to[channelIndex]! - channel) * frac))
    out += `\x1b[38;2;${rgb.join(';')}m${text[index] ?? ''}\x1b[39m`
  }
  return out
}
