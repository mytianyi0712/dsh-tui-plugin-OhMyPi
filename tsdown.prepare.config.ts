import { defineConfig } from 'tsdown'

/**
 * Consumer-side build (the `prepare` script, run on installs): transpile
 * straight from src with no type checking, mirroring the upstream turtle-ui
 * approach so git/file installs never need the harness monorepo.
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
