/**
 * dsh-llm-pi-ai thinking-level maps.
 *
 * Provider models persist  as a dict whose keys are the
 * official UI levels and whose values are the wire spelling generate() sends:
 *
 *   reasoningEfforts:
 *     off: none
 *     high: high
 *     max: max
 *
 * Only  may map to null / empty (supported, send nothing).
 */

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevel = typeof THINKING_LEVELS[number]

/** Official UI level -> upstream wire value. Absent key = unsupported. */
export type ReasoningEffortMap = Partial<Record<ThinkingLevel, string | null>>

/**
 * Model capability persisted in dsh `llm-pi-ai`: a level map, `false` for a
 * non-reasoning model, or absent/inherited from the installed catalog.
 */
export type ReasoningEffortSetting = ReasoningEffortMap | false

export interface ReasoningEffortPreset {
  id: string
  map: ReasoningEffortMap
  defaultEffort: ThinkingLevel
}

/** Vendor maps using the official dsh keys, matching ~/.dsh/settings.yaml. */
export const REASONING_EFFORT_PRESETS: readonly ReasoningEffortPreset[] = [
  { id: 'deepseek', map: { off: 'none', high: 'high', max: 'max' }, defaultEffort: 'max' },
  { id: 'openai', map: { off: 'none', low: 'low', medium: 'medium', high: 'high' }, defaultEffort: 'medium' },
  { id: 'openai-gpt', map: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' }, defaultEffort: 'medium' },
  { id: 'claude', map: { low: 'low', medium: 'medium', high: 'high' }, defaultEffort: 'high' },
]

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value)
}

export function thinkingLevelsOf(setting: ReasoningEffortSetting | undefined): ThinkingLevel[] {
  if (setting === undefined || setting === false) return []
  return THINKING_LEVELS.filter(level => setting[level] !== undefined)
}

export function formatReasoningEffortMap(map: ReasoningEffortMap | undefined): string {
  if (map === undefined) return ''
  const parts: string[] = []
  for (const level of THINKING_LEVELS) {
    if (map[level] === undefined) continue
    const wire = map[level]
    parts.push((wire === null || wire === '') ? (level + ':') : (level + ': ' + wire))
  }
  return parts.join(', ')
}

/** Render a persisted dsh setting; `false` round-trips as the text `false`. */
export function formatReasoningEffortSetting(setting: ReasoningEffortSetting | undefined): string {
  if (setting === false) return 'false'
  return formatReasoningEffortMap(setting)
}

function assignLevel(map: ReasoningEffortMap, level: ThinkingLevel, wire: string | null): void {
  if (wire === null || wire === '') {
    if (level === 'off') map.off = null
    return
  }
  map[level] = wire
}

/** Parse a dsh dict, a  string, or a legacy id list into a level map. */
export function parseReasoningEffortMap(
  value: string | readonly string[] | ReasoningEffortMap | Record<string, unknown> | boolean | undefined | null,
): ReasoningEffortMap | undefined {
  if (value === undefined || value === null || value === false || value === true) return undefined
  if (typeof value === 'string') {
    const parsed = parseReasoningEffortText(value)
    return parsed === false ? undefined : parsed
  }
  if (Array.isArray(value)) {
    const parsed = parseReasoningEffortText(value.map(part => part.trim()).filter(Boolean).join(','))
    return parsed === false ? undefined : parsed
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const map: ReasoningEffortMap = {}
  for (const level of THINKING_LEVELS) {
    if (!Object.prototype.hasOwnProperty.call(record, level)) continue
    const wire = record[level]
    if (wire === undefined) continue
    if (wire === null) {
      if (level === 'off') map.off = null
      continue
    }
    if (typeof wire === 'string') assignLevel(map, level, wire)
  }
  return Object.keys(map).length === 0 ? undefined : map
}

const PRESET_ALIASES: Readonly<Record<string, string>> = {
  deepseek: 'deepseek',
  openai: 'openai',
  gpt: 'openai-gpt',
  'openai-gpt': 'openai-gpt',
  claude: 'claude',
}

function presetById(id: string): ReasoningEffortPreset | undefined {
  const presetId = PRESET_ALIASES[id] ?? id
  return REASONING_EFFORT_PRESETS.find(preset => preset.id === presetId)
}

/** Resolve a map that matches a shipped preset, if any. */
export function presetIdOf(setting: ReasoningEffortSetting | undefined): string | undefined {
  if (setting === undefined || setting === false) return undefined
  const key = formatReasoningEffortMap(setting)
  return REASONING_EFFORT_PRESETS.find(preset => formatReasoningEffortMap(preset.map) === key)?.id
}

const EFFORT_TOKEN_PATTERN = /([A-Za-z][A-Za-z0-9_-]*)\s*([:=])\s*([^\s,，;；]*)|([A-Za-z][A-Za-z0-9_-]*)/g

/**
 * Parse the forgiving editor input. Accepts preset ids (`deepseek`,
 * `openai`, `gpt`, `claude`), a level list (`off, high, max` — wire values
 * default to the level names and `off` sends nothing), and explicit wire
 * mappings (`off: none, high: high, max: ultra`). `false` disables reasoning.
 */
function parseReasoningEffortText(text: string): ReasoningEffortSetting | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (trimmed.toLowerCase() === 'false') return false

  const map: ReasoningEffortMap = {}
  for (const match of trimmed.matchAll(EFFORT_TOKEN_PATTERN)) {
    const key = match[1]
    const sep = match[2]
    const wire = match[3]
    const plain = match[4]
    if (key !== undefined && sep !== undefined) {
      const level = key.toLowerCase()
      if (!isThinkingLevel(level)) continue
      if (wire === '') {
        if (level === 'off') map.off = null
        continue
      }
      map[level] = wire
      continue
    }
    if (plain === undefined) continue
    const id = plain.toLowerCase()
    const preset = presetById(id)
    if (preset !== undefined) {
      Object.assign(map, preset.map)
      continue
    }
    if (id === 'none') {
      map.off = 'none'
      continue
    }
    if (id === 'false') continue
    if (isThinkingLevel(id)) {
      if (id === 'off') map.off = null
      else map[id] = id
    }
  }
  return Object.keys(map).length === 0 ? undefined : map
}

/**
 * Parse a persisted dsh model capability. `false` is preserved as a
 * first-class value so a non-reasoning declaration round-trips through the
 * editor instead of being silently dropped.
 */
export function parseReasoningEffortSetting(
  value: string | readonly string[] | ReasoningEffortMap | Record<string, unknown> | boolean | undefined | null,
): ReasoningEffortSetting | undefined {
  if (value === false) return false
  if (typeof value === 'string') return parseReasoningEffortText(value)
  if (Array.isArray(value)) {
    return parseReasoningEffortText(value.map(part => part.trim()).filter(Boolean).join(','))
  }
  return parseReasoningEffortMap(value)
}

function mapKey(setting: ReasoningEffortSetting | undefined): string {
  return setting === false ? 'false' : formatReasoningEffortMap(setting)
}

export function nextReasoningEffortMap(
  current: ReasoningEffortSetting | undefined,
): { map: ReasoningEffortSetting | undefined; defaultEffort: ThinkingLevel | undefined } {
  const key = mapKey(current)
  const steps: Array<{ key: string; map: ReasoningEffortSetting | undefined; defaultEffort: ThinkingLevel | undefined }> = [
    { key: '', map: undefined, defaultEffort: undefined },
    ...REASONING_EFFORT_PRESETS.map(preset => ({
      key: mapKey(preset.map),
      map: { ...preset.map } as ReasoningEffortSetting,
      defaultEffort: preset.defaultEffort,
    })),
    { key: 'false', map: false, defaultEffort: undefined },
  ]
  const index = steps.findIndex(step => step.key === key)
  const nextIndex = index === -1 ? 1 : (index + 1) % steps.length
  const step = steps[nextIndex]!
  return { map: step.map, defaultEffort: step.defaultEffort }
}

export function defaultEffortOf(
  setting: ReasoningEffortSetting | undefined,
  selected?: string,
): ThinkingLevel | undefined {
  const levels = thinkingLevelsOf(setting)
  if (levels.length === 0) return undefined
  if (selected !== undefined && isThinkingLevel(selected) && levels.includes(selected)) return selected
  return levels.find(level => level !== 'off') ?? levels[0]
}
