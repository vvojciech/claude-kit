import type { Elements, RenderNode } from 'claude-code'

import type { Span } from './markdown'
import type { Palette } from './palette'
import { cellWidth } from './width'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Link'>

export type Draw = { kit: Kit; palette: Palette }

export type Look = { color?: string; background?: string; bold?: boolean; italic?: boolean; strike?: boolean; underline?: boolean; href?: string }

export type Run = { text: string; look: Look }

const CODE_KINDS = new Set<Span['kind']>(['code', 'path', 'line', 'command', 'subcommand', 'flag', 'string', 'number', 'variable', 'operator', 'word', 'space'])

const SPAN_ROLE: Partial<Record<Span['kind'], keyof Palette>> = {
  code: 'strong',
  url: 'strong',
  path: 'strong',
  line: 'muted',
  command: 'strong',
  subcommand: 'strong',
  flag: 'muted',
  string: 'strong',
  number: 'strong',
  variable: 'strong',
  operator: 'muted',
  image: 'muted',
  footnote: 'muted',
}

const WHITESPACE = /^\s+$/

function sameLook(a: Look, b: Look): boolean {
  return a.color === b.color && a.background === b.background && !a.bold === !b.bold && !a.italic === !b.italic && !a.strike === !b.strike && !a.underline === !b.underline && a.href === b.href
}

function absorbsSpace(look: Look): boolean {
  return !look.underline && !look.strike && look.href === undefined && look.background === undefined
}

function isPlain(look: Look): boolean {
  return look.color === undefined && look.background === undefined && !look.bold && !look.italic && !look.strike && !look.underline && look.href === undefined
}

export function appendRun(runs: Run[], text: string, look: Look): void {
  if (text === '') return
  const previous = runs.at(-1)
  if (previous && (sameLook(previous.look, look) || (WHITESPACE.test(text) && isPlain(look) && absorbsSpace(previous.look)))) previous.text += text
  else runs.push({ text, look: { ...look } })
}

export function spanLook(span: Span, palette: Palette, chip: boolean): Look {
  const role = SPAN_ROLE[span.kind]
  const bold = span.bold || span.kind === 'command'
  const look: Look = {}
  if (role) look.color = palette[role]
  if (chip && CODE_KINDS.has(span.kind)) look.background = palette.chip
  if (bold) look.bold = true
  if (span.italic) look.italic = true
  if (span.strike) look.strike = true
  if (span.underline || span.kind === 'url' || span.href !== undefined) look.underline = true
  if (span.href !== undefined) look.href = span.href
  return look
}

function bindsValue(span: Span | undefined): boolean {
  return span?.kind === 'flag' && span.text.endsWith('=')
}

export function flagValues(spans: Span[]): Span[] {
  return spans.map((span, i) => (bindsValue(spans[i - 1]) && span.kind !== 'space' ? { ...span, kind: 'flag' } : span))
}

export function spanRuns(spans: Span[], palette: Palette, runs: Run[] = [], chip = false): Run[] {
  for (const span of flagValues(spans)) appendRun(runs, span.text, span.kind === 'space' && !chip ? {} : spanLook(span, palette, chip))
  return runs
}

export function drawRuns({ kit }: Draw, runs: Run[]): RenderNode[] {
  const { Text, Link } = kit
  return runs.map(({ text, look }) => {
    if (isPlain(look)) return text
    return (
      <Text color={look.color} backgroundColor={look.background} bold={look.bold} italic={look.italic} strikethrough={look.strike} underline={look.underline}>
        {look.href === undefined ? text : <Link href={look.href}>{text}</Link>}
      </Text>
    )
  })
}

export function inline(draw: Draw, spans: Span[]): RenderNode[] {
  return drawRuns(draw, spanRuns(spans, draw.palette, [], true))
}

export function paragraph(draw: Draw, spans: Span[], color: string): RenderNode {
  return <draw.kit.Text color={color}>{inline(draw, spans)}</draw.kit.Text>
}

export function spansText(spans: Span[]): string {
  return spans.map(span => span.text).join('')
}

export function wrappedRows(text: string, width: number): number {
  const room = Math.max(1, width)
  return text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil((2 * cellWidth(line)) / room)), 0)
}

export function gapRows(count: number, gap: number): number {
  return Math.max(0, count - 1) * gap
}
