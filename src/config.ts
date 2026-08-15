/**
 * Serializable configuration and defaults for the omp-styled terminal mode.
 * The bundle's `tui` row carries these; schemastery validates the shape.
 */

import z from '@deepseek-ai/schemastery'
import type { Locale } from './i18n.ts'

/** Shipped working modes (backend compositions); locally installed presets use any other id. */
export type UiMode = 'standard' | 'minimal' | 'code' | 'cordis'

/** Theme and prompt-template settings. */
export interface TuiThemeConfig {
  /** Apply the ANSI palette at all. */
  color?: boolean
  /** Paint the startup banner with the 24-bit brand gradient. */
  truecolor?: boolean
  /** Built-in theme id, e.g. `catppuccin` or `tokyo-night`. */
  name?: string
  /** Per-role truecolor overrides on top of the built-in theme, e.g. `{ accent: [250, 179, 135] }`. */
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
export const DEFAULT_RIGHT_PROMPT = '${model}${effort}${context}${permission}'
export const DEFAULT_INPUT_PROMPT = '${indicator}'
export const DEFAULT_INPUT_PLACEHOLDER = ''

export const DEFAULT_THEME = 'catppuccin'
export const DEFAULT_MODE: string = 'standard'
export const DEFAULT_LOCALE: Locale = 'zh-CN'
export const DEFAULT_REASONING_EFFORT = 'max'

const themeSchema = z.object({
  color: z.boolean().default(true),
  truecolor: z.boolean(),
  name: z.string().default(DEFAULT_THEME),
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
  name: string
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

/** Apply direct-call defaults after Loader schema validation has normally run. */
export function resolveTuiConfig(config: TuiConfig | undefined): ResolvedTuiConfig {
  return {
    showReasoning: config?.showReasoning ?? true,
    maxToolOutputLines: config?.maxToolOutputLines ?? 6,
    defaultReasoningEffort: config?.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
    theme: {
      color: config?.theme?.color ?? true,
      truecolor: config?.theme?.truecolor ?? false,
      name: config?.theme?.name ?? DEFAULT_THEME,
      custom: config?.theme?.custom,
      leftPrompt: config?.theme?.leftPrompt ?? DEFAULT_LEFT_PROMPT,
      rightPrompt: config?.theme?.rightPrompt ?? DEFAULT_RIGHT_PROMPT,
      inputPrompt: config?.theme?.inputPrompt ?? DEFAULT_INPUT_PROMPT,
      inputPlaceholder: config?.theme?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER,
    },
    mode: config?.mode ?? DEFAULT_MODE,
    locale: config?.locale ?? DEFAULT_LOCALE,
    title: config?.title ?? 'dsh',
  }
}
