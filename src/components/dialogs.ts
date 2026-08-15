/**
 * Framed dialog helpers and overlay flows: select dialogs (single/toggle),
 * a custom-answer input dialog, the user-questions flow (`ctx.userQuestions`
 * provider), and the model-selection flow. All overlays render as rounded
 * omp-style frames and release focus back to the editor on completion.
 */

import { Input, SelectList, type Component, type OverlayHandle, type TUI } from '@earendil-works/pi-tui'
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
  ) {
    this.input = new Input()
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

/** Show an overlay component and resolve once it reports through `onDone`. */
export function showOverlay<T>(
  ui: TUI,
  make: (done: (value: T | undefined) => void) => Component,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const handle = ui.showOverlay(make((value) => {
      handle.hide()
      resolve(value)
    }), {
      anchor: 'bottom-center',
      width: '70%',
      maxHeight: '70%',
    })
    ui.requestRender()
  })
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
  for (const question of questions) {
    if (signal?.aborted) break
    const options = (question.options ?? []).map(option => ({
      value: option.label,
      label: option.label,
      description: option.description,
    }))
    let selected: string[] | undefined
    if (options.length === 0) {
      const custom = await showOverlay<string>(ui, (done) => new InputDialog(question.question, palette, done, t))
      if (custom === undefined) break
      selected = [custom]
    } else if (question.multiSelect === true) {
      const picked = await showOverlay<string[]>(ui, (done) => new ToggleDialog(question.question, options, palette, done))
      if (picked === undefined) break
      selected = picked
    } else {
      const withCustom = [...options, { value: CUSTOM_ANSWER, label: '✎ 自定义回答…' }]
      const picked = await showOverlay<string>(ui, (done) => new SelectDialog(question.question, withCustom, palette, done))
      if (picked === undefined) break
      if (picked === CUSTOM_ANSWER) {
        const custom = await showOverlay<string>(ui, (done) => new InputDialog(question.question, palette, done, t))
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
  const providers = llm.listProviders()
  const provider = await pickOne(ui, palette, t('modelProvider'), providers.map(entry => ({
    value: entry.id,
    label: entry.name,
  })))
  if (provider === undefined) return undefined
  const models = await llm.listModels(provider)
  const model = await pickOne(ui, palette, t('modelTitle', { provider }), models.map(entry => ({
    value: entry.id,
    label: entry.id,
    description: entry.name === undefined ? undefined : displayText(entry.name),
  })))
  if (model === undefined) return undefined
  const resolved = await llm.resolveModelInfo(provider, model)
  let reasoningEffort: string | undefined
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
  const selection: ModelSelection = {
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort as ModelSelection['reasoningEffort'] },
  }
  await save(selection)
  return selection
}
