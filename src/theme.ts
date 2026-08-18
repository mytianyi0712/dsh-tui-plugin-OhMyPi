/**
 * Palette and layout primitives matching the OMP installation on this machine.
 *
 * The catalog is generated from every OMP theme bundled in the local `omp`
 * executable (`src/theme-data.ts`). Users choose concrete OMP themes only
 * (`dark-catppuccin`, `light-catppuccin`, `alabaster`, …); the runtime
 * selection model is either a single fixed theme (`selected`) or a dark/light
 * pair (`dynamic`) whose slot is chosen from the terminal color scheme.
 */

import type {
  MarkdownTheme,
  SelectListTheme,
  TerminalColorScheme,
} from '@earendil-works/pi-tui'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { THEME_DATA, type Rgb, type ThemeScheme } from './theme-data.ts'

export type { MarkdownTheme, SelectListTheme, TerminalColorScheme, Rgb, ThemeScheme }

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

/** A named truecolor theme: every color role except `text` has an RGB value. */
export interface ThemeDefinition {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly scheme: ThemeScheme
  readonly roles: Readonly<Record<ColorRoleName, Rgb>>
}

export type ColorRoleName = typeof COLOR_ROLES[number]

/** How the runtime theme is chosen. */
export type ThemeMode = 'dynamic' | 'selected'

/**
 * The user-facing theme selection.
 *
 * - `selected`: one fixed theme id, used for both terminal schemes.
 * - `dynamic`: two independent slots; the terminal scheme picks one.
 */
export interface ThemeSelection {
  readonly mode: ThemeMode
  /** Fixed theme id when `mode` is `selected`. */
  readonly selectedId?: string
  /** Theme id used while the terminal reports a dark scheme. */
  readonly darkId?: string
  /** Theme id used while the terminal reports a light scheme. */
  readonly lightId?: string
}

export const DEFAULT_THEME_DARK = 'dark-catppuccin'
export const DEFAULT_THEME_LIGHT = 'light-catppuccin'
export const DEFAULT_THEME_SELECTED = 'dark-catppuccin'

export const DEFAULT_THEME_SELECTION: ThemeSelection = {
  mode: 'dynamic',
  darkId: DEFAULT_THEME_DARK,
  lightId: DEFAULT_THEME_LIGHT,
}

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

/** All concrete OMP themes as this TUI's role definitions. */
const CONCRETE_THEMES: readonly ThemeDefinition[] = THEME_DATA.map(data => ({
  id: data.id,
  label: data.label,
  description: data.description,
  scheme: data.scheme,
  roles: data.roles as Readonly<Record<ColorRoleName, Rgb>>,
}))

/**
 * Built-in theme catalog: the 98 concrete OMP themes. There are no preset
 * dark/light family groups; pairing is entirely user-defined.
 */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = CONCRETE_THEMES

/** Find a concrete theme by id, or `undefined` when unknown. */
export function findTheme(id: string | undefined): ThemeDefinition | undefined {
  if (id === undefined) return undefined
  return BUILTIN_THEMES.find(theme => theme.id === id)
}

function validThemeId(id: string | undefined): string | undefined {
  return findTheme(id)?.id
}

/** The first concrete theme, used as a last-resort fallback. */
function firstThemeId(): string {
  return BUILTIN_THEMES[0]?.id ?? DEFAULT_THEME_DARK
}

/** Resolve the concrete theme id for a selection and terminal scheme. */
export function resolveThemeId(
  selection: ThemeSelection | undefined,
  scheme: TerminalColorScheme = 'dark',
): string {
  const mode = selection?.mode ?? DEFAULT_THEME_SELECTION.mode
  const wanted = mode === 'selected'
    ? selection?.selectedId
    : scheme === 'light'
      ? selection?.lightId
      : selection?.darkId
  return validThemeId(wanted)
    ?? validThemeId(scheme === 'light' ? DEFAULT_THEME_LIGHT : DEFAULT_THEME_DARK)
    ?? validThemeId(scheme === 'light' ? DEFAULT_THEME_DARK : DEFAULT_THEME_LIGHT)
    ?? firstThemeId()
}

/** Resolve the concrete theme for a selection and terminal scheme. */
export function resolveTheme(
  selection: ThemeSelection | undefined,
  scheme: TerminalColorScheme = 'dark',
): ThemeDefinition {
  return findTheme(resolveThemeId(selection, scheme)) ?? CONCRETE_THEMES[0]!
}

/**
 * Compatibility helper for callers that still think in terms of one theme id.
 * It only resolves concrete ids; old family ids such as `catppuccin` no longer
 * exist in the catalog and fall back to the default concrete theme.
 */
export function findThemeForScheme(
  name: string | undefined,
  scheme: TerminalColorScheme = 'dark',
): ThemeDefinition {
  return findTheme(name) ?? resolveTheme(undefined, scheme)
}

/** User-supplied per-role overrides; triples are validated at resolve time. */
export type ThemeCustom = Readonly<Record<string, readonly number[]>>

/**
 * Merge a concrete theme's roles with user overrides. Unknown role names and
 * malformed RGB values are dropped silently; `text` cannot be overridden.
 */
export function resolveThemeRoles(
  themeId: string | undefined,
  custom: ThemeCustom | undefined,
): Readonly<Record<ColorRoleName, Rgb>> {
  const base = (findTheme(themeId) ?? resolveTheme(undefined, 'dark')).roles
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

/** The truecolor spec for one concrete theme id plus optional overrides. */
export function themeSpec(
  themeId: string | undefined,
  custom: ThemeCustom | undefined,
): SpecTable {
  const roles = resolveThemeRoles(themeId, custom)
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
  selection?: ThemeSelection,
  themeCustom?: ThemeCustom,
): SpecTable {
  if (!truecolor) return ansiSpec(scheme)
  return themeSpec(resolveThemeId(selection, scheme), themeCustom)
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

/** Runtime theme selection: mode plus the concrete ids for each slot. */
export interface ThemeOverride {
  readonly mode?: ThemeMode
  /** Fixed theme id for `selected` mode. */
  readonly selectedId?: string
  /** Theme id for the dark slot in `dynamic` mode. */
  readonly darkId?: string
  /** Theme id for the light slot in `dynamic` mode. */
  readonly lightId?: string
  readonly custom?: ThemeCustom
}

/** Normalize a partial override into a complete selection. */
export function selectionFromOverride(theme: ThemeOverride | undefined): ThemeSelection {
  const mode = theme?.mode ?? DEFAULT_THEME_SELECTION.mode
  return {
    mode,
    selectedId: theme?.selectedId ?? DEFAULT_THEME_SELECTION.selectedId,
    darkId: theme?.darkId ?? DEFAULT_THEME_SELECTION.darkId,
    lightId: theme?.lightId ?? DEFAULT_THEME_SELECTION.lightId,
  }
}

/**
 * Derive a palette from the active theme selection.
 *
 * @param enabled - whether ANSI is emitted at all.
 * @param scheme - active terminal color scheme; `dynamic` mode follows it.
 * @param truecolor - terminal 24-bit support; omitted to auto-detect like OMP.
 * @param theme - runtime theme selection; defaults to dynamic dark/light Catppuccin.
 */
export function createPalette(
  enabled: boolean,
  scheme: TerminalColorScheme = 'dark',
  truecolor?: boolean,
  theme?: ThemeOverride,
): Palette {
  const selection = selectionFromOverride(theme)
  const spec = paletteSpec(scheme, truecolor ?? detectTruecolor(), selection, theme?.custom)
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
  theme?: ThemeOverride,
): string[] {
  const spec = paletteSpec(scheme, truecolor, selectionFromOverride(theme), theme?.custom)
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
