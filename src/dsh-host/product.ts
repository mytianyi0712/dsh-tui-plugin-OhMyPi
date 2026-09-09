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

import type { Context } from './framework.ts'
import type { Session } from './session.ts'

/**
 * Permission preset API version bridge: alpha.3 changed `current(session)` from
 * rc.2's `current(events)`. Compile against alpha types but adapt at runtime.
 */
export function currentPermissionPreset(ctx: Context, session: Session): string {
  const service = ctx.permissionPresets as unknown as {
    permissionState?: (session: Session) => unknown
    current: (arg: Session | readonly unknown[]) => string
  }
  if (typeof service.permissionState === 'function') {
    // alpha.3: current(session) → derive(permissionState(session))
    return service.current(session)
  }
  // rc.2: current(events) → derive(foldKnobs(events))
  return service.current(session.events)
}

export function setPermissionPreset(ctx: Context, session: Session, preset: string): void {
  const service = ctx.permissionPresets as unknown as {
    permissionState?: (session: Session) => unknown
    set: (arg: Session | readonly unknown[], preset: string) => void
  }
  if (typeof service.permissionState === 'function') {
    service.set(session, preset)
  } else {
    service.set(session.events, preset)
  }
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
