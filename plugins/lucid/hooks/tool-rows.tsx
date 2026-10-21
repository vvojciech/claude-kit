import type { RenderElement, RenderNode } from 'claude-code'

import type { Span } from './markdown'
import type { Palette } from './palette'
import { drawRuns, spanRuns } from './runs'
import type { Draw, Run } from './runs'
import { cellWidth } from './width'
import { fitMiddle } from './tools'
import type { ToolLine, ToolRow, ToolState } from './tools'

const GUTTER = 2

const STATE_LOOK: Record<ToolState, { glyph: string; role: keyof Palette; name: keyof Palette; label: keyof Palette }> = {
  pending: { glyph: '◌', role: 'muted', name: 'strong', label: 'strong' },
  running: { glyph: '◐', role: 'progress', name: 'strong', label: 'strong' },
  started: { glyph: '○', role: 'muted', name: 'muted', label: 'muted' },
  done: { glyph: '●', role: 'done', name: 'strong', label: 'strong' },
  failed: { glyph: '✗', role: 'error', name: 'strong', label: 'error' },
  rejected: { glyph: '⊘', role: 'muted', name: 'muted', label: 'muted' },
  interrupted: { glyph: '⊘', role: 'muted', name: 'muted', label: 'muted' },
}

const BRANCH = '  ⎿  '

const NOTE_GAP = '  '

const QUIET_STATES = new Set<ToolState>(['rejected', 'interrupted'])

const PREVIEW_LINES = 10

function noteWidth(note: string | undefined): number {
  return note ? cellWidth(NOTE_GAP + note) : 0
}

function detailRoom(columns: number, indent: number, label: string, note: string | undefined): number {
  return Math.max(0, columns - indent - cellWidth(label) - 1 - noteWidth(note))
}

function plainLinks(runs: Run[]): Run[] {
  return runs.map(run => (run.look.href === undefined ? run : { ...run, look: { ...run.look, underline: false } }))
}

function quietRuns(runs: Run[], color: string): Run[] {
  return runs.map(run => ({ ...run, look: { ...run.look, color, bold: false } }))
}

function inTextColor(runs: Run[], color: string): Run[] {
  return runs.map(run => (run.look.color === undefined ? { ...run, look: { ...run.look, color } } : run))
}

function toolDetail(draw: Draw, spans: Span[], room: number, quiet: boolean): RenderNode[] {
  const runs = inTextColor(plainLinks(spanRuns(fitMiddle(spans, room), draw.palette)), draw.palette.text)
  return drawRuns(draw, quiet ? quietRuns(runs, draw.palette.muted) : runs)
}

function toolText(draw: Draw, label: RenderNode, detail: Span[], note: string | undefined, room: number, quiet = false): RenderNode {
  const { Text } = draw.kit
  return (
    <Text wrap="truncate-end">
      {label}
      {detail.length > 0 ? ' ' : ''}
      {toolDetail(draw, detail, room, quiet)}
      {note ? <Text color={draw.palette.muted}>{NOTE_GAP + note}</Text> : null}
    </Text>
  )
}

function branch(draw: Draw, first: boolean, line: ToolLine, columns: number): RenderNode {
  const { Box, Text } = draw.kit
  const label = <Text color={draw.palette[STATE_LOOK[line.state ?? 'done'].label]}>{line.label}</Text>
  return (
    <Box flexDirection="row">
      <Box width={BRANCH.length} flexShrink={0}>
        <Text color={draw.palette.muted}>{first ? BRANCH : ' '.repeat(BRANCH.length)}</Text>
      </Box>
      {toolText(draw, label, line.detail, line.note, detailRoom(columns, BRANCH.length, line.label, line.note))}
    </Box>
  )
}

function stateGlyph({ kit, palette }: Draw, state: ToolState): RenderNode {
  const look = STATE_LOOK[state]
  return <kit.Text color={palette[look.role]}>{look.glyph}</kit.Text>
}

export function renderToolRow(draw: Draw, row: ToolRow, state: ToolState, columns: number): RenderElement {
  const { kit, palette } = draw
  const { Box, Text } = kit
  const look = STATE_LOOK[state]
  const name = (
    <Text bold color={palette[look.name]}>
      {row.name}
    </Text>
  )
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Box width={GUTTER} flexShrink={0}>
          {stateGlyph(draw, state)}
        </Box>
        {toolText(draw, name, row.detail, row.note, detailRoom(columns, GUTTER, row.name, row.note), QUIET_STATES.has(state))}
      </Box>
      {(row.lines ?? []).map((line, i) => branch(draw, i === 0, line, columns))}
    </Box>
  )
}

function contentLines(content: string): string[] {
  const lines = content.split('\n')
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines
}

function previewLine(draw: Draw, number: number, digits: number, text: string): RenderNode {
  const { Box, Text } = draw.kit
  return (
    <Box flexDirection="row" paddingLeft={BRANCH.length + 1}>
      <Text wrap="truncate-end">
        <Text color={draw.palette.muted}>{String(number).padStart(digits)} </Text>
        <Text color={draw.palette.text}>{text}</Text>
      </Text>
    </Box>
  )
}

export function renderFailure(draw: Draw, reason: ReadonlyArray<string>): RenderElement {
  const { Box, Text } = draw.kit
  const [first = '', ...rest] = reason
  const shown = rest.slice(0, PREVIEW_LINES - 1)
  const hidden = rest.length - shown.length
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={draw.palette.muted}>{BRANCH}</Text>
        <Text color={draw.palette.error}>{first}</Text>
      </Text>
      {shown.map((line, i) => (
        <Box key={String(i)} paddingLeft={BRANCH.length}>
          <Text wrap="truncate-end" color={draw.palette.muted}>
            {line}
          </Text>
        </Box>
      ))}
      {hidden > 0 ? (
        <Box paddingLeft={BRANCH.length}>
          <Text color={draw.palette.muted}>
            … +{hidden} line{hidden === 1 ? '' : 's'} (ctrl+o to expand)
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

export function renderWrittenFile(draw: Draw, content: string): RenderElement {
  const { Box, Text } = draw.kit
  const lines = contentLines(content)
  const shown = lines.slice(0, PREVIEW_LINES)
  const digits = String(shown.length).length
  const hidden = lines.length - shown.length
  return (
    <Box flexDirection="column">
      <Text color={draw.palette.muted}>
        {BRANCH}
        {lines.length} line{lines.length === 1 ? '' : 's'}
      </Text>
      {shown.map((text, i) => previewLine(draw, i + 1, digits, text))}
      {hidden > 0 ? (
        <Box paddingLeft={BRANCH.length + 1}>
          <Text color={draw.palette.muted}>
            … +{hidden} line{hidden === 1 ? '' : 's'} (ctrl+o to expand)
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
