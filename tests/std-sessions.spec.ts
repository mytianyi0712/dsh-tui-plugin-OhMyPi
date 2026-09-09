/**
 * std-sessions 模块测试
 * 验证 TuiSessionManager 的基本功能
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { TuiSessionManager } from '../src/std-sessions/index.ts'
import type { SessionCatalogClient } from '@dsh-std/session/catalog'
import type { SessionHistoryClient } from '@dsh-std/session/history'
import type { Session as DshSession } from '@deepseek-ai/dsh-session'

describe('TuiSessionManager', () => {
  let nativeSessions: Record<string, DshSession>
  let mockCatalog: SessionCatalogClient
  let mockHistory: SessionHistoryClient
  let manager: TuiSessionManager

  beforeEach(() => {
    nativeSessions = {}
    
    // Mock native sessions store
    const nativeStore = {
      list: () => Object.values(nativeSessions),
      get: (id: string) => nativeSessions[id],
      create: (options: { title?: string }) => {
        const session = {
          id: `session-${Date.now()}-${Math.random()}`,
          title: options.title,
        } as DshSession
        nativeSessions[session.id] = session
        return session
      },
    }

    // Mock std catalog (模拟失败，强制fallback到native)
    mockCatalog = {
      list: () => {
        throw new Error('std catalog not available')
      },
      get: () => {
        throw new Error('std catalog not available')
      },
      create: () => {
        throw new Error('std catalog not available')
      },
      rename: () => {
        throw new Error('std catalog not available')
      },
      delete: () => {
        throw new Error('std catalog not available')
      },
      watch: () => {
        throw new Error('std catalog not available')
      },
    } as unknown as SessionCatalogClient

    // Mock std history (模拟失败，强制fallback到native)
    mockHistory = {
      read: () => {
        throw new Error('std history not available')
      },
      follow: () => {
        throw new Error('std history not available')
      },
      fork: () => {
        throw new Error('std history not available')
      },
    } as unknown as SessionHistoryClient

    manager = new TuiSessionManager({
      stdCatalog: mockCatalog,
      stdHistory: mockHistory,
      nativeSessions: nativeStore,
      debug: false,
    })
  })

  test('creates session with native fallback', async () => {
    const session = await manager.create({ title: 'Test Session' })
    
    expect(session).toBeDefined()
    expect(session.id).toMatch(/^session-/)
    expect(session.descriptor.title).toBe('Test Session')
    expect(session.descriptor.state).toBe('available')
    expect(session.native).toBeDefined()
  })

  test('lists sessions with native fallback', async () => {
    // 创建几个会话
    await manager.create({ title: 'Session 1' })
    await manager.create({ title: 'Session 2' })
    await manager.create({ title: 'Session 3' })

    const sessions = await manager.list()
    
    expect(sessions).toHaveLength(3)
    expect(sessions[0].descriptor.title).toBe('Session 1')
    expect(sessions[1].descriptor.title).toBe('Session 2')
    expect(sessions[2].descriptor.title).toBe('Session 3')
  })

  test('gets session by id', async () => {
    const created = await manager.create({ title: 'Get Test' })
    const retrieved = await manager.get(created.id)
    
    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.descriptor.title).toBe('Get Test')
  })

  test('returns undefined for non-existent session', async () => {
    const session = await manager.get('non-existent-id')
    expect(session).toBeUndefined()
  })

  test('renames session', async () => {
    const session = await manager.create({ title: 'Original Title' })
    await manager.rename(session.id, 'Updated Title')
    
    const retrieved = await manager.get(session.id)
    expect(retrieved?.descriptor.title).toBe('Updated Title')
  })

  test('generates unique requestId', async () => {
    const session1 = await manager.create({ title: 'Test 1' })
    const session2 = await manager.create({ title: 'Test 2' })
    
    // 不同的会话应该有不同的ID
    expect(session1.id).not.toBe(session2.id)
  })

  test('session has correct capabilities', async () => {
    const session = await manager.create({ title: 'Capability Test' })
    
    expect(session.getCatalog()).toBeDefined()
    expect(session.getHistory()).toBeDefined()
  })

  test('handles empty session list', async () => {
    const sessions = await manager.list()
    expect(sessions).toHaveLength(0)
  })
})
