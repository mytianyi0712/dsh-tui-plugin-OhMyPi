/**
 * Public adapter surface.
 *
 * The only adapter in this repository is the community std adapter
 * (`@dsh-std/adapter-dsh`). It is resolved dynamically from the profile and
 * owns all DSH → Community v0.15 protocol mapping. Nothing here re-exports
 * `@deepseek-ai/*` domain packages; host rendering seams that still need
 * them live in `src/dsh-host/`, outside the adapter tree.
 */

export {
  STD_ADAPTER_PACKAGE,
  STD_PROFILE_LOADER_PACKAGE,
  importStdAdapter,
  importStdProfileLoader,
  warnStdAdapter,
  type StdAdapterApplyConfig,
  type StdAdapterModule,
  type StdProfileLoaderModule,
} from './std-link.ts'

export { apply as applyStdAdapter, name as stdAdapterName } from './std-adapter.ts'
export { apply as applyStdProfileLoader, name as stdProfileLoaderName } from './std-profile-loader.ts'

// Public adapter protocol metadata/types available to the host.
export type {
  DshCommandCatalog,
  DshCommandExecution,
  DshFacetSnapshot,
  DshPresentationDescriptor,
  DshRuntimeDescriptor,
  DshRuntimeSnapshot,
  DshStandardComponentDescriptor,
} from '@dsh-std/adapter-dsh'
