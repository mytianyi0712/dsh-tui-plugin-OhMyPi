/** Shared persistent settings namespaces used by the TUI and title provider. */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const TUI_SETTINGS_NAMESPACE = settingsNamespace('tui')

export interface TuiSettings {
  themeName: string
  /** Whether model reasoning blocks are rendered. */
  showReasoning: boolean
  /** Maximum tool-card body lines retained in a collapsed preview. */
  maxToolOutputLines: number
}

export const TuiSettingsSchema: z<TuiSettings> = z.object({
  themeName: z.string(),
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
