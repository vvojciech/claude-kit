import type { Elements, RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { Tone } from './palette'
import { GAP, GLYPH, overflowLabel } from './targets'
import type { Row, Target } from './targets'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Press = (e: UiPressArgument) => void

export type Note = { label: string; press: Press }

export type Flash = { key: string; text: string }

export type Marker = {
  scope: string
  row: Row
  tone: Tone
  partial: boolean
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

function chipLabel(marker: Pick<Marker, 'flash'>, target: Target): string {
  return marker.flash?.key === keyOf(target) ? marker.flash.text : target.label
}

function controls(kit: Kit, marker: Marker): RenderNode[] {
  const { shown, hidden } = marker.row
  const { tone } = marker
  const chips = shown.map(t => control(kit, tone, keyOf(t), chipLabel(marker, t), marker.press(t), tone.text))
  const overflow = hidden.length > 0 ? [control(kit, tone, 'copy-more', overflowLabel(hidden.length), marker.more(hidden), tone.muted)] : []
  const note = marker.note ? [control(kit, tone, 'copy-note', marker.note.label, marker.note.press, tone.muted)] : []
  const partial = marker.partial ? [<kit.Text key="partial" color={tone.muted}>{PARTIAL}</kit.Text>] : []
  return [...partial, ...chips, ...overflow, ...note]
}

function spaced(kit: Kit, nodes: RenderNode[]): RenderNode[] {
  return nodes.flatMap((node, i) => (i === 0 ? [node] : [<kit.Text key={`gap-${i}`}>{' '.repeat(GAP)}</kit.Text>, node]))
}

function glyph(kit: Kit, tone: Tone, key: string): RenderNode {
  return (
    <kit.Text key={key} color={tone.muted}>
      {GLYPH}
      {EDGE}
    </kit.Text>
  )
}

function flashed(kit: Kit, marker: Marker): RenderNode[] {
  return marker.flash === undefined ? [] : [<kit.Text key="flash" color={marker.tone.text}>{marker.flash.text}</kit.Text>]
}

function strip(kit: Kit, marker: Marker): RenderNode {
  const { Box, Text } = kit
  return (
    <Box position="absolute" right={0} top={0} height={1} flexDirection="row" display="none" hover={{ display: 'flex' }}>
      {spaced(kit, controls(kit, marker))}
      <Text key="lead">{LEAD}</Text>
      {glyph(kit, marker.tone, 'cover')}
    </Box>
  )
}

function anchor(kit: Kit, marker: Marker): RenderNode {
  return (
    <kit.Box key="anchor" height={1} flexDirection="row">
      {flashed(kit, marker)}
      {marker.flash === undefined ? null : <kit.Text key="flash-gap">{LEAD}</kit.Text>}
      {glyph(kit, marker.tone, 'glyph')}
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
