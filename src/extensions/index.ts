/**
 * Renderer-coupled extension seams (`ctx.tuiDialogs`, `ctx.tuiStatus`,
 * `ctx.tuiShortcuts`, `ctx.tuiRenderers`, `ctx.tuiSettingsSections`,
 * `ctx.tuiScenes`). The TUI row creates one `ExtensionServices` instance,
 * provides the individual services on `ctx`, and registers pi-tui backends.
 */

export * from './services.ts'
