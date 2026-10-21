import type { RenderNode } from 'claude-code'

import type { Span } from './markdown'
import type { Palette } from './palette'
import { inline, spansText } from './runs'
import type { Draw, Look } from './runs'
import { cellWidth } from './width'

export const TITLE_RULE = '━'

function headingLook(level: number, palette: Palette): Look {
  if (level === 1) return { color: palette.strong, bold: true, underline: true }
  if (level === 2) return { color: palette.text, bold: true, underline: true }
  if (level === 3) return { color: palette.muted, bold: true }
  return { color: palette.muted }
}

export function titleRuleCells(spans: Span[], width: number): number {
  const longest = Math.max(0, ...spansText(spans).split('\n').map(cellWidth))
  return Math.max(1, Math.min(width, longest))
}

function titleRule(draw: Draw, spans: Span[], width: number): RenderNode {
  return <draw.kit.Text color={draw.palette.faint}>{TITLE_RULE.repeat(titleRuleCells(spans, width))}</draw.kit.Text>
}

export function heading(draw: Draw, level: number, spans: Span[], width: number): RenderNode {
  const look = headingLook(level, draw.palette)
  const title = (
    <draw.kit.Text color={look.color} bold={look.bold} underline={look.underline}>
      {inline(draw, spans)}
    </draw.kit.Text>
  )
  if (level !== 1) return title
  return (
    <draw.kit.Box flexDirection="column">
      {title}
      {titleRule(draw, spans, width)}
    </draw.kit.Box>
  )
}
