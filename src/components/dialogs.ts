/**
 * Framed dialog helpers and overlay flows: select dialogs (single/toggle),
 * a custom-answer input dialog, the user-questions flow (`ctx.userQuestions`
 * provider), an embedded ask card for the composer area, and the
 * model-selection flow. Overlays render as rounded omp-style frames and
 * release focus back to the editor on completion.
 */

import { Input, SelectList, wrapTextWithAnsi, type Component, type Container, type Focusable, type OverlayHandle, type OverlayOptions, type TUI } from '@earendil-works/pi-tui'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { frameBlock, selectTheme, type ColorRole, type Palette } from '../theme.ts'
import type { Translator } from '../i18n.ts'
import { displayText } from './text.ts'

/** A framed overlay hosting a single-select list. Resolves on Enter or Esc. */
export class SelectDialog implements Component {
  private readonly list: SelectList

  constructor(
    title: string,
    items: Array<{ value: string; label: string; description?: string }>,
    palette: Palette,
    private readonly onDone: (value: string | undefined) => void,
  ) {
    this.list = new SelectList(items, 8, selectTheme(palette))
    this.list.onSelect = (item) => onDone(item.value)
    this.list.onCancel = () => onDone(undefined)
    this.title = title
    this.palette = palette
  }

  private readonly title: string
  private readonly palette: Palette

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }

  render(width: number): string[] {
    const inner = Math.max(20, width - 4)
    const rows = this.list.render(inner - 4)
    return frameBlock(rows, width, this.palette.accent, undefined, this.title)
  }
}

/** A framed overlay where Enter toggles selections; Esc confirms (or cancels when empty). */
export class ToggleDialog implements Component {
  private readonly list: SelectList
  private readonly selected = new Set<string>()

  constructor(
    title: string,
    items: Array<{ value: string; label: string; description?: string }>,
    palette: Palette,
    private readonly onDone: (values: string[] | undefined) => void,
  ) {
    this.list = new SelectList(items, 8, selectTheme(palette))
    this.list.onSelect = (item) => {
      if (this.selected.has(item.value)) this.selected.delete(item.value)
      else this.selected.add(item.value)
      this.list.invalidate()
    }
    this.list.onCancel = () => {
      if (this.selected.size === 0) onDone(undefined)
      else onDone([...this.selected])
    }
    this.title = title
    this.palette = palette
  }

  private readonly title: string
  private readonly palette: Palette

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }

  render(width: number): string[] {
    const inner = Math.max(20, width - 4)
    const rows = this.list.render(inner - 4)
    return frameBlock(rows, width, this.palette.accent, undefined, this.title)
  }
}

/** A framed overlay with a single-line input; resolves on Enter or Esc. */
export class InputDialog implements Component {
  private readonly input: Input

  constructor(
    title: string,
    palette: Palette,
    private readonly onDone: (value: string | undefined) => void,
    private readonly t: Translator,
    initialValue = '',
  ) {
    this.input = new Input()
    if (initialValue !== '') this.input.setValue(initialValue)
    this.input.onSubmit = (value: string) => onDone(value)
    this.input.onEscape = () => onDone(undefined)
    this.title = title
    this.palette = palette
  }

  private readonly title: string
  private readonly palette: Palette

  handleInput(data: string): void {
    this.input.handleInput(data)
  }

  invalidate(): void {
    this.input.invalidate()
  }

  render(width: number): string[] {
    const inner = Math.max(20, width - 4)
    const rows = [`${this.palette.dim(this.t('dialogTypeAnswer'))}`, this.input.render(inner - 4)[0] ?? '']
    return frameBlock(rows, width, this.palette.accent, undefined, this.title)
  }
}

/**
 * Embedded ask card rendered in the composer area instead of a modal overlay.
 * It owns a single-line input and is focusable, so the user can answer while
 * keeping the main editor draft untouched.
 */
export class AskCardComponent implements Component, Focusable {
  focused = false
  private readonly input: Input

  constructor(
    private readonly question: AskUserQuestionItem,
    private readonly index: number,
    private readonly total: number,
    private readonly palette: Palette,
    private readonly t: Translator,
    private readonly onDone: (value: string | undefined) => void,
  ) {
    this.input = new Input()
    this.input.onSubmit = (value) => onDone(value)
    this.input.onEscape = () => onDone(undefined)
  }

  handleInput(data: string): void {
    this.input.focused = this.focused
    this.input.handleInput(data)
  }

  invalidate(): void {
    this.input.invalidate()
  }

  render(width: number): string[] {
    this.input.focused = this.focused
    const bodyWidth = Math.max(1, width - 4)
    const innerWidth = Math.max(20, width - 4)
    const inputWidth = Math.max(1, Math.min(innerWidth - 4, bodyWidth))
    const options = this.question.options ?? []
    const rows: string[] = []
    rows.push(...wrapTextWithAnsi(
      this.palette.bold(this.palette.accent(`❓ ${this.question.question}`)),
      bodyWidth,
    ))
    rows.push('')
    options.forEach((option, i) => {
      rows.push(...wrapTextWithAnsi(
        ` ${i + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`,
        bodyWidth,
      ))
    })
    if (options.length > 0) {
      rows.push('')
      rows.push(...wrapTextWithAnsi(this.palette.dim(this.question.multiSelect === true
        ? this.t('askInlineMultiHint')
        : this.t('askInlineOptionHint')), bodyWidth))
    } else {
      rows.push('')
      rows.push(...wrapTextWithAnsi(this.palette.dim(this.t('askInlineTextHint')), bodyWidth))
    }
    rows.push('')
    rows.push(...this.input.render(inputWidth))
    const title = this.total > 1
      ? `${this.t('askTitle')} ${this.index + 1}/${this.total}`
      : this.t('askTitle')
    return ['', ...frameBlock(rows, width, this.palette.accent, this.palette.toolPendingBg, title)]
  }
}

/** Show an overlay component and resolve once it reports through `onDone`. */
export function showOverlay<T>(
  ui: TUI,
  make: (done: (value: T | undefined) => void) => Component,
  options?: Partial<Pick<OverlayOptions, 'anchor' | 'width' | 'maxHeight' | 'offsetY' | 'margin'>>,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const handle = ui.showOverlay(make((value) => {
      handle.hide()
      resolve(value)
    }), {
      anchor: 'center',
      width: '80%',
      maxHeight: '85%',
      ...options,
    })
    ui.requestRender()
  })
}

/**
 * Parse one inline ask submission into the user-questions answer item.
 * Mirrors the WeChat ask mapping: a single numeric answer picks an option,
 * multi-select accepts comma/space separated numbers, and anything else is
 * treated as a custom answer.
 */
function parseInlineAnswer(raw: string, question: AskUserQuestionItem): AskUserQuestionAnswerItem {
  const text = raw.trim()
  const options = question.options ?? []
  const selected: string[] = []
  let custom: string | undefined
  if (question.multiSelect === true) {
    const parts = text.split(/[\s,，、]+/).filter(Boolean)
    const indices = parts.map(part => /^\d+$/.test(part) ? Number(part) : Number.NaN)
    const valid = indices.filter(index =>
      Number.isInteger(index) && index >= 1 && index <= options.length)
    if (valid.length > 0 && valid.length === parts.length) {
      for (const index of valid) {
        const option = options[index - 1]
        if (option) selected.push(option.label)
      }
    } else if (text !== '') {
      custom = text
    }
  } else if (options.length > 0 && /^\d+$/.test(text)) {
    const option = options[Number(text) - 1]
    if (option) selected.push(option.label)
    else if (text !== '') custom = text
  } else if (text !== '') {
    custom = text
  }
  return {
    id: question.id,
    selected,
    ...(custom !== undefined ? { custom } : {}),
  }
}

/**
 * Run the user-questions flow as an embedded card in the composer area.
 * Each question is rendered one at a time in `slot`; the card owns its input,
 * so the main editor draft is left untouched. Esc cancels the remaining flow
 * and an abort signal immediately removes the card.
 */
export async function runInlineQuestionFlow(
  ui: TUI,
  slot: Container,
  palette: Palette,
  t: Translator,
  questions: readonly AskUserQuestionItem[],
  signal: AbortSignal | undefined,
  restoreFocus: () => void,
): Promise<AskUserQuestionAnswerItem[]> {
  const answers: AskUserQuestionAnswerItem[] = []
  const { promise, resolve } = Promise.withResolvers<AskUserQuestionAnswerItem[]>()
  let settled = false

  const finish = (): void => {
    if (settled) return
    settled = true
    signal?.removeEventListener('abort', onAbort)
    slot.clear()
    ui.requestRender()
    restoreFocus()
  }

  const onAbort = (): void => {
    finish()
    resolve(answers)
  }

  const showQuestion = (index: number): void => {
    const question = questions[index]
    if (question === undefined) {
      finish()
      resolve(answers)
      return
    }
    const card = new AskCardComponent(question, index, questions.length, palette, t, (value) => {
      if (value === undefined) {
        finish()
        resolve(answers)
        return
      }
      if (value.trim() === '') {
        ui.requestRender()
        return
      }
      answers.push(parseInlineAnswer(value, question))
      if (index + 1 < questions.length) {
        showQuestion(index + 1)
      } else {
        finish()
        resolve(answers)
      }
    })
    slot.clear()
    slot.addChild(card)
    ui.setFocus(card)
    ui.requestRender()
  }

  if (signal?.aborted) {
    resolve(answers)
    return promise
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  showQuestion(0)
  return promise
}

const CUSTOM_ANSWER = '\u0000custom'

/**
 * Collect answers for one user-questions request: each question renders as an
 * option list (with a custom-answer entry), multi-select questions toggle.
 * Honors the request's abort signal by cancelling the flow.
 */
export async function runQuestionFlow(
  ui: TUI,
  palette: Palette,
  t: Translator,
  questions: readonly AskUserQuestionItem[],
  signal: AbortSignal | undefined,
): Promise<AskUserQuestionAnswerItem[]> {
  const answers: AskUserQuestionAnswerItem[] = []
  const askOverlayOptions = { width: '90%', maxHeight: '90%' } as const
  for (const question of questions) {
    if (signal?.aborted) break
    const options = (question.options ?? []).map(option => ({
      value: option.label,
      label: option.label,
      description: option.description,
    }))
    let selected: string[] | undefined
    if (options.length === 0) {
      const custom = await showOverlay<string>(ui, (done) => new InputDialog(question.question, palette, done, t), askOverlayOptions)
      if (custom === undefined) break
      selected = [custom]
    } else if (question.multiSelect === true) {
      const picked = await showOverlay<string[]>(ui, (done) => new ToggleDialog(question.question, options, palette, done), askOverlayOptions)
      if (picked === undefined) break
      selected = picked
    } else {
      const withCustom = [...options, { value: CUSTOM_ANSWER, label: '✎ 自定义回答…' }]
      const picked = await showOverlay<string>(ui, (done) => new SelectDialog(question.question, withCustom, palette, done), askOverlayOptions)
      if (picked === undefined) break
      if (picked === CUSTOM_ANSWER) {
        const custom = await showOverlay<string>(ui, (done) => new InputDialog(question.question, palette, done, t), askOverlayOptions)
        if (custom === undefined) break
        selected = [custom]
      } else {
        selected = [picked]
      }
    }
    if (selected === undefined) continue
    const optionSet = new Set(options.map(option => option.value))
    const custom = selected.length === 1 && !optionSet.has(selected[0]!) ? selected[0] : undefined
    const optionLabels = custom === undefined ? selected : selected.filter(value => optionSet.has(value))
    answers.push({
      id: question.id,
      selected: optionLabels ?? [],
      ...custom !== undefined ? { custom } : {},
    })
  }
  return answers
}

/** A generic selection helper for the model flow. */
async function pickOne(
  ui: TUI,
  palette: Palette,
  title: string,
  entries: Array<{ value: string; label: string; description?: string }>,
): Promise<string | undefined> {
  if (entries.length === 0) return undefined
  if (entries.length === 1) return entries[0]!.value
  return showOverlay(ui, (done) => new SelectDialog(title, entries, palette, done))
}

/**
 * The `/model` flow: provider → model → optional reasoning effort, committing
 * the selection through the caller's saver when one is supplied.
 */
export async function runModelFlow(
  ui: TUI,
  palette: Palette,
  t: Translator,
  llm: LlmRuntime,
  save: (selection: ModelSelection) => Promise<void>,
): Promise<ModelSelection | undefined> {
  const CUSTOM_MODEL = '\u0000custom-model'
  const providerEntries = llm.listProviders().map(entry => ({
    id: entry.id,
    name: entry.name,
  }))
  const provider = await pickOne(ui, palette, t('modelProvider'), providerEntries.map(entry => ({
    value: entry.id,
    label: entry.name,
  })))
  if (provider === undefined) return undefined

  let models: Array<{ id: string; name?: string }> = []
  try {
    const found = await llm.listModels(provider)
    models = found.map(entry => ({ id: entry.id, name: entry.name }))
  } catch {
    // Keep the custom model entry available when the adapter has no catalog.
  }

  const modelEntries = [
    ...models.map(entry => ({
      value: entry.id,
      label: entry.id,
      description: entry.name === undefined ? undefined : displayText(entry.name),
    })),
    { value: CUSTOM_MODEL, label: t('settingsCustomModel') },
  ]
  const picked = await pickOne(ui, palette, t('modelTitle', { provider }), modelEntries)
  if (picked === undefined) return undefined
  let model = picked
  if (picked === CUSTOM_MODEL) {
    const custom = await showOverlay<string>(
      ui,
      done => new InputDialog(t('modelTitle', { provider }), palette, done, t),
    )
    if (custom === undefined || custom.trim() === '') return undefined
    model = custom.trim()
  }

  let reasoningEffort: string | undefined
  try {
    const resolved = await llm.resolveModelInfo(provider, model)
    const efforts = resolved.reasoning?.efforts
    if (efforts !== undefined && efforts.length > 1) {
      const picked = await pickOne(ui, palette, t('modelEffort'), efforts.map(entry => ({
        value: entry.id,
        label: entry.name,
        description: entry.description,
      })))
      if (picked === undefined) return undefined
      reasoningEffort = picked
    }
  } catch {
    // Providers may accept dynamic model ids without exposing metadata.
  }
  const selection: ModelSelection = {
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort as ModelSelection['reasoningEffort'] },
  }
  await save(selection)
  return selection
}
