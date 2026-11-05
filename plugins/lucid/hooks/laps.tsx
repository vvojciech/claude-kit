import type { RenderElement } from 'claude-code'

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

export function renderLap(draw: Draw, word: string, durationMs: number, endedAt: number | undefined, columns: number): RenderElement {
  const { Box, Text } = draw.kit
  const time = lapTime(durationMs)
  const plain = ` ${word} ${time} `
  const clock = endedAt === undefined || columns < cellWidth(plain) + TAIL + CLOCK_ROOM * 2 ? '' : ` · ${clockTime(endedAt)}`
  const label = ` ${word} ${time}${clock} `
  const lead = Math.max(0, columns - cellWidth(label) - TAIL)
  return (
    <Box flexDirection="row" marginTop={1} width={columns}>
      <Text wrap="truncate-end">
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
