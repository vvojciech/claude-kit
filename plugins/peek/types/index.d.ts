export type Draft = { text: string }

declare module 'claude-code' {
  interface PluginState {
    peek: { draft: Draft }
  }
}
