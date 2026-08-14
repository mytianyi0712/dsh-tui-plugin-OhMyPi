/**
 * The status line: one full-width row above the editor rendering the
 * left/right prompt templates, padded to the terminal width and filled with
 * the omp `statusLineBg` — the terminal-mode counterpart of omp's status bar.
 */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import {
  renderTuiPromptTemplate,
  type TuiPromptToken,
} from '../prompt.ts'
import type { Palette } from '../theme.ts'

/** The left/right template line rendered above the editor. */
export class StatusLineComponent implements Component {
  constructor(
    private readonly leftTemplate: readonly TuiPromptToken[],
    private readonly rightTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const right = truncateToWidth(renderTuiPromptTemplate(this.rightTemplate, this.resolve), width, '')
    const rightWidth = visibleWidth(right)
    const leftCapacity = Math.max(0, width - rightWidth - (rightWidth === 0 ? 0 : 2))
    const left = truncateToWidth(renderTuiPromptTemplate(this.leftTemplate, this.resolve), leftCapacity, '')
    const gap = rightWidth === 0 ? '' : ' '.repeat(Math.max(0, width - visibleWidth(left) - rightWidth))
    const row = `${left}${gap}${right}`
    return [this.palette.statusLineBg(row + ' '.repeat(Math.max(0, width - visibleWidth(row))))]
  }
}
