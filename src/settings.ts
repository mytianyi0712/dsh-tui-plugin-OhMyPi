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

/**
 * Provider profiles owned by the TUI settings surface. The TUI never keeps
 * provider credentials in process memory as the source of truth: it persists
 * them through the dsh settings service, and re-reads them on every settings
 * screen open.
 */
export const LLM_PROVIDERS_SETTINGS_NAMESPACE = settingsNamespace('llm-providers')

export interface LlmProviderProfile {
  /** Display name and, for user-added providers, the provider route id. */
  name: string
  /** API/protocol flavor, e.g. `chat`, `responses`, `completion`, `messages`. */
  api?: string
  /** Endpoint base URL. */
  baseURL?: string
  /** API key; marked secret so wire/export surfaces redact it. */
  apiKey?: string
  /** Model ids selected for this provider. */
  models: string[]
}

export interface LlmProvidersSettings {
  providers: Record<string, LlmProviderProfile>
}

export const LlmProviderProfileSchema = z.object({
  name: z.string(),
  api: z.string().default(''),
  baseURL: z.string().default(''),
  apiKey: z.string().role('secret').default(''),
  models: z.array(z.string()).default([]),
})

export const LlmProvidersSettingsSchema: z<LlmProvidersSettings> = z.object({
  providers: z.dict(LlmProviderProfileSchema, z.string()).default({}),
})
