# Changelog

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
- GitHub Release tarball workflow for reproducible profile installation.
