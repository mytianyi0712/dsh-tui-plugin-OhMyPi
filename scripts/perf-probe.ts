/**
 * Long-session render cost probe: builds a synthetic transcript (messages,
 * tool cards, todo panel) and measures full re-renders — the per-frame cost
 * the differential renderer pays after every event in a long session.
 * Run: node --experimental-transform-types scripts/perf-probe.ts
 */
import { Container, visibleWidth } from '@earendil-works/pi-tui'
import { createPalette, markdownTheme } from '../src/theme.ts'
import {
  StaticCardComponent,
  TodoPanelComponent,
  ToolCardComponent,
  UserMessageComponent,
} from '../src/components/transcript.ts'

const palette = createPalette(false, 'dark', true)
const mdTheme = markdownTheme(palette)

const chat = new Container()
for (let i = 0; i < 40; i++) {
  chat.addChild(new UserMessageComponent(`用户消息 #${i}，包含一些说明文字用于换行测试 padding padding padding padding`, palette, mdTheme))
}
for (let i = 0; i < 120; i++) {
  const card = new ToolCardComponent('read', JSON.stringify({ path: `src/file-${i}.ts` }), 6, palette)
  card.updateResult({
    turn: i,
    step: 1,
    message: {
      id: `m${i}`,
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: `c${i}`, content: [{ type: 'text', text: `result ${i}: `.repeat(40) }] }],
      source: { kind: 'tool' },
    },
  } as never)
  chat.addChild(card)
}
const todo = new TodoPanelComponent(palette)
todo.setTodos([
  { content: 'implement core', status: 'completed' },
  { content: 'wire dialogs', status: 'in_progress' },
  { content: 'polish chrome', status: 'pending' },
])
const frames = new Container()
frames.addChild(chat)
frames.addChild(todo)
frames.addChild(new StaticCardComponent(['x'.repeat(200)], palette))

// Warm up, then measure 20 full renders at terminal width.
frames.render(120)
const rounds = 20
const started = performance.now()
for (let i = 0; i < rounds; i++) {
  const rows = frames.render(120)
  for (const row of rows) {
    if (visibleWidth(row) > 120) throw new Error(`overwide row: ${row.slice(0, 40)}`)
  }
}
const elapsed = performance.now() - started
console.log(`transcript: 40 messages + 120 tool cards + panel`)
console.log(`per frame: ${(elapsed / rounds).toFixed(2)} ms (${rounds} renders at 120 cols)`)
console.log(`rows per frame: ${frames.render(120).length}`)
