/**
 * Serializable configuration and defaults for the omp-styled terminal mode.
 * The bundle's `tui` row carries these; schemastery validates the shape.
 */

import z from '@deepseek-ai/schemastery'

/** Theme and prompt-template settings. */
export interface TuiThemeConfig {
  /** Apply the ANSI palette at all. */
  color?: boolean
  /** Paint the startup banner with the 24-bit DeepSeek brand gradient. */
  truecolor?: boolean
  /** Left-aligned template on the row above the editor. */
  leftPrompt?: string
  /** Right-aligned template on the row above the editor. */
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
  theme?: TuiThemeConfig
  /** Terminal title. */
  title?: string
}

export const DEFAULT_LEFT_PROMPT = '${cwd}${git/worktree}${model}${tokens}${context}'
export const DEFAULT_RIGHT_PROMPT = '${queued}'
export const DEFAULT_INPUT_PROMPT = '${symbol} ${indicator}'
export const DEFAULT_INPUT_PLACEHOLDER = 'press enter to send and esc to cancel'

const themeSchema = z.object({
  color: z.boolean().default(true),
  truecolor: z.boolean(),
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
  theme: themeSchema,
  title: z.string().default('dsh'),
})

/** Fully defaulted theme settings. */
export interface ResolvedTuiThemeConfig {
  color: boolean
  truecolor: boolean
  leftPrompt: string
  rightPrompt: string
  inputPrompt: string
  inputPlaceholder: string
}

/** Fully defaulted presentation settings. */
export interface ResolvedTuiConfig {
  showReasoning: boolean
  maxToolOutputLines: number
  theme: ResolvedTuiThemeConfig
  title: string
}

/** Apply direct-call defaults after Loader schema validation has normally run. */
export function resolveTuiConfig(config: TuiConfig | undefined): ResolvedTuiConfig {
  return {
    showReasoning: config?.showReasoning ?? true,
    maxToolOutputLines: config?.maxToolOutputLines ?? 6,
    theme: {
      color: config?.theme?.color ?? true,
      truecolor: config?.theme?.truecolor ?? false,
      leftPrompt: config?.theme?.leftPrompt ?? DEFAULT_LEFT_PROMPT,
      rightPrompt: config?.theme?.rightPrompt ?? DEFAULT_RIGHT_PROMPT,
      inputPrompt: config?.theme?.inputPrompt ?? DEFAULT_INPUT_PROMPT,
      inputPlaceholder: config?.theme?.inputPlaceholder ?? DEFAULT_INPUT_PLACEHOLDER,
    },
    title: config?.title ?? 'dsh',
  }
}
