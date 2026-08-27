// Outbound: chunked text send to a WeChat peer.
// 【职责】出站发送：自动分段 + 发送一条消息。

import crypto from 'node:crypto'
import { sendMessage, MSG_TYPE_BOT, MSG_STATE_FINISH, ITEM_TEXT } from './api.ts'
import type { Account } from './state.ts'

/** iLink 的单条消息硬上限；普通文本使用更短的智能分段。 */
export const TEXT_CHUNK_LIMIT = 4000
export const TEXT_SEGMENT_MIN = 50
export const TEXT_SEGMENT_MAX = 100

interface TextUnit {
  text: string
  protected: boolean
}

interface ParsedText {
  units: TextUnit[]
  trailing: string
}

export interface ReadyTextChunks {
  chunks: string[]
  remainder: string
}

const SENTENCE_ENDINGS = '。！？!?'
const CLOSING_MARKS = '”’"\'）)]}】》」』〉〕»*'

function lineEnd(text: string, start: number): number {
  const newline = text.indexOf('\n', start)
  return newline < 0 ? text.length : newline + 1
}

function lineBody(text: string, start: number, end: number): string {
  return text.slice(start, end).replace(/\r?\n$/, '')
}

function fenceStart(line: string): { marker: '`' | '~'; length: number } | undefined {
  const token = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
  const marker = token?.[0]
  if (marker !== '`' && marker !== '~' || token === undefined) return undefined
  return { marker, length: token.length }
}

function isFenceEnd(line: string, fence: { marker: '`' | '~'; length: number }): boolean {
  const token = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1]
  return token !== undefined && token[0] === fence.marker && token.length >= fence.length
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(line)
}

function isTableStart(text: string, start: number, firstEnd: number): boolean {
  const header = lineBody(text, start, firstEnd)
  if (!header.includes('|') || firstEnd >= text.length) return false
  const secondEnd = lineEnd(text, firstEnd)
  return isTableSeparator(lineBody(text, firstEnd, secondEnd))
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) slashes += 1
  return slashes % 2 === 1
}

/** Find a sentence/newline boundary while ignoring inline-code contents. */
function normalBoundary(text: string, start: number): number {
  let inlineCode = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '`' && !isEscaped(text, i)) {
      inlineCode = !inlineCode
      continue
    }
    if (inlineCode) continue
    if (ch === '\n') return i + 1
    if (ch !== undefined && SENTENCE_ENDINGS.includes(ch)) {
      let end = i + 1
      while (end < text.length && CLOSING_MARKS.includes(text[end] ?? '')) end += 1
      return end
    }
  }
  return -1
}

/** Tokenize complete sentence/Markdown units; incomplete protected units stay trailing. */
function parseText(text: string, force: boolean): ParsedText {
  const units: TextUnit[] = []
  let start = 0
  while (start < text.length) {
    const firstEnd = lineEnd(text, start)
    const atLineStart = start === 0 || text[start - 1] === '\n'
    if (atLineStart) {
      const fence = fenceStart(lineBody(text, start, firstEnd))
      if (fence) {
        let end = firstEnd
        let closed = false
        while (end < text.length) {
          const nextEnd = lineEnd(text, end)
          if (isFenceEnd(lineBody(text, end, nextEnd), fence)) {
            end = nextEnd
            closed = true
            break
          }
          end = nextEnd
        }
        if (!closed && !force) return { units, trailing: text.slice(start) }
        units.push({ text: text.slice(start, closed ? end : text.length), protected: true })
        start = closed ? end : text.length
        continue
      }
      if (isTableStart(text, start, firstEnd)) {
        let end = lineEnd(text, firstEnd)
        while (end < text.length) {
          const nextEnd = lineEnd(text, end)
          const row = lineBody(text, end, nextEnd)
          if (!row.trim() || !row.includes('|')) break
          end = nextEnd
        }
        if (end === text.length && !force) return { units, trailing: text.slice(start) }
        units.push({ text: text.slice(start, end), protected: true })
        start = end
        continue
      }
    }

    const boundary = normalBoundary(text, start)
    if (boundary < 0) {
      if (!force) return { units, trailing: text.slice(start) }
      units.push({ text: text.slice(start), protected: false })
      return { units, trailing: '' }
    }
    units.push({ text: text.slice(start, boundary), protected: false })
    start = boundary
  }
  return { units, trailing: '' }
}

function packNormalUnits(units: TextUnit[], max: number): string[] {
  const groups: TextUnit[][] = []
  let group: TextUnit[] = []
  let length = 0
  for (const unit of units) {
    if (group.length > 0 && length + unit.text.length > max) {
      groups.push(group)
      group = []
      length = 0
    }
    group.push(unit)
    length += unit.text.length
  }
  if (group.length > 0) groups.push(group)

  // Greedy packing can leave a tiny tail (e.g. 30+30+30+30 → 90+30).
  // Move whole sentence units back from the previous group when both sides
  // remain within the preferred range.
  const last = groups.at(-1)
  const previous = groups.at(-2)
  if (last !== undefined && previous !== undefined) {
    let lastLength = last.reduce((sum, unit) => sum + unit.text.length, 0)
    let previousLength = previous.reduce((sum, unit) => sum + unit.text.length, 0)
    while (lastLength < TEXT_SEGMENT_MIN && previous.length > 1) {
      const moved = previous.at(-1)
      if (moved === undefined || previousLength - moved.text.length < TEXT_SEGMENT_MIN) break
      previous.pop()
      last.unshift(moved)
      previousLength -= moved.text.length
      lastLength += moved.text.length
    }
  }
  return groups.map(group => group.map(unit => unit.text).join(''))
}

function packUnits(parsed: ParsedText, max: number, force: boolean): ReadyTextChunks {
  const chunks: string[] = []
  let remainder = parsed.trailing
  let normalUnits: TextUnit[] = []

  const flushNormal = (allowShort: boolean): void => {
    if (normalUnits.length === 0) return
    const groups = packNormalUnits(normalUnits, max)
    normalUnits = []
    const last = groups.at(-1)
    const completeCount = !allowShort && last !== undefined && last.length < TEXT_SEGMENT_MIN
      ? groups.length - 1
      : groups.length
    chunks.push(...groups.slice(0, completeCount))
    if (completeCount < groups.length) remainder = (last ?? '') + remainder
  }

  for (const unit of parsed.units) {
    if (unit.protected) {
      flushNormal(true)
      chunks.push(unit.text)
    } else {
      normalUnits.push(unit)
    }
  }
  flushNormal(force)
  return { chunks, remainder }
}

/** Split complete text at sentence boundaries, targeting 50–100 characters. */
export function chunkText(text: string, limit = TEXT_SEGMENT_MAX): string[] {
  if (text.length === 0) return [text]
  return packUnits(parseText(text, true), limit, true).chunks
}

/** Return only safe streaming chunks; incomplete sentences/code/tables remain buffered. */
export function readyChunkText(text: string, limit = TEXT_SEGMENT_MAX): ReadyTextChunks {
  if (text.length === 0) return { chunks: [], remainder: '' }
  return packUnits(parseText(text, false), limit, false)
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
