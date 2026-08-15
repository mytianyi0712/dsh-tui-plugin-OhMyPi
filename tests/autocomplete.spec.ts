import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui'
import { SkillAwareAutocompleteProvider } from '../src/autocomplete.ts'

function innerStub(suggestions: AutocompleteSuggestions | null): AutocompleteProvider {
  return {
    async getSuggestions() {
      return suggestions
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const currentLine = lines[cursorLine] ?? ''
      const before = currentLine.slice(0, cursorCol - prefix.length)
      const after = currentLine.slice(cursorCol)
      const newLine = `${before}/${item.value} ${after}`
      const newLines = [...lines]
      newLines[cursorLine] = newLine
      return { lines: newLines, cursorLine, cursorCol: before.length + item.value.length + 2 }
    },
  }
}

describe('SkillAwareAutocompleteProvider', () => {
  it('completes skill:<name> without inserting a trailing space', () => {
    const provider = new SkillAwareAutocompleteProvider(innerStub(null))
    const skill: AutocompleteItem = { value: 'skill:git-commit', label: 'skill:git-commit — Git 提交助手' }

    const applied = provider.applyCompletion(['/com'], 0, 4, skill, '/com')
    assert.equal(applied.lines[0], '/skill:git-commit')
    assert.equal(applied.cursorCol, '/skill:git-commit'.length)
  })

  it('delegates suggestions to the inner provider', async () => {
    const inner = innerStub({ items: [{ value: 'skill:git-commit', label: 'skill:git-commit' }], prefix: '/com' })
    const provider = new SkillAwareAutocompleteProvider(inner)
    const suggestions = await provider.getSuggestions(['/com'], 0, 4, {} as never)
    assert.ok(suggestions)
    assert.equal(suggestions!.items[0]!.value, 'skill:git-commit')
  })
})
