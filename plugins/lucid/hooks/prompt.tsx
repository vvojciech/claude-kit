import type { RenderElement, RenderNode } from 'claude-code'

import type { Draw } from './runs'
import { cellWidth, clipCells, firstLine } from './width'

const PASTE = /<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g

const PREVIEW_CELLS = 60

const PROMPT_CHROME = 3

type PromptPart = { text: string; isPaste: boolean; preview?: string }

function pasteLabel(body: string): string {
  const lines = body.split('\n').length
  return `[pasted ${lines} line${lines === 1 ? '' : 's'}]`
}

export function collapsePastes(text: string): PromptPart[] {
  const parts: PromptPart[] = []
  let last = 0
  for (const match of text.matchAll(PASTE)) {
    const index = match.index ?? 0
    const before = text.slice(last, index).trim()
    if (before !== '') parts.push({ text: before + ' ', isPaste: false })
    const body = (match[1] ?? '').trim()
    parts.push({ text: pasteLabel(body), isPaste: true, preview: firstLine(body) || undefined })
    last = index + match[0].length
  }
  const after = text.slice(last).trim()
  if (after !== '') parts.push({ text: (parts.length > 0 ? ' ' : '') + after, isPaste: false })
  return parts
}

function promptPart(draw: Draw, part: PromptPart, onlyPart: boolean, width: number): RenderNode {
  const { Text } = draw.kit
  if (!part.isPaste) return part.text
  const room = Math.min(PREVIEW_CELLS, width - PROMPT_CHROME - cellWidth(part.text) - 1)
  const preview = onlyPart && part.preview && room > 1 ? ` ${clipCells(part.preview, room)}` : ''
  return (
    <Text>
      <Text color={draw.palette.muted}>{part.text}</Text>
      {preview}
    </Text>
  )
}

export function renderPrompt(draw: Draw, text: string, columns: number): RenderElement {
  const { kit, palette } = draw
  const { Box, Text } = kit
  const parts = collapsePastes(text)
  return (
    <Box flexDirection="row" marginTop={1} width={columns}>
      <Box width={1} flexShrink={0} backgroundColor={palette.accent} />
      <Box flexGrow={1} backgroundColor={palette.panel} paddingX={1}>
        <Text color={palette.strong}>{parts.map(part => promptPart(draw, part, parts.length === 1, columns))}</Text>
      </Box>
    </Box>
  )
}
