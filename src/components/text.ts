/**
 * Terminal-safe text helpers: strip control sequences that would corrupt the
 * differential renderer and collapse newlines for single-row contexts.
 */

/** Normalize carriage-return line endings, then remove terminal control characters. */
export function displayText(text: string): string {
  // Keep LF as the only line separator: CRLF and bare CR both become newlines.
  const normalized = text.replace(/\r\n?/g, '\n')
  // eslint-disable-next-line no-control-regex
  return normalized.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** Collapse newlines and carriage returns into a single space for inline rows. */
export function displayInlineText(text: string): string {
  return displayText(text).replace(/\r?\n/g, ' ')
}
