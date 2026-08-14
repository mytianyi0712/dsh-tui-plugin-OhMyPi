/** OMP-style composer chrome: status segments embedded in a horizontal top rail. */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { renderTuiPromptTemplate, type TuiPromptToken } from '../prompt.ts'
import type { Palette } from '../theme.ts'

/** Left/right prompt templates rendered as surfaced groups inside the editor rail. */
export class StatusLineComponent implements Component {
  constructor(
    private readonly leftTemplate: readonly TuiPromptToken[],
    private readonly rightTemplate: readonly TuiPromptToken[],
    private readonly resolve: (name: string) => string | undefined,
    private readonly palette: Palette,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width)
    if (safeWidth < 8) return [this.palette.borderMuted('─'.repeat(safeWidth))]

    const rightBudget = Math.floor((safeWidth - 6) * 0.45)
    const right = truncateToWidth(
      renderTuiPromptTemplate(this.rightTemplate, this.resolve),
      rightBudget,
      '',
    )
    const rightClusterWidth = right === '' ? 0 : visibleWidth(right) + 2
    const leftBudget = Math.max(0, safeWidth - 6 - rightClusterWidth - 3)
    const left = truncateToWidth(
      renderTuiPromptTemplate(this.leftTemplate, this.resolve),
      leftBudget,
      '',
    )
    const leftCluster = left === '' ? '' : this.palette.statusLineBg(` ${left} `)
    const rightCluster = right === '' ? '' : this.palette.statusLineBg(` ${right} `)
    const fillWidth = Math.max(
      0,
      safeWidth - 6 - visibleWidth(leftCluster) - visibleWidth(rightCluster),
    )
    const rail = this.palette.borderMuted('─'.repeat(fillWidth))
    const cap = this.palette.borderMuted('───')
    return [`${cap}${leftCluster}${rail}${rightCluster}${cap}`]
  }
}

/** Bottom rail closing the borderless editor body, matching OMP's composer. */
export class InputBorderComponent implements Component {
  constructor(private readonly palette: Palette) {}

  invalidate(): void {}

  render(width: number): string[] {
    return [this.palette.borderMuted('─'.repeat(Math.max(1, width)))]
  }
}
