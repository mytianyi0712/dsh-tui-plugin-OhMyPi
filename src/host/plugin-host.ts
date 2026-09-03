/**
 * Plugin host (tuiPluginHost): admission, managed command registration,
 * decision-event subscription with the D-7 gate, and Host Descriptor build.
 *
 * Provided by the `dsh-omp-tui/plugin-host` row (see cordis.patch.yml). Like
 * the dsh-TUI reference, this row runs before the renderer rows so plugins can
 * inject `tuiPluginHost`/`tuiPluginStorage`/`tuiMessageObserver`.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '../dsh-host/index.ts'
import {
  buildHostDescriptor as buildDescriptor,
  negotiate,
  parseManifest,
  profileDigest,
  type DshPluginManifest,
  type NegotiationResult,
} from '../plugin-spec/index.ts'
import { createActivationId, type GrantStore } from './grants.ts'
import type { EffectLedger } from './effect-ledger.ts'
import { hostRuntime } from './runtime.ts'

export type DecisionEventName =
  | 'tui/input'
  | 'tui/rewind-prompt'
  | 'tui/rewind-done'
  | 'tui/session-switch'
  | 'tui/session-switched'
  | 'tui/compact'

export const DECISION_EVENT_NAMES: readonly DecisionEventName[] = [
  'tui/input',
  'tui/rewind-prompt',
  'tui/rewind-done',
  'tui/session-switch',
  'tui/session-switched',
  'tui/compact',
]

const INTERCEPT_PERMISSIONS: Partial<Record<DecisionEventName, string>> = {
  'tui/input': 'session.input.intercept',
  'tui/rewind-prompt': 'session.rewind.intercept',
  'tui/session-switch': 'session.switch.intercept',
  'tui/compact': 'session.compact.intercept',
}

export interface DecisionSubscription {
  componentId: string
  activationInstance: string
  event: DecisionEventName
  listener: (payload: Record<string, unknown>) => unknown
}

export interface Admission {
  componentId: string
  activationInstance: string
  manifest: DshPluginManifest
  negotiation: NegotiationResult
}

export interface AdmitResult {
  ok: boolean
  status: NegotiationResult['status']
  componentId?: string
  activationInstance?: string
  reasons: string[]
  admission?: Admission
}

export interface TuiPluginHost {
  generationId: string
  grants: GrantStore
  ledger: EffectLedger
  admit(pluginCtx: Context, source: unknown): AdmitResult
  registerCommand(pluginCtx: Context, definition: Record<string, unknown>): () => void
  subscribeDecision(pluginCtx: Context, event: DecisionEventName, listener: (payload: Record<string, unknown>) => unknown): () => void
  runDecision(event: DecisionEventName, payload: Record<string, unknown>): Promise<unknown>
  buildHostDescriptor(options: { commandsMounted?: boolean }): ReturnType<typeof buildDescriptor>
  selfCheck(): string[]
  activeAdmissions(): Admission[]
  activeDecisionSubscriptions(): DecisionSubscription[]
}

function componentIdOf(pluginCtx: Context): string {
  const name = (pluginCtx as Context & { name?: string }).name
  return typeof name === 'string' && name !== '' ? name : 'undeclared'
}

export class PluginHost implements TuiPluginHost {
  readonly generationId = hostRuntime.generationId
  readonly grants = hostRuntime.grants
  readonly ledger = hostRuntime.ledger
  private readonly admissions = new Map<string, Admission>()
  private readonly decisionSubscriptions: DecisionSubscription[] = []
  private readonly commandOwners = new Map<string, { componentId: string; activationInstance: string }>()

  admit(pluginCtx: Context, source: unknown): AdmitResult {
    let manifest: DshPluginManifest
    try {
      manifest = parseManifest(source)
    } catch (error) {
      const details = (error as Error & { details?: string[] }).details ?? []
      return { ok: false, status: 'rejected', reasons: [error instanceof Error ? error.message : String(error), ...details] }
    }

    const componentId = manifest.id
    const activationInstance = createActivationId()
    const granted = this.grants.grantedPermissions(componentId)
    const negotiation = negotiate(manifest, { grantedPermissions: granted })

    if (negotiation.status === 'rejected' || negotiation.status === 'unknown') {
      return { ok: false, status: negotiation.status, reasons: negotiation.contractDecisions.map(decision => `${decision.coordinate}: ${decision.status}`) }
    }

    const admission: Admission = { componentId, activationInstance, manifest, negotiation }
    this.admissions.set(componentId, admission)
    hostRuntime.recordActivation(componentId, activationInstance)
    hostRuntime.recordManifest(componentId, manifest)
    this.ledger.record({ operation: 'create', scope: 'admission', resource: `plugin:${componentId}` }, {
      pluginId: componentId,
      activationInstance,
      runtimeGenerationId: this.generationId,
    })
    return {
      ok: negotiation.status === 'compatible' || negotiation.status === 'compatible_degraded',
      status: negotiation.status,
      componentId,
      activationInstance,
      reasons: negotiation.contractDecisions.map(decision => `${decision.coordinate}: ${decision.status}`),
      admission,
    }
  }

  registerCommand(pluginCtx: Context, definition: Record<string, unknown>): () => void {
    const componentId = componentIdOf(pluginCtx)
    const admission = this.admissions.get(componentId)
    const activationInstance = admission?.activationInstance ?? 'undeclared'
    const contributionId = typeof definition.id === 'string' && definition.id !== '' ? definition.id : typeof definition.name === 'string' ? definition.name : undefined
    if (contributionId === undefined) {
      throw Object.assign(new Error('command definition requires an id or name'), { code: 'INVALID_CONTRIBUTION_ID' })
    }
    if (this.commandOwners.has(contributionId)) {
      throw Object.assign(new Error(`command contribution ${contributionId} is already registered`), { code: 'DUPLICATE_CONTRIBUTION_ID' })
    }

    const commands = pluginCtx.get('commands', false) as { register?: (definition: Record<string, unknown>) => () => void } | undefined
    if (commands?.register === undefined) {
      this.ledger.record({ operation: 'create', scope: 'commands', resource: `command:${contributionId}`, note: 'COMMANDS_UNAVAILABLE' }, {
        pluginId: componentId,
        activationInstance,
        runtimeGenerationId: this.generationId,
      })
      return () => undefined
    }

    const wrapped = { ...definition }
    const originalHandler = wrapped.handler
    wrapped.handler = (...args: unknown[]) => {
      const rootGrant = this.grants.check('host', 'commands.invoke')
      if (!rootGrant.granted) return { kind: 'error', text: 'commands.invoke denied by host policy' }
      const ownerGrant = this.grants.check(componentId, 'commands.invoke')
      if (!ownerGrant.granted) return { kind: 'error', text: `commands.invoke denied for ${componentId}` }
      return typeof originalHandler === 'function' ? originalHandler(...args) : { kind: 'error', text: 'command has no handler' }
    }

    const dispose = commands.register(wrapped)
    this.commandOwners.set(contributionId, { componentId, activationInstance })
    this.ledger.record({ operation: 'create', scope: 'commands', resource: `command:${contributionId}` }, {
      pluginId: componentId,
      activationInstance,
      runtimeGenerationId: this.generationId,
    })
    return () => {
      dispose()
      this.commandOwners.delete(contributionId)
      this.ledger.record({ operation: 'release', scope: 'commands', resource: `command:${contributionId}` }, {
        pluginId: componentId,
        activationInstance,
        runtimeGenerationId: this.generationId,
      })
    }
  }

  subscribeDecision(pluginCtx: Context, event: DecisionEventName, listener: (payload: Record<string, unknown>) => unknown): () => void {
    const componentId = componentIdOf(pluginCtx)
    if (!DECISION_EVENT_NAMES.includes(event)) {
      hostRuntime.log('warn', `decision guard: unknown event ${event} from ${componentId}`)
      return () => undefined
    }

    const permission = INTERCEPT_PERMISSIONS[event]
    if (permission !== undefined) {
      const grant = this.grants.check(componentId, permission, event)
      if (!grant.granted) {
        hostRuntime.log('warn', `decision guard: ${permission} not granted for ${componentId}; subscription is a no-op`)
        return () => undefined
      }
    }

    const subscription: DecisionSubscription = {
      componentId,
      activationInstance: this.admissions.get(componentId)?.activationInstance ?? 'undeclared',
      event,
      listener,
    }
    this.decisionSubscriptions.push(subscription)
    this.ledger.record({ operation: 'bind', scope: 'decision', resource: `subscription:${event}` }, {
      pluginId: componentId,
      activationInstance: subscription.activationInstance,
      runtimeGenerationId: this.generationId,
    })
    return () => {
      const index = this.decisionSubscriptions.indexOf(subscription)
      if (index >= 0) this.decisionSubscriptions.splice(index, 1)
      this.ledger.record({ operation: 'release', scope: 'decision', resource: `subscription:${event}` }, {
        pluginId: componentId,
        activationInstance: subscription.activationInstance,
        runtimeGenerationId: this.generationId,
      })
    }
  }

  async runDecision(event: DecisionEventName, payload: Record<string, unknown>): Promise<unknown> {
    const subscriptions = this.decisionSubscriptions.filter(subscription => subscription.event === event)
    if (subscriptions.length === 0) return undefined

    // Notification events are parallel broadcasts; intercept events stop at the
    // first valid decision.
    if (event === 'tui/rewind-done' || event === 'tui/session-switched') {
      for (const subscription of subscriptions) {
        void this.invokeDecision(subscription, payload)
      }
      return undefined
    }

    const deadline = Date.now() + 4000
    for (const subscription of subscriptions) {
      if (Date.now() >= deadline) break
      const decision = await this.invokeDecision(subscription, payload)
      if (decision !== undefined && decision !== null && decision !== false && typeof decision === 'object') {
        return decision
      }
    }
    return undefined
  }

  private async invokeDecision(subscription: DecisionSubscription, payload: Record<string, unknown>): Promise<unknown> {
    try {
      return await Promise.race([
        Promise.resolve().then(() => subscription.listener(payload)),
        new Promise(resolve => setTimeout(() => resolve(undefined), 400)),
      ])
    } catch (error) {
      hostRuntime.log('warn', `decision listener failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  buildHostDescriptor(options: { commandsMounted?: boolean } = {}): ReturnType<typeof buildDescriptor> {
    return buildDescriptor({
      hostId: 'dsh-omp-tui',
      hostVersion: '0.3.1',
      generationId: this.generationId,
      headless: false,
      commandsMounted: options.commandsMounted,
    })
  }

  selfCheck(): string[] {
    const problems: string[] = []
    const digest = profileDigest()
    if (digest === undefined) problems.push('profile digest unavailable; private contracts disabled')
    if (this.grants.isFailedClosed) problems.push('grant store is failed closed')
    return problems
  }

  activeAdmissions(): Admission[] {
    return [...this.admissions.values()]
  }

  activeDecisionSubscriptions(): DecisionSubscription[] {
    return [...this.decisionSubscriptions]
  }
}

export const name = 'tui-plugin-host'

export function apply(ctx: Context): void {
  const host = new PluginHost()
  ctx.provide('tuiPluginHost', host)
  const stopWatch = host.grants.watch(() => {
    // Live policy: decision and observer subscriptions re-check on every use,
    // so no eager release is required here beyond the ledger note.
    host.ledger.record({ operation: 'replace', scope: 'grants', resource: 'policy' }, { pluginId: 'host' })
  })
  ctx.effect(() => () => {
    stopWatch()
  })
}
