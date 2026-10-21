const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

const EMOJI_VARIATION = '️'

const KEYCAP = '⃣'

const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b2ff],
  [0x1f200, 0x1f2ff],
  [0x20000, 0x3fffd],
]

function isEastAsianWide(code: number): boolean {
  return WIDE_RANGES.some(([low, high]) => code >= low && code <= high)
}

function isEmoji(cluster: string): boolean {
  if (EMOJI_PRESENTATION.test(cluster) || cluster.includes(KEYCAP)) return true
  return cluster.includes(EMOJI_VARIATION) && PICTOGRAPHIC.test(cluster)
}

function clusterWidth(cluster: string): number {
  if (ZERO_WIDTH.test(cluster)) return 0
  if (isEmoji(cluster)) return 2
  return isEastAsianWide(cluster.codePointAt(0) ?? 0) ? 2 : 1
}

export function cellWidth(text: string): number {
  let width = 0
  for (const { segment } of GRAPHEMES.segment(text)) width += clusterWidth(segment)
  return width
}

export const ELLIPSIS = '…'

function clusters(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment)
}

export function sliceCells(text: string, budget: number, fromEnd = false): string {
  const ordered = fromEnd ? clusters(text).reverse() : clusters(text)
  const kept: string[] = []
  let used = 0
  for (const cluster of ordered) {
    used += clusterWidth(cluster)
    if (used > budget) break
    kept.push(cluster)
  }
  return (fromEnd ? kept.reverse() : kept).join('')
}

export function clipCells(text: string, cells: number): string {
  if (cellWidth(text) <= cells) return text
  return sliceCells(text, cells - 1) + ELLIPSIS
}

export function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}
