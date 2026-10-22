export type Reply = { texts: string[]; partial: boolean }

export type Replies = Reply[] | null

export type Owners = Record<string, Reply | null>

declare module 'claude-code' {
  interface PluginState {
    'copy-that': { replies: Replies; owners: Owners; live: boolean }
  }
}
