export const COLUMN_GAP = 2

const NARROWEST_TEXT_COLUMN = 6

const UNBROKEN_WORD = 20

export type Column = { natural: number; numeric: boolean; word?: number }

function narrowest(column: Column): number {
  if (column.numeric) return column.natural
  return Math.max(Math.min(column.natural, NARROWEST_TEXT_COLUMN), Math.min(column.word ?? 0, UNBROKEN_WORD))
}

function widestShrinkable(columns: readonly Column[], widths: number[]): number {
  let widest = -1
  widths.forEach((width, i) => {
    const column = columns[i]
    if (!column || width <= narrowest(column)) return
    if (widest === -1 || width > (widths[widest] ?? 0)) widest = i
  })
  return widest
}

export function gridWidths(columns: readonly Column[], available: number): number[] | undefined {
  const gaps = COLUMN_GAP * Math.max(0, columns.length - 1)
  if (columns.reduce((sum, column) => sum + narrowest(column), gaps) > available) return undefined
  const widths = columns.map(column => column.natural)
  let total = widths.reduce((sum, width) => sum + width, gaps)
  while (total > available) {
    const widest = widestShrinkable(columns, widths)
    widths[widest] = (widths[widest] ?? 0) - 1
    total--
  }
  return widths
}

export function padding(room: number, align: 'left' | 'right' | 'center'): [number, number] {
  const free = Math.max(0, room)
  if (align === 'right') return [free, 0]
  if (align === 'center') return [Math.floor(free / 2), Math.ceil(free / 2)]
  return [0, free]
}
