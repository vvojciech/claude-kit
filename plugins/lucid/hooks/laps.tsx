import type { RenderElement, RenderNode } from 'claude-code'

import type { Draw } from './runs'
import { cellWidth } from './width'

const TAIL = 4

export const LAP_RULE = '┈'

const CLOCK_ROOM = 8

export function lapTime(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function clockTime(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export type LapTally = { files: number; added: number; removed: number; commands: number; reads: number; failed: number }

type Chip = { glyph: string; value: string; color?: keyof Draw['palette'] }

export function emptyTally(): LapTally {
  return { files: 0, added: 0, removed: 0, commands: 0, reads: 0, failed: 0 }
}

export function tallyChips(tally: LapTally | undefined): Chip[][] {
  if (tally === undefined) return []
  const chips: Chip[][] = []
  if (tally.files > 0) {
    const edit: Chip[] = [{ glyph: '✎', value: String(tally.files) }]
    if (tally.added > 0) edit.push({ glyph: '', value: `+${tally.added}`, color: 'added' })
    if (tally.removed > 0) edit.push({ glyph: '', value: `−${tally.removed}`, color: 'removed' })
    chips.push(edit)
  }
  if (tally.commands > 0) chips.push([{ glyph: '$', value: String(tally.commands) }])
  if (tally.reads > 0) chips.push([{ glyph: '≡', value: String(tally.reads) }])
  if (tally.failed > 0) chips.push([{ glyph: '✗', value: String(tally.failed), color: 'error' }])
  return chips
}

function chipsText(chips: Chip[][]): string {
  return chips.map(group => group.map(chip => (chip.glyph ? `${chip.glyph} ${chip.value}` : chip.value)).join(' ')).join(CHIP_GAP)
}

const CHIP_GAP = '  '

function drawChips(draw: Draw, chips: Chip[][]): RenderNode[] {
  const { Text } = draw.kit
  return chips.flatMap((group, i) => [
    i > 0 ? CHIP_GAP : '',
    ...group.map((chip, j) => (
      <Text key={`${i}-${j}`} color={draw.palette[chip.color ?? 'muted']}>
        {j > 0 ? ' ' : ''}
        {chip.glyph ? `${chip.glyph} ` : ''}
        {chip.value}
      </Text>
    )),
  ])
}

export function renderLap(draw: Draw, word: string, durationMs: number, endedAt: number | undefined, columns: number, tally?: LapTally): RenderElement {
  const { Box, Text } = draw.kit
  const time = lapTime(durationMs)
  const plain = ` ${word} ${time} `
  const clock = endedAt === undefined || columns < cellWidth(plain) + TAIL + CLOCK_ROOM * 2 ? '' : ` · ${clockTime(endedAt)}`
  const label = ` ${word} ${time}${clock} `
  const chips = tallyChips(tally)
  const summary = chips.length > 0 && columns >= cellWidth(label) + TAIL + cellWidth(chipsText(chips)) + CLOCK_ROOM * 2 ? chips : []
  const summaryCells = summary.length > 0 ? cellWidth(chipsText(summary)) + 1 : 0
  const lead = Math.max(0, columns - cellWidth(label) - TAIL - summaryCells)
  return (
    <Box flexDirection="row" marginTop={1} width={columns}>
      <Text wrap="truncate-end">
        {summary.length > 0 ? drawChips(draw, summary) : null}
        {summary.length > 0 ? ' ' : ''}
        <Text color={draw.palette.faint}>{LAP_RULE.repeat(lead)}</Text>
        <Text color={draw.palette.muted}> {word} </Text>
        <Text bold color={draw.palette.strong}>
          {time}
        </Text>
        {clock ? <Text color={draw.palette.muted}>{clock}</Text> : null}
        <Text color={draw.palette.faint}> {LAP_RULE.repeat(TAIL)}</Text>
      </Text>
    </Box>
  )
}
