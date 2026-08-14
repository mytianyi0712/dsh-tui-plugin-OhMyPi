/**
 * Framed dialog helpers shared by overlays. Phase 2 grows this into the
 * question/model/details dialogs; today it hosts the `/palette` card layout.
 */

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { ColorRole } from '../theme.ts'

/**
 * Render a bordered dialog frame around body lines with a titled top edge.
 * @param title - dialog title shown in the top border.
 * @param body - body lines.
 * @param width - dialog width in columns.
 * @param accent - role painting the frame.
 * @returns the framed dialog lines.
 */
export function renderDialog(
  title: string,
  body: readonly string[],
  width: number,
  accent: ColorRole,
): string[] {
  const innerWidth = Math.max(1, width - 4)
  const topLabel = ` ${title} `
  const top = `╭${topLabel}${'─'.repeat(Math.max(0, width - visibleWidth(topLabel) - 2))}╮`
  const lines: string[] = [accent(top)]
  for (const line of body) {
    const clipped = truncateToWidth(line, innerWidth, '')
    lines.push(`${accent('│')} ${clipped}${' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${accent('│')}`)
  }
  lines.push(accent(`╰${'─'.repeat(Math.max(0, width - 2))}╯`))
  return lines
}
