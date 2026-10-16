/**
 * Declaration-merge imports: these side-effect type imports keep the Cordis
 * Context/Events augmentations active for the whole program even though the
 * rest of the code no longer imports these packages directly.
 */

import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tool-todo'

/**
 * The WeChat bridge's own message source. dsh 0.2 removed the shared catch-all
 * `plugin` kind: each producer declares its own `kind` in `MessageSourceMap`,
 * and consumers fall through unknown kinds.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'wechat-bridge': {
      kind: 'wechat-bridge'
      plugin: string
      form: 'notice'
      summary: string
    }
  }
}
