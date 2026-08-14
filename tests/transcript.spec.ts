import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Container, visibleWidth } from '@earendil-works/pi-tui'
import { createPalette, markdownTheme } from '../src/theme.ts'
import {
  HeaderComponent,
  StaticCardComponent,
  TodoPanelComponent,
  ToolCardComponent,
  UserMessageComponent,
} from '../src/components/transcript.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

const palette = createPalette(false, 'dark', true)
const mdTheme = markdownTheme(palette)

/** Collect a component's rows by rendering it inside a container. */
function render(component: { render(width: number): string[] }, width: number): string[] {
  const container = new Container()
  container.addChild(component as never)
  return container.render(width)
}

describe('transcript components respect the render width', () => {
  const widths = [5, 10, 40, 80, 120]
  const longText = '中文字符串很长很长很长很长很长很长很长很长很长很长很长很长，'.repeat(4) + 'plain english padding padding padding padding padding padding padding padding'

  it('user message frames stay within width', () => {
    for (const width of widths) {
      const rows = render(new UserMessageComponent(longText, palette, mdTheme), width)
      for (const row of rows) assert.ok(visibleWidth(row) <= width, `width=${width}`)
    }
  })

  it('tool cards stay within width in every status', () => {
    for (const width of widths) {
      const pending = new ToolCardComponent('bash', JSON.stringify({ command: longText }), 6, palette)
      const rows = render(pending, width)
      for (const row of rows) assert.ok(visibleWidth(row) <= width, `pending width=${width}`)
    }
    const settled = new ToolCardComponent('read', '{}', 6, palette)
    settled.updateResult({
      turn: 1,
      step: 1,
      message: {
        id: 'm1' as never,
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: 'c1' as never, content: [{ type: 'text', text: longText }] }],
        source: { kind: 'tool' },
      },
    } as never)
    for (const width of widths) {
      const rows = render(settled, width)
      for (const row of rows) assert.ok(visibleWidth(row) <= width, `settled width=${width}`)
    }
  })

  it('static cards and todo panels stay within width', () => {
    for (const width of widths) {
      const card = new StaticCardComponent([longText, 'short'], palette)
      for (const row of render(card, width)) assert.ok(visibleWidth(row) <= width)
      const todo = new TodoPanelComponent(palette)
      todo.setTodos([
        { content: longText, status: 'in_progress' },
        { content: 'done', status: 'completed' },
      ])
      for (const row of render(todo, width)) assert.ok(visibleWidth(row) <= width)
    }
  })

  it('the banner stays within width', () => {
    const agent = {
      session: { id: 'session-1', header: { cwd: 'C:/work' } },
    } as unknown as Agent
    for (const width of widths) {
      const header = new HeaderComponent(agent, () => longText, palette, false)
      for (const row of render(header, width)) assert.ok(visibleWidth(row) <= width)
    }
  })
})
