/**
 * Content-block helpers: flatten typed blocks to plain text and parse the raw
 * JSON string a model produced for a tool call.
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { displayText } from './text.ts'

/** Concatenate every text/reasoning block, in order, separated by blank lines. */
export function contentText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' | 'reasoning' }> =>
      block.type === 'text' || block.type === 'reasoning')
    .map(block => block.text)
    .join('\n\n')
}

/** Parsed tool arguments: valid JSON when the model produced any, else the raw string. */
export type ParsedArguments =
  | { readonly valid: true; readonly value: unknown }
  | { readonly valid: false; readonly raw: string }

/** Parse the raw arguments JSON a model emitted for a tool call. */
export function parseArguments(argumentsJson: string): ParsedArguments {
  if (argumentsJson.trim() === '') return { valid: true, value: {} }
  try {
    return { valid: true, value: JSON.parse(argumentsJson) as unknown }
  } catch {
    return { valid: false, raw: argumentsJson }
  }
}

/** Render a value as terminal-safe text: strings escaped, other values as pretty JSON. */
export function pretty(value: unknown): string {
  if (typeof value === 'string') return displayText(value)
  const serialized = JSON.stringify(value, null, 2) as string | undefined
  return displayText(serialized ?? String(value))
}
