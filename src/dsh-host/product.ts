/**
 * Product seams: settings, presets, query, cmdline, tools, titles, commands
 * and user questions.
 */

import type { Context } from './framework.ts'
import type { Session } from './session.ts'
import type { SettingsForms, SettingsNamespace } from '@deepseek-ai/dsh-settings'
export type { SettingsForms, SettingsNamespace }

/**
 * Runtime brand helper for settings namespaces. dsh-settings ships only the
 * nominal type (no runtime brand constructor), so the host facade keeps a local
 * constructor that casts through the branded string. A settings namespace is the
 * profile entry id of the row that owns the section.
 */
export function settingsNamespace(value: string): SettingsNamespace {
  return value as unknown as SettingsNamespace
}

/**
 * Permission preset settings section. dsh 0.2 dropped the exported namespace
 * constant; the section is keyed by the profile entry id, which is `permission`
 * in dsh-base. The row is deployment-owned, so the id is fixed here.
 */
export const PERMISSION_SETTINGS_NAMESPACE = settingsNamespace('permission')

/**
 * Live values of one profile entry's settings section.
 *
 * dsh 0.2 removed `SettingsForms.get(namespace)`; the section is read through
 * `describe()`, which returns every entry's resolved value plus its revision.
 * The section is keyed by the profile entry id, so the namespace is the row id.
 * Returns `undefined` when settings are disabled (no profile context) or the
 * entry is absent.
 */
export function settingsValues(ctx: Context, ns: SettingsNamespace): unknown {
  const forms = ctx.settings as SettingsForms | undefined
  if (forms === undefined) return undefined
  return forms.describe().find(entry => entry.ns === ns)?.value
}

/** Permission preset in force for one session. */
export function currentPermissionPreset(ctx: Context, session: Session): string {
  return ctx.permissionPresets.current(session)
}

/** Persist the permission preset selection for one session. */
export function setPermissionPreset(ctx: Context, session: Session, preset: string): void {
  ctx.permissionPresets.set(session, preset)
}

export { foldSessionTitle, SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
export { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
export { renderSkillContent } from '@deepseek-ai/dsh-skill'
export { type PresetOption } from '@deepseek-ai/dsh-permission-presets'
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
