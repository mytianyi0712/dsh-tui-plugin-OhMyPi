# dsh-omp-tui：自研 TUI bundle（方案 B）实施计划

> 目标：以插件（profile bundle）形式为 DeepSeek Harness（dsh）实现终端界面，
> 样式原生模仿本机 omp（titanium 暗色主题）。不动 harness、不改 turtle-ui。
> 创建：2026-08-14。上游版本基准：dsh 0.1.0-rc.6、turtle-ui b08ed69、
> @earendil-works/pi-tui 0.80.7。

---

## 0. 架构总览

- **定位**：与 turtle-ui 平级的"前门" bundle，骑在 `@deepseek-ai/dsh-base` 之上。
  harness 负责 agent/模型/工具/持久化/沙箱；本 bundle 只拥有终端呈现与输入。
- **渲染**：`@earendil-works/pi-tui@0.80.7`（npm 公开分发，含 win32 原生 prebuild）。
  移植 turtle-ui 的 pnpm patch（编辑器 `frame`/`prompt` 支持，BSD-3 需保留版权声明）。
- **样式**：omp 风格为原生实现——titanium 调色板 + truecolor 检测（照搬 omp
  `detectColorMode`）+ 圆角框 `╭╮╰╯` + 状态行（bg `#16161e`）+ 思考分级色。
  不移植 turtle-ui 的主题机制（其 16 色 ANSI 设计与 omp 目标相反）。
- **仓库布局**：
  - `D:/Projects/dsh` → 本 bundle 仓库（现为 turtle-ui 克隆，Phase 0 迁移）
  - `D:/Projects/deepseek-harness` → 兄弟 checkout（类型解析 + 测试宿主 + 合约来源）
  - `D:/Projects/turtle-ui` → turtle-ui 克隆移至此，仅作参考与 patch 来源

## Phase 0 — 合同测绘（前置，不可跳过）

1. 仓库迁移：`D:/Projects/dsh` 保留 PLAN.md，turtle-ui 克隆移入
   `D:/Projects/turtle-ui`；`D:/Projects/dsh` 初始化本 bundle 仓库。
2. 克隆兄弟 checkout：`git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git D:/Projects/deepseek-harness`，
   `pnpm install && pnpm run build`（turtle-ui README 同款流程；tsc 项目引用 + 测试宿主依赖它）。
3. 精读并输出 `docs/contracts.md` 速查表，逐项记录服务/事件/方法签名与所在源文件：
   - `@deepseek-ai/dsh-session`：SessionEventMap（user/message、assistant/chunk、tool/call、tool/result、
     turn/start、turn/end、step/start、compaction、goal 等）、SessionId、投影模型
   - `@deepseek-ai/dsh-agent`：Agent 接口（session、events、status、submit）、`installModelSelection`
   - `@deepseek-ai/dsh-cmdline`：cmdlineArgs 不可变快照
   - `@deepseek-ai/dsh-user-questions` + `@deepseek-ai/dsh-tool-ask-user`：提问队列与工具
   - `@deepseek-ai/dsh-session-persistence/projection/projection-cache/query`：会话落盘、事件→消息投影、/resume 扫描
   - `@deepseek-ai/dsh-skill`、`dsh-commands`、`dsh-token-meter`、`dsh-goal`、`dsh-compaction`、`dsh-system-prompt`
   - `packages/boot/app-boot`：profile 解析、bundle patch 层序、`healProfilesModuleFallback`
4. **验收**：不看 turtle-ui 源码，仅凭 contracts.md 能写出
   `cmdlineArgs → tuiStartup → ctx.agents.get(sessionId) → agent.session.events → 渲染`
   的完整调用链，无任何猜测成分。

## Phase 1 — 骨架（最小可对话前门）

1. **脚手架**：
   - `package.json`：name `dsh-omp-tui`，`dsh.bundle.patch = ./cordis.patch.yml`，
     peerDependencies 对齐 harness 包（turtle-ui 清单为基线），devDependencies：
     `@earendil-works/pi-tui@0.80.7` + tsdown + vitest + @xterm/headless
   - 移植 pi-tui patch：`patches/@earendil-works__pi-tui@0.80.7.patch` +
     `pnpm-workspace.yaml` `patchedDependencies`；保留上游版权声明
   - `tsdown.prepare.config.ts`（无 typecheck 的消费者构建）+ `tsdown.config.ts`
2. **cordis.patch.yml**（bundle 层，行清单照 turtle-ui 已验证的配方）：
   - 覆盖：`agent-loop`（agents: main，sessionId/resumeSessionId 取自 tuiStartup、
     provider/model/cwd）、`system-prompt`（persona）、`llm-deepseek`、`fs-sandbox`（cwd）、`tools`（mode: native）
   - 插入：session-reference、storage、storage-json、storage-domain、
     session-projection-cache、tmux-context、`tui-prompt`（自研 prompt 注册表）、
     `tui-startup`（自研：注入 cmdlineArgs，解析 `--resume`/`--session`/`--help`，
     提供 tuiStartup 服务）、`tui`（自研主组件行，inject tuiStartup）、tool-ask-user
3. **startup.ts / prompt.ts**：会话选择逻辑 + 模板 token 解析
   （`${cwd}${git/worktree}${model}${token_meter/cache_hit_rate}${context}${queued}${symbol}${indicator}`）
   与注册表（插件可注册自定义值，与 turtle-ui 同能力）。
4. **theme.ts（omp 原生样式）**：
   - titanium 全量角色：accent `#7aa2f7`、border `#4c566a`、success `#9ece6a`、
     warning `#e0af68`、error `#f7768e`、dim `#a9b1d6`、code `#c0caf5`、
     model `#bb9af7`、context `#2ac3de`、spend `#7dcfff`、thinking `#7aa2f7`
   - 背景角色：userMessageBg `#1f2335`、toolPendingBg `#1f2335`、
     toolSuccessBg `#1f2d2a`、toolErrorBg `#2d1f2a`、statusLineBg `#16161e`
   - truecolor 检测（COLORTERM/WT_SESSION/TERM，同 omp）；非 truecolor 回落 16 色 ANSI
   - 圆角框 helper（`╭─╮`/`╰─╯` + 侧边 `│`，整行背景填充）；`/palette` 命令
5. **TUI 核心**：TUI init、Container chat、HintEditor（patch 版：frame/prompt）、
   事件驱动 transcript：
   - user/message → 用户块（User 标签 + userMessageBg 圆角框）
   - assistant/chunk → 流式组件（text/reasoning 块；思考块 = thinking 色左竖线 + 斜体灰字）
   - tool/call + tool/result → 工具卡（圆角框 + per-status 背景 + 状态色边框）
   - turn/start → 状态指示（提示符 `>` 位置的活动字形）
   - 状态行：PromptContext 行整行 statusLineBg，分段色 path/model/spend/context
6. **验收**：`dsh plugin --profile tui add file:.` 后 `dsh --profile tui` 可对话；
   流式渲染、工具卡 omp 样式、Ctrl+C 中断、退出清理正常；headless 快照测试起步。

## Phase 2 — 会话与交互闭环

1. 会话生命周期：`--resume`/`--session`/新会话；投影缓存写入；标题（foldSessionTitle）；
   `/resume` 会话选择器（session-query 扫描、4 并发、最近排序、预览对话框）。
2. 输入体验：历史导航、Ctrl+O 工具卡三态（collapsed/expanded/hidden）、思考块显隐、
   `/help`、`/model`（installModelSelection + 选择对话框，含 effort 切换）、
   `/details`（会话诊断卡：标题/目录/模型/agent/tokens/KV cache/context）、`/palette`。
3. 提问闭环：挂载 tool-ask-user；消费 userQuestions 队列 → 渲染对话框
   （选项多选/单选 + 自定义答案），支持超时与取消。
4. **验收**：断点续会话可用；模型发起的用户提问完整回路可用（沙箱内工具可问人）。

## Phase 3 — 高级集成

1. `@` 会话引用（parseSessionReferenceText + 引用解析 + 引用卡渲染）。
2. 文件自动补全（@文件路径：glob 扫描、排除目录可配、条目/结果上限、防抖限流）。
3. skills：`/skill:<name>` 列表 + 调用渲染（项目/用户 skill 标记）。
4. todo/plan 面板（goal 事件折叠）、compaction 状态行、token 用量（tokenMeter）与缓存命中率。
5. **验收**：长会话 + 子代理场景渲染正确；核心组件快照测试覆盖；日常连续使用无渲染异常。

## Phase 4 — 验证与收尾

1. `pnpm run typecheck`（兄弟 checkout 环境下）+ 全量 vitest + 快照测试。
2. 实机 smoke：`dsh --profile tui` 完整跑一轮真实任务（含工具调用、提问、resume）。
3. 本地网关接线：profile `cordis.patch.yml` 覆盖 `llm-deepseek`：
   `baseURL: http://localhost:3000/v1` + apiKey 策略（网关本地模式不校验时放占位 key）。
4. 性能：宽度 keyed 渲染缓存（turtle-ui 教训：长会话每帧重排会卡）；长会话 1000+ 事件目检。
5. 清理：删临时代码、README（安装/使用/上游 rebase 手册）、LICENSE（BSD-3，注明 pi-tui patch 出处）。

---

## 跨 Phase 工程规范

- **上游同步**：每个 Phase 结束时对 `deepseek-harness` 与 `turtle-ui`（参考）
  各做一次 rebase/fetch，rc 阶段破坏性变更在本 Phase 内吸收，不跨 Phase 累积。
- **借用与自研边界**：借用 turtle-ui 的仅三样——pi-tui pnpm patch（保留 BSD-3 声明）、
  headless 终端测试手法、宽度缓存模式；其余全部自研（这是方案 B 的意义）。
- **一等平台**：Windows Terminal（用户环境）——WT_SESSION truecolor、
  get-east-asian-width 宽字符、IME 硬件光标（patch 版 Editor 支持）。
- **验收标准**：每 Phase 有可运行的独立交付物，禁止半成品堆到下一 Phase。

## 风险与对策

| 风险 | 对策 |
|---|---|
| rc 阶段 harness 接口变动 | Phase 0 contracts.md 为唯一真相源；接口变更先更新速查表再改代码；每 Phase rebase |
| pi-tui 0.80.7 断更/缺陷 | 同 API 家族可替换：omp 自用的 `@oh-my-pi/pi-tui`（必要时连同其 patch 迁移） |
| 工作量（turtle-ui ≈ 77KB index + 51KB dialogs） | 分 4 Phase 独立验收；若中途认为不划算，回落方案 A（fork+theme seam，约 1/5 工作量），contracts.md 直接复用 |
| 持久化格式耦合 | 只经 `dsh-session-projection` 等官方包读写，不直接碰 storage 文件格式 |
| 上游 turtle-ui 突然推出官方主题系统 | 本 bundle 独立存在，不受影响；反之可将其吸收 |

## 命名与安装（默认，可改）

- 包名：`dsh-omp-tui`；profile 名：`tui`
- 安装：`dsh plugin --profile tui add file:.`（checkout 内先 `pnpm run prepare`；
  每次改源码后重新 add 刷新副本）
- 运行：`dsh --profile tui`、`dsh --profile tui --resume <id>`、`dsh --profile tui --session <id>`
