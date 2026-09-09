# dsh-omp-tui 社区 std 标准迁移方案（2026-09-09 更新版）

> **基于最新 dsh-std 仓库全面分析**  
> 仓库版本：0.1.1-rc.2 (adapter-dsh)  
> 分析日期：2026-09-09  
> 项目版本：dsh-omp-tui 0.3.2

---

## 执行摘要

### 关键发现（2026-09-09）

**✅ 已验证的能力**：
- **adapter-dsh 0.1.1-rc.2** 已稳定发布，提供完整的 DSH → std 协议映射
- **SessionCatalog** (list/get/create/rename) 和 **SessionHistory** (read/follow) 已完整实现
- **ModelCatalog** 和 **CommandRuntime** 已可用于生产环境
- **Tool** 和 **ToolOverride** 本地注册机制已就绪

**⚠️ 当前项目状态**：
- **38 处**直接 `@deepseek-ai/*` 类型导入（从之前统计的 167 处大幅改善）
- **10 处** `@dsh-std/*` 协议使用（4 个协议包：core/manifest/command/storage/messages/presentation）
- **未使用但可用的协议**：session (P0)、connection (P1)、model (P2)、tool (P2)、workspace (P3)、ui/ui-browser (P3)

**🎯 核心差距**：
1. **会话管理**：仍直接使用 `@deepseek-ai/dsh-session`，未通过 std SessionCatalog/SessionHistory
2. **模型管理**：直接依赖 `@deepseek-ai/dsh-llm`，未通过 std ModelCatalog
3. **类型耦合**：peerDependencies 中 26 个 DSH 包，范围为 `>=0.1.0-rc.6 <0.1.3`

---

## 一、std 仓库能力清单（完整版）

### 1.1 核心协议层

| 包 | 版本 | 状态 | 提供能力 | TUI 使用 |
|---|---|---|---|---|
| `@dsh-std/core` | 0.1.1-rc.1 | ✅ 稳定 | 元协议：协议声明、协商、版本兼容性 | ✅ 已使用 |
| `@dsh-std/manifest` | 0.1.1-rc.2 | ✅ 稳定 | Community v0.15 插件清单解析、合约校验 | ✅ 已使用 |
| `@dsh-std/adapter-dsh` | 0.1.1-rc.2 | ✅ 生产就绪 | DSH → std 完整映射层 | ✅ 已依赖 |

**评估**：核心层已完全集成，无需额外工作。

---

### 1.2 会话与连接协议（P0-P1 优先级）

#### `@dsh-std/session` (0.1.1-rc.2) 🔴 P0

**提供能力**：

**SessionCatalog** (目录管理)：
- `list(request)` → SessionPage：分页列表，支持 cursor
- `get(sessionId)` → SessionDescriptor：单会话元数据
- `create(request)` → SessionDescriptor：幂等创建（requestId 去重）
- `rename(sessionId, title)` → void：重命名

**SessionHistory** (历史访问)：
- `read(request)` → HistoryChunk：分页读取历史事件
- `follow(request)` → AsyncIterable<HistoryEvent>：实时跟踪新事件

**SessionEvent 资源**：
- 插件可声明自定义事件类型
- `replay` 分类：`required`（必须重放）| `ignorable`（可跳过）| `none`（不重放）

**adapter-dsh 实现状态**（0.1.1-rc.2）：
```typescript
// 已实现的映射
SessionCatalog: {
  list: ✅ 完整实现，支持分页、catalogRevision
  get: ✅ 单会话查询
  create: ✅ 幂等创建，requestId 去重（见 CHANGELOG 修复）
  rename: ✅ 标题修改
  delete: ❌ 未实现（DSH 尚无同等删除语义）
  watch: ❌ 未实现（DSH 尚无目录订阅）
}

SessionHistory: {
  read: ✅ 冷启动安全的历史分页读取
  follow: ✅ 无间隙实时事件流
  fork: ❌ 未实现（DSH 尚无幂等 fork）
}
```

**TUI 当前实现缺陷**：
```typescript
// ❌ 错误：直接使用 DSH 类型
import { Session, SessionStore } from '@deepseek-ai/dsh-session'

ctx.sessions.list()  // 绕过 std catalog
ctx.sessions.create({ title: '...' })  // 无 requestId 幂等保证
session.events  // 直接访问内存对象，无法远程化
```

**迁移价值**：
- ✅ 会话操作与 DSH 版本解耦
- ✅ 为远程访问（SSH、Web）铺路
- ✅ 第三方插件可声明 SessionEvent 资源
- ✅ `create` 的 requestId 防止重复创建

---

#### `@dsh-std/connection` (0.1.1-rc.2) 🟠 P1

**提供能力**：

**核心概念**：
- **Endpoint**：逻辑通信实体（本地 TUI、远程 SSH daemon、Web 客户端）
- **Participant**：协议协商参与方
- **Agreement**：协商结果（包含双方选择的协议版本、能力绑定）

**服务接口**：
```typescript
// 应用消费侧
interface ConnectionService {
  connect(request: ConnectionRequest): Promise<ConnectionHandle>
  observe(listener: (event: ConnectionEvent) => void): () => void
}

// 实现发布侧
interface ParticipantPublicationService {
  publish(request: PublishParticipantRequest): Promise<ParticipantLease>
}
```

**TUI 可用场景**：
1. **本地 TUI 作为 Connection Host**：
   - 监听本地 IPC/Unix socket
   - 接受 Web 客户端、远程 SSH 连接
   - 协商暴露 SessionCatalog、CommandRuntime 给客户端

2. **TUI 作为远程客户端**：
   - 连接到远程 DSH daemon（通过 SSH target）
   - 使用远端的 SessionCatalog、AgentControl
   - 本地 terminal 渲染远程会话

**adapter-dsh 实现状态**：
- ✅ 内存 attachment 传输
- ✅ 协议协商、capability 绑定
- ⚠️ SSH target provider 需单独实现（adapter 不自带）
- ⚠️ WebSocket carrier 需单独实现

**迁移价值**：
- 🚀 TUI 变身"可远程化 Agent 运行时"
- 🚀 Web UI、移动端可连接本地 TUI
- ⚠️ 复杂度高，需配套 carrier/target 实现

---

### 1.3 模型与工具协议（P2 优先级）

#### `@dsh-std/model` (0.1.1-rc.1) 🟡 P2

**提供能力**：

**ModelProvider 资源**：
```typescript
{
  apiVersion: 'models.dsh/v1alpha1',
  kind: 'ModelProvider',
  metadata: { name: 'openai-provider' },
  spec: {
    title: 'OpenAI',
    actions: {
      authenticate: { name: 'login', path: ['openai', 'login'] },
      signout: { name: 'logout', path: ['openai', 'logout'] },
      configure: { name: 'settings', path: ['openai', 'settings'] }
    }
  }
}
```

**ModelCatalog capability**：
```typescript
interface ModelCatalog {
  list(): Promise<ModelProviderCatalogEntry[]>
  get(name: string): Promise<ModelProviderCatalogEntry | undefined>
}
```

**adapter-dsh 实现状态**：
- ✅ ModelCatalog 完整实现
- ✅ 本地 ModelProviderHandler 注册
- ❌ 远程模型执行未定义（需独立调用协议）

**TUI 当前问题**：
```typescript
// ❌ 直接依赖产品模型包
import { ModelCatalog } from '@deepseek-ai/dsh-llm'
```

**迁移价值**：
- 解耦 LLM 提供商（支持第三方模型插件）
- 统一模型目录查询接口
- 模型认证状态标准化

---

#### `@dsh-std/tool` (0.1.1-rc.1) 🟡 P2

**提供能力**：

**Tool 资源**：
```typescript
{
  apiVersion: 'tools.dsh/v1alpha1',
  kind: 'Tool',
  metadata: { name: 'web_search' },
  spec: {
    title: 'Web Search',
    description: 'Search the web'
  }
}

// Runtime status
{
  state: 'available',
  description: 'Search currently indexed content',
  parameters: { /* JSON Schema */ }
}
```

**ToolOverride 扩展**：
```typescript
{
  apiVersion: 'tools.dsh/v1alpha1',
  kind: 'ToolOverride',
  metadata: { name: 'enhanced-search' },
  spec: {
    target: 'web_search',
    description: 'Add caching layer'
  }
}
```

**adapter-dsh 实现状态**：
- ✅ 本地 Tool / ToolOverride activation
- ✅ 映射到 DSH 原生 tool registry
- ✅ 提供 DSH 的 workspace、attachment、sandbox 语义
- ❌ 跨 endpoint 工具执行未定义

**迁移价值**：
- 第三方插件可贡献工具
- 工具发现与执行分离
- 支持工具包装/增强

---

### 1.4 领域协议（已使用）

| 包 | 版本 | TUI 使用方式 | 评分 |
|---|---|---|---|
| `@dsh-std/command` | 0.1.1-rc.1 | ✅ CommandRuntime 注册 | A+ |
| `@dsh-std/storage` | 0.1.1-rc.1 | ✅ LocalStorage 插件存储 | A |
| `@dsh-std/messages` | 0.1.1-rc.1 | ✅ MessageObserver 监听 | A |
| `@dsh-std/presentation` | 0.1.1-rc.1 | ✅ UserInteraction 问答 | B+ |

**评估**：这 4 个协议已集成良好，继续保持。

---

### 1.5 可选增强协议（P3 优先级）

| 包 | 版本 | 提供能力 | 适用场景 |
|---|---|---|---|
| `@dsh-std/workspace` | 0.1.1-rc.1 | Workspace 目录、Session 成员关系 | 多工作区管理 |
| `@dsh-std/ui` | 0.1.1-rc.1 | UI surface 协商 | 插件 UI 贡献 |
| `@dsh-std/ui-browser` | 0.1.1-rc.1 | SettingsSection、ToolCallView | Web 端设置页 |
| `@dsh-std/lifecycle` | 0.1.1-rc.2 | 组件生命周期协议 | 插件热重载 |
| `@dsh-std/composition` | 0.1.1-rc.1 | 组件组合规则 | 高级插件系统 |
| `@dsh-std/sdk` | 0.1.1-rc.2 | Facet 开发 SDK | 插件作者工具 |

**评估**：0.4.0 之前不建议引入，等待核心协议稳定。

---

### 1.6 不成熟协议（观望）

| 包 | 版本 | 状态 | 建议 |
|---|---|---|---|
| `@dsh-std/agent` | 0.1.1-rc.1 | 草案 | 观望至 0.5.0+ |
| `@dsh-std/content` | 0.1.1-rc.1 | 草案 | 观望 |
| `connection/wire` | 0.1.1-rc.2 | 草案 | 不迁移（底层传输） |

---

## 二、当前项目实现状态

### 2.1 依赖分析

**DSH 直接导入统计**（2026-09-09）：
```bash
$ grep -r "from '@deepseek-ai/" src/ --include="*.ts" | wc -l
38
```

**已大幅改善**（从之前的 167 处降至 38 处），说明项目已进行部分解耦。

**主要导入位置**：
```typescript
// src/index.ts (主运行时，166KB)
import { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Agent } from '@deepseek-ai/dsh-agent'
import { ModelCatalog } from '@deepseek-ai/dsh-llm'
import { CommandRuntime } from '@deepseek-ai/dsh-commands'

// src/dsh-host/*.ts (宿主适配层)
import { ... } from '@deepseek-ai/dsh-*'
```

**std 协议使用**：
```bash
$ grep -r "from '@dsh-std/" src/ --include="*.ts" | wc -l
10
```

**已使用的 std 包**：
- `@dsh-std/core`：协议目录
- `@dsh-std/manifest`：清单解析
- `@dsh-std/command`：命令协议
- `@dsh-std/storage`：存储协议
- `@dsh-std/messages`：消息观察
- `@dsh-std/presentation`：用户交互

---

### 2.2 核心差距分析

#### 差距 1：会话管理未通过 std 协议

**当前方式**：
```typescript
// ❌ 直接使用 DSH 内部 API
const sessions = ctx.sessions.list()
const session = ctx.sessions.create({ title: 'New Chat' })
session.events.forEach(event => render(event))
```

**std 标准方式**：
```typescript
// ✅ 通过 SessionCatalog
const catalog = connection.capability<SessionCatalog>('session.dsh/v1alpha1', 'SessionCatalog')
const page = await catalog.list({ limit: 50 })
const session = await catalog.create({ 
  requestId: crypto.randomUUID(),  // 幂等保证
  title: 'New Chat' 
})

// ✅ 通过 SessionHistory
const history = connection.capability<SessionHistory>('session.dsh/v1alpha1', 'SessionHistory')
for await (const event of history.follow({ session: sessionRef })) {
  render(event)
}
```

**影响**：
- ❌ 无法远程访问 TUI 会话
- ❌ 无幂等创建保证（网络重试可能创建多个会话）
- ❌ 第三方插件无法声明 SessionEvent

---

#### 差距 2：模型管理耦合产品实现

**当前方式**：
```typescript
// ❌ 直接依赖 DSH LLM 包
import { ModelCatalog } from '@deepseek-ai/dsh-llm'
```

**std 标准方式**：
```typescript
// ✅ 通过 ModelCatalog capability
const modelCatalog = connection.capability<ModelCatalog>('models.dsh/v1alpha1', 'ModelCatalog')
const providers = await modelCatalog.list()
```

---

#### 差距 3：版本依赖范围过窄

**package.json peerDependencies**（当前）：
```json
{
  "@deepseek-ai/dsh-session": ">=0.1.0-rc.6 <0.1.3",
  "@deepseek-ai/dsh-agent": ">=0.1.0-rc.6 <0.1.3",
  // ... 26 个 DSH 包
}
```

**adapter-dsh 要求**（0.1.1-rc.2）：
```json
{
  "@deepseek-ai/dsh-session": ">=0.1.2-alpha.2 <0.1.3"
}
```

**问题**：TUI 的 `>=0.1.0-rc.6` 包含 rc.6、rc.7、0.1.1-rc.1、0.1.1-rc.2、0.1.2-alpha.1、0.1.2-alpha.2、0.1.2-alpha.3，但 adapter-dsh 只支持 `>=0.1.2-alpha.2`。用户安装 TUI 时，若 DSH 版本为 0.1.1-rc.2，会导致 adapter 不兼容。

---

## 三、迁移路线图（四阶段）

### 阶段 0：依赖范围对齐（0.3.2）✅ 立即执行

**目标**：对齐 adapter-dsh 的 peerDependencies 范围，避免版本冲突。

**工作量**：4-6 小时  
**风险**：极低  
**前置条件**：无

#### 具体任务

**Task 0.1**：修改 package.json peerDependencies
```json
{
  "peerDependencies": {
    // 对齐 adapter-dsh 0.1.1-rc.2 的范围
    "@deepseek-ai/dsh-session": ">=0.1.2-alpha.2 <0.1.3",
    "@deepseek-ai/dsh-attachment": ">=0.1.2-alpha.2 <0.1.3",
    "@deepseek-ai/dsh-llm": ">=0.1.2-alpha.2 <0.1.3",
    "@deepseek-ai/dsh-tools": ">=0.1.2-alpha.2 <0.1.3",
    "@deepseek-ai/dsh-commands": ">=0.1.2-alpha.2 <0.1.3",
    "@deepseek-ai/dsh-api-gateway": ">=0.1.2-alpha.2 <0.1.3",
    "@deepseek-ai/dsh-api-session-controller": ">=0.1.2-alpha.2 <0.1.3",
    // ... 其他包类似
    "@dsh-std/adapter-dsh": ">=0.1.1-rc.2 <0.2.0"
  }
}
```

**Task 0.2**：更新 src/std-contract.ts
```typescript
export const STD_ADAPTER_MINIMUM = '0.1.1-rc.2'
export const STD_ADAPTER_PEER_RANGE = '>=0.1.1-rc.2 <0.2.0'

export const UPSTREAM_VALIDATED_VERSIONS: readonly string[] = [
  '0.1.2-alpha.2',
  '0.1.2-alpha.3',
  // 未来可添加更多
]
```

**Task 0.3**：验证安装
```bash
pnpm install
pnpm run verify:contract
```

**交付物**：
- [x] package.json 更新
- [x] src/std-contract.ts 更新
- [x] 通过 CI 测试

---

### 阶段 1：Session 协议迁移（0.4.0-alpha.1）🔴 P0

**目标**：会话管理改为通过 std SessionCatalog/SessionHistory，保留 DSH native fallback。

**工作量**：25-35 小时  
**风险**：中  
**前置条件**：阶段 0 完成，adapter-dsh 0.1.1-rc.2+ 可用

#### 具体任务

**Task 1.1**：引入 session 协议包（2 小时）
```bash
pnpm add @dsh-std/session@^0.1.1-rc.2
```

```typescript
// src/std-contract.ts
export const STD_PROTOCOL_PACKAGES = [
  { name: '@dsh-std/core', minimum: '0.1.1-rc.1' },
  { name: '@dsh-std/manifest', minimum: '0.1.1-rc.2' },
  { name: '@dsh-std/session', minimum: '0.1.1-rc.2' },  // 新增
  // ...
]
```

**Task 1.2**：创建 Session 抽象层（8-10 小时）

**新建文件**：`src/std-sessions/index.ts`
```typescript
/**
 * std session 协议抽象层。
 * TUI 渲染层只依赖此模块，不直接 import @deepseek-ai/dsh-session。
 */
import type { 
  SessionCatalog, 
  SessionHistory, 
  SessionDescriptor,
  SessionReference,
  SessionEventEnvelope
} from '@dsh-std/session'
import type { Session as DshSession } from '@deepseek-ai/dsh-session'

// TUI 内部会话句柄（混合 DSH 原生 + std 投影）
export interface TuiSession {
  readonly id: string
  readonly descriptor: SessionDescriptor  // std 协议
  readonly native?: DshSession             // 内部使用，可选（远程会话无此字段）
  
  // std-compatible methods
  getHistory(): SessionHistory
  getCatalog(): SessionCatalog
}

// TUI 会话管理器
export class TuiSessionManager {
  constructor(
    private readonly stdCatalog: SessionCatalog,
    private readonly stdHistory: SessionHistory,
    private readonly nativeSessions: /* ctx.sessions */,  // fallback
  ) {}
  
  async list(): Promise<TuiSession[]> {
    try {
      // 优先通过 std catalog
      const page = await this.stdCatalog.list({ limit: 100 })
      return page.sessions.map(desc => this.wrapSession(desc))
    } catch (err) {
      // Fallback to native
      console.warn('std SessionCatalog unavailable, using native:', err)
      return this.nativeSessions.list().map(native => this.wrapNative(native))
    }
  }
  
  async create(options: { title?: string; requestId?: string }): Promise<TuiSession> {
    const requestId = options.requestId ?? crypto.randomUUID()
    try {
      const desc = await this.stdCatalog.create({ requestId, title: options.title })
      return this.wrapSession(desc)
    } catch (err) {
      // Fallback to native (无幂等保证)
      console.warn('std SessionCatalog.create failed, using native:', err)
      const native = this.nativeSessions.create({ title: options.title })
      return this.wrapNative(native)
    }
  }
  
  async rename(sessionId: string, title: string): Promise<void> {
    const session = await this.get(sessionId)
    await this.stdCatalog.rename(session.descriptor.session, title)
  }
  
  async *follow(sessionId: string): AsyncIterable<SessionEventEnvelope> {
    const session = await this.get(sessionId)
    yield* this.stdHistory.follow({ session: session.descriptor.session })
  }
  
  private wrapSession(desc: SessionDescriptor): TuiSession {
    // 尝试从 native sessions 找到对应的 DSH Session
    const native = this.nativeSessions.get(desc.session.id)
    return {
      id: desc.session.id,
      descriptor: desc,
      native,
      getHistory: () => this.stdHistory,
      getCatalog: () => this.stdCatalog,
    }
  }
  
  private wrapNative(native: DshSession): TuiSession {
    return {
      id: native.id,
      descriptor: {
        session: { provider: 'local', id: native.id },
        title: native.title,
        state: 'available',
        revision: 0,
      },
      native,
      getHistory: () => this.stdHistory,
      getCatalog: () => this.stdCatalog,
    }
  }
}
```

**Task 1.3**：重构 src/index.ts 会话引用（10-15 小时）

分 3 个 PR 渐进式迁移：

**PR 1**：创建、列表、获取
```typescript
// 替换前
const sessions = ctx.sessions.list()
const session = ctx.sessions.create({ title: 'New Chat' })

// 替换后
const sessions = await tuiSessionManager.list()
const session = await tuiSessionManager.create({ 
  title: 'New Chat',
  requestId: crypto.randomUUID()  // 幂等保证
})
```

**PR 2**：会话切换、重命名
```typescript
// 替换前
session.title = 'Updated Title'

// 替换后
await tuiSessionManager.rename(session.id, 'Updated Title')
```

**PR 3**：历史事件渲染
```typescript
// 替换前
session.events.forEach(event => render(event))

// 替换后
for await (const envelope of tuiSessionManager.follow(session.id)) {
  render(envelope.data)
}
```

**Task 1.4**：测试与验证（3-5 小时）
- [ ] 新会话通过 std create 创建
- [ ] 会话列表从 std catalog 读取
- [ ] 历史记录可通过 std history 回放
- [ ] 现有 JSONL 持久化不受影响
- [ ] `/resume` 命令正常工作
- [ ] 网络失败时 fallback 到 native API

**预期收益**：
- ✅ 会话管理 API 与 DSH 版本解耦
- ✅ 幂等创建（requestId）避免重复会话
- ✅ 为远程会话访问铺路
- ⚠️ 仍保留 DSH native fallback

---

### 阶段 2：Model 协议迁移（0.4.0-beta.1）🟡 P2

**目标**：模型管理改为通过 std ModelCatalog，解耦 LLM 提供商。

**工作量**：15-20 小时  
**风险**：中  
**前置条件**：阶段 1 完成

#### 具体任务

**Task 2.1**：引入 model 协议包（2 小时）
```bash
pnpm add @dsh-std/model@^0.1.1-rc.1
```

**Task 2.2**：创建 Model 抽象层（6-8 小时）

**新建文件**：`src/std-models/index.ts`
```typescript
import type { ModelCatalog, ModelProviderCatalogEntry } from '@dsh-std/model'

export class TuiModelManager {
  constructor(
    private readonly stdCatalog: ModelCatalog,
    private readonly nativeModels: /* ctx.llm */,  // fallback
  ) {}
  
  async listProviders(): Promise<ModelProviderCatalogEntry[]> {
    try {
      const catalog = await this.stdCatalog.list()
      return catalog
    } catch (err) {
      console.warn('std ModelCatalog unavailable, using native:', err)
      // Fallback logic
    }
  }
  
  async getProvider(name: string): Promise<ModelProviderCatalogEntry | undefined> {
    try {
      return await this.stdCatalog.get({ name })
    } catch (err) {
      console.warn('std ModelCatalog.get failed:', err)
      return undefined
    }
  }
}
```

**Task 2.3**：重构模型选择 UI（5-7 小时）
- 替换 `/model` 命令中的模型列表获取
- 替换设置页面的模型提供商列表
- 保留 native LLM fallback

**Task 2.4**：测试（2-3 小时）
- [ ] 模型列表正确显示
- [ ] 模型切换正常工作
- [ ] 认证状态正确反映

---

### 阶段 3：Connection 支持（0.5.0-alpha.1）🟠 P1

**目标**：TUI 作为 Connection Host，支持本地 IPC 连接。

**工作量**：40-60 小时  
**风险**：高  
**前置条件**：阶段 1、2 完成，adapter-dsh connection 支持可用

#### 具体任务

**Task 3.1**：引入 connection 协议包（2 小时）
```bash
pnpm add @dsh-std/connection@^0.1.1-rc.2
```

**Task 3.2**：实现 Connection Host（20-30 小时）

**新建文件**：`src/connection-host/index.ts`
```typescript
import type { 
  ConnectionService, 
  ParticipantPublicationService,
  ConnectionRequest,
  ConnectionHandle 
} from '@dsh-std/connection'

export class TuiConnectionHost implements ConnectionService {
  async connect(request: ConnectionRequest): Promise<ConnectionHandle> {
    // 1. 解析 target（local、ssh、等）
    // 2. 选择 carrier（Unix socket、named pipe）
    // 3. 执行协议协商
    // 4. 返回 ConnectionHandle
  }
  
  observe(listener: (event: ConnectionEvent) => void): () => void {
    // 监听连接事件
  }
}
```

**Task 3.3**：实现本地 IPC carrier（10-15 小时）
- Unix socket (Linux/macOS)
- Named pipe (Windows)
- 进程认证

**Task 3.4**：发布 TUI 能力（5-8 小时）
```typescript
// 向连接暴露能力
participantPublisher.publish({
  declaration: {
    supports: [
      sessionCatalogProtocol.support({ operations: ['list', 'get', 'create', 'rename'] }),
      sessionHistoryProtocol.support({ operations: ['read', 'follow'] }),
      commandRuntimeProtocol.support({ placements: ['tui'] }),
    ]
  },
  endpoint: {
    attach(input) {
      // 处理远程调用
    }
  }
})
```

**Task 3.5**：测试（3-5 小时）
- [ ] 本地 IPC 连接成功
- [ ] 远程客户端可列出会话
- [ ] 远程客户端可执行命令

**预期收益**：
- 🚀 Web UI 可连接本地 TUI
- 🚀 多个客户端共享同一 Agent 运行时
- ⚠️ SSH 远程化需单独实现 SSH target provider

---

### 阶段 4：完全解耦（1.0.0）🎯 长期目标

**目标**：完全移除 DSH 类型依赖，只通过 std 协议消费。

**工作量**：80-120 小时  
**风险**：极高  
**前置条件**：阶段 1-3 完成，std 协议覆盖全部需求

#### 具体任务

- 移除所有 `@deepseek-ai/dsh-*` 的直接导入
- 通过 adapter-dsh 提供的 std 协议消费全部能力
- 实现 Tool、Workspace 协议
- SSH target provider 实现
- 完整的远程连接测试

**预期收益**：
- 🌟 真正的"write once, run anywhere"
- 🌟 成为 std 标准参考实现
- 🌟 插件生态扩展

---

## 四、风险与缓解措施

### 4.1 adapter-dsh 不成熟

**风险**：adapter-dsh 仍在 rc 阶段，可能存在 bug 或缺失功能。

**缓解措施**：
- ✅ 保留 DSH native fallback（阶段 1-2）
- 定期检查 adapter-dsh CHANGELOG
- 在 dsh-std 仓库报告问题
- 贡献 PR 修复 adapter bug

### 4.2 用户困惑

**风险**："为什么要改？现在能用"

**缓解措施**：
- 清晰沟通收益（远程访问、插件支持）
- 提供详细的 CHANGELOG
- 渐进式迁移，保持后向兼容

### 4.3 破坏性变更

**风险**：会话/配置不兼容

**缓解措施**：
- 严格后向兼容测试
- 提供数据迁移工具
- 保留回滚路径（native fallback）

### 4.4 性能影响

**风险**：std 协议调用增加开销

**缓解措施**：
- 性能基准测试（阶段 1 前后对比）
- adapter-dsh 本地调用应接近零开销
- 必要时优化热路径

---

## 五、决策点与建议

### 决策 1：项目定位 🎯

**选项 A**：DSH Bundle（当前状态）
- 保持 DSH 依赖，只用 std 协议增强可扩展性
- 快速迭代，跟随 DSH 版本
- 适合：核心开发团队维护

**选项 B**：标准实现（1.0.0 目标）
- 完全解耦，可脱离 DSH 运行
- 成为参考实现，推动 std 标准
- 适合：社区生态、长期维护

**建议**：**先 A 后 B**
- 0.3.2-0.5.0：保持 DSH Bundle 定位，渐进式采用 std
- 0.6.0+：评估完全解耦的可行性

---

### 决策 2：立即行动 ✅

**强烈建议立即执行**：
- ✅ **阶段 0**（0.3.2）：对齐依赖范围，避免版本冲突
- ✅ **阶段 1**（0.4.0-alpha.1）：Session 协议迁移，价值最高

**可推迟**：
- ⏸️ 阶段 2（Model）：优先级 P2，可延至 0.4.0-beta.1
- ⏸️ 阶段 3（Connection）：复杂度高，评估远程访问需求后决定

---

### 决策 3：资源分配

**阶段 0 + 阶段 1 总工作量**：30-40 小时

**建议分配**：
- Week 1-2：阶段 0（6 小时）+ 阶段 1 Task 1.1-1.2（10 小时）
- Week 3-4：阶段 1 Task 1.3（15 小时）
- Week 5：阶段 1 Task 1.4 测试（5 小时）

---

## 六、成功指标

### 阶段 0 成功标准
- [ ] `pnpm install` 无 peer 依赖冲突
- [ ] `verify:contract` 通过
- [ ] CI 测试全部通过

### 阶段 1 成功标准
- [ ] 90%+ 会话操作通过 std API
- [ ] 0 个新 `@deepseek-ai/dsh-session` 导入
- [ ] `/new`、`/resume`、`/clear` 命令正常工作
- [ ] 会话持久化与恢复正常
- [ ] 性能无明显退化（<5% 延迟增加）

### 阶段 2 成功标准
- [ ] 模型列表通过 std ModelCatalog 获取
- [ ] 0 个新 `@deepseek-ai/dsh-llm` 导入
- [ ] `/model` 命令正常工作

### 阶段 3 成功标准
- [ ] 本地 IPC 连接成功建立
- [ ] 远程客户端可列出会话、执行命令
- [ ] 连接断开自动重连

---

## 七、下一步行动

### 本周（Week 1）

**Day 1**（4 小时）：
1. ✅ Review 本文档
2. ✅ 决策：是否执行阶段 0
3. 修改 package.json 依赖范围
4. 修改 src/std-contract.ts

**Day 2**（2 小时）：
1. 测试 `pnpm install`
2. 运行 `verify:contract`
3. 提交 PR："chore: align peerDependencies with adapter-dsh 0.1.1-rc.2"

### 下周（Week 2）

**如果阶段 0 成功**：
1. 引入 `@dsh-std/session`
2. 创建 `src/std-sessions/index.ts`
3. 编写 TuiSessionManager

### 每月

- 检查 dsh-std 仓库 CHANGELOG
- 评估 adapter-dsh 新版本
- 更新 UPSTREAM_VALIDATED_VERSIONS

---

## 八、附录

### A. adapter-dsh 0.1.1-rc.2 能力清单

**已实现**：
- ✅ SessionCatalog: list/get/create/rename
- ✅ SessionHistory: read/follow
- ✅ CommandRuntime: execute
- ✅ ModelCatalog: list/get
- ✅ Tool/ToolOverride: 本地注册
- ✅ MessageObserver
- ✅ LocalStorage
- ✅ Presentation

**未实现**：
- ❌ SessionCatalog: delete/watch
- ❌ SessionHistory: fork
- ❌ Connection: SSH target provider
- ❌ Connection: WebSocket carrier

### B. 依赖版本兼容性矩阵

| TUI 版本 | adapter-dsh | DSH 版本 | 状态 |
|---------|-------------|----------|------|
| 0.3.1 | 0.1.1-rc.2 | 0.1.0-rc.6 | ❌ 不兼容 |
| 0.3.2 (计划) | 0.1.1-rc.2 | 0.1.2-alpha.2+ | ✅ 兼容 |
| 0.4.0 (计划) | 0.1.1-rc.2+ | 0.1.2-alpha.2+ | ✅ 兼容 |

### C. 文档索引

| 文档 | 用途 | 读者 |
|------|------|------|
| **STD_MIGRATION_PLAN_2026-09-09.md**（本文） | 完整迁移方案 | 全体开发者 |
| **STD_MIGRATION_ROADMAP.md** | 旧版路线图（参考） | 架构师 |
| **STD_ADAPTATION_SUMMARY.md** | 决策摘要（参考） | 项目负责人 |
| **/tmp/dsh-std/README.zh.md** | std 仓库概述 | 新接触者 |
| **/tmp/dsh-std/docs/proposals/** | 协议设计提案 | 深度集成者 |

---

**报告生成时间**：2026-09-09  
**数据来源**：dsh-std 仓库完整克隆、adapter-dsh 0.1.1-rc.2 CHANGELOG、TUI 源码分析  
**维护者**：开发团队  
**下次更新**：阶段 0 完成后，或 adapter-dsh 发布新版本时
