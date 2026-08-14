# dsh-omp-tui 合约速查表（contracts.md）

> dsh 0.1.0-rc.6 唯一真相源。类型文本逐字引自 npm 安装包
> `@deepseek-ai/*/lib/types/*.d.ts`。本文件是 TUI bundle 消费 harness 服务的地图；
> 上游接口变更时先更新本表再改代码。
> 包根：`$PKG = C:/Users/mytianyi/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai`

---

## 1. 会话与事件 — `@deepseek-ai/dsh-session`

### 1.1 SessionEventMap（append-only 事件日志，事件源真相）

```ts
export interface SessionEventMap {
  'turn/start': { turn: number };
  'turn/end': { turn: number; reason: TurnEndReason };
  'step/start': { turn: number; step: number };
  'step/end': { turn: number; step: number };
  'user/message': UserMessage;           // 直接人类提示 / 注入上下文 / goal 续轮；data.source 区分
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk };
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage };
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string };
  'tool/result': { turn: number; step: number; message: ToolResultMessage; error?: { name: string; code: string }; meta?: JsonValue };
  'todo/write': { todos: TodoItem[] };   // 整表快照，后写覆盖；仅 UI 状态，不进派生历史
  'request/header': { header: EpochHeader; reason: RequestHeaderReason };
  'request/context': RequestContext;
  'session/end-seed': Record<string, never>;
  // 插件合并扩展：dsh-agent 追加 'agent/inbox/spliced'；compaction/goal 各自追加（见 §7）
}
```

插件扩展方式：`declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { ... } }`。

### 1.2 TurnEndReason

```ts
export interface TurnEndReasonMap {
  completed: { kind: 'completed' };
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause };   // user|parent|hook|disposed|legacy
  blocked: { kind: 'blocked' };
  error: { kind: 'error'; error: LlmFailure };
  'max-tokens': { kind: 'max-tokens' };
  interrupted: { kind: 'interrupted' };                        // 崩溃孤儿轮次，重启时由持久化后端闭合
}
```

### 1.3 SessionEvent 信封（判别联合，switch 收窄）

```ts
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K;
    seq: number;        // 单调连续 = log.length
    time: number;       // Unix 毫秒
    data: SessionEventMap[K];
    ignorable?: true;   // 缺省 = 必需事件；不认识的必需事件必须拒建会话
  } & (K extends SurfaceEventType ? {
    sourceEventSeqs?: number[];
    surfaceOp?: SurfaceOp;
  } : object);
}[T];
```

- SurfaceEventType = `'user/message' | 'assistant/message' | 'tool/result'`（唯一可上模型可见面的三类）
- SurfaceOp = `'append' | { op: 'replace'; start: number; end: number }`（compaction 用 replace 删除被遮蔽节点）
- 派生历史 = 按 surfaceOp 顺序走 surface 节点投影（`Session.deriveMessages()`）

### 1.4 Session（活会话）

```ts
class Session {
  readonly header: SessionHeader;      // 创建元数据（version/cwd/lineage/seedLength/createdAt）
  get id(): SessionId;
  readonly firstLiveSeq: number;       // 本进程首个 seq（种子长度）
  get events(): readonly SessionEvent[];  // 深冻结不可变快照
  get seq(): number;
  get surface(): SessionSurface;
  append<T>(type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [SurfaceIntent] : []): SessionEvent<T>;
  requestHeader(): EpochHeader | undefined;
  requestContext(): RequestContext | undefined;
  deriveMessages(): Message[];         // 缓存增量投影；返回新数组、共享深冻结 Message
  deriveEventMessage(event: SessionEvent): Message | null;
  static create(id, seed?, header?): Session;
  static fromRestore(id, seed, header): Session;
}
```

### 1.5 SessionStore（`ctx.sessions`）

```ts
class SessionStore extends Service {
  create(id?: SessionId, options?: CreateSessionOptions): Session;   // 便捷：创建+入店+宣布
  prepare(id?, options?: PrepareSessionOptions): Session;            // 不入店；配合 enter/announce
  enter(session: Session): () => void;                               // 装发布钩子+入店，返回 detach
  announce(session: Session): void;                                  // 发 session/created
  flush(session: Session): Promise<boolean>;                         // 持久化屏障：唯一入口
  get(id: SessionId): Session | undefined;
  list(): Session[];
  fork(source: Session | SessionId, boundary?: number, childSessionId?: SessionId): Session;
}
```

### 1.6 cordis 事件（dsh-session 声明合并）

| 事件 | 签名 | 语义 |
|---|---|---|
| `session/created` | `(session: Session) => void` | 同步抛错可否决发布（回滚） |
| `session/disposed` | `(session: Session) => void` | 离店通知 |
| `session/event` | `(session: Session, event: SessionEvent) => void` | **追加后 fire-and-forget 馈送（TUI 渲染主通道）**；种子重放不发出 |
| `session/flush` | `(session: Session) => Promise<void> \| void` | 并行耐久检查点 |

### 1.7 TodoItem

```ts
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}
```

---

## 2. Agent — `@deepseek-ai/dsh-agent`

### 2.1 Agent（活代理句柄）

```ts
export interface Agent {
  readonly id: SessionId;
  readonly options: AgentOptions;          // { provider?, model?, maxTokens? }
  readonly session: Session;               // 同一 id 的活会话
  readonly inbox: Inbox;
  readonly status: AgentStatus;            // 'idle' | 'running'
  readonly ctx: Context;                   // agent 作用域上下文
  cancel(cause: AgentCancelCause, options?: CancelOptions): void;   // cause: {kind:'user'|'parent'|'hook'|'disposed'}
  whenIdle(): Promise<void>;
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
  followup(message: UserMessage): void;    // 排队普通后续轮并唤醒
  steer(message: UserMessage): void;       // 提交最近 step 的 steering
  inject(message: UserMessage): void;      // 排队模型可见上下文，不唤醒
}
export type InboxTarget = 'next-turn' | 'next-step';
```

### 2.2 AgentRegistry（`ctx.agents`）

```ts
class AgentRegistry extends Service {
  create(options: CreateAgentOptions): Promise<AgentHandle>;   // 新建 agent+session（factory 路径）
  resume(options: ResumeAgentOptions): Promise<AgentHandle>;   // 从持久化会话恢复（factory 路径）
  register(agent: Agent): () => void;
  get(id: SessionId): Agent | undefined;
  list(): Agent[];
  roots(): Agent[];
  isOwnedBy(id: SessionId, owner: Agent): boolean;
  currentInitiator(): Agent | undefined;
  requireInitiator(): Agent;
  withInitiator<T>(agent: Agent, operation: () => T): T;
}
export interface AgentHandle { agent: Agent; dispose(): Promise<void>; }
```

- `CreateAgentOptions`: `{ sessionId, meta?: { cwd?, parentSession?, seedLength?, origin?, delegationDepth?, agentPreset? }, seed?, agentOptions?, signal?, setup? }`
- `ResumeAgentOptions`: `{ resumeSessionId, agentOptions?, signal?, setup? }`（内部先 `ctx.sessionPersistence.prepare`）

### 2.3 模型选择

```ts
export interface ModelSelection { provider: string; model: string; reasoningEffort?: ReasoningEffortId; }
export interface ModelSelectionRef { current: ModelSelection | undefined; assembled: ModelSelection | undefined; }
export declare function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void;
```

### 2.4 cordis 事件（dsh-agent）

| 事件 | 载荷 | TUI 用途 |
|---|---|---|
| `agent/created` / `agent/disposed` | `{ agent }` | 生命周期 |
| `agent/status` | `{ agent, status }` | **编辑框/指示器状态切换（idle/running）** |
| `agent/inbox/inserted` / `claimed` / `discarded` | `{ agent, message, turn? }` | 队列显示 |
| `agent/session-start` | `{ agent, source: 'startup'\|'resume'\|'clear'\|'compact' }` | 首轮前通知 |

---

## 3. 命令行 — `@deepseek-ai/dsh-cmdline`

```ts
export interface CmdlineArgs { get(): readonly string[]; }   // 启动器 flag 之后的所有参数原样
export interface AppExit { (code: number): void; }
declare module '@deepseek-ai/cordis' {
  interface Context { cmdlineArgs?: CmdlineArgs; appExit?: AppExit; }
}
export declare function parseCmdline(ctx: Context, program: Command): void;  // commander 程序；help/version/语法错=进程终止
```

- TUI 自持 `--resume <id>` / `--session <id>` / `--help`：注入 `cmdlineArgs`，用自己的 commander program 解析，在 action 中发布 `tuiStartup` 服务；普通行 `inject: [tuiStartup]` 惰性读配置。

---

## 4. 提问 — `@deepseek-ai/dsh-user-questions`

```ts
export interface AskUserQuestionItem {
  id: string; question: string; detail?: string; header?: string;
  options?: AskUserQuestionOption[];      // { label, description? }
  multiSelect?: boolean;
  intent?: AskUserQuestionIntent;         // { kind: 'plan-review', approve: string }
}
export interface AskUserQuestionAnswerItem { id: string; selected: string[]; custom?: string; }
export interface AskUserQuestionAnswer { answers: AskUserQuestionAnswerItem[]; }
export interface AskUserQuestionRequest { questions: AskUserQuestionItem[]; agent?: Agent; signal?: AbortSignal; }
export interface UserQuestionProvider { ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>; }

class UserQuestionService extends Service {   // ctx.userQuestions
  registerProvider(provider: UserQuestionProvider): () => void;   // 单 provider
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
  // 错误码：CALLER_NOT_LIVE / DELEGATED_CALLER
}
```

- 模型侧工具在 `@deepseek-ai/dsh-tool-ask-user`；TUI 注册唯一 UI provider，渲染对话框并返回答案。

---

## 5. LLM 词汇 — `@deepseek-ai/dsh-llm`

### 5.1 内容块（ContentBlock，合并可扩展）

```ts
export interface TextBlock { type: 'text'; text: string; }
export interface ReasoningBlock { type: 'reasoning'; text: string; }
export interface ImageBlock { type: 'image'; attachment: ImageAttachmentRef; }
export interface ToolCallBlock { type: 'tool-call'; id: CallId; name: string; arguments: string; }
export interface ToolResultBlock { type: 'tool-result'; toolCallId: CallId; content: ContentBlock[]; isError?: boolean; }
export type ContentBlock = ContentBlockMap[ContentBlockType];   // 按 type 判别
```

### 5.2 消息

```ts
export interface Message {
  readonly id: MessageId;
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: ContentBlock[];
  readonly source: MessageSource;    // user {kind:'user'} | plugin {kind:'plugin',plugin,...form} | model | tool
}
export interface UserMessage extends Message { readonly role: 'user'; }
export interface AssistantMessage extends Message { readonly role: 'assistant'; readonly source: ModelMessageSource; }
export interface ToolResultMessage extends Message { readonly role: 'user'; readonly content: [ToolResultBlock]; readonly source: ToolMessageSource; }
export declare function createUserMessage<T extends NewUserMessage>(input: T & {...}): T & Pick<UserMessage, 'id'|'role'>;
```

### 5.3 流块（StreamChunk）

```ts
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: unknown };
```

### 5.4 用量与失败

```ts
export interface TokenUsage {
  inputTokens: number; outputTokens: number;
  cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number;  // 计数不相交
}
export interface LlmFailure { message: string; code: string; status?: number; providerRetryAfterMs?: number; requestId?: string; }
```

---

## 6. 会话持久化/投影/查询 —（scout 章节，待补）

## 7. skill/commands/token-meter/goal/compaction/system-prompt/title/reference —（scout 章节，待补）

## 8. agent-loop/tools/terminal 配置 schema —（scout 章节，待补）

## 9. dsh-base 默认行清单（bundle 层参考）

`$PKG/dsh-base/cordis.patch.yml`（一行 insert）已挂载：timer、hmr、llm、session、typert 三件套、
session-title(+llm)、user-questions、agent、agent-default-model、jobs、llm-retry、settings、
credentials、llm-pi-ai、session-persistence-jsonl（root=`dshHomePath('sessions')`）、attachment-local、
session-query-sqlite（path `:memory:`、openAt `never`）、session-projection、session-telemetry-otel、
subprocess、sandbox、sandbox-policy（mode `workspace-write`，workspaceRoot=process.cwd()）、
bash-sandbox（win32 禁用）、pwsh-sandbox（仅 win32）、approval、permission、shell-env、
tool-bash（win32 禁用）、tool-pwsh（仅 win32）、tool-jobs、fs-observation-policy、tool-fs、
tool-fs-search、agent-instructions、skill、skill-filesystem、skill-badge（disabled）、tool-skill、
commands、command-feedback、goal、goal-round-driver、command-goal、plan-mode、token-meter、
compaction-basic、command-compact、subagent 三件套、tool-subagent-control(+list-agents)、
tool-subagent、tool-subagent-fork、tool-subagent-report、workflow、tool-workflow、timeout-policy、
spill-local、spill-policy（maxInlineBytes 50000）、session-checkpoint-policy、tool-result-pruner、
tool-todo、tool-goal、tool-ralph、tool-str-replace-editor、repeat-tool-reminder、web_search 系列。

→ TUI bundle 的 patch 只需**覆盖** `agent-loop`/`system-prompt`/`llm-deepseek`/`fs-sandbox`/`tools`
行 + **插入** session-reference/storage 三件套/session-projection-cache/tmux-context/tui 行。

---

## 6. 会话持久化/投影/查询（scout 汇总，rc.6 逐字）

### 6.1 SessionPersistence（`ctx.sessionPersistence`，抽象服务）

```ts
abstract class SessionPersistence extends Service {
  abstract locate(meta: SessionHeader): SessionLocation | undefined;
  abstract readonly supportsRawArtifacts: boolean;
  readRaw(_id, signal?): Promise<SessionRawArtifact | undefined>;
  abstract create(meta: SessionHeader): Promise<void>;
  abstract append(id, events): Promise<void>;
  prepare(id, signal?): Promise<SessionPreparation>;   // resume 专用排他预留
  abstract load(id): Promise<SessionInspection>;        // 冷恢复：合成 tool/result+step/end+turn/end{interrupted}
  abstract inspect(id, signal?): Promise<SessionInspection>;
  abstract readFrom(id, fromSeq, signal?): Promise<{ meta; events }>;  // watermark 原语
  abstract list(signal?): Promise<SessionHeader[]>;
  abstract listSnapshots(signal?): Promise<SessionPersistenceSnapshot[]>;
}
```

### 6.2 SessionProjectionRegistry（`ctx.sessionProjections`）

```ts
interface SessionProjectionMap {}   // merge-extensible：goal/title/tokenUsage/contextPressure/contextBreakdown 等键
interface ProjectionDefinition<K, S> { key; schema; init(); apply(state, event): S; view(state): V; stateVersion: number; }
class SessionProjectionRegistry extends Service {
  register(definition): () => void;
  onChanged(listener: (session, key, value, seq) => void): () => void;
  snapshot(session): ProjectionSnapshot;          // { asOfSeq, values: Partial<SessionProjectionMap> }
  checkpoint(session): ProjectionCheckpoint;
  restoreFloor(checkpoint): number | undefined;
  viewCheckpoint(checkpoint): Partial<SessionProjectionMap>;
  restore(checkpoint, events, baseSeq): { snapshot; checkpoint };
}
```

### 6.3 SessionProjectionCache（`ctx.sessionProjectionCache`）

```ts
class SessionProjectionCache extends Service {
  cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined;  // 零 I/O 列表读
  write(session): Promise<void>;          // 先 ctx.sessions.flush 再整记录替换
  coldSnapshot(id, signal?): Promise<ProjectionSnapshot>;
}
// Config（必填）：writeEveryEvents / writeIntervalMs（组合示例 200 / 5000）
// 必写点：turn/end、会话 detach。行绑定日志生命周期（createdAt+cwd 见证），ver 不匹配即弃。
```

### 6.4 SessionQueryEngine（`ctx.sessionQuery`，抽象服务）

```ts
abstract class SessionQueryEngine extends Service {
  abstract searchSessions(request, exec?): Promise<SessionSearchPage<SessionSearchHit>>;
  abstract searchEvents(request, exec?): Promise<SessionEventSearchPage>;
  listSessions(signal?): Promise<SessionRecord[]>;                 // 轻量；live 优先
  readSession(sessionId): Promise<SessionLogSnapshot>;
  filterSessions(filters, signal?): Promise<SessionRecord[]>;
  readTitle(sessionId, signal?): Promise<SessionTitleSnapshot | undefined>;
  readTitleSnapshots(sessionIds, signal?): Promise<SessionTitleObservationResult[]>;
  listEvents(sessionId): Promise<SessionEventRecord[]>;
  readSurface(sessionId): Promise<SessionSurfaceSnapshot>;
  traceSession(sessionId, signal?): Promise<SessionLineageTrace>;
  traceEvent(request, signal?): Promise<SessionEventTraceObservation>;
  readEvent(request, signal?): Promise<SessionEventWindow>;        // before/after ≤ readWindowMax=50
}
```

- 过滤器：`{kind:'id'|'cwd'|'created-at'|'parent'|'availability'}` / 事件 `{kind:'seq'|'time'|'type'|'surface'|'text'}`；AND 语义、同子句 OR。
- TUI 消费：`/resume` 列表用 `listSessions()`/`filterSessions([{kind:'availability',values:['persisted']}])` +
  `readTitleSnapshots`；预览用 `readSurface`。错误码闭集 18 个 `SESSION_QUERY_*`。

---

## 7. 状态与能力面（scout 汇总）

### 7.1 dsh-commands（`ctx.commands`）

```ts
class CommandRuntime extends Service {
  register(definition: CommandDefinition): () => void;   // { name, description, input?, recordInput?, handler }
  list(agent: Agent): readonly CommandDescriptor[];
  find(agent: Agent, name): CommandDefinition | undefined;
  execute(agent, line, signal): Promise<CommandExecution | undefined>;  // 语法/未知名 → undefined 不记日志
}
parseCommand(line: string): ParsedCommand | undefined;
// SessionEvent：'command/run' { commandId, name, args?, source } / 'command/done' { commandId, kind, text?, sourceEventSeq? }
// CommandResult: { kind:'success', text?, sourceEventSeq? } | { kind:'error', text }
```

### 7.2 dsh-goal（`ctx.goals`）

```ts
// SessionEvent：'goal/change' = 全量快照变更（kind:'goal/change', version:1, operation: create|edit|pause|resume|complete|block|clear, goal: GoalSnapshot, …）或 clear tombstone
foldGoal(events): FoldedGoal;          // 严格重放；TUI 用 applyGoalProjection（投影宽松版）
interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed'; }  // 真身在 dsh-session
interface GoalSnapshot extends GoalRef { objective; phase: 'active'|'paused'|'blocked'|'complete'; blockedReason?; maxGoalRounds }
```

### 7.3 dsh-compaction（`ctx.compaction`，抽象）

```ts
// SessionEvent：'compaction/start'|'summary'|'end'|'prune'（log-only 锁括号 + 阴影价协议）
// 成功序列：start → summary（shadowedRange/shadowedSeqs/shadowedTokenCount）→ user/message(surfaceOp replace, source=compactCheckpointSource) → end
// TUI：start 起显示 "Context being compacted" 状态；end 或 error 清除；replace 事件由事件驱动的 transcript 天然处理
```

### 7.4 dsh-token-meter（`ctx.tokenMeter`）

```ts
measure(session, requestHeader?): TokenMeasurement;  // { totalTokens, surfaceTokens, … }
// 投影键：tokenUsage（四桶 disjoint: uncachedInput/output/cacheRead/cacheWrite）、contextPressure、contextBreakdown
// 占用率 UI：projectedTokens / 独立解析的 capacity（requestContext().contextWindow 或 LlmResolvedModelInfo.context）
```

### 7.5 dsh-system-prompt（`ctx.systemPrompt`）

```ts
// Config: { includeHarnessIdentity?, includeRuntimeContext?, persona?, toolOrder? }
// persona → order-0 'deployment:persona' section；agent-scoped 同名 section 遮蔽全局
renderPrompt(assembly: PromptAssembly): string;   // 严格 {{variable}} 插值
```

### 7.6 dsh-session-title（`ctx.sessionTitle`）

```ts
// SessionEvent：'session/title'（last-wins，log-only）；投影键 title: string | null
foldSessionTitle(events): SessionTitleSnapshot | undefined;
// 服务：get(session) / rename(session, title)（pin 住）/ refresh(session, signal?) / register(provider)
```

### 7.7 dsh-session-reference（`ctx.sessionReferenceResolver`）

```ts
parseSessionReferenceText(text): { text; references: SessionReferenceInput[] };   // @[label](dsh-session:<b64>)
listCandidates(agent, query?, limit?, signal?): Promise<SessionReferenceCandidate[]>;
prepare(agent, content, references, signal?): Promise<PreparedReferencedMessage>;  // 快照+上下文，错误码 SESSION_REFERENCE_*
// 限制：MAX_REFERENCES=3、DEFAULT_CANDIDATE_LIMIT=50、DEFAULT_MAX_REFERENCE_BYTES=65536
```

### 7.8 dsh-skill（`ctx.skills`）

```ts
class SkillRegistry extends Service {
  list(options?): Promise<SkillSummary[]>;        // { name, description, whenToUse?, invocation, source, provider }
  snapshot(options?): Promise<SkillCatalogSnapshot>;  // { skills, complete }
  get(name, options?): Promise<SkillDefinition | undefined>;
}
isUserInvocable(skill): boolean;   // TUI `/skill:` 列表过滤
```

---

## 8. 配置行 schema（cordis.patch.yml 编写依据）

### 8.1 agent-loop 行

```ts
interface Config {
  maxParallelToolCalls?: number;   // default 10，min 1；1=串行
  agents: (AgentOptions & {
    id: string;                    // required，稳定 label
    sessionId?: SessionId;         // 稳定身份；与 resumeSessionId 互斥
    cwd?: string;                  // 仅新建会话
    resumeSessionId?: SessionId;   // 加载既有持久化会话
  })[];
}
// AgentOptions: { provider?, model?, maxTokens? }
// 无 sessionId/resumeSessionId → ${id}-session-<uuid> 每次重启新会话；配置 agent 自动启动
```

### 8.2 其他行

- `agent-default-model`：`{ provider: string (req), model: string (req) }`；settings 分节另有 `reasoningEffort?`
- `agent-instructions`：`maxBytes` 必填；其余可选（projectRootMarkers 默认 ['.git']、candidates [AGENTS.md, CLAUDE.md]…）
- `tools`：`{ mode?: 'native'|'code'|'both' (default native), maxParallelSubCalls?: number (default 10) }`
- `system-prompt`：`{ persona?, toolOrder?, includeHarnessIdentity?, includeRuntimeContext? }`
- `fs-sandbox`：`{ cwd }`（workspace 根）
- `llm-deepseek`：`{ apiKeyEnv?, baseURL?, thinking?, reasoningEffort? }`（settings 分节 llm-deepseek 可热覆盖 baseURL）
- `dsh-terminal`：无配置；**TUI 不直调**（owner 绑定，供 dsh-tool-terminal 消费）

---

## 9. TUI 接线备忘（从合约到实现）

1. **启动**：`tui-startup` 行 inject `cmdlineArgs`，commander 解析 `--resume`/`--session`/`--help` → 提供 `tuiStartup`（sessionId / resumeSessionId）；agent-loop 行 `inject: [tuiStartup]` 惰性读。
2. **取 agent**：`ctx.agents.get(sessionId)` → `Agent`；`agent.session.events` 为不可变日志快照。
3. **渲染主通道**：`session/event` 事件（追加后馈送）+ 初始 `agent.session.events` 重放（种子不发出）。
4. **状态**：`agent/status` 事件 → 编辑框边框/指示器；`agent.session.header.cwd` 为 workspace。
5. **提交输入**：`agent.followup(createUserMessage({ content, source: { kind: 'user' } }))`。
6. **中断**：`agent.cancel({ kind: 'user' })`。
7. **提问**：`ctx.userQuestions.registerProvider(provider)`；对话框完成后 resolve `AskUserQuestionAnswer`。
8. **命令**：`ctx.commands.execute(agent, line, signal)`；`/help` 列表用 `ctx.commands.list(agent)`。
9. **模型选择**：`installModelSelection(agent.ctx, selectionRef)` + `agentDefaultModel.currentSelection()/saveSelection()`。
10. **投影消费**：`ctx.sessionProjections.snapshot(session)` 或 `sessionProjectionCache.cachedSnapshot(header)`（列表零 I/O）。
