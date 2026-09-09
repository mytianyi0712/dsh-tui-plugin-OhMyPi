/**
 * LLM seams.
 */

import * as dshLlm from '@deepseek-ai/dsh-llm'
export type ToolCallId = string

export { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'

type ToolCallIdFactory = (id: string) => ToolCallId

/**
 * dsh 0.1.1-rc.2 calls this brand constructor `CallId`; alpha.3 renamed it
 * to `ToolCallId`. Namespace loading keeps the bundle valid on both hosts.
 */
const llmIdExports = dshLlm as unknown as {
  ToolCallId?: ToolCallIdFactory
  CallId?: ToolCallIdFactory
}

export const ToolCallId: ToolCallIdFactory = llmIdExports.ToolCallId ?? llmIdExports.CallId ?? ((id) => {
  throw new Error(`@deepseek-ai/dsh-llm does not provide a tool-call ID constructor for ${id}`)
})

export { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
export type {
  ContentBlock,
  ImageBlock,
  LlmConfigurableProvider,
  LlmReasoningEffortInfo,
  LlmRuntime,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
