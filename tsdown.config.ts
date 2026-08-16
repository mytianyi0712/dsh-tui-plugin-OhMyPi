import { defineConfig } from 'tsdown'

/**
 * Dev build: run `tsc` first (type gate against the sibling checkout or the
 * pinned devDependencies), then bundle. `@earendil-works/pi-tui` (devDependency)
 * is bundled into lib so consumers install no pi-tui; harness packages stay
 * external and resolve through the profile's managed fallback.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/startup.ts', 'src/prompt.ts', 'src/wechat/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: [/^@deepseek-ai\//],
})
