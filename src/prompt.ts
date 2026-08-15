/**
 * Prompt-template vocabulary for the terminal mode: `${name}` token parsing
 * plus the tuiPrompt value registry that plugins and the TUI itself share.
 * A template value is a plain string; segments carry their own colors because
 * the values are registered already styled.
 */

import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiPrompt: TuiPrompt
  }
}

/** One parsed template token. */
export type TuiPromptToken =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'value'; readonly name: string }

/**
 * Parse a `${name}` template into tokens. Literal `${` without a closing `}`
 * or an empty name stays literal text; unknown value names render as nothing
 * at render time.
 */
export function parseTuiPromptTemplate(template: string): TuiPromptToken[] {
  const tokens: TuiPromptToken[] = []
  let rest = template
  while (rest.length > 0) {
    const start = rest.indexOf('${')
    if (start < 0) {
      tokens.push({ type: 'text', text: rest })
      break
    }
    if (start > 0) tokens.push({ type: 'text', text: rest.slice(0, start) })
    const end = rest.indexOf('}', start)
    if (end < 0) {
      tokens.push({ type: 'text', text: rest.slice(start) })
      break
    }
    const name = rest.slice(start + 2, end)
    if (name === '') {
      tokens.push({ type: 'text', text: '${}' })
      rest = rest.slice(end + 1)
      continue
    }
    tokens.push({ type: 'value', name })
    rest = rest.slice(end + 1)
  }
  return tokens
}

/** Render tokens through a value resolver; missing values render as nothing. */
export function renderTuiPromptTemplate(
  tokens: readonly TuiPromptToken[],
  resolve: (name: string) => string | undefined,
): string {
  let out = ''
  for (const token of tokens) {
    out += token.type === 'text' ? token.text : (resolve(token.name) ?? '')
  }
  return out
}

/** A registered value slot; `set` marks the template dirty and notifies. */
export interface TuiPromptValueHandle {
  /** Replace the value, or clear it with `undefined`. */
  set(value: string | undefined): void
}

/**
 * Built-ins register full and compact composer status values for cwd, Git,
 * mode, model, reasoning effort, context, and permission, plus token usage,
 * queue state, symbol, and indicator; plugins may register their own
 * `${custom}` fragments and subscribe to any change.
 */
export class TuiPrompt extends Service {
  static inject: string[] = []

  private readonly values = new Map<string, string | undefined>()
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context) {
    super(ctx, 'tuiPrompt')
  }

  /** Register a value slot with an optional initial value. */
  register(name: string, initial?: string): TuiPromptValueHandle {
    this.values.set(name, initial)
    let active = true
    return {
      set: (value: string | undefined): void => {
        if (!active) return
        if (this.values.get(name) === value) return
        this.values.set(name, value)
        for (const listener of this.listeners) listener()
      },
    }
  }

  /** Read the current value of a slot. */
  get(name: string): string | undefined {
    return this.values.get(name)
  }

  /** Subscribe to value changes; returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export default TuiPrompt
