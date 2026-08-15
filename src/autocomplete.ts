/**
 * Composer autocomplete wrapper.
 *
 * Skills are exposed as ordinary slash commands named `skill:<name>` so they
 * appear in the quick command list after `/` and participate in the same fuzzy
 * search as other commands (e.g. `commit` matches `skill:git-commit`).
 *
 * The stock pi-tui completion inserts a space after a completed command, which
 * would turn `/skill:git-commit` into `/skill:git-commit `. This wrapper keeps
 * the no-space `skill:<name>` syntax when a skill command is completed.
 */

import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from '@earendil-works/pi-tui'

/** Autocomplete provider that completes `skill:<name>` commands without a space. */
export class SkillAwareAutocompleteProvider implements AutocompleteProvider {
  constructor(private readonly inner: AutocompleteProvider) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: Parameters<AutocompleteProvider['getSuggestions']>[3],
  ): Promise<AutocompleteSuggestions | null> {
    return this.inner.getSuggestions(lines, cursorLine, cursorCol, options)
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    if (item.value.startsWith('skill:')) {
      const currentLine = lines[cursorLine] ?? ''
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length)
      const afterCursor = currentLine.slice(cursorCol)
      const newLine = `${beforePrefix}/${item.value}${afterCursor}`
      const newLines = [...lines]
      newLines[cursorLine] = newLine
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + 1, // +1 for the leading "/"
      }
    }
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return this.inner.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
  }
}
