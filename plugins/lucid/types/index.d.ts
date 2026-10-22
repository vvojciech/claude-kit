export type LucidBlockKind = 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'quote' | 'rule'

export type LucidBlock = {
  kind: LucidBlockKind
  /** The block's markdown after CRLF is normalised to LF, with container markers (quote bars, list and footnote indents) removed. Depth-0 sources appear in the text in order. */
  source: string
  depth: number
  /** Where the block sits in the text as given (before CRLF normalisation): start inclusive, end exclusive. A nested block spans its first to last content line. */
  start?: number
  end?: number
  lang?: string
  text?: string
}

export type LucidBlocksArgs = {
  text: string
  requestId?: string
}

export type LucidPalette = Readonly<{
  text: string
  strong: string
  muted: string
  faint: string
  accent: string
  progress: string
  done: string
  error: string
  added: string
  removed: string
  panel: string
  chip: string
}>

/** The ground and '#rrggbb' palette lucid last drew with; read once per theme and again after the theme is set. */
export type LucidTone = Readonly<{
  ground: 'dark' | 'light'
  daltonized: boolean
  palette: LucidPalette
}>

export type Lucid = {
  blocks: (args: LucidBlocksArgs) => LucidBlock[]
  /** undefined until lucid has drawn once; a hook that wraps lucid's render reads it after next(e). */
  tone: () => LucidTone | undefined
}

declare module 'claude-code' {
  interface EngineInterface {
    lucid: Lucid
  }
  interface PluginState {
    lucid: {
      ranCalls: StateFamily<true>
      refusedCalls: StateFamily<true>
      launchedTasks: StateFamily<true>
      endedTasks: StateFamily<string>
    }
  }
}
