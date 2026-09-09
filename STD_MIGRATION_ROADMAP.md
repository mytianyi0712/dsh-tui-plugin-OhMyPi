# dsh-omp-tui 社区 std 标准全面迁移路线图

> 基于 dsh-std 仓库深度分析（6673 行提案文档，18 个协议包）  
> 生成日期：2026-09-08  
> 目标版本：0.3.2 (短期) → 0.4.0 (中期) → 1.0.0 (长期)

---

## 执行摘要

### 当前状态评估

**项目定位混淆**：dsh-omp-tui 在"一等公民 DSH bundle"与"标准插件"之间摇摆：
- ✅ **已实现**：Community v0.15 manifest 解析、admission 五态协商、`@dsh-std/command`/`storage`/`messages`/`presentation` 协议消费
- ⚠️ **部分实现**：依赖 `@dsh-std/adapter-dsh` 但未完全通过 adapter 抽象层消费 DSH
- ❌ **未实现**：16 个 std 协议中仅使用 4 个，缺少 connection/lifecycle/composition/session/model/tool/workspace/ui 等核心协议

**关键发现**：
1. **adapter-dsh 0.1.1-rc.2 依赖范围**：`@deepseek-ai/dsh-*: ">=0.1.2-alpha.2 <0.1.3"`，TUI 的 `0.1.2-alpha.3` devDep 在范围内
2. **adapter 提供完整映射**：SessionCatalog、SessionHistory、CommandRuntime、ModelCatalog、Tool 注册、Presentation、browser UI 贡献 —— TUI 可直接消费
3. **std 哲学与 TUI 实现冲突**：std 强调"可选协议、按需实现"，TUI 目前"直接依赖全部 DSH 类型"

---

## 可用 std 协议清单

基于 dsh-std v0.1.1-rc.1/rc.2 (2026-09-08)

### 第一层：元协议与组件系统

| 包 | 版本 | 状态 | TUI 当前使用 | 建议使用 |
|---|---|---|---|---|
| `@dsh-std/core` | 0.1.1-rc.1 | ✅ 方向确认 | ✅ 协议目录 | ✅ 保持 |
| `@dsh-std/manifest` | 0.1.1-rc.2 | ✅ 方向确认 | ✅ manifest 解析 | ✅ 保持 |
| `@dsh-std/composition` | 0.1.1-rc.1 | ⚠️ 探索性 | ❌ 未使用 | ⏸️ 0.4.0+ 可选 |
| `@dsh-std/lifecycle` | 0.1.1-rc.2 | ⚠️ 探索性 | ❌ 未使用 | ⏸️ 0.4.0+ 可选 |
| `@dsh-std/sdk` | 0.1.1-rc.2 | ⚠️ 探索性 | ❌ 未使用 | ⏸️ 若开发 facet 时使用 |

### 第二层：领域协议（已实现）

| 包 | 版本 | TUI 使用方式 | adapter-dsh 映射 | 评分 |
|---|---|---|---|---|
| `@dsh-std/command` | 0.1.1-rc.1 | ✅ 协议注册 | ✅ CommandRuntime | A+ |
| `@dsh-std/storage` | 0.1.1-rc.1 | ✅ 插件存储 | ✅ 权限检查 | A |
| `@dsh-std/messages` | 0.1.1-rc.1 | ✅ 观察者 | ✅ MessageEvent 投递 | A |
| `@dsh-std/presentation` | 0.1.1-rc.1 | ✅ 协议注册 | ✅ 用户问答 | B+ |

### 第三层：领域协议（可用但未使用）

| 包 | 版本 | 提供能力 | adapter-dsh 支持 | TUI 迁移优先级 |
|---|---|---|---|---|
| **`@dsh-std/session`** | 0.1.1-rc.2 | SessionCatalog list/get/create/rename<br/>SessionHistory read/follow<br/>SessionEvent 声明 | ✅ **完整实现** | 🔴 **P0 - 核心** |
| **`@dsh-std/connection`** | 0.1.1-rc.2 | Endpoint 协商<br/>跨端点能力调用<br/>Attachment 传输 | ✅ 内存传输 | 🟠 **P1 - 远程化前提** |
| **`@dsh-std/model`** | 0.1.1-rc.1 | ModelProvider 目录<br/>ModelCatalog 能力 | ✅ 完整实现 | 🟡 **P2 - 解耦 LLM** |
| **`@dsh-std/tool`** | 0.1.1-rc.1 | Tool 资源声明<br/>ToolHandler 注册 | ✅ 本地执行 | 🟡 **P2 - 工具发现** |
| **`@dsh-std/workspace`** | 0.1.1-rc.1 | Workspace 目录<br/>Session 成员关系 | ⚠️ 部分 | 🟢 **P3 - 可选增强** |
| `@dsh-std/ui` | 0.1.1-rc.1 | UI surface 协商 | ✅ 贡献模型 | 🟢 **P3 - 插件 UI** |
| `@dsh-std/ui-browser` | 0.1.1-rc.1 | SettingsSection<br/>ToolCallView | ✅ browser 侧 | 🟢 **P3 - Web UI** |

### 第四层：未成熟协议（暂不建议）

| 包 | 版本 | 状态 | 建议 |
|---|---|---|---|
| `@dsh-std/agent` | 0.1.1-rc.1 | 草案 | 观望，0.5.0+ |
| `@dsh-std/content` | 0.1.1-rc.1 | 草案 | 观望 |
| `connection/wire` | 0.1.1-rc.2 | 草案 | 不迁移（底层传输） |

---

## 核心问题分析

### 问题 1: Session 管理的双重标准

**当前**：
- TUI 直接 import `@deepseek-ai/dsh-session`，使用 `Session`/`SessionStore`/`SessionEvent` 类型
- 166KB `src/index.ts` 遍布 `session.events`、`session.deriveMessages()`、`ctx.sessions.list()` 调用
- 会话恢复、创建、fork 全部绕过 std 协议

**adapter-dsh 0.1.1-rc.2 提供**：
```typescript
// SessionCatalog capability (跨端点能力)
interface SessionCatalog {
  list(request: ListSessionsRequest): Promise<SessionPage>
  get(sessionId: string): Promise<SessionDescriptor | undefined>
  create(request: CreateSessionRequest): Promise<SessionDescriptor>
  rename(sessionId: string, title: string): Promise<void>
}

// SessionHistory capability (独立授权)
interface SessionHistory {
  read(request: ReadHistoryRequest): Promise<HistoryChunk>
  follow(request: FollowHistoryRequest): AsyncIterable<HistoryEvent>
}

// SessionEvent 资源声明（组件拥有）
interface SessionEventDeclaration {
  type: string
  replay: 'none' | 'ignorable' | 'required'
}
```

**差距**：
- TUI 未通过 SessionCatalog 管理会话元数据
- TUI 未通过 SessionHistory 读取事件流
- TUI 自己的 transcript 渲染直接消费 `SessionEvent[]`，未声明为 std 资源

**影响**：
- ❌ 无法远程访问 TUI 会话（Web 客户端、SSH 远程）
- ❌ 第三方插件无法声明自己的 SessionEvent 类型
- ❌ 权限粒度无法细化（目录访问 vs 历史读取）

### 问题 2: 类型依赖的深度耦合

**统计**：
```bash
$ grep -r "from '@deepseek-ai/" src/ | wc -l
167
```

**最严重的文件**：
- `src/index.ts`: 58 个 dsh-* 类型引用
- `src/dsh-host/session.ts`: 23 个
- `src/dsh-host/agent.ts`: 19 个

**问题根源**：
- TUI 作为"profile bundle"直接依赖 DSH 内部类型（`Session`, `Agent`, `Message`, `ContentBlock`...）
- `@dsh-std/adapter-dsh` 本意是"适配器负责类型映射"，但 TUI 绕过了这层抽象
- 每次 DSH 内部重构（如 0.1.1-rc.2 → 0.1.2-alpha.2 的 API Gateway 拆分）都需要 TUI 跟进

**std 哲学对比**：
- ✅ **正确姿势**：插件只依赖 `@dsh-std/*` 协议包，通过 `connection.invoke()` 调用能力
- ❌ **TUI 现状**：直接依赖 DSH 实现细节，adapter 形同虚设

### 问题 3: 版本协商的缺失

**adapter-dsh 提供的能力**（未被使用）：
- `ProtocolCatalog.negotiate()`: 双端声明 → 协商结果 → 绑定 ID
- `ConnectionPlan`: 版本选择、feature negotiation、capability 绑定
- `DshRuntimeDescriptor`: adapter 导出的运行时能力快照

**TUI 现状**：
- 硬编码 `UPSTREAM_VALIDATED_VERSION = '0.1.2-alpha.3'`
- 手动桥接 rc.2 / alpha.3 API 差异（`src/dsh-host/product.ts`）
- 无法声明"我需要 SessionHistory v1alpha1"并自动适配

---

## 迁移路线图

### 阶段 0: 版本声明规范化（0.3.2）

**工作量**: 6-8 小时  
**前置条件**: 无  
**交付物**: STD_ADAPTATION_TODO.md 中阶段 1-3

#### 目标
- 解除 devDep 精确锁定
- 扩展 peerDep 范围支持未来版本
- 实现多验证版本支持
- 运行时合约探针

#### 不做的事
- ❌ 不改变类型依赖方式
- ❌ 不引入新 std 协议
- ❌ 不重构 `src/index.ts`

**详见**: `STD_ADAPTATION_TODO.md`

---

### 阶段 1: Session 协议迁移（0.3.3 或 0.4.0-alpha.1）

**工作量**: 20-30 小时  
**前置条件**: 阶段 0 完成，adapter-dsh 0.1.1-rc.2+ 可用  
**优先级**: 🔴 **P0 - 核心架构**

#### 1.1 引入 std session 协议包

**新增依赖**:
```json
{
  "dependencies": {
    "@dsh-std/session": "^0.1.1-rc.2"
  }
}
```

**修改文件**:
- `src/std-contract.ts`: 添加 `@dsh-std/session` 到 `STD_PROTOCOL_PACKAGES`

#### 1.2 创建 Session 抽象层

**新建文件**: `src/std-sessions/index.ts`

```typescript
/**
 * std session 协议抽象层。
 * TUI 渲染层只依赖此模块，不直接 import @deepseek-ai/dsh-session。
 */
import type { SessionCatalog, SessionHistory, SessionDescriptor } from '@dsh-std/session'
import type { Session as DshSession } from '@deepseek-ai/dsh-session'

// TUI 内部会话句柄（混合 DSH 原生 + std 投影）
export interface TuiSession {
  readonly id: string
  readonly descriptor: SessionDescriptor  // std 协议
  readonly native: DshSession              // 内部使用，不暴露给插件
  
  // std-compatible methods
  getHistory(): SessionHistory
  getCatalog(): SessionCatalog
}

// TUI 会话管理器（替换直接使用 ctx.sessions）
export class TuiSessionManager {
  constructor(
    private readonly stdCatalog: SessionCatalog,
    private readonly stdHistory: SessionHistory,
    private readonly nativeSessions: /* ctx.sessions */
  ) {}
  
  async list(): Promise<TuiSession[]> {
    // 优先通过 std catalog
    const page = await this.stdCatalog.list({ limit: 100 })
    return page.sessions.map(desc => this.wrapSession(desc))
  }
  
  async create(title?: string): Promise<TuiSession> {
    const requestId = crypto.randomUUID()
    const desc = await this.stdCatalog.create({ requestId, title })
    return this.wrapSession(desc)
  }
  
  // ... 其他方法
}
```

#### 1.3 重构 src/index.ts 会话引用

**修改范围**: `src/index.ts:1-8000` (166KB 分阶段重构)

**第一阶段**（0.4.0-alpha.1）：
- 替换 `ctx.sessions.list()` → `tuiSessionManager.list()`
- 替换 `ctx.sessions.create()` → `tuiSessionManager.create()`
- 会话切换、恢复仍使用 native DSH API

**第二阶段**（0.4.0-alpha.2）：
- SessionEvent 渲染改为消费 `SessionHistory.follow()`
- Transcript 增量更新基于 std event stream

**第三阶段**（0.4.0-beta.1）：
- `/sessions` 命令改用 std catalog
- `/resume` 使用 std descriptor

#### 1.4 验证与测试

- [ ] 新会话通过 std create 创建
- [ ] 会话列表从 std catalog 读取
- [ ] 历史记录可通过 std history 回放
- [ ] 现有 JSONL 持久化不受影响（adapter 负责映射）
- [ ] `/resume` 命令正常工作

#### 预期收益

- ✅ 会话管理 API 与 DSH 版本解耦
- ✅ 为远程会话访问（SSH、Web）铺路
- ✅ 第三方插件可声明 SessionEvent 资源
- ⚠️ 仍保留 DSH native 通道（完全解耦需阶段 2）

---

### 阶段 2: 拆分 src/index.ts 巨类（0.4.0）

**工作量**: 40-60 小时  
**前置条件**: 阶段 1 完成  
**优先级**: 🟠 **P1 - 技术债**

#### 目标模块结构

```
src/
├── index.ts                    # 入口，仅做 setup + cordis.patch
├── tui-runtime.ts              # TUI 主运行时
├── ui/
│   ├── chrome.ts               # 顶部栏、底部栏、指示器
│   ├── transcript.ts           # 消息渲染
│   ├── input.ts                # 编辑器
│   ├── overlays.ts             # 对话框、菜单
│   └── theme.ts                # 主题系统
├── commands/
│   ├── session.ts              # /new, /resume, /clear
│   ├── settings.ts             # /settings
│   ├── model.ts                # /model, /think
│   ├── doctor.ts               # /doctor
│   └── index.ts
├── std-sessions/               # 阶段 1 产物
│   └── index.ts
├── dsh-host/                   # 现有
└── plugin-spec/                # 现有
```

#### 重构策略

**不做全量重写**：
- 保持现有逻辑（UI 交互、Typert 绘制、事件处理）
- 只做"切文件 + 导出规范化"
- 渐进式：每周拆分 2-3 个模块，6-8 周完成

#### 拆分顺序

1. **Week 1-2**: Commands（最独立）
   - `src/commands/session.ts` 提取所有 `/new`, `/resume`, `/sessions` 命令
   - `src/commands/settings.ts` 提取 `/settings` 菜单逻辑
   
2. **Week 3-4**: UI Components
   - `src/ui/chrome.ts` 提取顶部路径栏、底部状态栏
   - `src/ui/transcript.ts` 提取 transcript 渲染、工具卡
   
3. **Week 5-6**: Overlays & Input
   - `src/ui/overlays.ts` 提取对话框、选择器
   - `src/ui/input.ts` 提取编辑器、补全

4. **Week 7-8**: Runtime & Integration
   - `src/tui-runtime.ts` 主运行时协调器
   - `src/index.ts` 收缩为启动入口

#### 验证

- [ ] 每周末回归测试完整 TUI 功能
- [ ] 热重载不受影响
- [ ] bundle 大小无显著增长
- [ ] 所有命令、UI 交互正常

---

### 阶段 3: Connection 协议引入（0.5.0）

**工作量**: 30-40 小时  
**前置条件**: 阶段 2 完成  
**优先级**: 🟡 **P2 - 远程化基础**

#### 目标

- TUI 作为 Connection Host，可接受远程 endpoint 连接
- 会话管理、命令执行、模型调用通过 connection 投射
- 支持场景：SSH 远程 TUI、Web 客户端连接本地 TUI

#### 3.1 引入 connection 协议

**新增依赖**:
```json
{
  "dependencies": {
    "@dsh-std/connection": "^0.1.1-rc.2"
  }
}
```

#### 3.2 TUI 作为 Connection Host

**新建文件**: `src/connection-host/index.ts`

```typescript
import { StandardConnection, resolveConnection } from '@dsh-std/connection'
import type { SessionCatalog, SessionHistory } from '@dsh-std/session'

/**
 * TUI Connection Host: 向远程 endpoint 暴露能力。
 */
export class TuiConnectionHost {
  private connections = new Map<string, StandardConnection>()
  
  constructor(
    private readonly sessionCatalog: SessionCatalog,
    private readonly sessionHistory: SessionHistory,
    // ... 其他 capability providers
  ) {}
  
  /**
   * 接受远程连接请求（如 SSH client）
   */
  async acceptConnection(remoteEndpoint: Endpoint): Promise<StandardConnection> {
    // 本地声明支持的协议
    const localOffer = {
      endpoint: 'tui-host-local',
      revision: 1,
      participants: [{
        id: 'tui-host',
        supports: [
          { protocol: 'session.dsh/v1alpha1#SessionCatalog', spec: {} },
          { protocol: 'session.dsh/v1alpha1#SessionHistory', spec: {} },
          { protocol: 'command.dsh/v1alpha1#CommandRuntime', spec: {} },
        ]
      }]
    }
    
    // 协商
    const plan = await resolveConnection(localOffer, remoteEndpoint.offer, protocolCatalog)
    
    // 绑定能力实现
    const conn = new StandardConnection(plan)
    conn.bindCapability('session.dsh/v1alpha1#SessionCatalog', this.sessionCatalog)
    conn.bindCapability('session.dsh/v1alpha1#SessionHistory', this.sessionHistory)
    
    this.connections.set(conn.id, conn)
    return conn
  }
}
```

#### 3.3 远程传输实现

**选项 1**: 使用 `@dsh-std/connection/memory`（进程内测试）
**选项 2**: 实现 SSH wire profile（生产）
**选项 3**: 实现 WebSocket wire profile（Web 客户端）

**建议**：0.5.0 先实现选项 1+2，Web 推迟到 0.6.0

#### 3.4 验证场景

- [ ] 本地进程内测试：两个 memory connection 互相调用
- [ ] SSH 场景：远程 `dsh-cli` 连接本地 TUI，执行 `dsh session list`
- [ ] Web 场景（可选）：浏览器通过 WebSocket 连接 TUI

---

### 阶段 4: Model & Tool 协议迁移（0.5.0 或 0.6.0）

**工作量**: 20-30 小时  
**优先级**: 🟡 **P2 - LLM 解耦**

#### 目标

- 模型供应商通过 `@dsh-std/model` 的 ModelProvider 声明
- 工具注册通过 `@dsh-std/tool` 的 Tool 资源
- `/model`, `/models` 命令改用 ModelCatalog

#### 4.1 ModelProvider 迁移

**当前**：
- TUI 直接调用 `ctx.llm.listProviders()`
- Settings 写入 `ctx.settings.get('llm-pi-ai')`

**目标**：
```typescript
import { ModelCatalog, ModelProvider } from '@dsh-std/model'

const catalog: ModelCatalog = connection.getCapability('model.dsh/v1alpha1#ModelCatalog')
const providers = await catalog.list()

for (const provider of providers) {
  console.log(`${provider.name}: ${provider.status}`)
  if (provider.status === 'ready') {
    console.log(`  Models: ${provider.models.map(m => m.id).join(', ')}`)
  }
}
```

**adapter-dsh 已映射**：DSH `llm-pi-ai` → std ModelProvider 资源

#### 4.2 Tool 迁移

**当前**：
- TUI 不直接管理工具，但 adapter-dsh 已提供 Tool 注册
- 第三方插件可声明 Tool 资源

**0.6.0 增强**：
- TUI `/tools` 命令列出所有 std Tool
- Settings 页面显示插件贡献的工具
- 工具权限细粒度控制

---

### 阶段 5: 完全解耦 DSH 类型（1.0.0）

**工作量**: 80-100 小时  
**前置条件**: 阶段 1-4 完成  
**优先级**: 🟢 **P3 - 长期目标**

#### 最终架构

```
TUI 渲染层
    ↓ 只依赖
@dsh-std/* 协议包
    ↓ 通过
@dsh-std/connection
    ↓ 调用
@dsh-std/adapter-dsh
    ↓ 映射到
@deepseek-ai/dsh-*
```

#### 类型依赖清零

**目标**：
```bash
$ grep -r "from '@deepseek-ai/" src/ | grep -v "src/dsh-adapter/" | wc -l
0
```

**实现**：
- `src/dsh-host/` 全部移入 `src/dsh-adapter/`
- `src/index.ts` 等渲染层文件只 import `@dsh-std/*`
- DSH 原生类型只在 adapter 内部使用

#### 测试策略

- 在 **不安装 DSH** 的环境下编译 TUI 核心
- 运行时动态加载 adapter-dsh
- adapter 缺失时优雅降级

---

## 版本规划总览

| 版本 | 阶段 | 工作量 | std 协议使用 | DSH 耦合度 | 关键里程碑 |
|------|------|--------|------------|-----------|-----------|
| **0.3.2** | 阶段 0 | 6-8h | 4 个 | 高 | 版本声明规范化 |
| **0.3.3** | - | 4h | 4 个 | 高 | bug 修复、小增强 |
| **0.4.0-alpha** | 阶段 1 | 30h | 5 个 (+session) | 高 | Session 抽象层 |
| **0.4.0** | 阶段 2 | 60h | 5 个 | 中高 | index.ts 模块化 |
| **0.5.0** | 阶段 3 | 40h | 6 个 (+connection) | 中 | 远程连接支持 |
| **0.6.0** | 阶段 4 | 30h | 8 个 (+model+tool) | 中低 | LLM/工具解耦 |
| **1.0.0** | 阶段 5 | 100h | 8+ 个 | 低 | 完全解耦 |

**总工作量估算**: 270-320 小时

---

## 风险评估与缓解

### 风险 1: adapter-dsh 不成熟

**现状**: adapter-dsh 0.1.1-rc.2 仍在 rc 阶段，API 可能变化

**证据**:
- CHANGELOG 显示 0.1.1-rc.2 刚修复 SessionCatalog.create 重试 bug
- browser 集成依赖 DSH 0.1.2-alpha.2 的 sessionController 服务
- 部分能力（delete/watch/fork）未实现

**缓解措施**:
- ✅ 保持 DSH native 通道作为 fallback（阶段 1-4）
- ✅ 只迁移已稳定的协议（session/command/model）
- ⚠️ 延迟 workspace/agent/content 等草案协议到 1.x
- 📊 每季度评估 adapter 成熟度，调整路线图

### 风险 2: 性能下降

**原因**: 增加 std 抽象层可能带来开销

**缓解措施**:
- 热路径（transcript 渲染、输入处理）仍直接消费 DSH native
- std 调用只在冷路径（会话创建、设置保存、命令执行）
- 增加性能基准测试（startup time, transcript render FPS）

### 风险 3: 破坏性变更

**场景**: 用户升级 TUI 后现有会话/配置失效

**缓解措施**:
- 每个阶段保持后向兼容（读取旧格式）
- JSONL 持久化格式不变（adapter 负责映射）
- 提供迁移脚本（如 `omdsh migrate-to-std`）

### 风险 4: 社区分裂

**场景**: 用户困惑"为什么要 std 化？现在不好用吗？"

**缓解措施**:
- README 明确说明 TUI 定位（"std-aware native bundle"）
- 每个版本 CHANGELOG 强调用户可见收益
- 提供对比文档："直接依赖 DSH" vs "通过 std 协议"

---

## 立即行动项（下一步）

### 本周（0.3.2 发布前）

1. ✅ **完成阶段 0**（STD_ADAPTATION_TODO.md）
   - [ ] 执行 package.json 依赖范围修改
   - [ ] 实现 upstreamDriftWarnings() 数组逻辑
   - [ ] 添加 /doctor check 命令
   
2. 📝 **向社区提问**
   - 在 dsh-std GitHub 提 issue："TUI 作为 bundle 的 std 集成最佳实践"
   - 询问 adapter-dsh 路线图：何时达到 stable？

3. 📊 **内部决策**
   - 确定 0.4.0 时间表（是否立即开始阶段 1？）
   - 分配开发资源（是否需要多人协作？）

### 下月（0.4.0-alpha）

4. 🔧 **启动阶段 1**
   - 创建 `src/std-sessions/` 目录
   - 实现 TuiSessionManager 原型
   - 重构 `/new`, `/resume` 命令使用 std catalog

### 下季度（0.4.0-0.5.0）

5. 🏗️ **阶段 2 持续重构**
   - 每周拆分 2-3 个模块
   - 保持 CI 绿灯
   
6. 🌐 **探索 Connection 场景**
   - 实现 SSH connector PoC
   - 验证远程会话访问

---

## 附录：std 协议速查

### A. SessionCatalog 能力

```typescript
interface SessionCatalog {
  list(request: {
    limit?: number
    cursor?: string
    filter?: { workspaceId?: string }
  }): Promise<{
    sessions: SessionDescriptor[]
    nextCursor?: string
  }>
  
  get(sessionId: string): Promise<SessionDescriptor | undefined>
  
  create(request: {
    requestId: string      // 幂等键
    title?: string
    workspaceId?: string
  }): Promise<SessionDescriptor>
  
  rename(sessionId: string, title: string): Promise<void>
}

interface SessionDescriptor {
  id: string
  title: string
  createdAt: number
  lastActiveAt: number
  workspaceId?: string
  // adapter 可扩展产品特定字段
}
```

### B. SessionHistory 能力

```typescript
interface SessionHistory {
  read(request: {
    sessionId: string
    cursor?: string
    limit?: number
  }): Promise<HistoryChunk>
  
  follow(request: {
    sessionId: string
    fromCursor: string
  }): AsyncIterable<HistoryEvent>
}

interface HistoryEvent {
  cursor: string          // 单调递增
  event: SessionEvent     // 实际事件载荷
}
```

### C. ModelCatalog 能力

```typescript
interface ModelCatalog {
  list(): Promise<ModelProvider[]>
  get(providerId: string): Promise<ModelProvider | undefined>
}

interface ModelProvider {
  id: string              // 'openai', 'deepseek-official'
  name: string
  status: 'ready' | 'authentication-required' | 'unavailable'
  reason?: string
  models: ModelInfo[]
  // 命令引用
  authenticate?: CommandReference
  signOut?: CommandReference
  configure?: CommandReference
}
```

---

**文档版本**: v1.0  
**维护者**: TBD  
**审核**: TBD  
**下次更新**: 阶段 0 完成后
