/**
 * Message observer broker (C-042 / messages.dsh MessageObserver).
 *
 * Narrow mapping: `user/message` → `message.received`,
 * `assistant/message` → `message.sent`. Streaming chunks, tool and boundary
 * events never produce envelopes. Subscriptions are scoped to
 * `session:<id>` and receive only same-scope envelopes.
 */

import type { Context, Session, SessionEvent } from '../dsh-host/index.ts'
import { validateMessageEvent } from '@dsh-std/messages'
import { sanitizeCellText, truncateByCell } from '../render-safe.ts'
import { hostRuntime } from './runtime.ts'

const MAX_QUEUE = 16
const LISTENER_TIMEOUT_MS = 2000

export interface MessageContentBlock {
  readonly type: 'text' | 'image'
  readonly text?: string
  readonly data?: string
  readonly mimeType?: string
}

export interface MessageEnvelope {
  readonly eventType: 'messages.observe'
  readonly eventVersion: '0.15'
  readonly envelopeVersion?: '0.15'
  readonly eventId: string
  readonly scope: string
  readonly scopeType?: string
  readonly scopeId?: string
  readonly sequence: number
  readonly privacyClass: 'sensitive'
  readonly summary: string
  readonly payload: {
    readonly kind: 'message.received' | 'message.sent'
    readonly messageId?: string
    readonly author?: string
    readonly content: readonly MessageContentBlock[]
    readonly truncated?: boolean
  }
}

export interface MessageObserverService {
  subscribe(
    pluginCtx: Context,
    listener: (envelope: MessageEnvelope) => void | Promise<void>,
    options: { scope: string },
  ): () => void
}

interface Subscription {
  componentId: string
  activationInstance: string
  scope: string
  listener: (envelope: MessageEnvelope) => void | Promise<void>
  queue: MessageEnvelope[]
  draining: boolean
  closed: boolean
}

function componentIdOf(pluginCtx: Context): string {
  const name = (pluginCtx as Context & { name?: string }).name
  return typeof name === 'string' && name !== '' ? name : 'undeclared'
}

interface ManifestSubscriptionLike {
  apiVersion?: unknown
  kind?: unknown
  scope?: unknown
}

function isScopeDeclared(componentId: string, scope: string): boolean {
  const manifest = hostRuntime.manifestOf(componentId)
  if (manifest === undefined) return true
  const subscriptions = (manifest as { subscriptions?: unknown }).subscriptions
  if (!Array.isArray(subscriptions)) return false
  return subscriptions.some(subscription => {
    if (typeof subscription === 'string') return subscription === scope
    if (subscription === null || typeof subscription !== 'object') return false
    const record = subscription as ManifestSubscriptionLike
    return record.apiVersion === 'messages.dsh/v1alpha1'
      && record.kind === 'MessageObserver'
      && (record.scope === undefined || record.scope === scope)
  })
}

function buildContent(message: { content?: readonly unknown[] }): { content: MessageContentBlock[]; truncated: boolean } {
  const content: MessageContentBlock[] = []
  let truncated = false
  for (const block of message.content ?? []) {
    const record = block as { type?: unknown; text?: unknown; attachment?: unknown }
    if (record.type === 'text' || record.type === 'reasoning') {
      const text = sanitizeCellText(record.text, 4000)
      if (text !== undefined) content.push({ type: 'text', text })
    } else if (record.type === 'image') {
      // The std messages protocol only carries base64 image blocks. Image
      // attachment resolution is intentionally not performed here; such
      // blocks are dropped and the envelope is marked truncated.
      truncated = true
    }
  }
  if (content.length > 32) {
    return { content: content.slice(0, 32), truncated: true }
  }
  return { content, truncated }
}

function buildSummary(content: readonly MessageContentBlock[]): string {
  const text = content.filter(block => block.type === 'text').map(block => block.text ?? '').join(' ')
  return truncateByCell(text.replace(/\s+/g, ' ').trim(), 200)
}

function buildEnvelope(session: Session, event: SessionEvent, kind: MessageEnvelope['payload']['kind']): MessageEnvelope | undefined {
  const data = event.data as { message?: { id?: unknown; content?: readonly unknown[] } }
  const messageId = typeof data.message?.id === 'string' ? data.message.id : undefined
  const { content, truncated } = buildContent(data.message ?? {})
  const envelope: MessageEnvelope = Object.freeze({
    eventType: 'messages.observe',
    eventVersion: '0.15',
    envelopeVersion: '0.15',
    eventId: `${String(session.id)}:${event.seq}`,
    scope: `session:${String(session.id)}`,
    scopeType: 'session',
    scopeId: String(session.id),
    sequence: event.seq,
    privacyClass: 'sensitive',
    summary: buildSummary(content),
    payload: Object.freeze({
      kind,
      ...messageId === undefined ? {} : { messageId },
      content: Object.freeze(content),
      ...truncated ? { truncated: true } : {},
    }),
  })
  try {
    validateMessageEvent(envelope)
  } catch {
    return undefined
  }
  return envelope
}

export class MessageObserverBroker implements MessageObserverService {
  private readonly subscriptions = new Map<string, Subscription[]>()

  constructor(private readonly root: Context) {}

  subscribe(
    pluginCtx: Context,
    listener: (envelope: MessageEnvelope) => void | Promise<void>,
    options: { scope: string },
  ): () => void {
    const componentId = componentIdOf(pluginCtx)
    const scope = options?.scope
    if (typeof scope !== 'string' || !/^session:[^\s]{1,240}$/.test(scope)) {
      hostRuntime.log('warn', `message observer: invalid scope ${JSON.stringify(scope)} from ${componentId}`)
      return () => undefined
    }
    if (!isScopeDeclared(componentId, scope)) {
      hostRuntime.log('warn', `message observer: scope ${scope} is not declared in the plugin manifest for ${componentId}`)
      return () => undefined
    }
    const grant = hostRuntime.grants.check(componentId, 'messages.observe.read', scope)
    if (!grant.granted) {
      hostRuntime.log('warn', `message observer: messages.observe.read not granted for ${componentId}`)
      hostRuntime.ledger.record({
        operation: 'bind',
        scope: 'messages.observe',
        resource: 'subscription',
        note: 'PERMISSION_NOT_GRANTED',
      }, { pluginId: componentId, activationInstance: 'anonymous', runtimeGenerationId: hostRuntime.generationId })
      return () => undefined
    }

    const subscription: Subscription = {
      componentId,
      activationInstance: hostRuntime.activationInstanceOf(componentId) ?? 'undeclared',
      scope,
      listener,
      queue: [],
      draining: false,
      closed: false,
    }
    const list = this.subscriptions.get(componentId) ?? []
    list.push(subscription)
    this.subscriptions.set(componentId, list)

    hostRuntime.ledger.record({ operation: 'bind', scope: 'messages.observe', resource: `subscription:${scope}` }, {
      pluginId: componentId,
      activationInstance: subscription.activationInstance,
      runtimeGenerationId: hostRuntime.generationId,
    })

    return () => {
      subscription.closed = true
      const remaining = (this.subscriptions.get(componentId) ?? []).filter(entry => entry !== subscription)
      if (remaining.length === 0) this.subscriptions.delete(componentId)
      else this.subscriptions.set(componentId, remaining)
      hostRuntime.ledger.record({ operation: 'release', scope: 'messages.observe', resource: `subscription:${scope}` }, {
        pluginId: componentId,
        activationInstance: subscription.activationInstance,
        runtimeGenerationId: hostRuntime.generationId,
      })
    }
  }

  handleSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') return
    const kind = event.type === 'user/message' ? 'message.received' : 'message.sent'
    const scope = `session:${String(session.id)}`
    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        if (subscription.closed || subscription.scope !== scope) continue
        const envelope = buildEnvelope(session, event, kind)
        if (envelope === undefined) continue
        subscription.queue.push(envelope)
        if (subscription.queue.length > MAX_QUEUE) subscription.queue.shift()
        void this.drain(subscription)
      }
    }
  }

  private async drain(subscription: Subscription): Promise<void> {
    if (subscription.draining || subscription.closed) return
    subscription.draining = true
    try {
      while (subscription.queue.length > 0 && !subscription.closed) {
        const envelope = subscription.queue.shift()
        if (envelope === undefined) break
        const check = hostRuntime.grants.check(subscription.componentId, 'messages.observe.read', subscription.scope)
        if (!check.granted) {
          subscription.closed = true
          hostRuntime.ledger.record({ operation: 'release', scope: 'messages.observe', resource: `subscription:${subscription.scope}`, note: 'grant revoked' }, {
            pluginId: subscription.componentId,
            activationInstance: subscription.activationInstance,
            runtimeGenerationId: hostRuntime.generationId,
          })
          break
        }
        try {
          await Promise.race([
            Promise.resolve().then(() => subscription.listener(envelope)),
            new Promise(resolve => setTimeout(resolve, LISTENER_TIMEOUT_MS)),
          ])
        } catch (error) {
          hostRuntime.log('warn', `message observer listener failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      subscription.draining = false
    }
  }

  activeSubscriptions(): Array<{ componentId: string; scope: string; queued: number }> {
    const result: Array<{ componentId: string; scope: string; queued: number }> = []
    for (const [componentId, subscriptions] of this.subscriptions) {
      for (const subscription of subscriptions) {
        result.push({ componentId, scope: subscription.scope, queued: subscription.queue.length })
      }
    }
    return result
  }
}

export const name = 'tui-message-observer'

export function apply(ctx: Context): void {
  const broker = new MessageObserverBroker(ctx)
  ctx.provide('tuiMessageObserver', broker)
  const offEvent = ctx.on('session/event', (session, event) => {
    broker.handleSessionEvent(session, event)
  })
  ctx.effect(() => () => {
    offEvent()
  })
}
