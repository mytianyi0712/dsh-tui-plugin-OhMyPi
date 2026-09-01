/**
 * Untrusted render-path string sanitization shared by every extension seam.
 *
 * Rules (aligned with the dsh-TUI adapter contract):
 * - scalars (string/number/boolean) are coerced to string; null/undefined
 *   become `undefined` (treated as "nothing to render").
 * - objects, arrays, functions, symbols are rejected as `undefined` so they can
 *   never become `"[object Object]"` on screen.
 * - C0/C1 control characters are stripped, whitespace is folded.
 * - width calculations use terminal cells (approximate wcwidth), never
 *   `string.length`.
 */

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g
const WHITESPACE_RE = /\s+/g

/** Zero-width combining marks and joiners. */
const ZERO_WIDTH_RE = /[\u0300-\u036f\u200b-\u200f\u2028-\u202e\ufeff]/g

/** Rough East-Asian wide ranges (sufficient for CJK safety in transcript). */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || // CJK radicals, Kangxi, symbols
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // emoji block (treated wide)
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

/** Terminal cell width for a single code point. */
export function codePointCellWidth(codePoint: number): number {
  if (ZERO_WIDTH_RE.test(String.fromCodePoint(codePoint))) return 0
  return isWideCodePoint(codePoint) ? 2 : 1
}

/** Terminal cell width of a string. */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text.replace(ZERO_WIDTH_RE, '')) {
    width += codePointCellWidth(char.codePointAt(0) ?? 0)
  }
  return width
}

/** Strip control characters and fold whitespace. */
export function cleanScalarText(input: unknown): string {
  return String(input).replace(CONTROL_RE, '').replace(WHITESPACE_RE, ' ').trim()
}

/**
 * Coerce an untrusted value to renderable scalar text.
 * Returns `undefined` for non-scalars and empty strings.
 */
export function scalarText(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined
  const kind = typeof input
  if (kind !== 'string' && kind !== 'number' && kind !== 'boolean') return undefined
  const cleaned = cleanScalarText(input)
  return cleaned === '' ? undefined : cleaned
}

/** Truncate a string to `maxCells` terminal cells without breaking wide chars. */
export function truncateByCell(text: string, maxCells: number): string {
  if (maxCells <= 0) return ''
  let width = 0
  let result = ''
  for (const char of text.replace(ZERO_WIDTH_RE, '')) {
    const charWidth = codePointCellWidth(char.codePointAt(0) ?? 0)
    if (width + charWidth > maxCells) break
    width += charWidth
    result += char
  }
  return result
}

/** Full sanitize+truncate pipeline used by status lines, toasts, and renderers. */
export function sanitizeCellText(input: unknown, maxCells: number): string | undefined {
  const text = scalarText(input)
  if (text === undefined) return undefined
  return truncateByCell(text, maxCells)
}

/** Sanitize a line array: only scalar entries survive, each truncated. */
export function sanitizeLines(lines: readonly unknown[], maxLines: number, maxLineCells: number): string[] {
  const cleaned: string[] = []
  for (const line of lines.slice(0, maxLines)) {
    const text = sanitizeCellText(line, maxLineCells)
    if (text !== undefined) cleaned.push(text)
  }
  return cleaned
}

/** Validate a status/status-like key: `a-z0-9_-` with colon segments. */
export function isValidContributionKey(key: string): boolean {
  return /^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)*$/.test(key)
}
