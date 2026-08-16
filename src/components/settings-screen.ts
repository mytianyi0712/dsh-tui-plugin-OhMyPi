/** OMP-style full-screen settings menu with tabbed rows and nested selectors. */

import {
  getKeybindings,
  matchesKey,
  type Component,
  type Focusable,
  type SelectItem,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'
import type { Translator } from '../i18n.ts'
import type { Palette } from '../theme.ts'

/** A setting row: label on the left, effective value on the right. */
export interface SettingsItem extends SelectItem {
  currentValue: string
}

export interface SettingsTab {
  id: string
  label: string
  items: SettingsItem[]
}

function isSettingsItem(item: SelectItem): item is SettingsItem {
  return 'currentValue' in item
}

export class SettingsScreen implements Component, Focusable {
  focused = false
  onClose?: () => void
  onBack?: () => void
  onSelect?: (item: SelectItem, tabId?: string) => void

  private title: string
  private readonly maxVisible: number
  private readonly height: number | undefined
  private items: SelectItem[]
  private tabs: SettingsTab[] | undefined
  private activeTab = 0
  private selectedIndex = 0
  private readonly tabSelections = new Map<string, number>()

  constructor(
    items: SelectItem[],
    title: string,
    private readonly palette: Palette,
    private readonly t: Translator,
    maxVisible = 20,
    height?: number,
  ) {
    this.title = title
    this.maxVisible = Math.max(1, maxVisible)
    this.height = height
    this.items = items
  }

  /** Switch to the tabbed main screen, preserving each tab's cursor. */
  setTabs(tabs: SettingsTab[], title: string): void {
    this.rememberTabSelection()
    this.tabs = tabs
    this.activeTab = Math.max(0, Math.min(this.activeTab, tabs.length - 1))
    this.title = title
    const tab = tabs[this.activeTab]
    this.items = tab?.items ?? []
    this.selectedIndex = this.clampIndex(tab === undefined ? 0 : (this.tabSelections.get(tab.id) ?? 0))
  }

  /** Open a nested selector and optionally preselect its current value. */
  setItems(items: SelectItem[], title: string, selectedValue?: string): void {
    this.rememberTabSelection()
    this.tabs = undefined
    this.title = title
    this.items = items
    const selected = selectedValue === undefined ? -1 : items.findIndex(item => item.value === selectedValue)
    this.selectedIndex = this.clampIndex(selected < 0 ? 0 : selected)
  }

  getActiveTabId(): string | undefined {
    return this.tabs?.[this.activeTab]?.id
  }

  handleInput(data: string): void {
    const kb = getKeybindings()
    if (kb.matches(data, 'tui.select.cancel')) {
      if (this.tabs === undefined) this.onBack?.()
      else this.onClose?.()
      return
    }
    if (this.tabs !== undefined) {
      if (kb.matches(data, 'tui.editor.cursorLeft') || matchesKey(data, 'shift+tab')) {
        this.switchTab(-1)
        return
      }
      if (kb.matches(data, 'tui.editor.cursorRight') || matchesKey(data, 'tab')) {
        this.switchTab(1)
        return
      }
    }
    if (kb.matches(data, 'tui.select.up')) {
      this.moveSelection(-1)
      return
    }
    if (kb.matches(data, 'tui.select.down')) {
      this.moveSelection(1)
      return
    }
    if (kb.matches(data, 'tui.select.confirm') || data === ' ') {
      const item = this.items[this.selectedIndex]
      if (item !== undefined) this.onSelect?.(item, this.getActiveTabId())
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(4, width)
    const innerWidth = Math.max(1, safeWidth - 4)
    const tabLines = this.tabs === undefined ? [] : [this.renderTabBar(innerWidth)]
    const fixedRows = 1 + tabLines.length + 1 + 1 + 1 + 1
    const targetHeight = this.height === undefined ? undefined : Math.max(fixedRows + 1, this.height)
    const contentBudget = targetHeight === undefined
      ? this.maxVisible + 4
      : Math.max(1, targetHeight - fixedRows)
    const content = this.renderContent(innerWidth, contentBudget)
    const contentRows = targetHeight === undefined ? content.length : contentBudget

    const lines = [
      this.topBorder(safeWidth),
      ...tabLines.map(line => this.row(line, safeWidth)),
      this.divider(safeWidth),
    ]
    for (let index = 0; index < contentRows; index++) {
      lines.push(this.row(content[index] ?? '', safeWidth))
    }
    lines.push(
      this.divider(safeWidth),
      this.row(this.palette.dim(this.tabs === undefined
        ? this.t('settingsSubmenuHint')
        : this.t('settingsHint')), safeWidth),
      this.bottomBorder(safeWidth),
    )
    return lines
  }

  private rememberTabSelection(): void {
    const tab = this.tabs?.[this.activeTab]
    if (tab !== undefined) this.tabSelections.set(tab.id, this.selectedIndex)
  }

  private switchTab(delta: number): void {
    if (this.tabs === undefined || this.tabs.length === 0) return
    this.rememberTabSelection()
    this.activeTab = (this.activeTab + delta + this.tabs.length) % this.tabs.length
    const tab = this.tabs[this.activeTab]!
    this.items = tab.items
    this.selectedIndex = this.clampIndex(this.tabSelections.get(tab.id) ?? 0)
  }

  private moveSelection(delta: number): void {
    if (this.items.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length
  }

  private clampIndex(index: number): number {
    return Math.max(0, Math.min(index, Math.max(0, this.items.length - 1)))
  }

  private renderContent(width: number, height: number): string[] {
    if (this.items.length === 0) return [this.palette.dim(this.t('settingsEmpty'))]
    const selected = this.items[this.selectedIndex]
    const selectedDetails = [
      selected?.description,
      selected !== undefined && isSettingsItem(selected) && selected.currentValue !== ''
        ? `${selected.label}: ${selected.currentValue}`
        : undefined
    ].filter((value): value is string => value !== undefined && value !== '')
    const description = selectedDetails.length === 0
      ? []
      : wrapTextWithAnsi(selectedDetails.join(' · '), Math.max(1, width - 2))
    const descriptionRows = description.length === 0 ? 0 : description.length + 1
    const availableRows = Math.max(1, height - descriptionRows)
    const needsScroll = this.items.length > Math.min(this.maxVisible, availableRows)
    const visibleRows = Math.max(1, Math.min(this.maxVisible, availableRows - (needsScroll ? 1 : 0)))
    const start = Math.max(0, Math.min(
      this.selectedIndex - Math.floor(visibleRows / 2),
      this.items.length - visibleRows,
    ))
    const end = Math.min(this.items.length, start + visibleRows)
    const lines: string[] = []
    const maximumLabelWidth = Math.max(...this.items.map(item => visibleWidth(item.label)))
    const labelWidth = Math.min(maximumLabelWidth, Math.max(1, Math.floor(width * 0.45)))
    for (let index = start; index < end; index++) {
      const item = this.items[index]!
      lines.push(this.renderItem(item, index === this.selectedIndex, width, labelWidth))
    }
    if (needsScroll) lines.push(this.palette.dim(`  (${this.selectedIndex + 1}/${this.items.length})`))
    if (description.length > 0) {
      lines.push('')
      lines.push(...description.map(line => this.palette.dim(`  ${line}`)))
    }
    return lines.slice(0, height)
  }

  private renderItem(item: SelectItem, selected: boolean, width: number, labelWidth: number): string {
    const prefix = selected ? '→ ' : '  '
    const prefixWidth = visibleWidth(prefix)
    const styled = (text: string): string => selected
      ? this.palette.bold(this.palette.accent(text))
      : this.palette.text(text)
    if (isSettingsItem(item)) {
      const effectiveLabelWidth = Math.max(1, Math.min(labelWidth, width - prefixWidth - 4))
      const label = truncateToWidth(item.label, effectiveLabelWidth, '')
      const gap = ' '.repeat(Math.max(2, effectiveLabelWidth - visibleWidth(label) + 2))
      const valueWidth = Math.max(1, width - prefixWidth - visibleWidth(label) - gap.length)
      const value = truncateToWidth(item.currentValue, valueWidth, '')
      const renderedValue = selected ? this.palette.bold(this.palette.accent(value)) : this.palette.muted(value)
      return truncateToWidth(`${styled(prefix + label)}${gap}${renderedValue}`, width, '')
    }
    return truncateToWidth(styled(`${prefix}${item.label}`), width, '')
  }

  private renderTabBar(width: number): string {
    if (this.tabs === undefined) return ''
    const tabs = this.tabs.map((tab, index) => index === this.activeTab
      ? this.palette.bold(this.palette.accent(` ${tab.label} `))
      : this.palette.dim(` ${tab.label} `))
    return truncateToWidth(tabs.join(' '), width, '')
  }

  private topBorder(width: number): string {
    const innerWidth = Math.max(0, width - 2)
    const shown = truncateToWidth(` ${this.title} `, Math.max(0, innerWidth - 2), '')
    const fill = '─'.repeat(Math.max(0, innerWidth - 1 - visibleWidth(shown)))
    return `${this.palette.border('╭─')}${this.palette.bold(this.palette.accent(shown))}${this.palette.border(`${fill}╮`)}`
  }

  private divider(width: number): string {
    return this.palette.border(`├${'─'.repeat(Math.max(0, width - 2))}┤`)
  }

  private bottomBorder(width: number): string {
    return this.palette.border(`╰${'─'.repeat(Math.max(0, width - 2))}╯`)
  }

  private row(content: string, width: number): string {
    const innerWidth = Math.max(0, width - 4)
    const clipped = truncateToWidth(content, innerWidth, '')
    const fill = ' '.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))
    return `${this.palette.border('│')} ${clipped}${fill} ${this.palette.border('│')}`
  }
}
