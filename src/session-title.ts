/** Settings-aware first-prompt title provider for the terminal profile. */

import type { Context } from './dsh-host/index.ts'
import { SessionTitleProviderId } from './dsh-host/index.ts'
import {
  generateSessionTitleWithLlm,
  SessionTitleLlmConfigFields,
  type SessionTitleLlmConfig,
} from './dsh-host/index.ts'
import { z } from './dsh-host/index.ts'

export const name = 'session-title-first-prompt-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

export type Config = SessionTitleLlmConfig

/**
 * The row's Config is its own settings section under dsh 0.2 (`SettingsForms`
 * exposes live Loader Config and writes through `update`), so `/settings`
 * edits `provider` / `model` here and the row re-applies with the new route.
 */
export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
})

export function apply(ctx: Context, config: Config): void {
  const providerId = SessionTitleProviderId(name)
  ctx.sessionTitle.register({
    id: providerId,
    automatic: 'first-prompt',
    async generate(request) {
      const first = request.messages[0]
      if (first === undefined) throw new Error('first-prompt title provider requires one human message')
      return generateSessionTitleWithLlm(
        ctx,
        config,
        request,
        [first],
        providerId,
      )
    },
  })
}
