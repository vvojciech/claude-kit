import type { Elements, RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { Tone } from './palette'
import { GAP, GLYPH, overflowLabel } from './targets'
import type { Row, Target } from './targets'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Press = (e: UiPressArgument) => void

export type Note = { label: string; press: Press }

export type Marker = {
  scope: string
  row: Row
  tone: Tone
  partial: boolean
  note?: Note
  press: (target: Target) => Press
  more: (hidden: Target[]) => Press
}

export const PARTIAL = 'partial'

const EDGE = ' '

export const MARKER_ROOM = 2 * EDGE.length + GLYPH.length + 1

export function keyOf(target: Target): string {
  return `copy-${target.name.replace(/\s+/g, '-')}`
}

function control(kit: Kit, tone: Tone, key: string, label: string, onPress: Press, color: string): RenderNode {
  const { Box, Button, Text } = kit
  return (
    <Box key={key}>
      <Button key={key} plain label={label} onPress={onPress}>
        <Text color={color} hover={{ color: tone.accent, underline: true }}>
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

function strip(kit: Kit, marker: Marker): RenderNode {
  const { Box, Text } = kit
  return (
    <Box position="absolute" right={1} top={0} height={1} flexDirection="row" display="none" hover={{ display: 'flex' }}>
      <Text key="lead">{EDGE}</Text>
      {spaced(kit, controls(kit, marker))}
      <Text key="trail">{EDGE}</Text>
    </Box>
  )
}

export function copyMarker(kit: Kit, drawn: RenderElement, marker: Marker): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" alignSelf="flex-start">
      {drawn}
      <Box key={marker.scope} position="absolute" right={0} top={0} width={1} height={1}>
        <Text color={marker.tone.muted}>{GLYPH}</Text>
        {strip(kit, marker)}
      </Box>
    </Box>
  )
}
