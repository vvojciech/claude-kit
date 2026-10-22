import type { Elements, RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { Tone } from './palette'
import { GAP, GLYPH, overflowLabel } from './targets'
import type { Row, Target } from './targets'
import { cellWidth } from './width'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Press = (e: UiPressArgument) => void

export type Note = { label: string; press: Press }

export type Flash = { key: string; text: string; ok: boolean }

export type Marker = {
  scope: string
  row: Row
  tone: Tone
  partial: boolean
  besideLabel: boolean
  compact: boolean
  flash?: Flash
  note?: Note
  press: (target: Target) => Press
  more: (hidden: Target[]) => Press
}

export const PARTIAL = 'partial'

const EDGE = ' '

const LEAD = ' '.repeat(GAP)

const PANE_EDGE = 1

export const MARKER_ROOM = LEAD.length + EDGE.length + GLYPH.length + PANE_EDGE

export const STRIP_LEAD = GAP

export type Pointed = { color: string; backgroundColor: string; bold: true; underline: true }

export function pointedAt(tone: Tone): Pointed {
  return { color: tone.background, backgroundColor: tone.pointed, bold: true, underline: true }
}

export function stripLabels(marker: Pick<Marker, 'row' | 'partial' | 'note'>): string[] {
  const { shown, hidden } = marker.row
  const overflow = hidden.length > 0 ? [overflowLabel(hidden.length)] : []
  const note = marker.note ? [marker.note.label] : []
  return [...(marker.partial ? [PARTIAL] : []), ...shown.map(t => t.label), ...overflow, ...note]
}

export function keyOf(target: Target): string {
  return `copy-${target.name.replace(/\s+/g, '-')}`
}

function control(kit: Kit, tone: Tone, key: string, label: string, onPress: Press, color: string): RenderNode {
  const { Box, Button, Text } = kit
  return (
    <Box key={`hover-${key}`}>
      <Button key={key} plain label={label} onPress={onPress}>
        <Text color={color} hover={pointedAt(tone)}>
          {label}
        </Text>
      </Button>
    </Box>
  )
}

function controls(kit: Kit, marker: Marker): RenderNode[] {
  const { shown, hidden } = marker.row
  const { tone } = marker
  const chips = shown.map(t => control(kit, tone, keyOf(t), t.label, marker.press(t), tone.text))
  const overflow = hidden.length > 0 ? [control(kit, tone, 'copy-more', overflowLabel(hidden.length), marker.more(hidden), tone.muted)] : []
  const note = marker.note ? [control(kit, tone, 'copy-note', marker.note.label, marker.note.press, tone.muted)] : []
  const partial = marker.partial ? [<kit.Text key="partial" color={tone.muted}>{PARTIAL}</kit.Text>] : []
  return [...partial, ...chips, ...overflow, ...note]
}

function spaced(kit: Kit, nodes: RenderNode[]): RenderNode[] {
  return nodes.flatMap((node, i) => (i === 0 ? [node] : [<kit.Text key={`gap-${i}`}>{' '.repeat(GAP)}</kit.Text>, node]))
}

export const COPIED = '✓'

export const NOT_COPIED = '✗'

function glyph(kit: Kit, tone: Tone, key: string, shown: string = GLYPH): RenderNode {
  return (
    <kit.Text key={key} color={shown === GLYPH ? tone.muted : tone.text}>
      {shown}
      {EDGE}
    </kit.Text>
  )
}

function flashGlyph(flash: Flash | undefined): string {
  if (flash === undefined) return GLYPH
  return flash.ok ? COPIED : NOT_COPIED
}

function flashed(kit: Kit, marker: Marker): RenderNode[] {
  if (marker.flash === undefined || marker.besideLabel) return []
  return [<kit.Text key="flash" color={marker.tone.text}>{marker.flash.text}</kit.Text>, <kit.Text key="flash-gap">{LEAD}</kit.Text>]
}

function restingGlyph(marker: Marker): string {
  return marker.besideLabel ? flashGlyph(marker.flash) : GLYPH
}

export const COVER_KEY = 'copy-cover'

function onlyTarget(row: Row): Target | undefined {
  const all = [...row.shown, ...row.hidden]
  return all.length === 1 ? all[0] : undefined
}

function swallowed(): void {}

function cover(kit: Kit, marker: Marker): RenderNode {
  const { tone } = marker
  const shown = restingGlyph(marker)
  const only = onlyTarget(marker.row)
  return (
    <kit.Box key="cover" flexDirection="row">
      <kit.Button key={COVER_KEY} plain label={shown} onPress={only === undefined ? swallowed : marker.press(only)}>
        <kit.Text color={shown === GLYPH ? tone.muted : tone.text} hover={only === undefined ? undefined : pointedAt(tone)}>
          {shown}
        </kit.Text>
      </kit.Button>
      <kit.Text key="edge">{EDGE}</kit.Text>
    </kit.Box>
  )
}

function strip(kit: Kit, marker: Marker): RenderNode {
  const { Box, Text } = kit
  return (
    <Box position="absolute" right={0} top={0} height={1} flexDirection="row" display="none" hover={{ display: 'flex' }}>
      {marker.besideLabel ? (
        <Text key="strip-lead" backgroundColor={marker.tone.background}>
          {' '.repeat(STRIP_LEAD)}
        </Text>
      ) : null}
      {spaced(kit, controls(kit, marker))}
      <Text key="lead">{LEAD}</Text>
      {cover(kit, marker)}
    </Box>
  )
}

function compactGlyph(kit: Kit, marker: Marker): RenderNode {
  const { Box, Button, Text } = kit
  const { tone } = marker
  const shown = restingGlyph(marker)
  const [only] = marker.row.hidden
  const onPress = only !== undefined && marker.row.hidden.length === 1 ? marker.press(only) : marker.more(marker.row.hidden)
  return (
    <Box key="anchor" height={1} flexDirection="row">
      <Button key={COMPACT_KEY} plain label={compactLabel(marker.row)} onPress={onPress}>
        <Text color={shown === GLYPH ? tone.muted : tone.text} hover={pointedAt(tone)}>
          {shown}
        </Text>
      </Button>
      <Text key="edge">{EDGE}</Text>
    </Box>
  )
}

export const COMPACT_KEY = 'copy-compact'

export function compactLabel(row: Row): string {
  const [only] = row.hidden
  return only !== undefined && row.hidden.length === 1 ? only.label : `${GLYPH} ${overflowLabel(row.hidden.length)}`
}

function anchor(kit: Kit, marker: Marker): RenderNode {
  if (marker.compact) return compactGlyph(kit, marker)
  return (
    <kit.Box key="anchor" height={1} flexDirection="row">
      {flashed(kit, marker)}
      {glyph(kit, marker.tone, 'glyph', restingGlyph(marker))}
      {strip(kit, marker)}
    </kit.Box>
  )
}

export function replyMarker(kit: Kit, drawn: RenderElement, marker: Marker): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column">
      {drawn}
      <Box key={marker.scope} height={1} flexDirection="row" justifyContent="flex-end">
        {anchor(kit, marker)}
      </Box>
    </Box>
  )
}

const STOCK_SPACER = 1

function sumCells(nodes: readonly (RenderNode | readonly RenderNode[])[]): number | undefined {
  let cells = 0
  for (const node of nodes) {
    const step = cellsOf(node)
    if (step === undefined) return undefined
    cells += step
  }
  return cells
}

function boxCells(element: Extract<RenderElement, { type: 'Box' }>, children: readonly RenderNode[]): number | undefined {
  const inner = sumCells(element.props?.flexDirection === 'column' ? children.slice(0, 1) : children)
  const width = element.props?.width
  return typeof width === 'number' && inner !== undefined ? Math.max(width, inner) : inner
}

function isList(node: RenderNode | readonly RenderNode[] | undefined): node is readonly RenderNode[] {
  return Array.isArray(node)
}

function cellsOf(node: RenderNode | readonly RenderNode[] | undefined): number | undefined {
  if (isList(node)) return sumCells(node)
  if (typeof node === 'string') return cellWidth(node)
  if (typeof node !== 'object' || node === null) return 0
  if (node.type === 'engine') return undefined
  if (node.type !== 'Box' && node.type !== 'Text') return 0
  const children = (node as { children?: RenderNode[] }).children ?? []
  return node.type === 'Box' ? boxCells(node, children) : sumCells(children)
}

export function headWidth(drawn: RenderElement): number | undefined {
  return cellsOf(drawn)
}

export function headerRow(drawn: RenderElement): number {
  if (drawn.type === 'engine') return STOCK_SPACER
  const top = drawn.type === 'Box' ? drawn.props?.marginTop : undefined
  return typeof top === 'number' ? top : 0
}

export function toolMarker(kit: Kit, drawn: RenderElement, marker: Marker): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="row">
      <Box key="tool" flexDirection="column" flexGrow={1} flexShrink={1}>
        {drawn}
      </Box>
      <Box key={marker.scope} flexDirection="row" flexShrink={0} height={1} marginTop={headerRow(drawn)} paddingLeft={GAP}>
        {anchor(kit, marker)}
      </Box>
    </Box>
  )
}
