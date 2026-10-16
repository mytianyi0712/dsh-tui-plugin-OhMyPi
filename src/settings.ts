/**
 * Persistent settings namespaces used by the TUI and the title provider.
 *
 * dsh 0.2 has no runtime settings registration: a settings section is the live
 * Config of a profile entry, keyed by that entry's row id. Both namespaces
 * below name rows this bundle inserts through `cordis.patch.yml`.
 */

import { settingsNamespace } from './dsh-host/index.ts'

/** The `tui` row: theme, prompt templates, keybindings and card settings. */
export const TUI_SETTINGS_NAMESPACE = settingsNamespace('tui')

export type ThemeModeSetting = 'dynamic' | 'selected'

/**
 * Theme and prompt settings the TUI persists. These fields are part of the
 * `tui` row's Config schema (`TuiConfigSchema`), so the row's live Config is
 * the settings section.
 */
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
  /** Per-role truecolor overrides, e.g. `{ accent: [250, 179, 135] }`. */
  themeCustom?: Record<string, number[]>
  /** Template rendered left-aligned beside the permission state below the editor. */
  leftPrompt?: string
  /** Template rendered below the directory and permission row. */
  rightPrompt?: string
  /** Keybinding for cycling tool cards. */
  keyTools?: string
  /** Keybinding for toggling reasoning blocks. */
  keyReasoning?: string
  /** Whether model reasoning blocks are rendered. */
  showReasoning: boolean
  /** Maximum tool-card body lines retained in a collapsed preview. */
  maxToolOutputLines: number
}

/** The `session-title-llm-tui` row: title model route plus generation limits. */
export const SESSION_TITLE_SETTINGS_NAMESPACE = settingsNamespace('session-title-llm-tui')
