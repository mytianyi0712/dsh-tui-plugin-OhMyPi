/** Settings-aware first-prompt title provider for the terminal profile. */

import type { Context } from '@deepseek-ai/cordis'
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import {
  generateSessionTitleWithLlm,
  SessionTitleLlmConfigFields,
  type SessionTitleLlmConfig,
} from '@deepseek-ai/dsh-session-title-llm'
import z from '@deepseek-ai/schemastery'
import {
  SESSION_TITLE_SETTINGS_NAMESPACE,
  SessionTitleSettingsSchema,
  type SessionTitleSettings,
} from './settings.ts'

export const name = 'session-title-first-prompt-llm'
export const inject = ['sessionTitle', 'llm', 'sessions', 'settings']

export type Config = SessionTitleLlmConfig

export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
})

function configuredRoute(config: Config): Partial<SessionTitleSettings> {
  return {
    ...config.provider === undefined ? {} : { provider: config.provider },
    ...config.model === undefined ? {} : { model: config.model },
  }
}

export function apply(ctx: Context, config: Config): void {
  const scope = ctx.settings.register(SESSION_TITLE_SETTINGS_NAMESPACE, SessionTitleSettingsSchema, {
    base: configuredRoute(config),
    validate: (value) => {
      if ((value.provider === undefined) !== (value.model === undefined)) {
        throw new Error('session-title settings require provider and model together')
      }
    },
  })
  const providerId = SessionTitleProviderId(name)
  ctx.sessionTitle.register({
    id: providerId,
    automatic: 'first-prompt',
    async generate(request) {
      const first = request.messages[0]
      if (first === undefined) throw new Error('first-prompt title provider requires one human message')
      return generateSessionTitleWithLlm(
        ctx,
        { ...config, ...scope.get() },
        request,
        [first],
        providerId,
      )
    },
  })
}
