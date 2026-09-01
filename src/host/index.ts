/**
 * Host-plane services: grants, effect ledger, plugin storage, message
 * observer, and the plugin host. Each service has its own package subpath
 * entrypoint (`dsh-omp-tui/plugin-host`, etc.) mounted by cordis.patch.yml.
 * This index only re-exports the building blocks for tests and diagnostics.
 */

export { GrantStore, createActivationId } from './grants.ts'
export type { GrantPolicy, GrantCheck } from './grants.ts'
export { EffectLedger } from './effect-ledger.ts'
export type { LedgerEntry, LedgerRecord, LedgerIdentity } from './effect-ledger.ts'
export { PluginStorageService, StorageContractError } from './plugin-storage.ts'
export type { StorageHandle, StorageErrorCode } from './plugin-storage.ts'
export { MessageObserverBroker } from './message-observer.ts'
export type { MessageEnvelope, MessageObserverService } from './message-observer.ts'
export { PluginHost } from './plugin-host.ts'
export type { TuiPluginHost, AdmitResult, DecisionEventName, DecisionSubscription } from './plugin-host.ts'
export { hostRuntime } from './runtime.ts'
