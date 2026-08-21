/**
 * Serializable configuration and defaults for the omp-styled terminal mode.
 * The bundle's `tui` row carries these; schemastery validates the shape.
 */

import z from '@deepseek-ai/schemastery'
import type { Locale } from './i18n.ts'
import type { ThemeMode } from './theme.ts'
import { THEME_DATA } from './theme-data.ts'

/** Shipped working modes (backend compositions); locally installed presets use any other id. */
export type UiMode = 'standard' | 'minimal' | 'code' | 'cordis'

/** Theme and prompt-template settings. */
export interface TuiThemeConfig {
  /** Apply the ANSI palette at all. */
  color?: boolean
  /** Paint the startup banner with the 24-bit brand gradient. */
  truecolor?: boolean
  /**
   * Theme selection mode: `dynamic` follows the terminal scheme, `selected`
   * uses one fixed theme.
   */
  mode?: ThemeMode
  /** Theme id used while the terminal reports a dark scheme (`dynamic` mode). */
  dark?: string
  /** Theme id used while the terminal reports a light scheme (`dynamic` mode). */
  light?: string
  /** Fixed theme id for `selected` mode. */
  selected?: string
  /**
   * Deprecated single-theme id. Migrated to `mode`/`dark`/`light`/`selected`
   * at resolve time; kept only for backwards compatibility.
   */
  name?: string
  /** Per-role truecolor overrides on top of the selected theme, e.g. `{ accent: [250, 179, 135] }`. */
  custom?: Record<string, number[]>
  /** Template embedded in the rail above the editor. */
  leftPrompt?: string
  /** Template rendered below the editor's bottom rail. */
  rightPrompt?: string
  /** Template used as the editor's first-line prefix. */
  inputPrompt?: string
  /** Static placeholder shown in an empty editor while the agent is running. */
  inputPlaceholder?: string
}

/** Interaction and presentation settings. */
export interface TuiConfig {
  /** Render model reasoning blocks. */
  showReasoning?: boolean
  /** Maximum tool-card body lines retained in its collapsed preview. */
  maxToolOutputLines?: number
  /** Reasoning effort used before a session has a recorded request header. */
  defaultReasoningEffort?: string
  theme?: TuiThemeConfig
  /** Backend composition preset for blank sessions: any shipped or locally installed preset id. */
  mode?: string
  /** UI language; `zh-CN` is the default, `en` is fully supported. */
  locale?: Locale
  /** Terminal title. */
  title?: string
}

export const DEFAULT_LEFT_PROMPT = '${mode}${cwd}${git/worktree}'
export const DEFAULT_RIGHT_PROMPT = '${model}${effort}${context}${permission}${queued}'
export const DEFAULT_INPUT_PROMPT = '${indicator}'
export const DEFAULT_INPUT_PLACEHOLDER = ''

export const DEFAULT_THEME_MODE: ThemeMode = 'dynamic'
export const DEFAULT_THEME_DARK = 'dark-catppuccin'
export const DEFAULT_THEME_LIGHT = 'light-catppuccin'
export const DEFAULT_THEME_SELECTED = 'dark-catppuccin'

export const DEFAULT_MODE: string = 'standard'
export const DEFAULT_LOCALE: Locale = 'zh-CN'
export const DEFAULT_REASONING_EFFORT = 'max'

const themeSchema = z.object({
  color: z.boolean().default(true),
  truecolor: z.boolean(),
  mode: z.union([z.const('dynamic'), z.const('selected')]),
  dark: z.string(),
  light: z.string(),
  selected: z.string(),
  name: z.string(),
  custom: z.dict(z.array(z.number().min(0).max(255)).min(3).max(3), z.string()),
  leftPrompt: z.string().default(DEFAULT_LEFT_PROMPT),
  rightPrompt: z.string().default(DEFAULT_RIGHT_PROMPT),
  inputPrompt: z.string().default(DEFAULT_INPUT_PROMPT),
  inputPlaceholder: z.string().default(DEFAULT_INPUT_PLACEHOLDER),
})

/** Alias kept for consumers that name the plugin config `Config`. */
export type Config = TuiConfig

/** Schemastery schema for presentation settings embedded by the bundle. */
export const TuiConfigSchema: z<TuiConfig> = z.object({
  showReasoning: z.boolean().default(true),
  maxToolOutputLines: z.number().step(1).min(1).default(6),
  defaultReasoningEffort: z.string().default(DEFAULT_REASONING_EFFORT),
  theme: themeSchema,
  mode: z.string().default(DEFAULT_MODE),
  locale: z.union([z.const('zh-CN'), z.const('en')]).default(DEFAULT_LOCALE),
  title: z.string().default('dsh'),
})

/** Fully defaulted theme settings. */
export interface ResolvedTuiThemeConfig {
  color: boolean
  truecolor: boolean
  mode: ThemeMode
  dark: string
  light: string
  selected: string
  custom: Record<string, number[]> | undefined
  leftPrompt: string
  rightPrompt: string
  inputPrompt: string
  inputPlaceholder: string
}

/** Fully defaulted presentation settings. */
export interface ResolvedTuiConfig {
  showReasoning: boolean
  maxToolOutputLines: number
  defaultReasoningEffort: string
  theme: ResolvedTuiThemeConfig
  mode: string
  locale: Locale
  title: string
}

const CONCRETE_THEME_IDS = new Set(THEME_DATA.map(theme => theme.id))

function isConcreteThemeId(id: string | undefined): id is string {
  return id !== undefined && CONCRETE_THEME_IDS.has(id)
}

/** Resolve a deprecated `theme.name` into the new mode/dark/light/selected fields. */
function migrateLegacyThemeName(
  name: string | undefined,
): Pick<ResolvedTuiThemeConfig, 'mode' | 'dark' | 'light' | 'selected'> {
  if (isConcreteThemeId(name)) {
    return { mode: 'selected', dark: DEFAULT_THEME_DARK, light: DEFAULT_THEME_LIGHT, selected: name }
  }
  if (name !== undefined && isConcreteThemeId(`dark-${name}`) && isConcreteThemeId(`light-${name}`)) {
    return { mode: 'dynamic', dark: `dark-${name}`, light: `light-${name}`, selected: DEFAULT_THEME_SELECTED }
  }
  return {
    mode: DEFAULT_THEME_MODE,
    dark: DEFAULT_THEME_DARK,
    light: DEFAULT_THEME_LIGHT,
    selected: DEFAULT_THEME_SELECTED,
  }
}

/** Apply direct-call defaults after Loader schema validation has normally run. */
export function resolveTuiConfig(config: TuiConfig | undefined): ResolvedTuiConfig {
  const theme = config?.theme
  const legacy = theme?.name !== undefined && theme?.mode === undefined
    ? migrateLegacyThemeName(theme.name)
    : undefined

  let mode: ThemeMode = theme?.mode ?? DEFAULT_THEME_MODE
  let dark = theme?.dark ?? DEFAULT_THEME_DARK
  let light = theme?.light ?? DEFAULT_THEME_LIGHT
  let selected = theme?.selected ?? DEFAULT_THEME_SELECTED

  if (legacy !== undefined) {
    mode = legacy.mode
    dark = legacy.dark
    light = legacy.light
    selected = legacy.selected
  } else if (theme?.mode === undefined) {
    // Infer mode from which new fields were explicitly supplied.
    if (theme?.selected !== undefined && theme?.dark === undefined && theme?.light === undefined) {
      mode = 'selected'
    } else if (theme?.dark !== undefined || theme?.light !== undefined) {
      mode = 'dynamic'
    }
  }

  return {
    showReasoning: config?.showReasoning ?? true,
    maxToolOutputLines: config?.maxToolOutputLines ?? 6,
    defaultReasoningEffort: config?.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    theme: {
      color: theme?.color ?? true,
      truecolor: theme?.truecolor ?? false,
      mode,
      dark,
      light,
      selected,
      custom: theme?.custom,
      leftPrompt: theme?.leftPrompt ?? DEFAULT_LEFT_PROMPT,
      rightPrompt: theme?.rightPrompt ?? DEFAULT_RIGHT_PROMPT,
      inputPrompt: theme?.inputPrompt ?? DEFAULT_INPUT_PROMPT,
      inputPlaceholder: theme?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER,
    },
    mode: config?.mode ?? DEFAULT_MODE,
    locale: config?.locale ?? DEFAULT_LOCALE,
    title: config?.title ?? 'dsh',
  }
}
