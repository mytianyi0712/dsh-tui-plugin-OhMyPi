/**
 * Shared dsh-std `ProtocolCatalog` and `ManifestDefinitionCatalog` for the
 * omp-tui admission profile.
 *
 * Public dsh-std protocols are registered from their packages
 * (`@dsh-std/command`, `@dsh-std/storage`, `@dsh-std/messages`,
 * `@dsh-std/presentation`). Private `tui.dsh/*` coordinates are registered as
 * lightweight protocol definitions whose product-policy semantics live in
 * `manifest.ts` (five-state negotiation + grants).
 */

import { ProtocolCatalog, type ProtocolDefinition } from '@dsh-std/core'
import { ManifestDefinitionCatalog } from '@dsh-std/manifest'
import { register as registerCommand } from '@dsh-std/command'
import { register as registerMessages } from '@dsh-std/messages'
import { register as registerPresentation } from '@dsh-std/presentation'
import { register as registerStorage } from '@dsh-std/storage'
import { PRIVATE_DEFINITIONS } from './registry.ts'

function privateDefinition(entry: (typeof PRIVATE_DEFINITIONS)[number]): ProtocolDefinition {
  return {
    apiVersion: entry.apiVersion,
    kind: entry.kind,
    validateRequirement() {
      return undefined
    },
    validateSupport(value: unknown) {
      return value
    },
    negotiate() {
      return { issues: [] }
    },
  } as unknown as ProtocolDefinition
}

export const SHARED_PROTOCOL_CATALOG = new ProtocolCatalog({
  name: 'dsh-omp-tui',
  version: '0.3.0',
})

export const SHARED_MANIFEST_CATALOG = new ManifestDefinitionCatalog()

registerCommand(SHARED_PROTOCOL_CATALOG, SHARED_MANIFEST_CATALOG)
for (const register of [registerStorage, registerMessages, registerPresentation]) {
  register(SHARED_PROTOCOL_CATALOG)
}

for (const definition of PRIVATE_DEFINITIONS) {
  SHARED_PROTOCOL_CATALOG.register(privateDefinition(definition))
}
