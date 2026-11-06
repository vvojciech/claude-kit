export type Change = { added: number; removed: number }

type Hunk = { lines?: unknown }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function patchChange(patch: unknown): Change | undefined {
  if (!Array.isArray(patch)) return undefined
  const change = { added: 0, removed: 0 }
  for (const hunk of patch as Hunk[]) {
    if (!Array.isArray(hunk.lines)) continue
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) change.added += 1
      else if (line.startsWith('-')) change.removed += 1
    }
  }
  return change
}

function lineCount(text: string): number {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

export function changeOf(tool: string, output: unknown): Change | undefined {
  if (!['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) return undefined
  const result = record(output)
  const fromPatch = patchChange(result.structuredPatch)
  if (fromPatch && fromPatch.added + fromPatch.removed > 0) return fromPatch
  if (tool === 'Write' && result.type === 'create' && typeof result.content === 'string') return { added: lineCount(result.content), removed: 0 }
  return fromPatch
}

export function sumChanges(changes: ReadonlyArray<Change | undefined>): Change | undefined {
  const present = changes.filter((change): change is Change => change !== undefined)
  if (present.length === 0) return undefined
  return present.reduce((sum, change) => ({ added: sum.added + change.added, removed: sum.removed + change.removed }), { added: 0, removed: 0 })
}

export function changeText(change: Change | undefined): { added?: string; removed?: string } {
  if (change === undefined) return {}
  return { added: change.added > 0 ? `+${change.added}` : undefined, removed: change.removed > 0 ? `−${change.removed}` : undefined }
}
