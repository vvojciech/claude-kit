import type { RenderNode } from 'claude-code'

import { isNumeric, spansWidth } from './markdown'
import type { Block, Span } from './markdown'
import { appendRun, drawRuns, gapRows, inline, spanRuns, spansText, wrappedRows } from './runs'
import type { Draw, Run } from './runs'
import { COLUMN_GAP, gridWidths, padding } from './table'
import { cellWidth } from './width'

type Align = 'left' | 'right' | 'center'

const JUSTIFY = { left: 'flex-start', right: 'flex-end', center: 'center' } as const

function longestWord(cell: Span[]): number {
  return Math.max(0, ...spansText(cell).split(/\s+/).map(cellWidth))
}

function isNumericColumn(rows: Span[][][], i: number): boolean {
  return rows.length > 0 && rows.every(r => (r[i] ?? []).length === 0 || isNumeric(spansText(r[i] ?? [])))
}

function columnAlign(declared: Align | undefined, rows: Span[][][], i: number): Align {
  if (declared) return declared
  return isNumericColumn(rows, i) ? 'right' : 'left'
}

function gridLine(draw: Draw, cells: Span[][], widths: number[], align: Align[], header: boolean): RenderNode {
  const { kit, palette } = draw
  const runs: Run[] = []
  cells.forEach((cell, i) => {
    const [before, after] = padding((widths[i] ?? 0) - spansWidth(cell), align[i] ?? 'left')
    appendRun(runs, ' '.repeat(before), {})
    spanRuns(cell, palette, runs, true)
    if (i < cells.length - 1) appendRun(runs, ' '.repeat(after + COLUMN_GAP), {})
  })
  return (
    <kit.Text color={header ? palette.strong : palette.text} bold={header}>
      {drawRuns(draw, runs)}
    </kit.Text>
  )
}

function gridBoxes(draw: Draw, cells: Span[][], widths: number[], align: Align[], header: boolean): RenderNode {
  const { kit, palette } = draw
  return (
    <kit.Box flexDirection="row">
      {cells.map((cell, i) => (
        <kit.Box width={widths[i]} marginRight={i < cells.length - 1 ? COLUMN_GAP : 0} justifyContent={JUSTIFY[align[i] ?? 'left']} flexShrink={0}>
          <kit.Text color={header ? palette.strong : palette.text} bold={header}>
            {inline(draw, cell)}
          </kit.Text>
        </kit.Box>
      ))}
    </kit.Box>
  )
}

function gridRow(draw: Draw, cells: Span[][], widths: number[], align: Align[], header: boolean): RenderNode {
  const fits = cells.every((cell, i) => !spansText(cell).includes('\n') && spansWidth(cell) <= (widths[i] ?? 0))
  return fits ? gridLine(draw, cells, widths, align, header) : gridBoxes(draw, cells, widths, align, header)
}

function stackedTable(draw: Draw, head: Span[][], rows: Span[][][]): RenderNode {
  const { kit, palette } = draw
  return (
    <kit.Box flexDirection="column">
      {rows.map((row, r) => (
        <kit.Box flexDirection="column" marginTop={r > 0 ? 1 : 0}>
          {row.map((cell, i) => (
            <kit.Text color={palette.text}>
              <kit.Text color={palette.muted}>{`${spansText(head[i] ?? [])}: `}</kit.Text>
              {inline(draw, cell)}
            </kit.Text>
          ))}
        </kit.Box>
      ))}
    </kit.Box>
  )
}

function headerRule(head: Span[][], widths: number[], align: Align[]): string {
  return widths
    .map((width, i) => {
      const length = Math.max(1, Math.min(width, spansWidth(head[i] ?? [])))
      const [before, after] = padding(width - length, align[i] ?? 'left')
      return ' '.repeat(before) + '─'.repeat(length) + (i < widths.length - 1 ? ' '.repeat(after) : '')
    })
    .join(' '.repeat(COLUMN_GAP))
}

export function table(draw: Draw, t: Extract<Block, { kind: 'table' }>, width: number): RenderNode {
  const { kit, palette } = draw
  const count = t.header.length
  const head = t.header.map(cell => cell.map(span => ({ ...span, bold: true })))
  const rows: Span[][][] = t.rows.map(row => Array.from({ length: count }, (_, i) => row[i] ?? []))
  const columns = Array.from({ length: count }, (_, i) => ({
    natural: Math.max(spansWidth(head[i] ?? []), ...rows.map(r => spansWidth(r[i] ?? []))),
    numeric: isNumericColumn(rows, i),
    word: Math.max(longestWord(head[i] ?? []), ...rows.map(r => longestWord(r[i] ?? []))),
  }))
  const widths = gridWidths(columns, width)
  if (!widths) return stackedTable(draw, t.header, rows)
  const align = Array.from({ length: count }, (_, i) => columnAlign(t.align[i], rows, i))
  return (
    <kit.Box flexDirection="column">
      {gridRow(draw, head, widths, align, true)}
      <kit.Text color={palette.faint}>{headerRule(head, widths, align)}</kit.Text>
      {rows.map(r => gridRow(draw, r, widths, align, false))}
    </kit.Box>
  )
}

export function tableRows(t: Extract<Block, { kind: 'table' }>, width: number): number {
  const cells = (row: Span[][]) => row.reduce((rows, cell, i) => rows + wrappedRows(`${spansText(t.header[i] ?? [])}: ${spansText(cell)}`, width), 0)
  return 2 + cells(t.header) + t.rows.reduce((rows, row) => rows + cells(row), 0) + gapRows(t.rows.length, 1)
}
