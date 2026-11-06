import type { RenderElement, RenderNode } from 'claude-code'

import type { Span } from './markdown'
import type { Palette } from './palette'
import { drawRuns, spanRuns } from './runs'
import type { Draw, Run } from './runs'
import { changeText } from './changes'
import type { Change } from './changes'
import { toolGlyph } from './glyphs'
import { EMPTY, FILLED, progressCells, progressCount } from './metrics'
import type { Progress } from './metrics'
import { cellWidth } from './width'
import { fitMiddle } from './tools'
import type { ToolLine, ToolRow, ToolState } from './tools'

const GUTTER = 2

const KIND_SLOT = 2

const STATE_LOOK: Record<ToolState, { glyph: string; role: keyof Palette; name: keyof Palette; label: keyof Palette }> = {
  pending: { glyph: '◌', role: 'muted', name: 'strong', label: 'strong' },
  running: { glyph: '◐', role: 'progress', name: 'strong', label: 'strong' },
  started: { glyph: '○', role: 'muted', name: 'muted', label: 'muted' },
  done: { glyph: '●', role: 'done', name: 'strong', label: 'strong' },
  failed: { glyph: '✗', role: 'error', name: 'strong', label: 'error' },
  rejected: { glyph: '⊘', role: 'muted', name: 'muted', label: 'muted' },
  interrupted: { glyph: '⊘', role: 'muted', name: 'muted', label: 'muted' },
  cancelled: { glyph: '⊘', role: 'muted', name: 'muted', label: 'muted' },
}

const BRANCH = '  ⎿  '

const NOTE_GAP = '  '

const QUIET_STATES = new Set<ToolState>(['rejected', 'interrupted', 'cancelled'])

const PREVIEW_LINES = 10

function noteWidth(note: string | undefined, change?: Change): number {
  const { added, removed } = changeText(change)
  const counts = [added, removed].filter(Boolean).map(text => cellWidth(` ${text}`)).reduce((sum, cells) => sum + cells, 0)
  return (note ? cellWidth(NOTE_GAP + note) : 0) + counts
}

function detailRoom(columns: number, indent: number, label: string, note: string | undefined, change?: Change): number {
  return Math.max(0, columns - indent - cellWidth(label) - 1 - noteWidth(note, change))
}

function progressWidth(progress: Progress | undefined): number {
  if (progress === undefined) return 0
  const { filled, active, empty } = progressCells(progress)
  const count = progressCount(progress)
  return 1 + filled + active + empty + (count ? cellWidth(` ${count}`) : 0)
}

function progressBar(draw: Draw, progress: Progress | undefined): RenderNode | null {
  if (progress === undefined) return null
  const { filled, active, empty } = progressCells(progress)
  const count = progressCount(progress)
  const { Text } = draw.kit
  return (
    <Text>
      {' '}
      <Text color={draw.palette.done}>{FILLED.repeat(filled)}</Text>
      <Text color={draw.palette.progress}>{FILLED.repeat(active)}</Text>
      <Text color={draw.palette.faint}>{EMPTY.repeat(empty)}</Text>
      {count ? <Text color={draw.palette.muted}> {count}</Text> : null}
    </Text>
  )
}

function changeCounts(draw: Draw, change: Change | undefined): RenderNode | null {
  const { added, removed } = changeText(change)
  if (added === undefined && removed === undefined) return null
  const { Text } = draw.kit
  return (
    <Text>
      {added ? <Text color={draw.palette.added}> {added}</Text> : null}
      {removed ? <Text color={draw.palette.removed}> {removed}</Text> : null}
    </Text>
  )
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

function toolText(draw: Draw, label: RenderNode, detail: Span[], note: string | undefined, room: number, quiet = false, change?: Change, progress?: Progress): RenderNode {
  const { Text } = draw.kit
  return (
    <Text wrap="truncate-end">
      {label}
      {detail.length > 0 ? ' ' : ''}
      {progressBar(draw, progress)}
      {toolDetail(draw, detail, room, quiet)}
      {changeCounts(draw, change)}
      {note ? <Text color={draw.palette.muted}>{NOTE_GAP + note}</Text> : null}
    </Text>
  )
}

function kindSlot(draw: Draw, state: ToolState, tool: string | undefined, key: string): RenderNode | null {
  const glyph = toolGlyph(tool)
  if (glyph === undefined && state !== 'running') return null
  const { Box, Text } = draw.kit
  return (
    <Box width={KIND_SLOT} flexShrink={0}>
      {state === 'running' ? stateGlyph(draw, state, key) : state === 'failed' ? <Text color={draw.palette.error}>{STATE_LOOK.failed.glyph}</Text> : <Text color={draw.palette.muted}>{glyph}</Text>}
    </Box>
  )
}

function slotWidth(state: ToolState, tool: string | undefined): number {
  return toolGlyph(tool) === undefined && state !== 'running' ? 0 : KIND_SLOT
}

function branch(draw: Draw, index: number, line: ToolLine, columns: number): RenderNode {
  const { Box, Text } = draw.kit
  const state = line.state ?? 'done'
  const label = <Text color={draw.palette[STATE_LOOK[state].label]}>{line.label}</Text>
  const indent = BRANCH.length + slotWidth(state, line.tool)
  const row = (
    <Box flexDirection="row">
      <Box width={BRANCH.length} flexShrink={0}>
        <Text color={draw.palette.muted}>{index === 0 ? BRANCH : ' '.repeat(BRANCH.length)}</Text>
      </Box>
      {kindSlot(draw, state, line.tool, `running-${index}`)}
      {toolText(draw, label, line.detail, line.note, detailRoom(columns, indent, line.label, line.note, line.change), QUIET_STATES.has(state), line.change)}
    </Box>
  )
  return line.tail ? (
    <Box flexDirection="column">
      {row}
      {tailLine(draw, line.tail, BRANCH.length + KIND_SLOT)}
    </Box>
  ) : (
    row
  )
}

export const RUNNING_FRAMES = ['◐', '◓', '◑', '◒']

const RUNNING_FRAME_MS = 150

export const SETTLE_FLASH_MS = 250

const SETTLE_FLASH: Partial<Record<ToolState, string>> = { done: '◉', failed: '◉' }

export type RowMotion = { settling?: boolean }

function stateGlyph({ kit, palette }: Draw, state: ToolState, key = 'running', motion: RowMotion = {}): RenderNode {
  const look = STATE_LOOK[state]
  const color = palette[look.role]
  const flash = SETTLE_FLASH[state]
  if (motion.settling && flash !== undefined && kit.Client) return <kit.Client key="settle" module="./settle.tsx" width={1} props={{ flash, flashColor: palette.strong, glyph: look.glyph, color, ms: SETTLE_FLASH_MS }} />
  if (state === 'running' && kit.Client) return <kit.Client key={key} module="./spinner.tsx" width={1} props={{ frames: RUNNING_FRAMES, color, ms: RUNNING_FRAME_MS }} />
  return <kit.Text color={color}>{look.glyph}</kit.Text>
}

export const TAIL_MARK = '↳'

function tailLine(draw: Draw, tail: string, indent = GUTTER + KIND_SLOT): RenderNode {
  const { Box, Text } = draw.kit
  return (
    <Box paddingLeft={indent}>
      <Text wrap="truncate-end" color={draw.palette.faint}>
        {TAIL_MARK} {tail}
      </Text>
    </Box>
  )
}

export function renderToolRow(draw: Draw, row: ToolRow, state: ToolState, columns: number, motion: RowMotion = {}): RenderElement {
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
          {stateGlyph(draw, state, 'running', motion)}
        </Box>
        {kindSlot(draw, 'done', row.tool, 'kind')}
        {toolText(draw, name, row.detail, row.note, detailRoom(columns, GUTTER + (row.tool !== undefined ? KIND_SLOT : 0) + progressWidth(row.progress), row.name, row.note, row.change), QUIET_STATES.has(state), row.change, row.progress)}
      </Box>
      {(row.lines ?? []).map((line, i) => branch(draw, i, line, columns))}
      {row.tail ? tailLine(draw, row.tail) : null}
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
