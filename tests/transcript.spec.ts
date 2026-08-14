import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Container, visibleWidth } from '@earendil-works/pi-tui'
import { createPalette, markdownTheme } from '../src/theme.ts'
import {
  AssistantStreamController,
  ContextCardComponent,
  HeaderComponent,
  StaticCardComponent,
  TodoPanelComponent,
  ToolCardComponent,
  ThinkingBlock,
  UserMessageComponent,
} from '../src/components/transcript.ts'
import { InputBorderComponent, StatusLineComponent } from '../src/components/status.ts'
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

  it('renders user messages as unlabelled full-width surfaces', () => {
    for (const width of widths) {
      const rows = render(new UserMessageComponent(longText, palette, mdTheme), width)
      for (const row of rows) assert.equal(visibleWidth(row), width, `width=${width}`)
      assert.ok(rows.every(row => !/[╭╮╰╯]/.test(row)))
      assert.ok(rows.every(row => !row.includes('User')))
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

  it('uses an inline pending status and sectioned settled output', () => {
    const pending = new ToolCardComponent('read', '{"i":"Reading entrypoint","path":"src/index.ts"}', 6, palette)
    assert.deepEqual(render(pending, 48), ['', ' Read: Reading entrypoint'])

    pending.updateResult({
      message: {
        content: [{ content: [{ type: 'text', text: 'line one\nline two' }], isError: false }],
      },
    } as never)
    const settled = render(pending, 48)
    assert.match(settled[1]!, /^╭─── • Read: Reading entrypoint/)
    assert.match(settled[2]!, /^├─── Output /)
  })

  it('frames injected context separately from unframed model reasoning', () => {
    const context = render(new ContextCardComponent(
      '@deepseek-ai/dsh-system-prompt',
      'Current runtime context.\n\nApproval policy: ask.',
      6,
      palette,
    ), 64)
    assert.match(context[0]!, /^╭─── Injected context · @deepseek-ai\/dsh-system-prompt/)
    assert.match(context.at(-1)!, /^╰─+╯$/)
    assert.ok(context.every(row => visibleWidth(row) === 64))

    const reasoning = render(new ThinkingBlock('private model reasoning', palette, mdTheme), 64)
    assert.ok(reasoning.some(row => row.includes('private model reasoning')))
    assert.ok(reasoning.every(row => !/[╭╮╰╯│]/.test(row)))
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
      options: { model: 'deepseek-v4-pro', provider: 'deepseek-official' },
      session: { id: 'session-1', header: { cwd: 'C:/work' } },
    } as unknown as Agent
    for (const width of widths) {
      const header = new HeaderComponent(agent, () => longText, palette, false)
      for (const row of render(header, width)) assert.ok(visibleWidth(row) <= width)
    }
  })
})

describe('transcript chronology', () => {
  it('keeps each user message before the assistant step started ahead of it', () => {
    const transcript = new Container()
    const assistant = new AssistantStreamController(transcript, palette, mdTheme)
    const addTurn = (user: string, model: string): void => {
      // DSH publishes step/start before it appends the entered user/message.
      assistant.start(false)
      transcript.addChild(new UserMessageComponent(user, palette, mdTheme))
      assistant.settle([{ type: 'text', text: model }])
      assistant.end()
    }

    addTurn('first user', 'first model')
    addTurn('second user', 'second model')

    const output = transcript.render(80).join('\n')
    const firstUser = output.indexOf('first user')
    const firstModel = output.indexOf('first model')
    const secondUser = output.indexOf('second user')
    const secondModel = output.indexOf('second model')
    assert.ok(firstUser >= 0)
    assert.ok(firstUser < firstModel)
    assert.ok(firstModel < secondUser)
    assert.ok(secondUser < secondModel)
  })
})

describe('composer chrome', () => {
  it('embeds left and right status groups in an exact-width top rail', () => {
    const values: Record<string, string> = { left: 'path', right: 'model' }
    const status = new StatusLineComponent(
      [{ type: 'value', name: 'left' }],
      [{ type: 'value', name: 'right' }],
      name => values[name],
      palette,
    )
    const [row] = status.render(40)
    assert.equal(visibleWidth(row!), 40)
    assert.ok(row!.startsWith('─── path '))
    assert.ok(row!.endsWith(' model ───'))
  })

  it('closes the editor with a full-width muted rail', () => {
    assert.equal(new InputBorderComponent(palette).render(12)[0], '────────────')
  })
})
