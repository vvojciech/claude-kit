import type { RenderNode } from 'claude-code'

import type { Span } from './markdown'
import type { Palette } from './palette'
import { inline } from './runs'
import type { Draw, Look } from './runs'

export function headingLook(level: number, palette: Palette): Look {
  if (level === 1) return { color: palette.strong, bold: true, underline: true }
  if (level === 2) return { color: palette.strong, bold: true }
  if (level === 3) return { color: palette.muted, bold: true }
  return { color: palette.muted }
}

export function heading(draw: Draw, level: number, spans: Span[]): RenderNode {
  const look = headingLook(level, draw.palette)
  return (
    <draw.kit.Text color={look.color} bold={look.bold} underline={look.underline}>
      {inline(draw, spans)}
    </draw.kit.Text>
  )
}
