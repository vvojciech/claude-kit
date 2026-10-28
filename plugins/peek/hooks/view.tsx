import type { Elements, RenderElement, RenderNode } from 'claude-code'

import type { Cells } from './fit'
import type { Tone } from './tone'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Image'>

export type Action = { key: string; label: string; press: () => void }

export type Shown = { id: string; name: string; caption?: string; png?: string; cells?: Cells; actions: Action[] }

export const MARK = '▣'

export const OPEN = '⤢ open'

export const GALLERY_KEY = 'peek'

export const BAND_KEY = 'peek-band'

export function imageKey(id: string): string {
  return `peek-img-${id}`
}

function button(kit: Kit, tone: Tone, action: Action): RenderNode {
  return (
    <kit.Button key={action.key} plain label={action.label} onPress={action.press}>
      <kit.Text color={tone.muted} hover={{ color: tone.text, underline: true }}>
        {action.label}
      </kit.Text>
    </kit.Button>
  )
}

function buttons(kit: Kit, tone: Tone, shown: Shown): RenderNode[] {
  return shown.actions.flatMap(action => [<kit.Text key={`gap-${action.key}`}>{'  '}</kit.Text>, button(kit, tone, action)])
}

export function lineOf(kit: Kit, tone: Tone, shown: Shown): RenderElement {
  return (
    <kit.Box key={`peek-${shown.id}`} flexDirection="row" height={1}>
      <kit.Text color={tone.muted} wrap="truncate-end">
        {`${MARK} ${shown.name}`}
      </kit.Text>
      {buttons(kit, tone, shown)}
    </kit.Box>
  )
}

function caption(kit: Kit, tone: Tone, shown: Shown): RenderNode[] {
  return [
    <kit.Text key="name" color={tone.muted} wrap="truncate-end">
      {shown.name}
    </kit.Text>,
    ...(shown.caption === undefined ? [] : [<kit.Text key="caption" color={tone.muted}>{shown.caption}</kit.Text>]),
  ]
}

function actionRows(kit: Kit, tone: Tone, shown: Shown): RenderNode[] {
  return shown.actions.map(action => (
    <kit.Box key={`row-${action.key}`} height={1}>
      {button(kit, tone, action)}
    </kit.Box>
  ))
}

function actionsRow(kit: Kit, tone: Tone, shown: Shown): RenderNode {
  return (
    <kit.Box key="actions" flexDirection="row" height={1}>
      {buttons(kit, tone, shown).slice(1)}
    </kit.Box>
  )
}

function side(kit: Kit, tone: Tone, shown: Shown, rows: number): RenderNode[] {
  const named = caption(kit, tone, shown)
  const full = [...named, ...actionRows(kit, tone, shown)]
  return full.length <= rows ? full : [...named.slice(0, Math.max(0, rows - 1)), actionsRow(kit, tone, shown)]
}

export function pictureOf(kit: Kit, tone: Tone, shown: Shown, rows: number): RenderElement {
  if (shown.png === undefined || shown.cells === undefined) return lineOf(kit, tone, shown)
  return (
    <kit.Box key={`peek-${shown.id}`} flexDirection="row" marginRight={2}>
      <kit.Image key={imageKey(shown.id)} source={{ png: shown.png }} columns={shown.cells.columns} rows={shown.cells.rows} alt={`${MARK} ${shown.name}`} />
      <kit.Box key="side" flexDirection="column" paddingLeft={1} flexShrink={1}>
        {side(kit, tone, shown, rows)}
      </kit.Box>
    </kit.Box>
  )
}

export function shownOf(kit: Kit, tone: Tone, shown: Shown, pictures: boolean, rows: number): RenderElement {
  return pictures ? pictureOf(kit, tone, shown, rows) : lineOf(kit, tone, shown)
}

export function gallery(kit: Kit, drawn: RenderElement, items: RenderElement[]): RenderElement {
  return (
    <kit.Box flexDirection="column">
      {drawn}
      <kit.Box key={GALLERY_KEY} flexDirection="column" paddingLeft={2}>
        {items}
      </kit.Box>
    </kit.Box>
  )
}

export function band(kit: Kit, below: RenderElement, items: RenderElement[], pictures: boolean): RenderElement {
  return (
    <kit.Box flexDirection="column">
      <kit.Box key={BAND_KEY} flexDirection={pictures ? 'row' : 'column'}>
        {items}
      </kit.Box>
      {below}
    </kit.Box>
  )
}
