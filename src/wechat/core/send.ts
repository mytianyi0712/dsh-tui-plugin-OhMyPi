// Outbound: chunked text send to a WeChat peer.
// 【职责】出站发送：自动分段 + 发送一条消息。

import crypto from 'node:crypto'
import { sendMessage, MSG_TYPE_BOT, MSG_STATE_FINISH, ITEM_TEXT } from './api.ts'
import type { Account } from './state.ts'

export const TEXT_CHUNK_LIMIT = 4000

/** Last sentence boundary (newline or sentence-ending punctuation) at or before `max`. */
function lastSentenceBoundary(text: string, max: number): number {
  for (let i = max; i >= 0; i -= 1) {
    const ch = text[i]
    if (ch === '\n' || (ch !== undefined && '。！？；!?;…'.includes(ch))) {
      return i + 1 // include the punctuation in the finished chunk
    }
  }
  return -1
}

/**
 * Split long text into ≤limit chunks at sentence boundaries (newlines first,
 * then sentence-ending punctuation); only hard-cuts mid-sentence when a single
 * sentence itself exceeds the limit.
 */
export function chunkText(text: string, limit = TEXT_CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = lastSentenceBoundary(rest, limit)
    if (cut <= 0) {
      chunks.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    } else {
      chunks.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
  }
  if (rest) chunks.push(rest)
  return chunks
}

export function randomClientId(): string {
  return `dsh-wechat-${crypto.randomBytes(8).toString('hex')}`
}

/**
 * Send text to a peer. Returns number of messages actually sent.
 * Fails hard on API error so callers can surface it to the model.
 */
export async function sendTextToPeer(
  account: Account,
  to: string,
  text: string,
  contextToken?: string,
): Promise<number> {
  const chunks = chunkText(text)
  for (const chunk of chunks) {
    await sendMessage(account.baseUrl, account.token, {
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: randomClientId(),
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: chunk ? [{ type: ITEM_TEXT, text_item: { text: chunk } }] : undefined,
        context_token: contextToken ?? undefined,
      },
    })
  }
  return chunks.length
}
