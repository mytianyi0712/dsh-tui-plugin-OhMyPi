/**
 * Host shell seams.
 *
 * This module is NOT an adapter. The only adapter in this repo is the public
 * `@dsh-std/adapter-dsh` (dynamically linked from the profile, wired in
 * `src/dsh-adapter/`). The public adapter maps DSH services to Community v0.15
 * protocols; the host TUI still needs several DSH product services that the
 * std protocol catalog does not cover yet — live session events, agent
 * lifecycle, LLM streaming chunks, user-questions, permission presets,
 * settings namespaces, skill rendering, session query, cmdline and tool
 * definition. Those product seams live here, isolated from the adapter tree.
 *
 * The seams are split by domain (`framework`, `agent`, `llm`, `session`,
 * `product`) so a single upstream rename cannot take down the whole facade.
 * Declaration merges live in `declarations.ts`.
 *
 * `pnpm run verify:boundary` enforces: `@deepseek-ai/*` only here;
 * `@dsh-std/adapter-dsh` only in `src/dsh-adapter/`.
 */

export * from './framework.ts'
export * from './agent.ts'
export * from './llm.ts'
export * from './session.ts'
export * from './product.ts'
import './declarations.ts'
