/**
 * Terminal-safe text helpers: strip control sequences that would corrupt the
 * differential renderer and collapse newlines for single-row contexts.
 */

/** Replace control characters (except tab/newline handling by callers) with nothing. */
export function displayText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** Collapse newlines and carriage returns into a single space for inline rows. */
export function displayInlineText(text: string): string {
  return displayText(text).replace(/\r?\n/g, ' ')
}
