/**
 * std session 协议抽象层。
 * TUI 渲染层只依赖此模块，不直接 import @deepseek-ai/dsh-session。
 * 
 * 提供：
 * - TuiSession: 混合 std 协议 + DSH native 的会话句柄
 * - TuiSessionManager: 会话管理器，优先使用 std 协议，fallback 到 native API
 */

import type {
  SessionDescriptor,
  SessionReference,
} from '@dsh-std/session'
import type {
  SessionCatalogClient,
  ListSessionsInput,
  CreateSessionInput,
  RenameSessionInput,
} from '@dsh-std/session/catalog'
import type {
  SessionHistoryClient,
  SessionEventEnvelope,
  FollowSessionHistoryInput,
  ReadSessionHistoryInput,
} from '@dsh-std/session/history'
import type { Session as DshSession, SessionEvent as DshSessionEvent } from '@deepseek-ai/dsh-session'

/**
 * TUI 内部会话句柄（混合 DSH 原生 + std 投影）
 */
export interface TuiSession {
  /** 会话 ID（与 DSH native 一致） */
  readonly id: string
  /** std 协议描述符 */
  readonly descriptor: SessionDescriptor
  /** DSH 原生会话对象（本地会话有此字段，远程会话为 undefined） */
  readonly native?: DshSession

  /** 获取历史访问能力 */
  getHistory(): SessionHistoryClient
  /** 获取目录管理能力 */
  getCatalog(): SessionCatalogClient
}

/**
 * 会话管理器选项
 */
export interface TuiSessionManagerOptions {
  /** std SessionCatalog 能力（优先使用） */
  stdCatalog: SessionCatalogClient
  /** std SessionHistory 能力（优先使用） */
  stdHistory: SessionHistoryClient
  /** DSH 原生会话存储（fallback） */
  nativeSessions: {
    list(): DshSession[]
    get(id: string): DshSession | undefined
    create(options: { title?: string }): DshSession
  }
  /** 是否启用 debug 日志 */
  debug?: boolean
}

/**
 * TUI 会话管理器
 * 
 * 优先通过 std 协议操作会话，失败时 fallback 到 DSH native API。
 * 这种渐进式策略降低迁移风险，确保向后兼容。
 */
export class TuiSessionManager {
  private readonly stdCatalog: SessionCatalogClient
  private readonly stdHistory: SessionHistoryClient
  private readonly nativeSessions: TuiSessionManagerOptions['nativeSessions']
  private readonly debug: boolean

  constructor(options: TuiSessionManagerOptions) {
    this.stdCatalog = options.stdCatalog
    this.stdHistory = options.stdHistory
    this.nativeSessions = options.nativeSessions
    this.debug = options.debug ?? false
  }

  /**
   * 列出所有会话
   * 
   * 优先使用 std SessionCatalog.list，失败时 fallback 到 native。
   */
  async list(options?: { limit?: number }): Promise<TuiSession[]> {
    try {
      const input: ListSessionsInput = {
        limit: options?.limit ?? 100,
      }
      const call = this.stdCatalog.list(input)
      const page = await call.result
      
      if (this.debug) {
        console.log(`[TuiSessionManager] std catalog.list returned ${page.sessions.length} sessions`)
      }
      
      return page.sessions.map(desc => this.wrapStdDescriptor(desc))
    } catch (err) {
      if (this.debug) {
        console.warn('[TuiSessionManager] std SessionCatalog.list failed, using native:', err)
      }
      
      // Fallback to native
      const nativeSessions = this.nativeSessions.list()
      return nativeSessions.map(native => this.wrapNative(native))
    }
  }

  /**
   * 获取单个会话
   */
  async get(sessionId: string): Promise<TuiSession | undefined> {
    try {
      const ref: SessionReference = { provider: 'local', id: sessionId }
      const call = this.stdCatalog.get(ref)
      const desc = await call.result
      if (!desc) return undefined
      
      return this.wrapStdDescriptor(desc)
    } catch (err) {
      if (this.debug) {
        console.warn('[TuiSessionManager] std SessionCatalog.get failed, using native:', err)
      }
      
      const native = this.nativeSessions.get(sessionId)
      return native ? this.wrapNative(native) : undefined
    }
  }

  /**
   * 创建新会话
   * 
   * 使用 std SessionCatalog.create，带 requestId 幂等保证。
   * 失败时 fallback 到 native（无幂等保证）。
   */
  async create(options: { title?: string; requestId?: string }): Promise<TuiSession> {
    const requestId = options.requestId ?? this.generateRequestId()
    
    try {
      const input: CreateSessionInput = {
        requestId,
        title: options.title,
      }
      const call = this.stdCatalog.create(input)
      const result = await call.result
      
      if (this.debug) {
        console.log(`[TuiSessionManager] std catalog.create session ${result.session.session.id}`)
      }
      
      return this.wrapStdDescriptor(result.session)
    } catch (err) {
      if (this.debug) {
        console.warn('[TuiSessionManager] std SessionCatalog.create failed, using native:', err)
      }
      
      // Fallback to native (无幂等保证)
      const native = this.nativeSessions.create({ title: options.title })
      return this.wrapNative(native)
    }
  }

  /**
   * 重命名会话
   */
  async rename(sessionId: string, title: string): Promise<void> {
    try {
      const session = await this.get(sessionId)
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }
      
      const input: RenameSessionInput = {
        session: session.descriptor.session,
        title,
      }
      const call = this.stdCatalog.rename(input)
      await call.result
      
      if (this.debug) {
        console.log(`[TuiSessionManager] std catalog.rename session ${sessionId}`)
      }
    } catch (err) {
      if (this.debug) {
        console.warn('[TuiSessionManager] std SessionCatalog.rename failed:', err)
      }
      
      // Fallback: 直接修改 native session (类型不安全但必要)
      const native = this.nativeSessions.get(sessionId)
      if (native && 'title' in native) {
        (native as Record<string, unknown>).title = title
      }
    }
  }

  /**
   * 跟随会话历史事件流（实时）
   */
  async *follow(sessionId: string): AsyncIterable<SessionEventEnvelope> {
    const session = await this.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }
    
    try {
      const input: FollowSessionHistoryInput = {
        session: session.descriptor.session,
      }
      
      if (this.debug) {
        console.log(`[TuiSessionManager] std history.follow session ${sessionId}`)
      }
      
      const call = this.stdHistory.follow(input)
      
      // 处理进度流
      for await (const progress of call.progress) {
        if (progress.type === 'event') {
          yield progress.event
        }
      }
      
      await call.result
    } catch (err) {
      if (this.debug) {
        console.warn('[TuiSessionManager] std SessionHistory.follow failed:', err)
      }
      
      // Fallback: 从 native session 读取事件（不是实时流）
      if (session.native && 'events' in session.native) {
        const events = (session.native as unknown as { events?: DshSessionEvent[] }).events ?? []
        for (const event of events) {
          yield this.wrapNativeEvent(session.descriptor.session, event)
        }
      }
    }
  }

  /**
   * 读取会话历史（分页）
   */
  async readHistory(sessionId: string, options?: { limit?: number; after?: string }) {
    const session = await this.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }
    
    try {
      const input: ReadSessionHistoryInput = {
        session: session.descriptor.session,
        limit: options?.limit,
        after: options?.after,
      }
      
      const call = this.stdHistory.read(input)
      return await call.result
    } catch (err) {
      if (this.debug) {
        console.warn('[TuiSessionManager] std SessionHistory.read failed:', err)
      }
      
      // Fallback: 从 native session 构造
      if (session.native && 'events' in session.native) {
        const events = (session.native as unknown as { events?: DshSessionEvent[] }).events ?? []
        return {
          session: session.descriptor.session,
          events: events.map(e => this.wrapNativeEvent(session.descriptor.session, e)),
          hasMore: false,
        }
      }
      
      throw err
    }
  }

  /**
   * 将 std descriptor 包装为 TuiSession
   */
  private wrapStdDescriptor(desc: SessionDescriptor): TuiSession {
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

  /**
   * 将 DSH native session 包装为 TuiSession
   */
  private wrapNative(native: DshSession): TuiSession {
    const title = 'title' in native ? (native as { title?: string }).title : undefined
    return {
      id: native.id,
      descriptor: {
        session: { provider: 'local', id: native.id },
        title,
        state: 'available' as const,
        revision: 0,
      },
      native,
      getHistory: () => this.stdHistory,
      getCatalog: () => this.stdCatalog,
    }
  }

  /**
   * 将 DSH native event 包装为 std SessionEventEnvelope
   */
  private wrapNativeEvent(session: SessionReference, event: DshSessionEvent): SessionEventEnvelope {
    // 类型保护：确保 event 有我们需要的字段
    const eventObj = event as Record<string, unknown>
    const id = typeof eventObj.id === 'string' || typeof eventObj.id === 'number' ? String(eventObj.id) : String(Date.now())
    const type = typeof eventObj.type === 'string' ? eventObj.type : 'unknown'
    const timestamp = typeof eventObj.timestamp === 'string' ? eventObj.timestamp : undefined
    
    return {
      session,
      cursor: id,
      type,
      timestamp,
      replay: 'ignorable' as const, // DSH native events 标记为 ignorable
      data: event,
    }
  }

  /**
   * 生成唯一 requestId（用于幂等创建）
   */
  private generateRequestId(): string {
    return `tui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

/**
 * 创建 TuiSessionManager 的辅助函数
 */
export function createTuiSessionManager(options: TuiSessionManagerOptions): TuiSessionManager {
  return new TuiSessionManager(options)
}
