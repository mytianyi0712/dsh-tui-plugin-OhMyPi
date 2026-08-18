/** Shared persistent settings namespaces used by the TUI and title provider. */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const TUI_SETTINGS_NAMESPACE = settingsNamespace('tui')

export type ThemeModeSetting = 'dynamic' | 'selected'

export interface TuiSettings {
  /** Deprecated single-theme setting; migrated to the fields below on read. */
  themeName?: string
  /** Theme selection mode: dynamic (follow terminal) or selected (fixed). */
  themeMode?: ThemeModeSetting
  /** Theme id used while the terminal reports a dark scheme. */
  themeDark?: string
  /** Theme id used while the terminal reports a light scheme. */
  themeLight?: string
  /** Fixed theme id for selected mode. */
  themeSelected?: string
  /** Whether model reasoning blocks are rendered. */
  showReasoning: boolean
  /** Maximum tool-card body lines retained in a collapsed preview. */
  maxToolOutputLines: number
}

export const TuiSettingsSchema: z<TuiSettings> = z.object({
  themeName: z.string(),
  themeMode: z.union([z.const('dynamic'), z.const('selected')]),
  themeDark: z.string(),
  themeLight: z.string(),
  themeSelected: z.string(),
  showReasoning: z.boolean().default(true),
  maxToolOutputLines: z.number().step(1).min(1).default(6),
})

export const SESSION_TITLE_SETTINGS_NAMESPACE = settingsNamespace('session-title')

export interface SessionTitleSettings {
  provider?: string
  model?: string
}

export const SessionTitleSettingsSchema: z<SessionTitleSettings> = z.object({
  provider: z.string(),
  model: z.string(),
})
