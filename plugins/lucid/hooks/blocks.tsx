import type { RenderElement, RenderNode } from 'claude-code'

import { code, codeLines } from './code'
import { heading } from './headings'
import type { AlertKind, Block, ListItem } from './markdown'
import { parseBlocks } from './message'
import type { Palette } from './palette'
import { drawRuns, gapRows, paragraph, spansText, wrappedRows } from './runs'
import type { Draw, Run } from './runs'
import { table, tableRows } from './tables'
import { cellWidth } from './width'

type Context = { done: boolean; nesting: number; gutter: string; owed: number[] }

type Size = { nodes: number; depth: number }

type DrawnBlock = { node: RenderNode; size: Size }

const TOP: Context = { done: false, nesting: 0, gutter: '', owed: [] }

const NESTING_LIMIT = 8

const NODE_BUDGET = 15000

const DEPTH_BUDGET = 26

const ROW_NODES = 1

const QUOTE_INDENT = 2

const QUOTE_BAR = '▎'

const QUOTE_GUTTER = `${QUOTE_BAR} `

const THEMATIC_BREAK = '╌'

const RULE_CELLS = 40

const TITLE_GAP = 2

const SECTION_LEVELS = 2

const WIDE_BLOCKS = new Set<Block['kind']>(['code', 'table'])

const ALERT_LABEL: Record<AlertKind, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }

function markerRuns(item: ListItem, palette: Palette): Run[] {
  if (item.marker === 'done') return [{ text: '- ', look: { color: palette.muted } }, { text: '[x]', look: { color: palette.done } }]
  if (item.marker === 'todo') return [{ text: '- [ ]', look: { color: palette.muted } }]
  if (item.marker === 'number') return [{ text: item.number ?? '-', look: { color: palette.muted } }]
  return [{ text: '-', look: { color: palette.muted } }]
}

function markerWidth(item: ListItem, numberWidth: number): number {
  if (item.marker === 'number') return numberWidth
  return item.marker === 'bullet' ? 1 : 5
}

type Segment = { blocks: Block[]; isCode: boolean }

function isCode(b: Block): boolean {
  return b.kind === 'code'
}

function holds(b: Block, leaf: (b: Block) => boolean): boolean {
  if (leaf(b)) return true
  if (b.kind === 'list') return b.items.some(item => item.blocks.some(child => holds(child, leaf)))
  return b.kind === 'quote' && b.blocks.some(child => holds(child, leaf))
}

function holdsCode(b: Block): boolean {
  return holds(b, isCode)
}

function segments(blocks: Block[], pulled: (b: Block) => boolean = isCode): Segment[] {
  const found: Segment[] = []
  for (const child of blocks) {
    const isCode = pulled(child)
    const last = found.at(-1)
    if (last && !isCode && !last.isCode) last.blocks.push(child)
    else found.push({ blocks: [child], isCode })
  }
  return found.length > 0 && !found[0]?.isCode ? found : [{ blocks: [], isCode: false }, ...found]
}

export function holdsWide(b: Block): boolean {
  return holds(b, child => WIDE_BLOCKS.has(child.kind))
}

function itemBody(draw: Draw, blocks: Block[], marker: RenderNode | null, lead: number, width: number, gap: number, loose: boolean, context: Context): RenderNode {
  const { Box } = draw.kit
  const room = Math.max(1, width - lead)
  return (
    <Box flexDirection="column" paddingLeft={lead} width={room + lead} marginTop={gap}>
      {marker}
      {blocks.length === 0 ? <draw.kit.Text> </draw.kit.Text> : null}
      {blocks.flatMap((child, i) => {
        const drawn = barredBlock(draw, child, room, context)
        return spaced(draw, loose && i > 0 ? 1 : 0, context, top => (top > 0 ? <Box marginTop={top}>{drawn}</Box> : drawn))
      })}
    </Box>
  )
}

function itemMarker(draw: Draw, item: ListItem): RenderNode {
  const { Box, Text } = draw.kit
  return (
    <Box position="absolute" left={0} top={0}>
      <Text>{drawRuns(draw, markerRuns(item, draw.palette))}</Text>
    </Box>
  )
}

function flushCode(draw: Draw, blocks: Block[], width: number, top: number, context: Context, cue: string): RenderNode {
  const edge = cellWidth(context.gutter)
  const margin = edge > 0 ? -edge : undefined
  const room = width + edge
  return (
    <draw.kit.Box marginTop={top} marginLeft={margin} width={margin === undefined ? undefined : room} flexDirection="column">
      {blocks.map(child => (child.kind === 'code' ? code(draw, child.language, child.source, room, cue) : block(draw, child, room, { ...context, gutter: '' })))}
    </draw.kit.Box>
  )
}

function listItem(draw: Draw, item: ListItem, loose: boolean, numberWidth: number, width: number, context: Context, gap: number): RenderNode[] {
  const lead = markerWidth(item, numberWidth) + 1
  const inner = { ...context, done: context.done || item.marker === 'done', nesting: context.nesting + 1 }
  const indented = { ...inner, gutter: context.gutter + ' '.repeat(lead) }
  const childGap = loose ? 1 : 0
  return segments(item.blocks).flatMap((segment, i) =>
    spaced(draw, i === 0 ? gap : childGap, context, top => {
      if (segment.isCode) return flushCode(draw, segment.blocks, width, top, inner, indented.gutter)
      return itemBody(draw, segment.blocks, i === 0 ? itemMarker(draw, item) : null, lead, width, top, loose, indented)
    }),
  )
}

function list(draw: Draw, b: Extract<Block, { kind: 'list' }>, width: number, context: Context): RenderNode {
  const numberWidth = Math.max(0, ...b.items.filter(i => i.marker === 'number').map(i => cellWidth(i.number ?? '')))
  return (
    <draw.kit.Box flexDirection="column">
      {b.items.flatMap((item, index) => listItem(draw, item, b.loose, numberWidth, width, context, b.loose && index > 0 ? 1 : 0))}
    </draw.kit.Box>
  )
}

function listRows(b: Extract<Block, { kind: 'list' }>, width: number): number {
  const items = b.items.map(item => item.blocks.reduce((rows, child) => rows + blockRows(child, width), 0) + gapRows(item.blocks.length, 1))
  return items.reduce((rows, item) => rows + Math.max(1, item), 0) + gapRows(b.items.length, b.loose ? 1 : 0)
}

export function blockRows(b: Block, width: number): number {
  switch (b.kind) {
    case 'heading':
      return wrappedRows(spansText(b.spans), width) + (b.level === 1 ? 1 : 0)
    case 'paragraph':
      return wrappedRows(spansText(b.spans), width)
    case 'list':
      return listRows(b, width)
    case 'code':
      return (b.language === '' ? 0 : 1) + wrappedRows(codeLines(b.source).join('\n'), width)
    case 'table':
      return tableRows(b, width)
    case 'quote':
      return quoteBarRows(b, width)
    case 'rule':
      return 1
  }
}

function proseRows(blocks: Block[], width: number): number {
  return blocks.reduce((rows, child) => rows + blockRows(child, width), 0) + gapRows(blocks.length, 1)
}

export function quoteBarRows(b: Extract<Block, { kind: 'quote' }>, width: number): number {
  return (b.alert ? 1 : 0) + proseRows(b.blocks, Math.max(1, width - QUOTE_INDENT))
}

function quoteChild(draw: Draw, child: Block, width: number, context: Context): RenderNode {
  return child.kind === 'paragraph' ? paragraph(draw, child.spans, draw.palette.muted) : block(draw, child, width, context)
}

function barAt(draw: Draw, left: number, rows: number): RenderNode {
  const { Box, Text } = draw.kit
  return (
    <Box position="absolute" left={left} top={0} bottom={0} width={1} overflow="hidden">
      <Text color={draw.palette.faint}>{Array.from({ length: rows }, () => QUOTE_BAR).join('\n')}</Text>
    </Box>
  )
}

function quoteBar(draw: Draw, rows: number): RenderNode {
  return barAt(draw, 0, rows)
}

function owedBars(draw: Draw, owed: number[], edge: number, rows: number): RenderNode[] {
  return owed.map(column => barAt(draw, column - edge, rows))
}

function barredGap(draw: Draw, context: Context, rows: number): RenderNode {
  return (
    <draw.kit.Box height={rows} width={1}>
      {owedBars(draw, context.owed, cellWidth(context.gutter), rows)}
    </draw.kit.Box>
  )
}

function spaced(draw: Draw, top: number, context: Context, build: (top: number) => RenderNode): RenderNode[] {
  if (top === 0 || context.owed.length === 0) return [build(top)]
  return [barredGap(draw, context, top), build(0)]
}

type DrawBlock = (draw: Draw, b: Block, width: number, context: Context) => RenderNode

function barredBlock(draw: Draw, child: Block, width: number, context: Context, drawChild: DrawBlock = block): RenderNode {
  if (context.owed.length === 0 || holdsCode(child)) return drawChild(draw, child, width, context)
  return (
    <draw.kit.Box flexDirection="column">
      {drawChild(draw, child, width, { ...context, owed: [] })}
      {owedBars(draw, context.owed, cellWidth(context.gutter), blockRows(child, width))}
    </draw.kit.Box>
  )
}

function quoteProse(draw: Draw, blocks: Block[], label: RenderNode | null, width: number, top: number, context: Context, edge: number): RenderNode {
  const { Box } = draw.kit
  const inner = Math.max(1, width - QUOTE_INDENT)
  const rows = (label === null ? 0 : 1) + proseRows(blocks, inner)
  const unowed = { ...context, owed: [] }
  const children = blocks.map((child, i) => <Box flexDirection="column" marginTop={i > 0 ? 1 : 0}>{quoteChild(draw, child, inner, unowed)}</Box>)
  return (
    <Box flexDirection="column" paddingLeft={QUOTE_INDENT} marginTop={top}>
      {label}
      {children}
      {quoteBar(draw, rows)}
      {owedBars(draw, context.owed, edge, rows)}
    </Box>
  )
}


function quoteHoldingCode(draw: Draw, blocks: Block[], width: number, top: number, context: Context): RenderNode {
  const inner = Math.max(1, width - QUOTE_INDENT)
  return (
    <draw.kit.Box flexDirection="column" paddingLeft={QUOTE_INDENT} marginTop={top}>
      {blocks.flatMap((child, i) =>
        spaced(draw, i > 0 ? 1 : 0, context, top => {
          if (isCode(child)) return flushCode(draw, [child], inner, top, context, context.gutter)
          return (
            <draw.kit.Box flexDirection="column" marginTop={top}>
              {barredBlock(draw, child, inner, context, quoteChild)}
            </draw.kit.Box>
          )
        }),
      )}
    </draw.kit.Box>
  )
}

function alertLabel(draw: Draw, b: Extract<Block, { kind: 'quote' }>): RenderNode | null {
  return b.alert ? <draw.kit.Text bold color={draw.palette.strong}>{ALERT_LABEL[b.alert]}</draw.kit.Text> : null
}

function quote(draw: Draw, b: Extract<Block, { kind: 'quote' }>, width: number, context: Context): RenderNode {
  const label = alertLabel(draw, b)
  const edge = cellWidth(context.gutter)
  const prose = { ...context, gutter: context.gutter + QUOTE_GUTTER }
  const owing = { ...prose, owed: [...context.owed, edge] }
  const parts = segments(b.blocks, holdsCode).filter((segment, i) => segment.blocks.length > 0 || (i === 0 && label !== null))
  return (
    <draw.kit.Box flexDirection="column">
      {parts.flatMap((segment, i) =>
        spaced(draw, i > 0 ? 1 : 0, { ...context, owed: owing.owed }, top => {
          if (segment.isCode && segment.blocks.every(isCode)) return flushCode(draw, segment.blocks, width, top, context, prose.gutter)
          if (segment.isCode) return quoteHoldingCode(draw, segment.blocks, width, top, owing)
          return quoteProse(draw, segment.blocks, i === 0 ? label : null, width, top, prose, edge)
        }),
      )}
    </draw.kit.Box>
  )
}

function levelledItems(item: ListItem): ListItem[] {
  const own = item.blocks.filter(child => child.kind !== 'list')
  const deeper = item.blocks.flatMap(child => (child.kind === 'list' ? child.items.flatMap(levelledItems) : []))
  return [{ ...item, blocks: own }, ...deeper]
}

function levelled(b: Extract<Block, { kind: 'list' }>): Extract<Block, { kind: 'list' }> {
  return { ...b, items: b.items.flatMap(levelledItems) }
}

function flattened(draw: Draw, b: Block): RenderNode {
  return <draw.kit.Text color={draw.palette.text}>{plainText(b)}</draw.kit.Text>
}

function block(draw: Draw, b: Block, width: number, context: Context = TOP): RenderNode {
  switch (b.kind) {
    case 'heading':
      return heading(draw, b.level, b.spans, width)
    case 'paragraph':
      return paragraph(draw, b.spans, context.done ? draw.palette.muted : draw.palette.text)
    case 'list':
      return list(draw, context.nesting >= NESTING_LIMIT ? levelled(b) : b, width, context)
    case 'code':
      return code(draw, b.language, b.source, width)
    case 'table':
      return table(draw, b, width)
    case 'quote':
      return context.nesting >= NESTING_LIMIT ? flattened(draw, b) : quote(draw, b, width, { ...context, nesting: context.nesting + 1 })
    case 'rule':
      return <draw.kit.Text color={draw.palette.faint}>{THEMATIC_BREAK.repeat(Math.min(width, RULE_CELLS))}</draw.kit.Text>
  }
}

const MARKDOWN_MARKER: Partial<Record<ListItem['marker'], string>> = { bullet: '-', todo: '- [ ]', done: '- [x]' }

function quoted(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

function itemText(item: ListItem): string {
  const lead = MARKDOWN_MARKER[item.marker] ?? item.number ?? '-'
  const body = item.blocks.map(plainText).join('\n')
  return `${lead} ${body.replace(/\n/g, `\n${' '.repeat(lead.length + 1)}`)}`
}

export function plainText(b: Block): string {
  switch (b.kind) {
    case 'heading':
      return `${'#'.repeat(b.level)} ${spansText(b.spans)}`
    case 'paragraph':
      return spansText(b.spans)
    case 'list':
      return b.items.map(itemText).join('\n')
    case 'code':
      return b.source.replace(/\n+$/, '')
    case 'table':
      return [b.header, ...b.rows].map(row => row.map(spansText).join('  ')).join('\n')
    case 'quote':
      return quoted(b.blocks.map(plainText).join('\n\n'))
    case 'rule':
      return '---'
  }
}

export function treeSize(node: RenderNode | null | undefined, depth = 1): Size {
  if (node === null || node === undefined) return { nodes: 0, depth: depth - 1 }
  if (typeof node === 'string') return { nodes: 1, depth }
  const children = (node as { children?: RenderNode[] }).children ?? []
  return children.reduce(
    (size, child) => {
      const inner = treeSize(child, depth + 1)
      return { nodes: size.nodes + inner.nodes, depth: Math.max(size.depth, inner.depth) }
    },
    { nodes: 1, depth },
  )
}

const drawnBlocks = new WeakMap<Block, Map<string, DrawnBlock>>()

const paletteIds = new WeakMap<Palette, number>()

let palettesSeen = 0

function paletteId(palette: Palette): number {
  const known = paletteIds.get(palette)
  if (known !== undefined) return known
  palettesSeen += 1
  paletteIds.set(palette, palettesSeen)
  return palettesSeen
}

export function drawnBlock(draw: Draw, b: Block, width: number): DrawnBlock {
  const key = `${paletteId(draw.palette)}|${width}`
  const drawings = drawnBlocks.get(b) ?? new Map<string, DrawnBlock>()
  drawnBlocks.set(b, drawings)
  const cached = drawings.get(key)
  if (cached) return cached
  const node = block(draw, b, width)
  const drawn = { node, size: treeSize(node) }
  drawings.set(key, drawn)
  return drawn
}

export function blockGap(previous: Block | undefined, current: Block): number {
  if (!previous) return 0
  return current.kind === 'heading' && current.level <= SECTION_LEVELS ? TITLE_GAP : 1
}

function blockRow(draw: Draw, node: RenderNode, gap: number, width: number | undefined): RenderNode {
  return (
    <draw.kit.Box flexDirection="column" marginTop={gap} width={width}>
      {node}
    </draw.kit.Box>
  )
}

function plainRest(draw: Draw, blocks: Block[]): RenderNode {
  return <draw.kit.Text color={draw.palette.text}>{blocks.map(plainText).join('\n\n')}</draw.kit.Text>
}

export function renderMarkdown(draw: Draw, text: string, columns: number, streaming = false): RenderElement {
  const blocks = parseBlocks(text, { streaming })
  const flowWidth = Math.max(1, columns)
  const rows: RenderNode[] = []
  let spent = 1
  for (const [i, b] of blocks.entries()) {
    const gap = blockGap(blocks[i - 1], b)
    const wide = b.kind === 'list' ? holdsWide(b) : WIDE_BLOCKS.has(b.kind)
    const drawn = drawnBlock(draw, b, flowWidth)
    if (spent + drawn.size.nodes + ROW_NODES > NODE_BUDGET) {
      rows.push(blockRow(draw, plainRest(draw, blocks.slice(i)), gap, undefined))
      break
    }
    const node = drawn.size.depth <= DEPTH_BUDGET ? drawn.node : plainRest(draw, [b])
    spent += (node === drawn.node ? drawn.size.nodes : 2) + ROW_NODES
    rows.push(blockRow(draw, node, gap, wide ? undefined : flowWidth))
  }
  return (
    <draw.kit.Box flexDirection="column" marginTop={1}>
      {rows}
    </draw.kit.Box>
  )
}
