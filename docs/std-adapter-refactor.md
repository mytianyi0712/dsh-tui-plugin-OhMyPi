# dsh-omp-tui std 适配器重构：审查与实施计划

> 日期：2026-05-13
> 状态：已开始（阶段 0 修复中）
> 目标：对齐 dsh-TUI 提供的 std 适配器规范（dsh-ecosystem-spec v0.15 + `@dsh-std/*` + `@dsh-std/adapter-dsh`），
> 实现更广泛的 DSH 版本兼容与更简便的插件开发。

---

## 1. 审查结论（一句话）

仓库已完成 std 适配器重构的**骨架**（`src/dsh-adapter/`、`src/dsh-host/`、`src/plugin-spec/`、`src/host/`、`src/extensions/`、`dsh-plugin.json` 均存在，三道 verify 门禁可跑），但当前**基线是断的**：`tsc` 有 5 个错误、测试 98 例中 9 例失败；与 dsh-ecosystem-spec v0.15 / dsh-std 规范相比，插件准入、权限执行、消息校验、effect ledger、Host Descriptor、conformance 验证仍存在关键语义缺口。

---

## 2. 现状审查

### 2.1 已落地部分（保留）

| 模块 | 现状 |
|---|---|
| `src/dsh-adapter/` | 动态链接 `@dsh-std/adapter-dsh` + profile-loader，缺失时优雅降级 |
| `src/dsh-host/index.ts` | 唯一 `@deepseek-ai/*` 宿主投影面，UI/wechat/host/extensions 经它间接接触上游 |
| `src/plugin-spec/` | v0.15 manifest 解析、五态类型、registry、host-descriptor 雏形 |
| `src/host/` | grants（fail-closed 语义基本正确）、effect ledger、plugin storage、message observer、plugin host 已挂入 `cordis.patch.yml` |
| `src/extensions/` | tuiDialogs / tuiStatus / tuiShortcuts / tuiRenderers / tuiSettingsSections / tuiScenes 六个扩展面已提供并 `ctx.provide` |
| 决策事件 | `tui/input`、`tui/session-switch`、`tui/session-switched`、`tui/compact` 已接入 `PluginHost.runDecision` |
| 门禁脚本 | `verify:boundary` / `verify:contract` / `verify:plugin-spec` 存在且能跑 |

### 2.2 P0 —— 基线断裂（build/test 当前为红）

实测：

```text
verify:boundary ok
verify:contract ok
verify:plugin-spec ok (negotiation waiting_authorization)

tsc: 5 errors
tests: 98 例，88 pass / 9 fail
```

根因：

1. `src/session-persistence.ts:243` 调用了不存在的 `CallId(id)`；当前代码与 `package.json` 对齐的是 `0.1.2-alpha.3` 类型线（品牌函数为 `ToolCallId`），而 `node_modules` 里装的是 `0.1.1-rc.2`（品牌函数为 `CallId`）。源码与安装树版本漂移导致 `ToolCallId` 导出在运行时/类型面均不一致。
2. `src/index.ts:434,522` 使用 `frame`/`setPrompt`，这是 `patches/@earendil-works__pi-tui@0.80.7.patch` 注入的 API，但当前 `node_modules` 由 **npm** 安装（存在 `package-lock.json` / `node_modules/.package-lock.json`），pnpm `patchedDependencies` 未生效。
3. `src/dsh-adapter/index.ts:34` 从 `@dsh-std/adapter-dsh` 做 `export type`，但该 optional peer 未安装，`tsc` 报 `TS2307`。
4. `pnpm-workspace.yaml` 的 `allowBuilds.koffi` 是占位符文本而非布尔值，会阻断 pnpm 安装。

### 2.3 P1 —— 规范落地不完整

#### A. 版本兼容目标与 package.json 矛盾

- 文档声称“不再钉 DSH rc”，但 `peerDependencies` 仍把 20 个 `@deepseek-ai/*` 钉在 `^0.1.2-alpha.3` 单线。
- 上游 dsh-TUI 的 peer 为多线范围（`^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2`）。
- `dependencies` 中有 3 个 `@deepseek-ai/*`（`dsh-agent-presets`、`dsh-session-title-llm`、`dsh-settings`），会让消费者在 profile 之外再拉一份 DSH 树。
- `@dsh-std/*` 只依赖 `core`、`manifest`，缺少 `command` / `storage` / `messages` / `presentation` / `workspace` / `connection`；`@dsh-std/adapter-dsh` 无 devDep。

#### B. plugin-spec 是手写实现

- `src/plugin-spec/registry.ts` 协议目录硬编码在 TS；规范要求使用 `@dsh-std/core` 的 `ProtocolCatalog`，公共 definition 来自 `@dsh-std/*` 包，私有 `tui.dsh/*` 来自固定 profile definitions 并做 SHA-256 digest。
- `src/plugin-spec/manifest.ts` 只用 `parseManifest`，未使用 `ManifestDefinitionCatalog.validate` / `projectManifest`。
- **五态协商语义有 bug**：`negotiate()` 从不产出 `compatible_degraded`；optional+fallback 契约被先按缺 grant 判成 `waiting_authorization`。自家 `dsh-plugin.json` 全部是 optional+fallback，`verify-plugin-spec` 却报 `waiting_authorization`，即为错误证据。规范语义：optional 且带 fallback → 缺能力/缺授权判 `compatible_degraded`；required 缺授权才 `waiting_authorization`。

#### C. Host plane 权限与校验缺口

| 服务 | 问题 |
|---|---|
| `src/host/plugin-storage.ts` | **无权限检查**。`open(owner)` 接受任意字符串/`{name}`，未绑定 admission identity；`get/set/delete` 不查 `storage.local.read/write`。规范要求 `open(ctx)` 按已验证 Component 身份派生 namespace，且每次调用现查授权 |
| `src/host/message-observer.ts` | 不校验 manifest 声明的 MessageObserver scope；不逐条过 `@dsh-std/messages` validator；`activationInstance` 硬编码 `'activation'` |
| `src/host/effect-ledger.ts` | 写前只有 allowlist，无规范要求的 `effect-ledger-record.schema.json`（`additionalProperties:false`） |
| `src/host/grants.ts` | 8 个权限硬编码在 `plugin-spec/registry.ts`；规范要求由 vendored `registry/permissions-0.1.json` 驱动 |
| `src/host/plugin-host.ts` | `admit()` 无任何调用方；`@dsh-std/adapter-dsh` 未安装，真实激活链路未验证；`cordis.patch.yml` 中 `dsh-std-adapter` 排在 `plugin-host` 之前，需确认 adapter apply 是否依赖 `ctx.tuiPluginHost` |

#### D. 诊断面缺失

规范要求的 `/plugins`（C-070/C-030）与 `/doctor` 未实现；`PluginHost.selfCheck()` / `activeAdmissions()` 已具备但无 UI 入口。

#### E. 验证面薄弱

- `scripts/verify-plugin-spec.ts` 只校验本包 manifest + 构造 descriptor；无 conformance fixtures、profile hash 漂移检查、Host Descriptor schema 校验。
- 无等价于上游 `verify:patch-surface` 的快照门禁。
- 缺少 storage 授权、message observer scope/validator、ledger schema、grants fail-closed、adapter-dsh 集成测试。

### 2.4 P2 —— 架构债

1. `src/index.ts` 166KB / 3707 行，`Tui` 类本质是单个巨型构造函数，内部局部函数吞掉全部 UI。可按段落注释拆分：`components`(428-499)、`prompt values`(500-643)、`status`(644-692)、`interjection queue`(693-847)、`transcript`(848-1080)、`input`(1081-3127)、`mount`(3128-3704)。
2. `src/dsh-host/index.ts` 是单一 re-export 面，任何成员名漂移都会整体炸掉；建议按域拆分并加编译期契约测试。
3. `src/extensions/services.ts`：`RenderersService` 不拒绝内建事件类型；`DialogsService` 无 caller 生命周期绑定；`ScenesService` 使用 pi-tui 组件而非 React（已记录为已知偏差）。

---

## 3. 分阶段修改计划

### 阶段 0：修复基线，让 build/test 变绿（已完成）

- [x] 修正 `src/session-persistence.ts:243`：`CallId(id)` → `ToolCallId(id)`（与 `0.1.2-alpha.3` 类型线一致）。
- [x] 修复 `pnpm-workspace.yaml` `allowBuilds.koffi` 为 `false`。
- [x] `package.json` 增加 `@dsh-std/adapter-dsh@0.1.1-rc.2` 到 `devDependencies`，解决 `src/dsh-adapter/index.ts` 的 TS2307。
- [x] 统一包管理器为 pnpm：删除 `package-lock.json`，执行 `pnpm install` 生成 `pnpm-lock.yaml`，使 pi-tui patch 与 `0.1.2-alpha.3` 依赖树同时生效。
- [x] `src/dsh-host/index.ts` 适配 alpha.3：`TodoItem` 改从 `@deepseek-ai/dsh-tool-todo` 导入；`settingsNamespace` 改为本地品牌函数；补 `dsh-tool-todo` 声明合并。
- [x] `src/index.ts` 适配 alpha.3：`permissionPresets.current(session)` 三处；`userQuestions` 改为 `user-questions/request` waterfall 事件。
- [x] `tests/session-persistence.spec.ts`：`CallId` → `ToolCallId`。
- [x] `tsdown.config.ts` / `tsdown.prepare.config.ts`：`clean: true`，消除 lib 中残留旧 hashed chunk。
- [x] 验证 `tsc --noEmit` 0 错误、`node --test` 全过（e2e 跳过 1 例）。

验收：`pnpm run check` 全绿。

### 阶段 1：补齐 std 依赖与 conformance 资产

- 引入 dsh-ecosystem-spec 资产（submodule 或固定 revision vendor）：`registry/registry-0.15.json`、`registry/permissions-0.1.json`、`protocols/profile-definitions.js`、`schemas/effect-ledger-record.schema.json`、conformance fixtures。
- `package.json`：
  - `devDependencies` 增加 `@dsh-std/{command,storage,messages,presentation,workspace,connection}`（0.1.1-rc.x）。
  - 将 `dependencies` 中的 `@deepseek-ai/dsh-agent-presets` / `dsh-session-title-llm` / `dsh-settings` 移到 `devDependencies` + optional peer。
  - `peerDependencies` 改为多线兼容范围（参考上游）。
- `src/std-contract.ts` 扩展：校验全部 `@dsh-std/*` 与 adapter-dsh 版本、vendored registry/profile digest。

验收：`verify:contract` 能检出缺失/版本不符的 `@dsh-std/*` 包。

### 阶段 2：重写 plugin-spec 语义

- `registry.ts`：公共 definition 从 `@dsh-std/*` 包导入构建 `ProtocolCatalog`；私有 `tui.dsh/*` 从 vendored profile definitions 加载 + SHA-256 digest。
- `manifest.ts`：使用 `parseManifest` + `projectManifest` + `ManifestDefinitionCatalog.validate`；修正五态协商（optional+fallback → `compatible_degraded`）。
- `host-descriptor.ts`：`$schema` 指向 vendored schema；增加 schema 校验，失败清空 contracts。
- `scripts/verify-plugin-spec.ts`：运行 conformance fixtures 正反例。

验收：本包 `verify:plugin-spec` 输出 `compatible_degraded`；conformance fixtures 全过。

### 阶段 3：补齐 host plane 授权与校验

- `plugin-storage.ts`：`open(pluginCtx)` + admission 绑定 + 每次调用现查 grants + `PERMISSION_NOT_GRANTED`。
- `message-observer.ts`：manifest scope 精确匹配 + `@dsh-std/messages` validator + 真实 activationInstance。
- `effect-ledger.ts`：写前过 `effect-ledger-record.schema.json`（`additionalProperties:false`）。
- `grants.ts` / `registry.ts`：权限注册表由 vendored `permissions-0.1.json` 驱动。
- `plugin-host.ts`：验证并接通 `@dsh-std/adapter-dsh` 调用 `admit()` 的链路；必要时调整 `cordis.patch.yml` 行顺序。

验收：新增单测覆盖 storage 授权拒绝、message scope 拒绝、ledger schema 拒绝夹带、grants fail-closed。

### 阶段 4：诊断面与扩展面收口

- 实现 `/plugins`（trust disclosure、Host Descriptor 摘要、授权矩阵、ledger 尾 5 条、`/plugins check <path>`）与 `/doctor`。
- `RenderersService` 拒绝内建事件类型；`DialogsService` 绑定 caller 生命周期（可后续）。
- rewind 决策事件待 rewind 功能落地后接入（当前缺失已记录）。

验收：`/plugins`、`/doctor` 在真实 TTY 可见；`/plugins check` 输出正确五态。

### 阶段 5：dsh-host 门面收敛与版本兼容闭环

- `dsh-host/` 按域拆分（framework/agent/session/llm/commands/user-questions/settings）。
- 增加运行时 contract 探针，缺失成员给可读 drift 警告。
- `std-contract.ts` 增加 `UPSTREAM_VALIDATED_VERSIONS`：harness 包完整版本校验、框架包 major 校验；CI fail，运行时 warn。
- 增加 `scripts/verify-patch-surface.ts` + `patch-surface.snapshot.json`。
- 更新 README / docs/contracts.md §11 与实现一致。

验收：`pnpm run check` 全绿；`0.1.1-rc.2` 与 `0.1.2-alpha.3` 两套 profile smoke 通过。

### 阶段 6（建议，可排后）：拆分 src/index.ts

按段落注释拆为 `src/screens/`、`src/transcript/`、`src/input/`、`src/status/`、`src/tui-state.ts`。纯结构重构，行为零变化，每拆一个模块跑一次全量测试。

---

## 4. 风险与建议

1. `@dsh-std/adapter-dsh` 是实验性依赖，升级必须与 vendored registry revision 绑定，走 PR + conformance。
2. pi-tui patch 依赖 pnpm；CI 与开发环境必须统一 pnpm，建议 CI 增加“patch 是否生效”断言。
3. `tuiScenes` 的 pi-tui 组件偏差意味着社区 React 场景插件无法直接运行；中期应提供 React 场景兼容层或明确文档化并 fail-closed 拒绝。
4. 严格按阶段合入，每阶段单独 PR，`pnpm run check` 必须全绿。
5. 无头测试无法覆盖 TTY、热重载、grants 即时生效；每阶段后至少做一次 `dsh --profile tui` 实机 smoke，并用 `dsh-working-activity` 作为社区插件端到端样本。

---

## 5. 实施进度记录

### 已完成

- **阶段 0 全部**：基线修复，`pnpm run check` 全绿（144 tests，143 pass，1 skip）。
- **阶段 1 部分**：
  - `package.json` 依赖归一化：`dependencies` 只保留 `@dsh-std/core`、`@dsh-std/manifest`、`commander`、`qrcode-terminal`；
  - 全部直接 `@deepseek-ai/dsh-*` import 改为 optional peer + pinned devDep；peer 范围放宽为 `^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2`；
  - `@dsh-std/adapter-dsh`、`@deepseek-ai/dsh-tool-todo` 进入 devDeps。
  - 待办：dsh-ecosystem-spec 资产 vendoring、其余 `@dsh-std/*` protocol 包、`std-contract` 全量校验。
- **阶段 2 核心**：
  - `negotiate()` 五态语义修正：optional+fallback → `compatible_degraded`，required 缺 grant → `waiting_authorization`；
  - `verify:plugin-spec` 现输出 `compatible_degraded`。
  - 待办：`ProtocolCatalog` / `ManifestDefinitionCatalog.validate` / conformance fixtures。
- **阶段 3 部分**：
  - `plugin-storage.ts` 改为 `open(pluginCtx)`，`get` 现查 `storage.local.read`、`set/delete` 现查 `storage.local.write`，拒绝时抛 `PERMISSION_NOT_GRANTED`。
  - `message-observer.ts` envelope 对齐 `@dsh-std/messages` 0.1.1-rc.1 的 `MessageEvent` 形态，投递前过 `validateMessageEvent`；`@dsh-std/messages` 已进入运行时 `dependencies`。
  - `effect-ledger.ts` 增加本地 `additionalProperties:false` 结构 schema 校验；`hostRuntime` 增加 process-wide activation registry，`admit()` 记录、message-observer 读取。
  - `plugin-spec` 协议目录与权限注册表改为从 vendored JSON（`src/plugin-spec/registry-0.15.json`、`permissions-0.15.json`）加载并打包。
  - 待办：message observer manifest scope 校验、adapter-dsh 调用 `admit()` 的集成验证。
- **阶段 4 部分**：
  - `/plugins` 已支持 `check <path>`、self-check、admissions、grants 规则数、ledger 尾 5 条；`/doctor` 已接入。
  - 待办：完整 8 权限矩阵展示。
- **阶段 5 部分**：
  - `verify:patch-surface` 门禁已落地（`patch-surface.snapshot.json` 快照 + `--snapshot` 重新生成），并挂入 `check`/`build`。
  - `std-contract` 增加 `@dsh-std/messages` 版本校验。
  - `dsh-host` 已按域拆分：`framework.ts` / `agent.ts` / `llm.ts` / `session.ts` / `product.ts` / `declarations.ts`，`index.ts` 仅做 facade re-export，外部 API 不变。
  - 待办：运行时 contract 探针、`UPSTREAM_VALIDATED_VERSIONS` 全量版本线。
- **阶段 6 未开始**：`src/index.ts` 166KB 巨类拆分（已给出目标模块蓝图）。

### 打包与安装验证

- `pnpm run build` 通过，`npm pack` 生成 `dsh-omp-tui-0.3.0.tgz`。
- `npm install -g ./dsh-omp-tui-0.3.0.tgz` 完成（npm 默认拦截 prepare 脚本；lib 已在打包时生成，不影响启动）。
- `omdsh --help` 正常。
- `DSH_DEBUG=1 omdsh` 打印 `omdsh → dsh --profile tui`。
- 移除 profile 旧包后执行 `omdsh`，TUI 成功渲染并进入会话界面（微信桥显示已连接）。
