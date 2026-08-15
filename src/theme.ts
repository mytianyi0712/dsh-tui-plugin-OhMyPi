/**
 * Palette and layout primitives matching the OMP installation on this machine.
 *
 * The default dark roles mirror OMP 17.2.15's active `dark-catppuccin` theme:
 * peach accents, blue/lavender chrome, mantle message surfaces, and a crust
 * status surface. Non-truecolor terminals keep a readable ANSI fallback and
 * omit background fills that cannot be represented reliably.
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
  /** The terminal's own default foreground; still a role, so it does not stack. */
  text: ColorRole
  /** Low-emphasis content and secondary chrome. */
  muted: ColorRole
  /** The quietest foreground tone. */
  dim: ColorRole
  success: ColorRole
  warning: ColorRole
  error: ColorRole
  code: ColorRole
  /** Accent frame chrome. */
  border: ColorRole
  /** Recessed card and editor chrome. */
  borderMuted: ColorRole
  toolTitle: ColorRole
  toolOutput: ColorRole
  /** Status-line path and branch segments. */
  path: ColorRole
  git: ColorRole
  /** Status-line model segment. */
  model: ColorRole
  /** Status-line context segment. */
  context: ColorRole
  /** Status-line token/spend segment. */
  spend: ColorRole
  statusSep: ColorRole
  /** Reasoning prose. */
  thinking: ColorRole
  /** Full-row block backgrounds. */
  userMessageBg: ColorRole
  toolPendingBg: ColorRole
  toolSuccessBg: ColorRole
  toolErrorBg: ColorRole
  statusLineBg: ColorRole
  /** Powerline tail foreground, derived from `statusLineBg` so both always match. */
  statusLineTail: ColorRole
  bold: AttributeRole
  italic: AttributeRole
  underline: AttributeRole
  strike: AttributeRole
  /** Reverse video for the active selection. */
  selected: AttributeRole
}

/** Names of the palette's color roles, in the order `/palette` prints them. */
export const COLOR_ROLES = [
  'text', 'muted', 'dim', 'accent', 'code', 'success', 'warning', 'error',
  'border', 'borderMuted', 'toolTitle', 'toolOutput', 'path', 'git', 'model',
  'context', 'spend', 'statusSep', 'thinking', 'userMessageBg', 'toolPendingBg',
  'toolSuccessBg', 'toolErrorBg', 'statusLineBg',
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

/** One RGB channel triple for a truecolor role. */
export type Rgb = readonly [number, number, number]

/** A named truecolor theme: every color role except `text` has an RGB value. */
export interface ThemeDefinition {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly roles: Readonly<Record<ColorRoleName, Rgb>>
}

export type ColorRoleName = typeof COLOR_ROLES[number]

/** Role purpose sentences shown by `/palette`, shared by every theme. */
const ROLE_PURPOSES: Readonly<Record<ColorRoleName, string>> = {
  text: 'Body text, using the terminal foreground',
  muted: 'Secondary prose and tool output',
  dim: 'Quiet chrome, metadata, and inactive content',
  accent: 'Primary emphasis and the composer rails',
  code: 'Inline code',
  success: 'Successful operations and additions',
  warning: 'Pending operations and warnings',
  error: 'Failures and removals',
  border: 'Accent frame chrome',
  borderMuted: 'Recessed frame and editor chrome',
  toolTitle: 'Tool-card titles',
  toolOutput: 'Tool-card output',
  path: 'Status-line path',
  git: 'Clean Git branch',
  model: 'Status-line model',
  context: 'Status-line context usage',
  spend: 'Status-line token usage',
  statusSep: 'Status-line separators',
  thinking: 'Reasoning prose',
  userMessageBg: 'User-message surface (mantle)',
  toolPendingBg: 'Pending tool surface (surface0)',
  toolSuccessBg: 'Successful tool surface (mantle)',
  toolErrorBg: 'Failed tool surface (crust)',
  statusLineBg: 'Status segment surface (crust)',
}

/** Background roles get `48;2;…` spans; everything else is foreground. */
const BACKGROUND_ROLES = new Set<ColorRoleName>([
  'userMessageBg', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg', 'statusLineBg',
])

/** OMP 17.2.15 `dark-catppuccin`, the default local OMP dark theme. */
const CATPPUCCIN_ROLES: Readonly<Record<ColorRoleName, Rgb>> = {
  text: [0, 0, 0], // placeholder: text stays the terminal default
  muted: [127, 132, 156],
  dim: [108, 112, 134],
  accent: [250, 179, 135],
  code: [245, 224, 220],
  success: [166, 227, 161],
  warning: [249, 226, 175],
  error: [243, 139, 168],
  border: [137, 180, 250],
  borderMuted: [49, 50, 68],
  toolTitle: [180, 190, 254],
  toolOutput: [127, 132, 156],
  path: [148, 226, 213],
  git: [249, 226, 175],
  model: [245, 194, 231],
  context: [203, 166, 247],
  spend: [116, 199, 236],
  statusSep: [69, 71, 90],
  thinking: [127, 132, 156],
  userMessageBg: [24, 24, 37],
  toolPendingBg: [49, 50, 68],
  toolSuccessBg: [24, 24, 37],
  toolErrorBg: [17, 17, 27],
  statusLineBg: [17, 17, 27],
}

/** Tokyo Night variant, the alternative built-in theme. */
const TOKYO_NIGHT_ROLES: Readonly<Record<ColorRoleName, Rgb>> = {
  text: [0, 0, 0],
  muted: [169, 177, 214],
  dim: [86, 95, 137],
  accent: [122, 162, 247],
  code: [192, 202, 245],
  success: [158, 206, 106],
  warning: [224, 175, 104],
  error: [247, 118, 142],
  border: [76, 86, 106],
  borderMuted: [41, 46, 66],
  toolTitle: [192, 202, 245],
  toolOutput: [169, 177, 214],
  path: [125, 207, 255],
  git: [224, 175, 104],
  model: [187, 154, 247],
  context: [42, 195, 222],
  spend: [125, 207, 255],
  statusSep: [59, 66, 97],
  thinking: [122, 162, 247],
  userMessageBg: [31, 35, 53],
  toolPendingBg: [31, 35, 53],
  toolSuccessBg: [31, 45, 42],
  toolErrorBg: [45, 31, 42],
  statusLineBg: [22, 22, 30],
}

/** Built-in themes; the first entry is the default when `theme.name` is unset or unknown. */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = [
  { id: 'catppuccin', label: 'Catppuccin', description: 'OMP 17.2.15 dark-catppuccin (default)', roles: CATPPUCCIN_ROLES },
  { id: 'tokyo-night', label: 'Tokyo Night', description: 'Tokyo-Night family variant', roles: TOKYO_NIGHT_ROLES },
]

/** Find a built-in theme by id, falling back to the default theme. */
export function findTheme(id: string | undefined): ThemeDefinition {
  return BUILTIN_THEMES.find(theme => theme.id === id) ?? BUILTIN_THEMES[0]!
}

/** User-supplied per-role overrides; triples are validated at resolve time. */
export type ThemeCustom = Readonly<Record<string, readonly number[]>>

/**
 * Merge a built-in theme's roles with user overrides. Unknown role names and
 * malformed RGB values are dropped silently; `text` cannot be overridden.
 */
export function resolveThemeRoles(
  name: string | undefined,
  custom: ThemeCustom | undefined,
): Readonly<Record<ColorRoleName, Rgb>> {
  const base = findTheme(name).roles
  if (custom === undefined) return base
  const merged = { ...base } as Record<ColorRoleName, Rgb>
  for (const key of Object.keys(custom)) {
    if (key === 'text') continue
    const rgb = custom[key]
    if (key in merged && Array.isArray(rgb) && rgb.length === 3 && rgb.every(channel => Number.isFinite(channel))) {
      merged[key as ColorRoleName] = [rgb[0]!, rgb[1]!, rgb[2]!]
    }
  }
  return merged
}

/** Attribute specs shared by every truecolor theme. */
const ATTRIBUTE_SPECS: Readonly<Record<typeof ATTRIBUTE_ROLES[number], RoleSpec>> = {
  bold: { open: '1', close: '22', purpose: 'Emphasis; composes with any color' },
  italic: { open: '3', close: '23', purpose: 'Reasoning and hint prose' },
  underline: { open: '4', close: '24', purpose: 'Links and selected labels' },
  strike: { open: '9', close: '29', purpose: 'Struck-through Markdown' },
  selected: { open: '7', close: '27', purpose: 'Reverse video for the active selection' },
}

/** The truecolor spec for one theme name plus optional per-role overrides. */
export function themeSpec(
  name: string | undefined,
  custom: ThemeCustom | undefined,
): SpecTable {
  const roles = resolveThemeRoles(name, custom)
  const colors = {} as Record<ColorRoleName, RoleSpec>
  for (const role of COLOR_ROLES) {
    if (role === 'text') {
      colors.text = { open: '', close: '', purpose: ROLE_PURPOSES.text }
      continue
    }
    const rgb = roles[role]
    const bg = BACKGROUND_ROLES.has(role)
    colors[role] = {
      open: `${bg ? '48' : '38'};2;${rgb.join(';')}`,
      close: bg ? '49' : '39',
      purpose: ROLE_PURPOSES[role],
    }
  }
  return { colors, attributes: ATTRIBUTE_SPECS }
}

/**
 * Every SGR code the TUI may emit, keyed by semantic role. `/palette` reads the
 * same table, preventing the diagnostic view from drifting from rendering.
 */
export function paletteSpec(
  scheme: TerminalColorScheme,
  truecolor = false,
  themeName?: string,
  themeCustom?: ThemeCustom,
): SpecTable {
  return truecolor && scheme === 'dark' ? themeSpec(themeName, themeCustom) : ansiSpec(scheme)
}

/** Scheme-adaptive ANSI fallback for terminals without truecolor. */
function ansiSpec(scheme: TerminalColorScheme): SpecTable {
  const none = (purpose: string): RoleSpec => ({ open: '', close: '', purpose })
  return {
    colors: {
      text: none('Body text, using the terminal foreground'),
      muted: { open: '2;39', close: '22;39', purpose: 'Secondary prose and tool output' },
      dim: { open: '2;39', close: '22;39', purpose: 'Quiet chrome and metadata' },
      accent: { open: '93', close: '39', purpose: 'Primary emphasis' },
      code: scheme === 'light'
        ? { open: '35', close: '39', purpose: 'Inline code' }
        : { open: '96', close: '39', purpose: 'Inline code' },
      success: { open: '32', close: '39', purpose: 'Successful operations and additions' },
      warning: { open: '33', close: '39', purpose: 'Pending operations and warnings' },
      error: { open: '31', close: '39', purpose: 'Failures and removals' },
      border: { open: '94', close: '39', purpose: 'Accent frame chrome' },
      borderMuted: { open: '2;39', close: '22;39', purpose: 'Recessed frame and editor chrome' },
      toolTitle: { open: '95', close: '39', purpose: 'Tool-card titles' },
      toolOutput: { open: '2;39', close: '22;39', purpose: 'Tool-card output' },
      path: { open: '36', close: '39', purpose: 'Status-line path' },
      git: { open: '32', close: '39', purpose: 'Clean Git branch' },
      model: { open: '95', close: '39', purpose: 'Status-line model' },
      context: { open: '95', close: '39', purpose: 'Status-line context usage' },
      spend: { open: '96', close: '39', purpose: 'Status-line token usage' },
      statusSep: { open: '2;39', close: '22;39', purpose: 'Status-line separators' },
      thinking: { open: '2;39', close: '22;39', purpose: 'Reasoning prose' },
      userMessageBg: none('User-message background unavailable in ANSI fallback'),
      toolPendingBg: none('Pending tool background unavailable in ANSI fallback'),
      toolSuccessBg: none('Successful tool background unavailable in ANSI fallback'),
      toolErrorBg: none('Failed tool background unavailable in ANSI fallback'),
      statusLineBg: none('Status background unavailable in ANSI fallback'),
    },
    attributes: ATTRIBUTE_SPECS,
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
  const open = `\x1b[${spec.open}m`
  const close = `\x1b[${spec.close}m`
  if (!spec.open.startsWith('48;')) return (text: string) => `${open}${text}${close}`
  return (text: string) => {
    const stable = text
      .replace(/\x1b\[(?:0)?m/g, reset => `${reset}${open}`)
      .replace(/\x1b\[49m/g, reset => `${reset}${open}`)
    return `${open}${stable}${close}`
  }
}

/** Runtime theme selection: built-in name plus optional per-role RGB overrides. */
export interface ThemeOverride {
  readonly name?: string
  readonly custom?: ThemeCustom
}

/**
 * Derive a palette from the active theme spec.
 *
 * @param enabled - whether ANSI is emitted at all.
 * @param scheme - active terminal color scheme; truecolor themes apply to dark schemes only.
 * @param truecolor - terminal 24-bit support; omitted to auto-detect like OMP.
 * @param theme - built-in theme name and per-role overrides; defaults to the first built-in theme.
 */
export function createPalette(
  enabled: boolean,
  scheme: TerminalColorScheme = 'dark',
  truecolor?: boolean,
  theme?: ThemeOverride,
): Palette {
  const spec = paletteSpec(scheme, truecolor ?? detectTruecolor(), theme?.name, theme?.custom)
  const roles = {} as Record<string, unknown>
  for (const name of COLOR_ROLES) roles[name] = ansi(spec.colors[name], enabled)
  for (const name of ATTRIBUTE_ROLES) roles[name] = ansi(spec.attributes[name], enabled)
  const surface = spec.colors.statusLineBg
  roles.statusLineTail = ansi({
    open: surface.open.replace(/^48;/, '38;'),
    close: surface.open.startsWith('48;') ? '39' : surface.close,
    purpose: 'Powerline tail matching the status segment surface',
  }, enabled)
  return roles as unknown as Palette
}

/**
 * Derive the pi-tui Markdown theme from a role palette.
 * @param palette - active role palette.
 */
export function markdownTheme(palette: Palette): MarkdownTheme {
  return {
    heading: (text: string) => palette.accent(text),
    link: (text: string) => palette.border(text),
    linkUrl: (text: string) => palette.dim(text),
    code: (text: string) => palette.code(text),
    codeBlock: (text: string) => palette.text(text),
    codeBlockBorder: (text: string) => palette.borderMuted(text),
    quote: (text: string) => palette.muted(text),
    quoteBorder: (text: string) => palette.borderMuted(text),
    hr: (text: string) => palette.borderMuted(text),
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
 * Frame rows with OMP's rounded output-block grammar. Titles begin after a
 * three-cell cap (`╭─── title ─╮`); an optional section label adds the matching
 * `├─── label ─┤` divider used by settled tool results.
 */
export function frameBlock(
  lines: readonly string[],
  width: number,
  border: ColorRole,
  background: ColorRole | undefined,
  title?: string,
  sectionTitle?: string,
): string[] {
  const bodyInner = Math.max(1, width - 4)
  const paint = (row: string): string => background === undefined ? row : background(row)
  const bar = (left: string, right: string, label?: string): string => {
    const innerWidth = Math.max(0, width - 2)
    if (label === undefined) return paint(border(`${left}${'─'.repeat(innerWidth)}${right}`))
    const cap = '───'
    const labelBudget = Math.max(0, innerWidth - cap.length)
    const clippedLabel = truncateToWidth(` ${label} `, labelBudget, '')
    const fill = '─'.repeat(Math.max(0, innerWidth - cap.length - visibleWidth(clippedLabel)))
    return paint(`${border(`${left}${cap}`)}${clippedLabel}${border(`${fill}${right}`)}`)
  }
  const body = lines.map((line) => {
    const clipped = truncateToWidth(line, bodyInner, '')
    const pad = ' '.repeat(Math.max(0, bodyInner - visibleWidth(clipped)))
    return paint(`${border('│')} ${clipped}${pad} ${border('│')}`)
  })
  return [
    bar('╭', '╮', title),
    ...sectionTitle === undefined ? [] : [bar('├', '┤', sectionTitle)],
    ...body,
    bar('╰', '╯'),
  ]
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

/** OMP's welcome-screen gradient, hot pink through violet and cyan to mint. */
const BRAND_GRADIENT = [
  [255, 92, 200],
  [200, 110, 255],
  [120, 130, 255],
  [60, 200, 255],
  [120, 255, 220],
] as const

/** Paint a multi-line logo with a stable diagonal OMP-style gradient. */
export function gradientLogo(lines: readonly string[]): string[] {
  const rows = lines.length
  const columns = Math.max(1, ...lines.map(line => line.length))
  const span = Math.max(1, columns + rows - 1)
  return lines.map((line, row) => {
    let out = ''
    for (let column = 0; column < line.length; column++) {
      const char = line[column] ?? ''
      if (char === ' ') {
        out += char
        continue
      }
      const position = (column + rows - 1 - row) / span
      const scaled = position * (BRAND_GRADIENT.length - 1)
      const segment = Math.min(BRAND_GRADIENT.length - 2, Math.floor(scaled))
      const fraction = scaled - segment
      const from = BRAND_GRADIENT[segment] ?? BRAND_GRADIENT[0]!
      const to = BRAND_GRADIENT[segment + 1] ?? from
      const rgb = from.map((channel, index) =>
        Math.round(channel + (to[index]! - channel) * fraction))
      out += `\x1b[38;2;${rgb.join(';')}m${char}\x1b[39m`
    }
    return out
  })
}
