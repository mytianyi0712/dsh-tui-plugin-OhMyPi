/** Shared persistent settings namespaces used by the TUI and title provider. */

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const TUI_SETTINGS_NAMESPACE = settingsNamespace('tui')

export interface TuiSettings {
  themeName: string
}

export const TuiSettingsSchema: z<TuiSettings> = z.object({
  themeName: z.string(),
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
