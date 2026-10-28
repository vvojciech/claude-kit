import type { Elements, RenderElement, RenderNode, UiPressArgument } from 'claude-code'

import type { Tone } from './palette'
import { menuLine } from './menu'
import type { Opening } from './menu'
import { GAP, GLYPH, overflowLabel } from './targets'
import type { Row, Target } from './targets'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Press = (e: UiPressArgument) => void

export type Note = { label: string; press: Press }

export type Flash = { key: string; text: string; ok: boolean }

export type Marker = {
  scope: string
  row: Row
  tone: Tone
  partial: boolean
  flashOnGlyph: boolean
  opening: Opening
  width: number
  flash?: Flash
  note?: Note
  press: (target: Target) => Press
  more: (hidden: Target[]) => Press
}

export const PARTIAL = 'partial'

const EDGE = ' '

export type Pointed = { color: string; backgroundColor: string; bold: true; underline: true }

export function pointedAt(tone: Tone): Pointed {
  return { color: tone.background, backgroundColor: tone.pointed, bold: true, underline: true }
}

export function menuLabels(marker: Pick<Marker, 'row' | 'partial' | 'note'>): string[] {
  const { shown, hidden } = marker.row
  const overflow = hidden.length > 0 ? [overflowLabel(hidden.length)] : []
  const note = marker.note ? [marker.note.label] : []
  return [...(marker.partial ? [PARTIAL] : []), ...shown.map(t => t.label), ...overflow, ...note]
}

export function keyOf(target: Target): string {
  return `copy-${target.name.replace(/[%\s]/g, encodeURIComponent)}`
}

function item(kit: Kit, marker: Marker, key: string, label: string, onPress: Press, color: string): RenderNode {
  const { Box, Button, Text } = kit
  const { tone, width } = marker
  return (
    <Box key={`hover-${key}`} width={width} height={1}>
      <Button key={key} plain label={label} onPress={onPress}>
        <Text color={color} wrap="truncate-end" hover={pointedAt(tone)}>
          {menuLine(label, width)}
        </Text>
      </Button>
    </Box>
  )
}

function partialItem(kit: Kit, marker: Marker): RenderNode[] {
  if (!marker.partial) return []
  return [
    <kit.Text key="partial" color={marker.tone.muted} wrap="truncate-end">
      {menuLine(PARTIAL, marker.width)}
    </kit.Text>,
  ]
}

function items(kit: Kit, marker: Marker): RenderNode[] {
  const { shown, hidden } = marker.row
  const { tone } = marker
  const chips = shown.map(t => item(kit, marker, keyOf(t), t.label, marker.press(t), tone.text))
  const overflow = hidden.length > 0 ? [item(kit, marker, MORE_KEY, overflowLabel(hidden.length), marker.more(hidden), tone.muted)] : []
  const note = marker.note ? [item(kit, marker, NOTE_KEY, marker.note.label, marker.note.press, tone.muted)] : []
  return [...partialItem(kit, marker), ...chips, ...overflow, ...note]
}

export const MORE_KEY = 'menu-more'

export const NOTE_KEY = 'menu-note'

export const MENU_KEY = 'menu'

export const HIT_X = 2

export const HIT_Y = 1

function edge(opening: Opening): { top: number } | { bottom: number } {
  return opening === 'up' ? { bottom: 0 } : { top: 0 }
}

function menu(kit: Kit, marker: Marker): RenderNode {
  return (
    <kit.Box
      key={MENU_KEY}
      position="absolute"
      right={-HIT_X}
      {...edge(marker.opening)}
      paddingX={HIT_X}
      paddingY={HIT_Y}
      flexDirection="column"
      display="none"
      hover={{ display: 'flex', scope: marker.scope }}
    >
      {items(kit, marker)}
    </kit.Box>
  )
}

export const COPIED = '✓'

export const NOT_COPIED = '✗'

function flashGlyph(flash: Flash | undefined): string {
  if (flash === undefined) return GLYPH
  return flash.ok ? COPIED : NOT_COPIED
}

function flashed(kit: Kit, marker: Marker): RenderNode[] {
  if (marker.flash === undefined || marker.flashOnGlyph) return []
  return [<kit.Text key="flash" color={marker.tone.text}>{marker.flash.text}</kit.Text>, <kit.Text key="flash-gap">{' '.repeat(GAP)}</kit.Text>]
}

function restingGlyph(marker: Marker): string {
  return marker.flashOnGlyph ? flashGlyph(marker.flash) : GLYPH
}

export const COVER_KEY = 'menu-cover'

function onlyTarget(row: Row): Target | undefined {
  const all = [...row.shown, ...row.hidden]
  return all.length === 1 ? all[0] : undefined
}

function swallowed(): void {}

function glyph(kit: Kit, marker: Marker): RenderNode {
  const { tone } = marker
  const shown = restingGlyph(marker)
  const only = onlyTarget(marker.row)
  return (
    <kit.Button key={COVER_KEY} plain label={shown} onPress={only === undefined ? swallowed : marker.press(only)}>
      <kit.Text color={shown === GLYPH ? tone.muted : tone.text} hover={only === undefined ? undefined : pointedAt(tone)}>
        {shown}
      </kit.Text>
    </kit.Button>
  )
}

function anchor(kit: Kit, marker: Marker): RenderNode {
  return (
    <kit.Box key="anchor" height={1} flexDirection="row" hover={{ scope: marker.scope }}>
      {flashed(kit, marker)}
      {glyph(kit, marker)}
      <kit.Text key="edge">{EDGE}</kit.Text>
      {menu(kit, marker)}
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
