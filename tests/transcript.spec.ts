import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CombinedAutocompleteProvider, Container, Editor, visibleWidth } from '@earendil-works/pi-tui'
import { createPalette, markdownTheme } from '../src/theme.ts'
import { createTranslator } from '../src/i18n.ts'
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
import {
  CommandHintComponent,
  ComposerFooterComponent,
  InputBorderComponent,
  StatusLineComponent,
  chooseReasoningEffort,
  formatContextTokens,
  resolveSessionModelSelection,
} from '../src/components/status.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

const palette = createPalette(false, 'dark', true)
const mdTheme = markdownTheme(palette)
const t = createTranslator('zh-CN')

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
      const header = new HeaderComponent(agent, () => longText, palette, false, t)
      for (const row of render(header, width)) assert.ok(visibleWidth(row) <= width)
    }
  })

  it('shows the active session selection instead of Agent creation defaults', () => {
    const agent = {
      options: { model: 'deepseek-v4-flash', provider: 'deepseek-official' },
      session: { id: 'session-1', header: { cwd: 'C:/work' } },
    } as unknown as Agent
    const header = new HeaderComponent(agent, () => undefined, palette, false, t, () => ({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: ReasoningEffortId('max'),
    }))
    const output = render(header, 80).join('\n')
    assert.ok(output.includes('deepseek-v4-pro'))
    assert.ok(!output.includes('deepseek-v4-flash'))
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
  it('keeps mode and Git visible while collapsing an overlong directory', () => {
    const values: Record<string, string> = {
      mode: '标准  ',
      cwd: ' D:/Projects/a/very/long/workspace/path',
      'git/worktree': '  main',
    }
    const status = new StatusLineComponent(
      [{ type: 'value', name: 'mode' }, { type: 'value', name: 'cwd' }, { type: 'value', name: 'git/worktree' }],
      name => values[name],
      palette,
    )
    const [row] = status.render(32)
    assert.equal(visibleWidth(row!), 32)
    assert.ok(row!.startsWith(' ─── '))
    assert.ok(row!.includes('标准  '))
    assert.ok(row!.includes('…'))
    assert.ok(row!.includes(' main'))
    assert.ok(row!.endsWith(' '))
  })

  it('renders the footer as model · effort · used/limit below the rail', () => {
    const values: Record<string, string> = {
      model: 'deepseek-v4-flash',
      effort: ' · max',
      context: ' · ctx 100k/1m',
    }
    const footer = new ComposerFooterComponent(
      [{ type: 'value', name: 'model' }, { type: 'value', name: 'effort' }, { type: 'value', name: 'context' }],
      name => values[name],
      palette,
    )
    const [row] = footer.render(48)
    assert.equal(row, '  deepseek-v4-flash · max · ctx 100k/1m')
    assert.ok(visibleWidth(row!) <= 48)
  })

  it('uses Flash/max for a new session and the last request route for history', () => {
    const fallback = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    assert.deepEqual(resolveSessionModelSelection(undefined, fallback, 'max'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    assert.deepEqual(resolveSessionModelSelection({
      config: {
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        reasoningEffort: ReasoningEffortId('xhigh'),
      },
    }, fallback, 'max'), {
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'xhigh',
    })
    assert.deepEqual(resolveSessionModelSelection(undefined, {
      ...fallback,
      reasoningEffort: ReasoningEffortId('high'),
    }, 'max'), {
      ...fallback,
      reasoningEffort: 'high',
    })
  })

  it('selects or cycles only through efforts advertised by the active model', () => {
    const off = { id: ReasoningEffortId('off'), name: 'Off' }
    const high = { id: ReasoningEffortId('high'), name: 'High' }
    const max = { id: ReasoningEffortId('max'), name: 'Max' }
    const efforts = [off, high, max]

    assert.deepEqual(chooseReasoningEffort(efforts, max.id, ''), { kind: 'selected', effort: off })
    assert.deepEqual(chooseReasoningEffort(efforts, off.id, 'high'), { kind: 'selected', effort: high })
    assert.deepEqual(chooseReasoningEffort(efforts, high.id, 'high'), { kind: 'already', effort: high })
    assert.deepEqual(chooseReasoningEffort(efforts, high.id, 'extreme'), { kind: 'unknown', requested: 'extreme' })
    assert.deepEqual(chooseReasoningEffort([], high.id, ''), { kind: 'unsupported' })
  })

  it('formats context usage as compact used/limit values', () => {
    assert.equal(formatContextTokens(0), '0')
    assert.equal(formatContextTokens(100_000), '100k')
    assert.equal(formatContextTokens(1_000_000), '1m')
    assert.equal(formatContextTokens(1_200_000), '1.2m')
  })

  it('paints inset composer rails blue and derives the Powerline tail from its surface', () => {
    const enabled = createPalette(true, 'dark', true)
    const border = '\u001b[38;2;137;180;250m'
    const [rail] = new InputBorderComponent(enabled).render(12)
    assert.equal(rail, ` ${border}${'─'.repeat(10)}\u001b[39m `)
    const [top] = new StatusLineComponent([], () => undefined, enabled).render(20)
    assert.ok(top!.startsWith(` ${border}───\u001b[39m`))
    assert.equal(visibleWidth(top!), 20)
    assert.equal(enabled.statusLineTail(''), '\u001b[38;2;17;17;27m\u001b[39m')
  })
  it('renders a faint expected-argument hint inside the composer', () => {
    const hint = new CommandHintComponent(() => '/mode <standard|minimal|code|cordis>', palette)
    assert.deepEqual(hint.render(48), ['  /mode <standard|minimal|code|cordis>'])
    const hidden = new CommandHintComponent(() => undefined, palette)
    assert.deepEqual(hidden.render(48), [])
  })

  it('returns annotated preset options immediately after a command space', async () => {
    const provider = new CombinedAutocompleteProvider([{
      name: 'mode',
      description: '切换模式',
      argumentHint: '<standard|minimal>',
      getArgumentCompletions: () => [
        { value: 'standard', label: 'standard — 标准', description: '完整 Agent 与工具链' },
        { value: 'minimal', label: 'minimal — 极简', description: 'bash + 编辑器双工具' },
      ],
    }], 'D:/work')
    const suggestions = await provider.getSuggestions(
      ['/mode '],
      0,
      '/mode '.length,
      { signal: new AbortController().signal },
    )
    assert.equal(suggestions?.prefix, '')
    assert.deepEqual(suggestions?.items.map(item => [item.value, item.description]), [
      ['standard', '完整 Agent 与工具链'],
      ['minimal', 'bash + 编辑器双工具'],
    ])
  })

  it('submits an exact slash-command argument with one Enter press', async () => {
    const identity = (text: string): string => text
    const editor = new Editor({
      terminal: { rows: 24 },
      requestRender: () => undefined,
    } as never, {
      borderColor: identity,
      selectList: {
        selectedPrefix: identity,
        selectedText: identity,
        description: identity,
        scrollInfo: identity,
        noMatch: identity,
      },
    })
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider([{
      name: 'mode',
      description: '切换模式',
      argumentHint: '<standard|minimal>',
      getArgumentCompletions: () => [
        { value: 'standard', label: 'standard — 标准' },
        { value: 'minimal', label: 'minimal — 极简' },
      ],
    }], 'D:/work'))
    let submitted: string | undefined
    editor.onSubmit = (text): void => { submitted = text }

    for (const character of '/mode minimal') editor.handleInput(character)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(editor.isShowingAutocomplete(), true)

    editor.handleInput('\r')
    assert.equal(submitted, '/mode minimal')
    assert.equal(editor.getText(), '')
  })
})
