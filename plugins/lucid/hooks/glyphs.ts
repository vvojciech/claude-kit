const KIND_GLYPH: ReadonlyArray<[RegExp, string]> = [
  [/^(Bash|BashOutput|KillShell|KillBash|PowerShell)$/, '$'],
  [/^(Read|NotebookRead)$/, '≡'],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, '✎'],
  [/^(Grep|Glob|LSP|ToolSearch)$/, '⌕'],
  [/^(WebFetch|WebSearch)$/, '↗'],
  [/^(Agent|Task)$/, '◈'],
  [/^Skill$/, '✦'],
  [/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/, '☐'],
  [/^mcp__/, '⬡'],
]

export const OTHER_TOOL_GLYPH = '·'

export function toolGlyph(tool: string | undefined): string | undefined {
  if (tool === undefined) return undefined
  return KIND_GLYPH.find(([kind]) => kind.test(tool))?.[1] ?? OTHER_TOOL_GLYPH
}

export function toolGlyphs(): string[] {
  return [...KIND_GLYPH.map(([, glyph]) => glyph), OTHER_TOOL_GLYPH]
}
