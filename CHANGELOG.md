# Changelog

## [0.4.0] - 2026-10-16

### 适配 dsh 0.2.0-rc.2

- 目标版本从 `0.1.2-alpha.3` 迁移到 `0.2.0-rc.2`；`devDependencies` 精确钉死 `0.2.0-rc.2`（`@dsh-std/adapter-dsh` 钉 `0.1.1-rc.4`，cordis `4.0.5-alpha.2`，schemastery `3.18.5-alpha.2`），`peerDependencies` 放宽为 `>=0.1.2-alpha.2 <0.2.1`。0.1.2-alpha.3 兼容垫片全部移除，只支持 0.2 线。
- 会话读取面：dsh 0.2 移除 `Session.events` getter，新增 `src/dsh-host/session.ts` 的 `sessionEvents(session)` 单一入口（`snapshotEvents()`）。快照在两次 append 之间身份稳定，transcript 的日志增长检查仍然成立。
- 事件面：durable `assistant/chunk` 会话事件被移除，实时文本改由 `agent/assistant-stream` 帧驱动（`src/index.ts` 新增 `offStream` 监听，`src/wechat/dsh/progress.ts` 的 chat 流式回传同步改造，chunk 帧不带 turn，由 start 帧记录 turn）。`tool/result` 的调用 id 从 `ToolResultMessage.toolCallId` 读取，不再从 content 块取。
- 消息来源：dsh 0.2 移除共享的 `kind: 'plugin'` 来源，微信桥改为自己声明的 `wechat-bridge` 来源（`src/dsh-host/declarations.ts` 的 `MessageSourceMap` 合并）。
- 设置面：dsh 0.2 的 `SettingsForms` 没有 `register`/`get`，一个 profile 行的实时 Config 就是它的 settings section。`TuiSettingsSchema` 的字段并入 `TuiConfigSchema`（行 `tui`），标题行 `session-title-llm-tui` 的 Config 即其自身 section；读取统一走 `settings.describe()`，写入走 `settings.update(namespace, …)`。
- 预设名册：`@deepseek-ai/dsh-agent-presets` 在 0.2 线不存在，改用 `@deepseek-ai/dsh-agent-preset-registry`。dsh 0.2 不随发行版提供名册，本 bundle 在 `cordis.patch.yml` 自行声明 `standard`/`minimal`/`code`/`cordis` 四套预设行（含 plan-mode `section`、compaction realm、delegation realm）。`/mode` 的当前预设改读 `agentPreset` 会话投影（registry 注册），creation header 作为回退；`agent-preset/selected` 事件在 registry 的类型合并下可正常写入与恢复。
- 默认模式：设置页读写 registry Config 的 `selectedDefault`（用户选择默认），显示走 `defaultId`（`selectedDefault ?? default`）。
- 系统提示：`dsh-system-prompt` Config 的 `persona` 改名 `personaPrefix`。
- 权限预设：`PERMISSION_SETTINGS_NAMESPACE` 不再导出，改用 `settingsNamespace('permission')`；读写走 `ctx.permissionPresets.current(session)` / `.set(session, preset)`。
- 会话持久化：dsh 0.2 的 JSONL 后端在首次物理 append 与 `SessionHandle.flush` 时物化，且后端把实时会话事件直接路由到自己的 handle。会话写入闸门（`ConversationPersistenceGate`）无法阻止空白会话物化，已删除；`src/session-persistence.ts` 只保留 LLM 流 seam 上的 tool-call id 合成（`ToolCallIdSanitizer`）。空 id 在写入前被合成，避免恢复时校验拒绝整条日志。
- 启动器：`omdsh` 按精确版本安装 `@dsh-std/adapter-dsh@0.1.1-rc.4`（npm `latest` 标签仍是 `0.1.1-rc.2`，peer 范围不覆盖 0.2）。
- `/doctor check` 子命令落地：实时探测当前 profile 的协议包/adapter 版本漂移（此前 CHANGELOG 已声明但从未实现）。

### Breaking Changes

- 不再兼容 dsh `0.1.2-alpha.3`。在 0.1 线上运行本版本会因 `Session.events`、`SettingsForms.register`、`assistant/chunk`、`dsh-agent-presets` 缺失而启动失败。
- 空白会话被放弃时不再保证「零产物」：0.2 的持久化后端在 durability barrier 会写入 header，`~/.dsh/sessions/<project>/<session>/session.v4.jsonl.zstd` 会留下仅含 header 的小文件。
- 旧会话日志里空 tool-call id 的读取侧修复被移除：0.2 的格式恢复在 handle 内部校验，插件无法在读取前修补，这类旧会话无法恢复。写入侧（流 seam 合成 id）保证新会话不再产生该损坏。

### 已知限制

- `@dsh-std/adapter-dsh@0.1.1-rc.4` 的自带行依赖 `sessionController`，dsh `0.2.0-rc.2` 未提供该服务，该行停留在 pending；TUI 正常启动，社区 std 插件不自动加载。
- `dsh-base@0.2.0-rc.2` 的 `session-query-sqlite` 默认 `openAt: never`，`ctx.sessionQuery` 已挂载但全文检索返回 `SESSION_QUERY_SEARCH_DISABLED`；`/resume` 选择器走 exact reads 与 title 读取，不受影响。

## [0.3.2] - 2026-09-08

### 社区 std 标准适配改进

- 依赖版本策略调整：`devDependencies` 中 harness 包改为范围依赖 `^0.1.2-alpha.3` 允许同通道补丁更新，`peerDependencies` 扩展为 `>=0.1.0-rc.6 <0.1.3` 覆盖所有已知兼容版本线。
- std adapter peer 范围更新为 `>=0.1.1-rc.2 <0.2.0`，支持未来 0.1.x 系列所有兼容更新。
- std 协议包（`@dsh-std/command`, `storage`, `messages`, `presentation`）改为范围依赖 `^0.1.1-rc.1` 接受补丁更新。
- 验证版本改为数组支持多版本线：`UPSTREAM_VALIDATED_VERSIONS` 记录所有经过烟雾测试的 harness 版本，`/doctor` 显示完整已验证清单。
- 运行时合约探针：`/doctor check` 子命令实时检测当前 profile 中协议包/adapter 版本漂移，启动时仅警告不阻断。
- 移除硬编码的 `UPSTREAM_VALIDATED_VERSION` 单版本锁定：合约检查改为范围验证，仅在 MAJOR 版本不匹配时发出警告。

### Breaking Changes

无运行时破坏性变更；peer 范围扩展为**放宽约束**。

### 已知限制

- TUI 仍直接依赖 `@deepseek-ai/dsh-*` harness 类型（devDep），未通过 std adapter 抽象接口消费；完全解耦需架构级重构，列入 0.4.0 规划。
- adapter 版本协商协议需 dsh-ecosystem-spec 规范补充，当前为手动声明 `STD_ADAPTER_MINIMUM`。

## [0.3.1] - 2026-09-02

- 思考等级改为读写 dsh `llm-pi-ai` 的 `reasoningEfforts` 模型能力：读取供应商模型配置中保存的档位映射（off/minimal/low/medium/high/xhigh/max → 上游取值），保存时写回字典或 `false`（非推理模型）。不再维护 TUI 自管的 modelEfforts，也不再覆盖 LLM 适配器返回的 reasoning 信息。
- 新增 `src/reasoning-maps.ts`：统一思考等级映射的解析、格式化、预设循环与默认强度选择；识别 DeepSeek/OpenAI/GPT/Claude 预设，并保留 `false` 的往返。
- 供应商模型列表改为回车展开平铺字段：模型 ID、显示名称、思考等级、默认思考强度、上下文窗口、最大输出 tokens 均可在当前页编辑。模型 ID/名称/上下文/输出 tokens 原地输入；思考等级行按 Enter 循环预设（跟随上游 → DeepSeek → OpenAI → GPT → Claude → 非推理），按 `e` 自定义；思考强度行按 Enter 循环选择。
- 自定义思考等级输入支持更宽松的格式：预设名（`deepseek`/`openai`/`gpt`/`claude`）、档位列表（`off, high, max`）、显式映射（`high: ultra, max`）或 `false`，同时兼容旧的 `off: none, high: high, max: max` 写法。
- 保存供应商时把模型能力（`contextWindow`、`maxTokens`、`reasoningEfforts`）写入 dsh 配置；保存失败时把完整错误写入会话，错误提示保留更久。
- 简化 `/settings`：开关和数字项在当前行回车即可切换或循环；分组标题不再占用光标；「模型与供应商」页集中默认模型、默认思考强度、标题模型与供应商编辑，去掉扁平模型清单和额外操作子页。
- 设置与选择类菜单改为全屏覆盖：打开下一级时隐藏上一层，关闭后还原，不再叠出多层边框；选择列表高度随终端视口调整。
- 供应商表单中接口类型按 Enter 循环官方值 `openai-completions` / `openai-responses` / `anthropic-messages`；探测上游模型直接合并进草稿，不再自动打开另一层编辑器。
- 新增 `omdsh check`：比较全局 `dsh-omp-tui` 与 tui profile 的实际内容（不只看版本号），存在差异时用全局包覆盖 profile。普通启动仍只在版本不一致或安装不健康时自动同步，同版本内容变化不覆盖。
- 修复 `omdsh check` / 同步把开发构建打进 tui profile 导致缺少 `session-title` / `session-persistence` 而无法启动的问题：打包前改为走发布构建，并在 tsdown 入口中显式包含这两个模块。
- 默认模型选择会结合适配器声明的 reasoning 能力（默认强度与可用档位）自动确定思考强度；设置页的默认思考强度按 Enter 循环。

## [0.3.0] - 2026-09-01

### 社区 std 适配器（dsh-ecosystem-spec v0.15）

- 插件准入改为官方 Community v0.15 体系：`dsh-plugin.json` 由 `@dsh-std/manifest` 解析，`src/plugin-spec/` 提供五态协商（`compatible / compatible_degraded / waiting_authorization / rejected / unknown`，优先级 `unknown > rejected > waiting_authorization > compatible_degraded > compatible`）。
- `src/plugin-spec/registry.ts` 改为从 vendored 上游资产加载：`registry-0.15.json`、`permissions-0.1.json`、`extensions-0.15.json`（`SettingsSection` / `Scene` 私有扩展）全部打包进 lib。
- 新增 `src/plugin-spec/catalog.ts`：用 `@dsh-std/core` 的 `ProtocolCatalog` 注册 `command` / `storage` / `messages` / `presentation` 公共协议与 `tui.dsh/*` 私有定义；`parseManifest` 接入 `projectManifest` + `ManifestDefinitionCatalog.validate`。
- `verify:plugin-spec` 增加 dsh-ecosystem-spec conformance fixtures 正反例（8 个 fixture）并构建 Host Descriptor。
- 上游版本兼容由 `@dsh-std/adapter-dsh` 吸收，同时新增 harness 包完整版本校验与运行时漂移 boot notice（`src/std-contract.ts`）。
- `dsh-host` 按域拆分：`framework` / `agent` / `llm` / `session` / `product` / `declarations`，`index.ts` 仅做 facade re-export。
- 依赖归一化：`@deepseek-ai/dsh-*` 全部改为 optional peer + pinned devDep；`@dsh-std/{command,storage,messages,presentation}` 进入运行时依赖；`dependencies` 只保留 dsh-std 协议包、commander、qrcode-terminal。

### 宿主平面（src/host）

- `tuiPluginStorage` 改为 `open(pluginCtx)` 派生 namespace，`get` 每次现查 `storage.local.read`、`set/delete` 每次现查 `storage.local.write`，拒绝时抛 `PERMISSION_NOT_GRANTED`。
- `tuiMessageObserver` envelope 对齐 `@dsh-std/messages` 0.1.1-rc.1 的 `MessageEvent`，投递前过 `validateMessageEvent`；订阅时校验 manifest 中 `MessageObserver` 声明的 scope 精确匹配；activationInstance 从 admission registry 读取。
- `tuiEffectLedger` 写入前过 `effect-ledger-record.schema.json`（`additionalProperties:false`），结构性禁止夹带 payload。
- `tuiPluginHost.admit()` 成功后记录 activation 与 manifest 到 process-wide registry，供 storage / message observer / 诊断面查询。

### 诊断与门禁

- 新增 `/plugins`：trust disclosure、Host Descriptor 摘要、self-check、admissions、grants 规则数、ledger 尾 5 条，以及 `/plugins check <path>`。
- 新增 `/doctor`：self-check、advertised contracts、generation。
- 新增 `verify:patch-surface` 门禁 + `patch-surface.snapshot.json`（7 overrides / 15 inserts），并挂入 `pnpm run check` / `pnpm run build`。
- `verify:boundary` 保持双边界：`@deepseek-ai/*` 仅 `src/dsh-host/`，`@dsh-std/adapter-dsh` 仅 `src/dsh-adapter/`。

### 底部信息栏重排

- 第一行（目录/状态行）左侧显示工作目录与 git 分支，右侧固定显示「当前编辑模式 · 权限预设」；空间不足时优先折叠模式，权限始终可见。
- 第二行（底部信息栏）改为左右分区：左侧对齐显示模型与思考强度（队列指示跟随左侧），右侧对齐显示上下文用量与缓存命中率；折叠顺序为队列 → 模型 → 思考强度 → 上下文前缀 → 缓存命中。
- 新增缓存命中统计：累计 `cacheReadTokens`，按 `cacheRead / (cacheRead + inputTokens)` 显示命中率，仅在存在请求活动后出现。
- 微信状态行增加图标前缀并弱化为灰色（dim），与主对话文本区分；错误/警告通知仍保持彩色。

### 打包与启动

- 统一使用 pnpm 安装（`package-lock.json` 移除，`pnpm-lock.yaml` 生成），pi-tui patch 随 `patchedDependencies` 生效；`tsdown` 开启 `clean: true`，消除 lib 残留旧 chunk。
- `omdsh` 正常启动不自动升级、不迁移凭据/会话、不安装 std adapter，也不打印启动日志；首次尚无 tui profile 时仍静默安装当前启动器包。
- 新增 `omdsh update`：从 GitHub Release 安装最新 tarball，并在此时做新版本适配（凭据扁平化、旧会话编码、社区 std adapter）。
- 已知问题：`@dsh-std/adapter-dsh@0.1.1-rc.2` 作为 dsh bundle 安装时，其自带 `dsh-std-adapter` 行依赖 `sessionController`，当前 dsh `0.1.2-alpha.3` profile 无此服务会阻断启动；重复 id 冲突已修复，完整激活需等 adapter 更新或改为非 bundle 依赖安装。

## [0.2.6] - 2026-08-26

- 新增微信远程模式切换命令：`@dsh chat` 使后续普通微信消息实时分段回传且不汇报进度；`@dsh work` 使后续消息完成后回传结果，并保留周期性进度汇报。
- 启动/重开会话时历史记录先置顶显示，首个实时 transcript 事件到达后再自动跟随最新，避免打开即跳底。
- 临时通知改为固定占位行：通知只在行内刷新，不再通过增删行改变 chrome 高度，避免启动和通知出现/消失时界面上下抽动。
- 微信桥普通运行日志不再进入 TUI 通知或 transcript；固定占位行改为持久显示“微信连接状态 + 接收锁归属”，只有 error/失败类日志才走临时通知。
- 修复 `llm/stream` 消毒层对 tool-call 身份的破坏：不再把缺失 `name` 的 delta 续片替换成 `unknown`，并在续片/`block-end` 缺失 `id`/`name` 时沿用同块首次出现的非空值，避免合法工具调用被误判为 unknown tool（`unknown tool ""`）。

## [0.2.5] - 2026-08-24

- 适配新版 dsh 的 credentials-local：`omdsh` 启动前自动将旧版 `~/.dsh/.credentials.yaml`（`version: 1` + `refs:`）迁移为新版扁平凭据文档
- 适配新版 dsh 的 agent-loop 启动契约：`agent-loop` 行注入 `sessionPersistence`，避免声明式 agent 因缺少该依赖而无法激活，修复 TUI 一直报 `session ... never became live (timed out)`
- 适配新版 dsh session-persistence-jsonl 的 zstd 编码检查：`omdsh` 启动前自动把同目录混存的 `session.jsonl` 旧 plain 日志重命名为 `session.jsonl.omdsh-legacy-<ts>`，保留 zstd 版本，避免 `encoding mismatch` 阻断启动
- 同步修复全局 npm 安装目录下实际生效的 `cordis.patch.yml` 与 `scripts/omdsh.js`
- 微信远程 `@dsh` 命令不再注册为本地 `/dsh-*` 命令：这些命令仅由微信消息直接分发，不会出现在本地 `/help`、命令补全菜单中，也无法在本地 TUI 中调用

## [0.2.4] - 2026-08-21

- 修复 TUI 手动 `/compact` 等命令执行器抛错时未捕获导致 TUI 崩溃：改为显示命令失败通知，并保留压缩失败原因与提示
- 修复 rc8 `commands.execute` 方法被解包调用后丢失 `this`，导致手动 `/compact` 报 `Cannot read properties of undefined (reading 'view')`：TUI 与微信命令路径改为绑定 `ctx.commands` 调用
- 修复微信远程 `@dsh model`/`@dsh think` 只写入默认模型、未更新 TUI 前台 `selectionRef`，导致 TUI 状态栏仍显示旧模型且实际请求仍走旧模型：微信命令现在优先通过 TUI 前台控制保存模型选择
- 修复 `@dsh models` 只探测当前 provider：改为遍历全部已注册/可配置 provider 并合并模型列表，数字回复可直接跨 provider 切换
- 新增 TUI 插话机制：生成中回车把消息加入插话队列（`agent.steer`），在下一步/工具调用结束后送达模型；`Alt+Up` 可编辑未生效插话并自动取消其排队状态
- 修复 Ctrl+C 只清屏无法退出：恢复双击 Ctrl+C 退出，单次仍用于中断/清屏
- 迁移 Oh My Pi 原版快捷键：Esc 中断、Ctrl+C 清屏/中断（双击退出）、Ctrl+D 空编辑器退出、Ctrl+T 思考块、Ctrl+O 工具输出展开、Ctrl+Shift+O 工具活动显隐、Alt+L 重置显示、Ctrl+P/Shift+Ctrl+P 循环模型、Alt+M 模型选择、Ctrl+Q/Ctrl+Enter follow-up；选择器补齐 PageUp/PageDown/Home/End

## [0.2.3] - 2026-08-20

- 升级 dsh 宿主依赖与开发依赖到 `0.1.0-rc.8`：适配 `commands.execute(agent, line, images, signal)` 新签名，TUI 与微信命令路径统一传入空图片批次
- 移除失效的 `@deepseek-ai/dsh-llm` pnpm patch（原 patch 只改 `lib/types/assembler.js`，实际主入口 `lib/index.js` 未被修复）；改为 TUI 侧 `llm/stream` 流式消毒器，在 `tool-call-delta` / `block-end` 进入 BlockAssembler 前把空 `id`/`name` 替换为 `call-<index>` / `unknown`
- 在会话持久化读写边界修复历史异常工具调用：包装 JSONL backend 的 `appendBatch` 与 `loadStored`，对 `tool/call`、`tool/result`、`assistant/message` 中的空 `callId`/`name`/`arguments` 做规范化，使存在空工具 id 的存量会话可被恢复
- 工具卡空名称显示回退为 `Unknown`，不再出现空白标题
- 新增回归测试：空工具 id 的损坏会话可 `Session.fromRestore` 恢复；空工具名工具卡回退渲染

## [0.2.2] - 2026-08-20

- 修复上下文压缩进度提示仅 5s 瞬时消失：`compaction/start` 置 `isCompacting` 并经 `indicator` 持久显示 `上下文压缩中…`，`compaction/end` 清除，与 `running` 旋钮互斥，且在 `rebuildTranscript` 时按事件重建
- 修复压缩后插入的上下文卡片无法展开：`ContextCardComponent` 增加 `collapsed/expanded` 状态并接入 `Ctrl+O` 全局显隐循环，`maxOutputLines` 截断时持久提示 `… +N lines (Ctrl+O to expand)`
- 修复压缩后上下文用量仍显示旧长度：`compaction/end` 强制 `contextUsageCache.measuredAt=0` 触发 `tokenMeter.measure` 立即重算，`rebuildTranscript` 重建时同步 `isCompacting` 状态
- 修复超长会话恢复失败：`BlockAssembler` 空 `tool-call` 覆盖导致 `tool/result callId:""` 持久化后 `Session.fromRestore` 拒识，补丁忽略空 `id/name` 并回退 `block-end`，`repair-sessions.py` 按 `(turn,step)` 回填并重建多帧 `zstd`（`tui-695e` 86 帧、`tui-edaa` 截断至 233797 事件），`79` 会话校验 0 fail
- 修复非官方接入点 `/compact` 400：`pi-ai openai-completions isDeepSeek` 扩展至 `deepseek-official` 与 `model.id`，`dsh-compaction-basic summarizeWithLlm` 增加 `configured/latest/agentTarget` 回退，`cordis.patch.yml` 保留 `deepseek-official/deepseek-v4-flash` 并提升 `AGENT_READY_TIMEOUT 10s→30s`
- 将 `AGENT_READY_TIMEOUT_MS` 提升至 `30s` 并重建多帧存储以避免 `persistence.list()` 首帧 8k 未命中导致的启动超时

## [0.2.1] - 2026-08-18
- Port all 98 concrete OMP themes from the local OMP installation into `src/theme-data.ts`; `/theme` and settings now list every dark, light, and neutral OMP theme with no preset family groups.
- Rework theme selection into `dynamic` (dark/light slots chosen independently, follows the terminal scheme) and `selected` (one fixed theme); the dark slot may hold a light theme and vice versa.
- Truecolor light schemes now use the light-slot OMP theme instead of falling back to ANSI colors.
- `omdsh` now automatically updates the tui profile when the installed plugin version is older than the launcher version.
- Cache rendered transcript rows per component and throttle token-meter/permission reads to once per second, fixing the progressive slowdown as session history grows.
- Tool cards now keep the title as the bare tool name and show the actual command or query in an `Input` section above `Output` for `pwsh`, `bash`, `read`, `write`, `edit`, `grep`, `glob`, `web_search`, `web_fetch`, and `run_code`; long commands wrap instead of truncating.
- `str_replace_editor` renders `old_str`/`new_str` as a diff section (red removals, green additions) instead of hiding the edit content.
- Wrap session-event rendering in try/catch error notices so one malformed event cannot crash the TUI.
- Add Linux CI E2E smoke test (`dsh --profile tui` boots, renders `/help`) and WeChat command/config unit tests.
- Add settings UI for per-role RGB theme overrides, status prompt templates, and tool/reasoning keybindings; add a subagent descriptor panel.

## [0.2.0] - 2026-08-18

- Fix WeChat inbound routing to always follow the foreground TUI session; only send the "task in progress" receipt after the message is successfully queued.
- `@dsh new` now creates a session through the TUI and brings it to the foreground instead of switching the WeChat bridge to a background session.
- Replace the `dsh` wrapper with an `omdsh` launcher that uses the system `dsh` from PATH and bootstraps the tui profile on first run.
- 将 dsh 宿主 peer 依赖标记为 optional，避免 npm 11 全局安装启动器时因 peer 图触发 Arborist 的 `null.children` 崩溃。

## [0.1.3] - 2026-08-17

- Fix WeChat inbound routing after TUI session switches: `/resume` and `/new` now update the WeChat bridge's active-agent pointer, so ordinary WeChat messages are steered into the currently visible TUI session instead of an old background session.
- Fix `/model` and the settings default/title model pickers to include models configured on user-added providers in the provider settings screen, instead of only querying the live LLM registry.
- The settings screen now writes custom provider profiles through the official `llm-pi-ai` settings namespace and lets the dsh adapter own registration and runtime requests; it does not implement a second LLM adapter.
- Decouple WeChat start/result notifications from the progress-reporting switch: turning progress reporting off now disables only periodic progress reports, while the "task in progress" start receipt and final result/error push remain enabled.
- Improve provider model management: long Base URLs and model IDs show complete wrapped details, model lists support add/edit/delete with transactional Save/Cancel, and Delete/Backspace removes the highlighted model instead of implicitly deleting the last entry.
- Fix the model catalog dialog on narrow terminals: help text, model IDs, selected values, errors, and footer hints now wrap within the frame instead of being clipped.

## [0.1.2] - 2026-08-16

- Migrate the OMP WeChat (iLink) bridge into dsh as a first-class bundle service: `/wechat-*` commands, `@dsh` remote commands, `wechat_send`/`wechat_status` tools, automatic progress/result push, and WeChat-aware ask bridging.
- Optimize overlay dialogs: center them by default, enlarge ask/user-question dialogs to 90% width/height, and enlarge general dialogs to 80% width/85% height so content is less likely to be folded.
- Add a default config section in `/settings` for startup permission mode, model, and reasoning effort; `/new` now continues the current session's permission instead of the global default.
- Rework `/settings` around OMP's full-screen framed layout: tabbed label/value rows, preserved cursors, current-value preselection, nested Escape-to-back navigation, and stale async-view guards.
- Expand `/settings` with more configurable items: show reasoning, tool output lines, default mode, max parallel tool calls, custom provider/model entries (with editing of saved custom IDs), and move default model/effort onto the Model tab with visible Provider/Model rows.
- Add a single-page custom model form: provider, model, and reasoning effort are shown together with save-target checkboxes and Save/Cancel actions, so no more one-field-per-screen wizard.
- Reorganize `/settings` into General / Models & Providers / Advanced tabs; provider editing/creation now uses the official dsh-llm-pi-ai protocol values `openai-completions`, `openai-responses`, and `anthropic-messages`, with Base URL, API key, model discovery, manual model entry, and preset templates persisted through dsh settings.
- Fix default mode persistence: `/settings` 中保存的 `agent-presets.default` 现在会在新会话启动时生效，不再固定回退到 `standard`。
- Expose each skill as a `skill:<name>` quick command in the composer, so typing `/` lists them and fuzzy search can find them by partial names (e.g. `commit` → `skill:git-commit`); completion keeps the no-space syntax.
- Sanitize ANSI/C1 escape sequences and tabs from session, tool, and todo text before differential rendering to prevent colored blocks, cursor movement, and frame corruption.
- Add a `微信claw` tab in `/settings` for WeChat progress reporting, progress interval, and terminal-task push configuration.
- Fix WeChat send tool return shape so empty messages and omitted `to` fields are represented cleanly.

## [0.1.1] - 2026-08-15

- Add `/new` for in-process fresh-session creation.
- Keep abandoned sessions unmaterialized until they contain conversation data.
- Submit exact slash-command arguments, including `/mode minimal`, with one Enter press.
- Add `/think [level]` with model-specific effort completion, cycling, and persistence.
- Wrap the mode, path, and Git prompt in one OMP-style dark Powerline surface.
- Discover and switch any locally installed agent preset via `/mode`.
- Advertise the configured `/permission` modes in help, inline hints, and argument completion, with localized built-in descriptions.
- Make narrow sidebars use coherent compact status segments and keep permission state visible after context usage.
- Sanitize carriage returns from shell output so multiline tool cards keep their borders intact.
- Present the unrestricted permission preset as `full-access`, show a startup reminder when it is active, and highlight it with the theme's emphasis color.
- Harden session resume: avoid quadratic transcript rebuilds, make Git branch reads non-blocking, cap resume/title loading with timeouts, and surface resume failures.
- Keep the hardware cursor visible in the editor so IMEs that preview pinyin/composition text place it inline at the cursor instead of at the line end.
- Cap the compact mode segment to 4 CJK / 8 ASCII columns with an ellipsis so long preset ids like `anchored-standard` stay compact.
- Rework the footer compression order: compress the model with a middle ellipsis first, then drop the `ctx` prefix, and only then remove lower-priority segments.

## [0.1.0] - 2026-08-14

- Initial public dsh profile bundle.
- OMP-styled Catppuccin terminal layout with responsive welcome panel.
- Chronological user, injected-context, assistant, reasoning, and tool rendering.
