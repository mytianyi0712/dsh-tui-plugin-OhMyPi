/**
 * Product seams: settings, presets, query, cmdline, tools, titles, commands
 * and user questions.
 */

import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
export type { SettingsNamespace }

/**
 * Runtime brand helper for settings namespaces. Newer dsh-settings ships only
 * the nominal type (no runtime brand constructor), so the host facade keeps a
 * local constructor that casts through the branded string.
 */
export function settingsNamespace(value: string): SettingsNamespace {
  return value as unknown as SettingsNamespace
}

export { foldSessionTitle, SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
export { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
export { renderSkillContent } from '@deepseek-ai/dsh-skill'
export { PERMISSION_SETTINGS_NAMESPACE, type PresetOption } from '@deepseek-ai/dsh-permission-presets'
export { resolveSessionPreset } from '../session-preset.ts'
export type { SessionRecord } from '@deepseek-ai/dsh-session-query'
export { parseCmdline } from '@deepseek-ai/dsh-cmdline'
export { defineTool } from '@deepseek-ai/dsh-tools'
export {
  generateSessionTitleWithLlm,
  SessionTitleLlmConfigFields,
  type SessionTitleLlmConfig,
} from '@deepseek-ai/dsh-session-title-llm'
export type {
  CommandId,
  CommandInvocation,
  CommandResult,
} from '@deepseek-ai/dsh-commands'
export type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
