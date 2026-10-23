import type { Size } from './png'

export const THUMB_ROWS = 8

export const BAND_ROWS = 3

export const MAX_COLUMNS = 48

const CELL_ASPECT = 2

export type Cells = { columns: number; rows: number }

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function fitCells(size: Size, maxRows: number, maxColumns: number): Cells {
  const ratio = size.width / size.height
  const rows = clamp(Math.min(maxRows, Math.ceil(size.height / 16)), 1, 255)
  const wanted = Math.round(rows * ratio * CELL_ASPECT)
  if (wanted <= maxColumns) return { columns: clamp(wanted, 1, 255), rows }
  const columns = clamp(maxColumns, 1, 255)
  return { columns, rows: clamp(Math.round(columns / ratio / CELL_ASPECT), 1, rows) }
}
