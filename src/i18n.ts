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
  helpPermission: string
  cmdPermission: string
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
  noticeResumeFailed: string
  noticeResumeTimeout: string
  noticeModelSet: string
  noticeThinkSet: string
  noticeThinkAlready: string
  noticeThinkUnknown: string
  noticeThinkUnsupported: string
  noticeThinkFailed: string
  noticeCompacting: string
  noticeCompactionDone: string
  noticeCompactionFailed: string
  noticeCompactionCause: string
  noticeCompactionHint: string
  noticeCompaction400Hint: string
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
  noticeEventRenderFailed: string
  noticeThemeSet: string
  noticeThemeUnknown: string
  noticeThemeModeSet: string
  noticeThemeModeUnknown: string
  noticeThemeDarkSet: string
  noticeThemeLightSet: string
  noticeSettingsUnavailable: string
  noticeSettingsSaved: string
  noticeSettingsFailed: string
  noticeTitleModelSet: string
  noticeExitHint: string
  noticeFullAccessWarning: string
  // --- dialogs and flows --------------------------------------------------
  dialogTypeAnswer: string
  askTitle: string
  askInlineOptionHint: string
  askInlineMultiHint: string
  askInlineTextHint: string
  modelProvider: string
  modelTitle: string
  modelEffort: string
  resumeTitle: string
  settingsTitle: string
  settingsHint: string
  settingsSubmenuHint: string
  settingsEmpty: string
  settingsTabGeneral: string
  settingsTabModelsProviders: string
  settingsTabAppearance: string
  settingsTabModel: string
  settingsTabDefaults: string
  settingsAddProvider: string
  settingsEditProvider: string
  settingsProviderName: string
  settingsProviderId: string
  settingsCredentialConfigured: string
  settingsApi: string
  settingsApiOpenAiCompletions: string
  settingsApiOpenAiResponses: string
  settingsApiAnthropicMessages: string
  settingsBaseURL: string
  settingsApiKey: string
  settingsModels: string
  settingsManageModels: string
  settingsAddModel: string
  settingsModelListHint: string
  settingsModelListEmpty: string
  settingsModelValue: string
  settingsModelRequired: string
  settingsModelDuplicate: string
  settingsProviderTemplate: string
  settingsBlankProvider: string
  settingsDiscoverModels: string
  settingsDiscovering: string
  settingsDiscoveredCount: string
  settingsDiscoveryUnavailable: string
  settingsConfiguredProviders: string
  settingsConfiguredModels: string
  settingsProviderModelCount: string
  settingsSetDefaultModel: string
  settingsSetTitleModel: string
  providerFormHint: string
  providerConfigRequired: string
  providerIdRequired: string
  providerIdInvalid: string
  providerBaseURLRequired: string
  providerApiRequired: string
  providerModelsRequired: string
  noticeProviderSaved: string
  noticeProviderFailed: string
  noticeDiscoveryUnavailable: string
  settingsTheme: string
  settingsThemeMode: string
  settingsThemeModeDynamic: string
  settingsThemeModeSelected: string
  settingsThemeDark: string
  settingsThemeLight: string
  settingsThemeSelectedItem: string
  settingsThemeCustom: string
  settingsThemeCustomNone: string
  settingsThemeCustomEditHint: string
  noticeThemeCustomSet: string
  noticeThemeCustomInvalid: string
  settingsTitleModel: string
  settingsProvider: string
  settingsModel: string
  settingsCustomProvider: string
  settingsCustomModel: string
  settingsEditCustomProvider: string
  settingsEditCustomModel: string
  settingsCustomConfig: string
  settingsSaveDefault: string
  settingsSaveTitle: string
  settingsSave: string
  settingsCancel: string
  customConfigHint: string
  customConfigRequired: string
  customConfigTarget: string
  settingsDefaultPermission: string
  settingsDefaultModel: string
  settingsDefaultEffort: string
  settingsOn: string
  settingsOff: string
  settingsEnabled: string
  settingsShowReasoning: string
  settingsToolOutputLines: string
  settingsDefaultMode: string
  settingsMaxParallelToolCalls: string
  settingsLeftPrompt: string
  settingsRightPrompt: string
  settingsPromptHint: string
  settingsKeyTools: string
  settingsKeyReasoning: string
  noticeKeybindingSet: string
  noticePromptSet: string
  settingsTabAdvanced: string
  settingsTabWechat: string
  settingsWechatProgressEnabled: string
  settingsWechatProgressInterval: string
  settingsWechatNotify: string
  settingsWechatUnavailable: string
  noticeWechatInvalidInterval: string
  noticeDefaultPermissionSet: string
  noticeDefaultModelSet: string
  noticeDefaultEffortSet: string
  noticeDefaultModeSet: string
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
  permissionReadOnly: string
  permissionReadOnlyHint: string
  permissionWorkspaceWrite: string
  permissionWorkspaceWriteHint: string
  permissionFullAccess: string
  permissionFullAccessHint: string
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
    helpMode: '切换工作模式（官方预设与本地安装的预设）',
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

    cmdMode: '切换工作模式（官方预设与本地安装的预设）',
    cmdTheme: '查看或切换主题',
    helpPermission: '切换权限模式（沙箱 + 审批策略）',
    cmdPermission: '切换权限模式（沙箱 + 审批策略）',
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
    noticeResumeFailed: '会话恢复失败：{error}',
    noticeResumeTimeout: '会话恢复超时，已取消本次恢复。',
    noticeModelSet: '模型已设为 {provider}/{model}。',
    noticeThinkSet: '思考等级已切换为 {name}（{id}）。',
    noticeThinkAlready: '当前思考等级已是 {name}（{id}）。',
    noticeThinkUnknown: '当前模型不支持思考等级：{name}',
    noticeThinkUnsupported: '当前模型未提供可切换的思考等级。',
    noticeThinkFailed: '思考等级切换失败：{error}',
    noticeCompacting: '上下文压缩中…',
    noticeCompactionDone: '上下文压缩完成。',
    noticeCompactionFailed: '上下文压缩失败：{error}',
    noticeCompactionCause: '详细原因：{cause}',
    noticeCompactionHint: '压缩失败通常表示可压缩历史太少或摘要未比原文更短。建议继续对话积累更多历史后再试。',
    noticeCompaction400Hint: '压缩请求被模型 API 拒绝（HTTP 400）。请检查 DEEPSEEK_BASE_URL 网关是否兼容 compaction 请求，以及当前模型是否支持该请求体。',
    noticeTurnEnded: '回合结束：{reason}。',
    noticeToolCards: '工具卡：{visibility}。',
    noticeReasoningShown: '思考块已显示。',
    noticeReasoningHidden: '思考块已隐藏。',
    noticeModelFailed: '模型选择失败：{error}',
    noticeUnknownCommand: '未知命令：{name}',
    noticeReferenceFailed: '会话引用失败：{error}',
    noticeModeSet: '已切换到「{mode}」。',
    noticeModeUnknown: '未知模式：{name}',
    noticeModeUnavailable: '当前组合未提供 agent-presets 服务。',
    noticeModeAlready: '当前已是「{mode}」。',
    noticeModeNotBlank: '会话已产生内容，无法切换模式；请在新会话中切换。',
    noticeModeMountFailed: '模式装配失败：{error}',
    noticeModeSwitchFailed: '模式切换失败：{error}',
    noticeEventRenderFailed: '会话事件渲染失败：{error}',
    noticeThemeSet: '已切换主题：{name}。',
    noticeThemeUnknown: '未知主题：{name}',
    noticeThemeModeSet: '主题模式已切换：{mode}。',
    noticeThemeModeUnknown: '未知主题模式：{name}',
    noticeThemeDarkSet: '深色主题已设为 {name}。',
    noticeThemeLightSet: '浅色主题已设为 {name}。',
    noticeSettingsUnavailable: '当前组合未提供持久化设置服务。',
    noticeSettingsSaved: '设置已保存。',
    noticeSettingsFailed: '设置保存失败：{error}',
    noticeTitleModelSet: '标题模型已设为 {provider}/{model}。',
    noticeExitHint: '再次按 Ctrl+C 退出',
    noticeFullAccessWarning: '当前为完全访问模式：文件沙箱已禁用，且不会请求审批。请谨慎操作。',
    dialogTypeAnswer: '输入你的回答并回车',
    askTitle: '提问',
    askInlineOptionHint: '输入数字选择，或直接输入自定义回答后回车',
    askInlineMultiHint: '多个选项用逗号分隔序号，回车提交；也可直接输入自定义回答',
    askInlineTextHint: '输入回答后回车',
    modelProvider: '服务商',
    modelTitle: '模型 · {provider}',
    modelEffort: '推理强度',
    resumeTitle: '恢复会话',
    settingsTitle: '设置',
    settingsHint: '↑/↓ 选择 · ←/→/Tab 切换标签 · Enter/Space 修改 · Esc 关闭',
    settingsSubmenuHint: '↑/↓ 选择 · Enter 确认 · Esc 返回',
    settingsEmpty: '没有可用选项',
    settingsTabGeneral: '常规',
    settingsTabModelsProviders: '模型与供应商',
    settingsTabAppearance: '外观',
    settingsTabModel: '模型',
    settingsTabDefaults: '默认配置',
    settingsAddProvider: '＋ 新增供应商',
    settingsEditProvider: '编辑供应商',
    settingsProviderName: '供应商名称',
    settingsProviderId: '供应商 ID',
    settingsCredentialConfigured: '已配置（留空保持不变）',
    settingsApi: '接口类型',
    settingsApiOpenAiCompletions: 'OAI 兼容（OpenAI Completions）',
    settingsApiOpenAiResponses: 'Response（OpenAI Responses）',
    settingsApiAnthropicMessages: 'Message（Anthropic Messages）',
    settingsBaseURL: 'Base URL',
    settingsApiKey: 'API Key',
    settingsModels: '模型列表',
    settingsManageModels: '管理模型列表',
    settingsAddModel: '新增模型',
    settingsModelListHint: '↑/↓ 选择模型 · Enter 编辑 · Delete/Backspace 删除当前模型 · Enter 执行操作 · Esc 取消；修改只在保存后生效',
    settingsModelListEmpty: '暂无模型。请选择“新增模型”。',
    settingsModelValue: '完整模型 ID',
    settingsModelRequired: '模型 ID 不能为空',
    settingsModelDuplicate: '模型 ID 已存在',
    settingsProviderTemplate: '选择供应商模板',
    settingsBlankProvider: '空白自定义',
    settingsDiscoverModels: '探测上游模型',
    settingsDiscovering: '正在探测模型…',
    settingsDiscoveredCount: '已发现 {count} 个模型',
    settingsDiscoveryUnavailable: '当前部署未提供模型探测服务。',
    settingsConfiguredProviders: '已配置供应商',
    settingsConfiguredModels: '已配置模型',
    settingsProviderModelCount: '{count} 个模型',
    settingsSetDefaultModel: '设为默认模型',
    settingsSetTitleModel: '设为标题模型',
    providerFormHint: '↑/↓/←/→ 移动 · Enter 编辑/执行 · Esc 返回',
    providerConfigRequired: '供应商名称不能为空',
    providerIdRequired: '供应商 ID 不能为空',
    providerIdInvalid: '供应商 ID 必须是小写字母开头的 kebab-case',
    providerApiRequired: '自定义供应商必须选择有效接口类型',
    providerBaseURLRequired: '自定义供应商必须填写 Base URL',
    providerModelsRequired: '自定义供应商至少需要一个模型',
    noticeProviderSaved: '供应商已保存。',
    noticeProviderFailed: '供应商保存失败：{error}',
    noticeDiscoveryUnavailable: '当前部署未提供模型探测服务。',
    settingsTheme: '主题',
    settingsThemeMode: '主题模式',
    settingsThemeModeDynamic: '动态',
    settingsThemeModeSelected: '选定',
    settingsThemeDark: '深色主题',
    settingsThemeLight: '浅色主题',
    settingsThemeSelectedItem: '单一主题',
    settingsThemeCustom: '主题颜色覆盖',
    settingsThemeCustomNone: '未设置',
    settingsThemeCustomEditHint: '输入 RGB 三元组，例如 250,179,135；留空清除覆盖',
    noticeThemeCustomSet: '主题颜色覆盖已更新：{name}',
    noticeThemeCustomInvalid: '颜色格式无效，请输入 0-255 范围内的三个数字，用逗号分隔。',
    settingsTitleModel: '标题模型',
    settingsProvider: '供应商',
    settingsModel: '模型',
    settingsCustomProvider: '✎ 自定义供应商…',
    settingsCustomModel: '✎ 自定义模型…',
    settingsEditCustomProvider: '✎ 编辑当前自定义供应商…',
    settingsEditCustomModel: '✎ 编辑当前自定义模型…',
    settingsCustomConfig: '✎ 自定义模型配置…',
    settingsSaveDefault: '保存为默认模型',
    settingsSaveTitle: '保存为标题模型',
    settingsSave: '保存',
    settingsCancel: '取消',
    customConfigHint: '↑/↓/←/→ 移动 · Enter 编辑/选中/取消选中 · Esc 返回',
    customConfigRequired: '供应商和模型不能为空',
    customConfigTarget: '至少选择一个保存目标',
    settingsDefaultPermission: '默认权限模式',
    settingsDefaultModel: '默认模型',
    settingsDefaultEffort: '默认思考强度',
    settingsOn: '开',
    settingsOff: '关',
    settingsEnabled: '启用',
    settingsShowReasoning: '显示思考过程',
    settingsToolOutputLines: '工具输出行数',
    settingsDefaultMode: '默认模式',
    settingsMaxParallelToolCalls: '最大并行工具调用数',
    settingsLeftPrompt: '左侧状态栏模板',
    settingsRightPrompt: '底部状态栏模板',
    settingsPromptHint: '输入提示词模板；留空恢复默认模板',
    settingsKeyTools: '工具卡切换快捷键',
    settingsKeyReasoning: '思考块开关快捷键',
    noticeKeybindingSet: '快捷键已更新：{name}',
    noticePromptSet: '提示词模板已更新：{name}',
    settingsTabAdvanced: '高级',
    settingsTabWechat: '微信claw',
    settingsWechatProgressEnabled: '进度汇报',
    settingsWechatProgressInterval: '进度汇报间隔（轮）',
    settingsWechatNotify: '终端任务推送微信',
    settingsWechatUnavailable: '微信桥不可用',
    noticeWechatInvalidInterval: '进度汇报间隔必须是正整数。',
    noticeDefaultPermissionSet: '默认权限模式已设为 {permission}。',
    noticeDefaultModelSet: '默认模型已设为 {provider}/{model}。',
    noticeDefaultEffortSet: '默认思考强度已设为 {effort}。',
    noticeDefaultModeSet: '默认模式已设为 {mode}。',
    untitled: '（未命名）',
    modeStandard: '标准',
    modeMinimal: '极简',
    modeCode: 'PTC',
    modeCordis: '创造',
    modeStandardHint: '完整 Agent 与工具链',
    modeMinimalHint: 'bash + 编辑器双工具',
    modeCodeHint: 'PTC Code Mode SDK',
    modeCordisHint: '创建和调试 preset',
    permissionReadOnly: '只读',
    permissionReadOnlyHint: '只允许读取；写入或更高权限操作需要审批',
    permissionWorkspaceWrite: '工作区写入',
    permissionWorkspaceWriteHint: '允许写入工作区与临时目录；范围外操作需要审批',
    permissionFullAccess: '完全访问',
    permissionFullAccessHint: '不受文件沙箱限制，且不会请求审批',
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
    helpMode: 'switch working mode (shipped or locally installed presets)',
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

    cmdMode: 'Switch working mode (shipped or locally installed presets)',
    cmdTheme: 'Show or switch theme',
    cmdSettings: 'Open visual settings',
    helpPermission: 'switch permission mode (sandbox + approval policy)',
    cmdPermission: 'Switch permission mode (sandbox + approval policy)',
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
    noticeResumeFailed: 'Failed to resume session: {error}',
    noticeResumeTimeout: 'Session resume timed out and was cancelled.',
    noticeModelSet: 'Model set to {provider}/{model}.',
    noticeThinkSet: 'Reasoning effort switched to {name} ({id}).',
    noticeThinkAlready: 'Reasoning effort is already {name} ({id}).',
    noticeThinkUnknown: 'The current model does not support reasoning effort: {name}',
    noticeThinkUnsupported: 'The current model does not expose selectable reasoning efforts.',
    noticeThinkFailed: 'Reasoning effort switch failed: {error}',
    noticeCompacting: 'Context being compacted…',
    noticeCompactionDone: 'Compaction finished.',
    noticeCompactionFailed: 'Compaction failed: {error}',
    noticeCompactionCause: 'Detailed reason: {cause}',
    noticeCompactionHint: 'Compaction usually fails when the compactable history is too small or the summary is not shorter. Continue the conversation and retry later.',
    noticeCompaction400Hint: 'The model API rejected the compaction request (HTTP 400). Check whether DEEPSEEK_BASE_URL gateway supports compaction requests and whether the current model accepts the request body.',
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
    noticeEventRenderFailed: 'Session event render failed: {error}',
    noticeThemeSet: 'Theme switched to {name}.',
    noticeThemeUnknown: 'Unknown theme: {name}',
    noticeThemeModeSet: 'Theme mode switched to {mode}.',
    noticeThemeModeUnknown: 'Unknown theme mode: {name}',
    noticeThemeDarkSet: 'Dark theme set to {name}.',
    noticeThemeLightSet: 'Light theme set to {name}.',
    noticeSettingsUnavailable: 'Persistent settings are not available in this deployment.',
    noticeSettingsSaved: 'Settings saved.',
    noticeSettingsFailed: 'Settings save failed: {error}',
    noticeTitleModelSet: 'Title model set to {provider}/{model}.',
    noticeExitHint: 'Press Ctrl+C again to exit',
    noticeFullAccessWarning: 'Full access mode is active: file confinement is disabled and approval prompts are off. Proceed with care.',
    dialogTypeAnswer: 'type your answer and press enter',
    askTitle: 'Question',
    askInlineOptionHint: 'Type a number to select, or type a custom answer and press Enter',
    askInlineMultiHint: 'Enter comma-separated option numbers and press Enter, or type a custom answer',
    askInlineTextHint: 'Type your answer and press Enter',
    modelProvider: 'Provider',
    modelTitle: 'Model · {provider}',
    modelEffort: 'Reasoning effort',
    resumeTitle: 'Resume session',
    settingsTitle: 'Settings',
    settingsHint: '↑/↓ select · ←/→/Tab switch tabs · Enter/Space change · Esc close',
    settingsSubmenuHint: '↑/↓ select · Enter confirm · Esc go back',
    settingsEmpty: 'No options available',
    settingsTabGeneral: 'General',
    settingsTabModelsProviders: 'Models & Providers',
    settingsTabAppearance: 'Appearance',
    settingsTabModel: 'Model',
    settingsTabDefaults: 'Defaults',
    settingsAddProvider: '＋ Add provider',
    settingsEditProvider: 'Edit provider',
    settingsProviderName: 'Provider name',
    settingsProviderId: 'Provider ID',
    settingsCredentialConfigured: 'Configured (leave blank to keep)',
    settingsApi: 'API type',
    settingsApiOpenAiCompletions: 'OAI-compatible (OpenAI Completions)',
    settingsApiOpenAiResponses: 'Response (OpenAI Responses)',
    settingsApiAnthropicMessages: 'Message (Anthropic Messages)',
    settingsBaseURL: 'Base URL',
    settingsApiKey: 'API Key',
    settingsModels: 'Models',
    settingsManageModels: 'Manage model list',
    settingsAddModel: 'Add model',
    settingsModelListHint: '↑/↓ select model · Enter edit · Delete/Backspace delete current model · Enter run action · Esc cancel; changes apply only on Save',
    settingsModelListEmpty: 'No models. Choose “Add model”.',
    settingsModelValue: 'Full model ID',
    settingsModelRequired: 'Model ID is required',
    settingsModelDuplicate: 'Model ID already exists',
    settingsProviderTemplate: 'Choose provider template',
    settingsBlankProvider: 'Blank custom',
    settingsDiscoverModels: 'Discover upstream models',
    settingsDiscovering: 'Discovering models…',
    settingsDiscoveredCount: '{count} models discovered',
    settingsDiscoveryUnavailable: 'Model discovery is not available in this deployment.',
    settingsConfiguredProviders: 'Configured providers',
    settingsConfiguredModels: 'Configured models',
    settingsProviderModelCount: '{count} models',
    settingsSetDefaultModel: 'Set as default model',
    settingsSetTitleModel: 'Set as title model',
    providerFormHint: '↑/↓/←/→ move · Enter edit/run · Esc back',
    providerConfigRequired: 'Provider name is required',
    providerIdRequired: 'Provider ID is required',
    providerIdInvalid: 'Provider ID must be lowercase kebab-case',
    providerApiRequired: 'A custom provider must use a supported API type',
    providerBaseURLRequired: 'A custom provider must specify a Base URL',
    providerModelsRequired: 'A custom provider needs at least one model',
    noticeProviderSaved: 'Provider saved.',
    noticeProviderFailed: 'Provider save failed: {error}',
    noticeDiscoveryUnavailable: 'Model discovery is not available in this deployment.',
    settingsTheme: 'Theme',
    settingsThemeMode: 'Theme mode',
    settingsThemeModeDynamic: 'Dynamic',
    settingsThemeModeSelected: 'Selected',
    settingsThemeDark: 'Dark theme',
    settingsThemeLight: 'Light theme',
    settingsThemeSelectedItem: 'Theme',
    settingsThemeCustom: 'Theme color overrides',
    settingsThemeCustomNone: 'None',
    settingsThemeCustomEditHint: 'Enter an RGB triple, e.g. 250,179,135; leave blank to clear',
    noticeThemeCustomSet: 'Theme color override updated: {name}',
    noticeThemeCustomInvalid: 'Invalid color format. Enter three comma-separated numbers between 0 and 255.',
    settingsTitleModel: 'Title model',
    settingsProvider: 'Provider',
    settingsModel: 'Model',
    settingsCustomProvider: '✎ Custom provider…',
    settingsCustomModel: '✎ Custom model…',
    settingsEditCustomProvider: '✎ Edit current custom provider…',
    settingsEditCustomModel: '✎ Edit current custom model…',
    settingsCustomConfig: '✎ Custom model config…',
    settingsSaveDefault: 'Save as default model',
    settingsSaveTitle: 'Save as title model',
    settingsSave: 'Save',
    settingsCancel: 'Cancel',
    customConfigHint: '↑/↓/←/→ move · Enter edit/toggle · Esc back',
    customConfigRequired: 'Provider and model are required',
    customConfigTarget: 'Choose at least one save target',
    settingsDefaultPermission: 'Default permission mode',
    settingsDefaultModel: 'Default model',
    settingsDefaultEffort: 'Default reasoning effort',
    settingsOn: 'On',
    settingsOff: 'Off',
    settingsEnabled: 'Enabled',
    settingsShowReasoning: 'Show reasoning',
    settingsToolOutputLines: 'Tool output lines',
    settingsDefaultMode: 'Default mode',
    settingsMaxParallelToolCalls: 'Max parallel tool calls',
    settingsLeftPrompt: 'Left status template',
    settingsRightPrompt: 'Bottom status template',
    settingsPromptHint: 'Enter a prompt template; leave blank to restore the default',
    settingsKeyTools: 'Tool card cycle key',
    settingsKeyReasoning: 'Reasoning toggle key',
    noticeKeybindingSet: 'Keybinding updated: {name}',
    noticePromptSet: 'Prompt template updated: {name}',
    settingsTabAdvanced: 'Advanced',
    settingsTabWechat: 'WeChat Claw',
    settingsWechatProgressEnabled: 'Progress reports',
    settingsWechatProgressInterval: 'Progress interval (rounds)',
    settingsWechatNotify: 'Push terminal tasks to WeChat',
    settingsWechatUnavailable: 'WeChat bridge unavailable',
    noticeWechatInvalidInterval: 'Progress interval must be a positive integer.',
    noticeDefaultPermissionSet: 'Default permission mode set to {permission}.',
    noticeDefaultModelSet: 'Default model set to {provider}/{model}.',
    noticeDefaultEffortSet: 'Default reasoning effort set to {effort}.',
    noticeDefaultModeSet: 'Default mode set to {mode}.',
    untitled: '(untitled)',
    modeStandard: 'standard',
    modeMinimal: 'minimal',
    modeCode: 'PTC',
    modeCordis: 'creator',
    modeStandardHint: 'full Agent and toolchain',
    modeMinimalHint: 'bash + editor only',
    modeCodeHint: 'PTC Code Mode SDK',
    modeCordisHint: 'create and debug presets',
    permissionReadOnly: 'read only',
    permissionReadOnlyHint: 'Allow reads; writes or higher-privilege operations require approval',
    permissionWorkspaceWrite: 'workspace write',
    permissionWorkspaceWriteHint: 'Allow writes inside the workspace and temporary directories; wider access requires approval',
    permissionFullAccess: 'full access',
    permissionFullAccessHint: 'Disable file confinement and approval prompts',
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
