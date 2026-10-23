export type Draft = { text: string }

export type PeekPictureArgs = {
  /** Absolute, `~/`, `file://` or relative to `cwd`. */
  path: string
  /** Defaults to the session's working directory. */
  cwd?: string
  /** The viewport's columns; peek sizes the thumbnail to them as it does its own. */
  columns?: number
  /** Pictures draw only under fullscreen rendering; pass the viewport's flag. */
  isFullscreen?: boolean
  /** The message being drawn. Given, peek treats the image as drawn in place there and leaves it out of its own thumbnails under that message. */
  requestId?: string
}

export type PeekPicture = {
  source: { png: string }
  columns: number
  rows: number
  alt: string
  path: string
  name: string
  caption: string
  open: string
  /** Draw the Image under this key so peek's capability check can find it. */
  key: string
}

export type PeekFallback = { fallback: 'pictures-off' | 'unresolved' }

export type PeekOpenArgs = { path: string; cwd?: string }

export type PeekOpened = { error?: string }

export type Peek = {
  picture: (args: PeekPictureArgs) => Promise<PeekPicture | PeekFallback>
  open: (args: PeekOpenArgs) => Promise<PeekOpened>
}

declare module 'claude-code' {
  interface PluginState {
    peek: { draft: Draft }
  }
  interface EngineInterface {
    peek: Peek
  }
}
