import { defineConfig } from 'tsdown'

/**
 * Dev build: run `tsc` first (type gate against the sibling checkout or the
 * pinned devDependencies), then bundle. `@earendil-works/pi-tui` (devDependency)
 * is bundled into lib so consumers install no pi-tui; harness packages stay
 * external and resolve through the profile's managed fallback.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts', 'src/prompt.ts', 'src/session-title.ts', 'src/session-persistence.ts', 'src/wechat/index.ts', 'src/host/plugin-host.ts', 'src/host/plugin-storage.ts', 'src/host/message-observer.ts', 'src/host/effect-ledger.ts', 'src/dsh-adapter/std-adapter.ts', 'src/dsh-adapter/std-profile-loader.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  external: [/^@deepseek-ai\//, /^@dsh-std\//],
})
