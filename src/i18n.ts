/**
 * Minimal i18n layer for user-facing strings. Every visible string lives in
 * one of the locale dictionaries below; the active locale is resolved from
 * the `tui.locale` config row (default `zh-CN`).
 *
 * Adding a string: add a key to {@link MessageKey} (via the `Messages`
 * record), then fill it in BOTH dictionaries — the `Messages` type enforces
 * key parity at compile time, and `tests/i18n.spec.ts` re-checks it.
 */

/** Supported UI locales. */
export const LOCALES = ['zh-CN', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** Message templates; `{name}` placeholders are substituted by {@link Translator}. */
export type Messages = {
  // --- welcome header -----------------------------------------------------
  headerWelcome: string
  headerTips: string
  headerCommands: string
  headerSessions: string
  headerComplete: string
  headerExpand: string
  headerSession: string
  headerWorkspace: string
  headerTip: string
  headerTipBody: string
  // --- /help listing ------------------------------------------------------
  helpShortcuts: string
  helpCtrlC: string
  helpCtrlO: string
  helpCtrlR: string
  helpCommands: string
  helpPalette: string
  helpHelp: string
  helpModel: string
  helpThink: string
  helpNew: string
  helpResume: string
  helpDetails: string
  helpSkills: string
  helpSkillInvoke: string
  helpMode: string
  helpTheme: string
  helpSettings: string
  // --- command autocomplete descriptions ----------------------------------
  cmdPalette: string
  cmdHelp: string
  cmdModel: string
  cmdThink: string
  cmdNew: string
  cmdResume: string
  cmdDetails: string
  cmdSkills: string
  cmdMode: string
  cmdTheme: string
  cmdSettings: string
  // --- notices ------------------------------------------------------------
  noticeNoSessions: string
  noticeSessionListFailed: string
  noticeNoSkills: string
  noticeSkillListFailed: string
  noticeSkillUsage: string
  noticeUnknownSkill: string
  noticeSkillFailed: string
  noticeAlreadySession: string
  noticeResuming: string
  noticeCreatingSession: string
  noticeSessionCreated: string
  noticeSessionCreateFailed: string
  noticeSessionResumed: string
  noticeModelSet: string
  noticeThinkSet: string
  noticeThinkAlready: string
  noticeThinkUnknown: string
  noticeThinkUnsupported: string
  noticeThinkFailed: string
  noticeCompacting: string
  noticeCompactionDone: string
  noticeCompactionFailed: string
  noticeTurnEnded: string
  noticeToolCards: string
  noticeReasoningShown: string
  noticeReasoningHidden: string
  noticeModelFailed: string
  noticeUnknownCommand: string
  noticeReferenceFailed: string
  noticeModeSet: string
  noticeModeUnknown: string
  noticeModeUnavailable: string
  noticeModeAlready: string
  noticeModeNotBlank: string
  noticeModeMountFailed: string
  noticeModeSwitchFailed: string
  noticeThemeSet: string
  noticeThemeUnknown: string
  noticeSettingsUnavailable: string
  noticeSettingsSaved: string
  noticeSettingsFailed: string
  noticeTitleModelSet: string
  noticeExitHint: string
  // --- dialogs and flows --------------------------------------------------
  dialogTypeAnswer: string
  modelProvider: string
  modelTitle: string
  modelEffort: string
  resumeTitle: string
  settingsTitle: string
  settingsTheme: string
  settingsTitleModel: string
  settingsThemeCurrent: string
  settingsTitleModelCurrent: string
  untitled: string
  // --- mode / theme labels ------------------------------------------------
  modeStandard: string
  modeMinimal: string
  modeCode: string
  modeCordis: string
  modeStandardHint: string
  modeMinimalHint: string
  modeCodeHint: string
  modeCordisHint: string
  themeCurrent: string
  themeCustomNote: string
}

export const MESSAGES: Record<Locale, Messages> = {
  'zh-CN': {
    headerWelcome: '欢迎回来！',
    headerTips: '小贴士',
    headerCommands: '打开命令',
    headerSessions: '引用会话与文件',
    headerComplete: '补全',
    headerExpand: '展开工具输出',
    headerSession: '会话',
    headerWorkspace: '工作目录',
    headerTip: '提示：',
    headerTipBody: '输入 /help 查看命令与快捷键。',
    helpShortcuts: '键盘快捷键',
    helpCtrlC: '中断当前回合',
    helpCtrlO: '切换工具卡显示：折叠 → 展开 → 隐藏',
    helpCtrlR: '显示 / 隐藏思考块',
    helpCommands: '命令',
    helpPalette: '查看调色板角色表',
    helpHelp: '本帮助列表',
    helpModel: '选择 provider / model / 推理强度',
    helpThink: '切换当前模型的思考等级',
    helpNew: '新建会话',
    helpResume: '恢复持久化会话',
    helpDetails: '查看会话诊断',
    helpSkills: '列出可用技能',
    helpSkillInvoke: '以指令方式调用技能',
    helpSettings: '打开可视化设置',
    helpMode: '切换工作模式（标准 / 极简 / PTC / 创造）',
    helpTheme: '查看主题或切换主题',
    cmdPalette: '查看调色板角色表',
    cmdHelp: '查看快捷键与命令',
    cmdModel: '选择 provider / model / 推理强度',
    cmdThink: '切换当前模型的思考等级',
    cmdNew: '新建会话',
    cmdSettings: '打开可视化设置',
    cmdResume: '恢复持久化会话',
    cmdDetails: '查看会话诊断',
    cmdSkills: '列出可用技能',
    cmdMode: '切换工作模式（标准 / 极简 / PTC / 创造）',
    cmdTheme: '查看或切换主题',
    noticeNoSessions: '没有持久化会话。',
    noticeSessionListFailed: '会话列表获取失败：{error}',
    noticeNoSkills: '没有可用技能。',
    noticeSkillListFailed: '技能列表获取失败：{error}',
    noticeSkillUsage: '用法：/skill:<名称>',
    noticeUnknownSkill: '未知技能：{name}',
    noticeSkillFailed: '技能 "{name}" 加载失败：{error}',
    noticeAlreadySession: '已在当前会话。',
    noticeResuming: '正在恢复会话…',
    noticeCreatingSession: '正在创建新会话…',
    noticeSessionCreated: '已新建会话 {id}。',
    noticeSessionCreateFailed: '新建会话失败：{error}',
    noticeSessionResumed: '会话 {id} 已恢复。',
    noticeModelSet: '模型已设为 {provider}/{model}。',
    noticeThinkSet: '思考等级已切换为 {name}（{id}）。',
    noticeThinkAlready: '当前思考等级已是 {name}（{id}）。',
    noticeThinkUnknown: '当前模型不支持思考等级：{name}',
    noticeThinkUnsupported: '当前模型未提供可切换的思考等级。',
    noticeThinkFailed: '思考等级切换失败：{error}',
    noticeCompacting: '上下文压缩中…',
    noticeCompactionDone: '上下文压缩完成。',
    noticeCompactionFailed: '上下文压缩失败：{error}',
    noticeTurnEnded: '回合结束：{reason}。',
    noticeToolCards: '工具卡：{visibility}。',
    noticeReasoningShown: '思考块已显示。',
    noticeReasoningHidden: '思考块已隐藏。',
    noticeModelFailed: '模型选择失败：{error}',
    noticeUnknownCommand: '未知命令：{name}',
    noticeReferenceFailed: '会话引用失败：{error}',
    noticeModeSet: '已切换到{mode}模式。',
    noticeModeUnknown: '未知模式：{name}',
    noticeModeUnavailable: '当前组合未提供 agent-presets 服务。',
    noticeModeAlready: '当前已是{mode}模式。',
    noticeModeNotBlank: '会话已产生内容，无法切换模式；请在新会话中切换。',
    noticeModeMountFailed: '模式装配失败：{error}',
    noticeModeSwitchFailed: '模式切换失败：{error}',
    noticeThemeSet: '已切换主题：{name}。',
    noticeThemeUnknown: '未知主题：{name}',
    noticeSettingsUnavailable: '当前组合未提供持久化设置服务。',
    noticeSettingsSaved: '设置已保存。',
    noticeSettingsFailed: '设置保存失败：{error}',
    noticeTitleModelSet: '标题模型已设为 {provider}/{model}。',
    noticeExitHint: '再次按 Ctrl+C 退出',
    dialogTypeAnswer: '输入你的回答并回车',
    modelProvider: '服务商',
    modelTitle: '模型 · {provider}',
    modelEffort: '推理强度',
    resumeTitle: '恢复会话',
    settingsTitle: '设置',
    settingsTheme: '主题',
    settingsTitleModel: '标题模型',
    settingsThemeCurrent: '当前主题：{name}',
    settingsTitleModelCurrent: '当前标题模型：{provider}/{model}',
    untitled: '（未命名）',
    modeStandard: '标准',
    modeMinimal: '极简',
    modeCode: 'PTC',
    modeCordis: '创造',
    modeStandardHint: '完整 Agent 与工具链',
    modeMinimalHint: 'bash + 编辑器双工具',
    modeCodeHint: 'PTC Code Mode SDK',
    modeCordisHint: '创建和调试 preset',
    themeCurrent: '当前主题',
    themeCustomNote: '自定义主题需通过配置 theme.custom 提供。',
  },
  en: {
    headerWelcome: 'Welcome back!',
    headerTips: 'Tips',
    headerCommands: '/ for commands',
    headerSessions: '@ for sessions and files',
    headerComplete: 'Tab to complete',
    headerExpand: 'Ctrl+O to expand tool output',
    headerSession: 'Session',
    headerWorkspace: 'Workspace',
    headerTip: 'Tip:',
    headerTipBody: 'Use /help to discover the command surface.',
    helpShortcuts: 'Keyboard shortcuts',
    helpCtrlC: 'interrupt the running turn',
    helpCtrlO: 'cycle tool cards: collapsed → expanded → hidden',
    helpCtrlR: 'toggle reasoning blocks',
    helpCommands: 'Commands',
    helpPalette: 'show the palette role table',
    helpHelp: 'this listing',
    helpModel: 'pick a provider/model/reasoning effort',
    helpThink: 'switch the current model reasoning effort',
    helpNew: 'start a new session',
    helpResume: 'resume a persisted session',
    helpDetails: 'show session diagnostics',
    helpSkills: 'list available skills',
    helpSkillInvoke: 'invoke a skill as instructions',
    helpMode: 'switch working mode (standard / minimal / PTC / creator)',
    helpTheme: 'show themes or switch theme',
    helpSettings: 'open visual settings',
    cmdPalette: 'Show the palette role table',
    cmdHelp: 'Show keyboard shortcuts and commands',
    cmdModel: 'Pick a provider/model/reasoning effort',
    cmdThink: 'Switch the current model reasoning effort',
    cmdNew: 'Start a new session',
    cmdResume: 'Resume a persisted session',
    cmdDetails: 'Show session diagnostics',
    cmdSkills: 'List available skills',
    cmdMode: 'Switch working mode (standard/minimal/PTC/creator)',
    cmdTheme: 'Show or switch theme',
    cmdSettings: 'Open visual settings',
    noticeNoSessions: 'No persisted sessions.',
    noticeSessionListFailed: 'Session listing failed: {error}',
    noticeNoSkills: 'No skills available.',
    noticeSkillListFailed: 'Skill listing failed: {error}',
    noticeSkillUsage: 'Usage: /skill:<name>',
    noticeUnknownSkill: 'Unknown skill: {name}',
    noticeSkillFailed: 'Skill "{name}" failed to load: {error}',
    noticeAlreadySession: 'Already on this session.',
    noticeResuming: 'Resuming session…',
    noticeCreatingSession: 'Creating a new session…',
    noticeSessionCreated: 'Started session {id}.',
    noticeSessionCreateFailed: 'Failed to create session: {error}',
    noticeSessionResumed: 'Session {id} resumed.',
    noticeModelSet: 'Model set to {provider}/{model}.',
    noticeThinkSet: 'Reasoning effort switched to {name} ({id}).',
    noticeThinkAlready: 'Reasoning effort is already {name} ({id}).',
    noticeThinkUnknown: 'The current model does not support reasoning effort: {name}',
    noticeThinkUnsupported: 'The current model does not expose selectable reasoning efforts.',
    noticeThinkFailed: 'Reasoning effort switch failed: {error}',
    noticeCompacting: 'Context being compacted…',
    noticeCompactionDone: 'Compaction finished.',
    noticeCompactionFailed: 'Compaction failed: {error}',
    noticeTurnEnded: 'Turn ended: {reason}.',
    noticeToolCards: 'Tool cards {visibility}.',
    noticeReasoningShown: 'Reasoning blocks shown.',
    noticeReasoningHidden: 'Reasoning blocks hidden.',
    noticeModelFailed: 'Model selection failed: {error}',
    noticeUnknownCommand: 'Unknown command: {name}',
    noticeReferenceFailed: 'Session reference failed: {error}',
    noticeModeSet: 'Mode switched to {mode}.',
    noticeModeUnknown: 'Unknown mode: {name}',
    noticeModeUnavailable: 'agent-presets is not composed in this deployment.',
    noticeModeAlready: 'Already in {mode} mode.',
    noticeModeNotBlank: 'Cannot switch modes: the session already produced content. Start a new session to switch.',
    noticeModeMountFailed: 'Preset mount failed: {error}',
    noticeModeSwitchFailed: 'Mode switch failed: {error}',
    noticeThemeSet: 'Theme switched to {name}.',
    noticeThemeUnknown: 'Unknown theme: {name}',
    noticeSettingsUnavailable: 'Persistent settings are not available in this deployment.',
    noticeSettingsSaved: 'Settings saved.',
    noticeSettingsFailed: 'Settings save failed: {error}',
    noticeTitleModelSet: 'Title model set to {provider}/{model}.',
    noticeExitHint: 'Press Ctrl+C again to exit',
    dialogTypeAnswer: 'type your answer and press enter',
    modelProvider: 'Provider',
    modelTitle: 'Model · {provider}',
    modelEffort: 'Reasoning effort',
    resumeTitle: 'Resume session',
    settingsTitle: 'Settings',
    settingsTheme: 'Theme',
    settingsTitleModel: 'Title model',
    settingsThemeCurrent: 'Current theme: {name}',
    settingsTitleModelCurrent: 'Current title model: {provider}/{model}',
    untitled: '(untitled)',
    modeStandard: 'standard',
    modeMinimal: 'minimal',
    modeCode: 'PTC',
    modeCordis: 'creator',
    modeStandardHint: 'full Agent and toolchain',
    modeMinimalHint: 'bash + editor only',
    modeCodeHint: 'PTC Code Mode SDK',
    modeCordisHint: 'create and debug presets',
    themeCurrent: 'Current theme',
    themeCustomNote: 'Custom themes are provided through the theme.custom config.',
  },
}

export type MessageKey = keyof Messages

/** Substitute `{name}` placeholders in a template. */
function fill(template: string, params: Record<string, string | number> | undefined): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** Build the translator bound to one locale; unknown locales fall back to zh-CN. */
export function createTranslator(locale: Locale): Translator {
  const messages = MESSAGES[locale] ?? MESSAGES['zh-CN']
  return (key, params) => fill(messages[key] ?? MESSAGES['zh-CN'][key], params)
}

/** Translate one message key, with optional `{name}` parameters. */
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string
