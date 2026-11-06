export type Progress = { done: number; active: number; total: number }

export const PROGRESS_CELLS = 10

export const FILLED = '▰'

export const EMPTY = '▱'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function readNote(output: unknown): string | undefined {
  const file = record(record(output).file)
  const lines = count(file.numLines)
  const total = count(file.totalLines)
  if (lines === undefined) return undefined
  return total !== undefined && total > lines ? `${lines} of ${plural(total, 'line')}` : plural(lines, 'line')
}

export function fetchNote(output: unknown): string | undefined {
  const result = record(output)
  const code = count(result.code)
  const bytes = count(result.bytes)
  const status = code === undefined || (code >= 200 && code < 300) ? undefined : String(code)
  const parts = [status, bytes === undefined ? undefined : size(bytes)].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function todoProgress(input: unknown): Progress | undefined {
  const todos = record(input).todos
  if (!Array.isArray(todos) || todos.length === 0) return undefined
  const status = (todo: unknown) => record(todo).status
  return { done: todos.filter(todo => status(todo) === 'completed').length, active: todos.filter(todo => status(todo) === 'in_progress').length, total: todos.length }
}

export function progressCells(progress: Progress): { filled: number; active: number; empty: number } {
  const cells = Math.min(progress.total, PROGRESS_CELLS)
  const scale = (n: number) => (progress.total === 0 ? 0 : Math.round((n / progress.total) * cells))
  const filled = scale(progress.done)
  const active = Math.min(cells - filled, Math.max(progress.active > 0 ? 1 : 0, scale(progress.active)))
  return { filled, active, empty: cells - filled - active }
}

export function progressCount(progress: Progress): string | undefined {
  return progress.total > PROGRESS_CELLS ? `${progress.done}/${progress.total}` : undefined
}
