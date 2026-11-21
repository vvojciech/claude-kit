import type { RenderNode } from 'claude-code'

import type { Block, Span } from './markdown'
import type { Palette } from './palette'
import { appendRun, drawRuns, spanRuns, spansText } from './runs'
import type { Draw, Run } from './runs'
import { cellWidth } from './width'

type Label = 'decide' | 'unsure'

export type LeadItem = { marker: string; spans: Span[] }

export type LeadSection = { lead: Span[]; items: LeadItem[]; blocks: Block[] }

export type LeadHeader = { answer: Span[]; decide?: LeadSection; unsure?: LeadSection; size: number; rest?: Block }

type Step = 'took' | 'stopped' | 'refused'

const LABELS: Record<Label, string> = { decide: 'Decide:', unsure: 'Unsure:' }

const ORDER: Label[] = ['decide', 'unsure']

const ANSWER_WORDS = 30

const TAG = /\((?:inferred|not checked)\)/g

const JOIN: Span = { text: ' ', kind: 'plain' }

export const BAR = 1

export const GUTTER = BAR + 1

function lines(spans: Span[]): Span[][] {
  const found: Span[][] = [[]]
  for (const span of spans) {
    span.text.split('\n').forEach((text, i) => {
      if (i > 0) found.push([])
      if (text !== '') found.at(-1)?.push({ ...span, text })
    })
  }
  return found
}

function labelOf(line: Span[]): Label | undefined {
  const [first] = line
  if (first === undefined || first.kind !== 'plain' || first.bold !== true || first.italic || first.strike || first.underline || first.href !== undefined) return undefined
  return ORDER.find(label => LABELS[label] === first.text)
}

function isPendingLabel(line: Span[]): boolean {
  const text = spansText(line)
  const bare = text.replace(/\*/g, '')
  return text.startsWith('*') && labelOf(line) === undefined && ORDER.some(label => LABELS[label].startsWith(bare))
}

function opensList(section: LeadSection): boolean {
  const rest = spansText(section.lead.slice(1)).trim()
  return section.items.length === 0 && section.blocks.length === 0 && (rest === '' || rest.endsWith(':'))
}

const SENTENCE_END = /[?.!]$/

const ITEM_START = /^(\d{1,9}[.)]|[-*+])[ \t]+/

const FIRST_ITEM = /^[ \t]*1([.)])[ \t]+/

function sliceSpans(spans: Span[], from: number, to = Infinity): Span[] {
  const found: Span[] = []
  let at = 0
  for (const span of spans) {
    const start = Math.max(from, at)
    const end = Math.min(to, at + span.text.length)
    if (end > start) found.push({ ...span, text: span.text.slice(start - at, end - at) })
    at += span.text.length
  }
  return found
}

function trimmedEnd(spans: Span[]): Span[] {
  const last = spans.at(-1)
  if (last === undefined) return spans
  const text = last.text.replace(/\s+$/, '')
  return text === '' ? trimmedEnd(spans.slice(0, -1)) : [...spans.slice(0, -1), { ...last, text }]
}

function inlineItems(spans: Span[]): LeadItem[] | undefined {
  const text = spansText(spans)
  const first = FIRST_ITEM.exec(text)
  if (first === null) return undefined
  const delimiter = first[1] ?? '.'
  const starts = [{ at: 0, body: first[0].length, marker: `1${delimiter}` }]
  for (let n = 2; ; n++) {
    const next = new RegExp(`\\s${n}\\${delimiter}[ \\t]+`).exec(text.slice(starts.at(-1)?.body ?? 0))
    if (next === null) break
    const at = (starts.at(-1)?.body ?? 0) + next.index
    starts.push({ at, body: at + next[0].length, marker: `${n}${delimiter}` })
  }
  return starts.map((start, i) => ({ marker: start.marker, spans: trimmedEnd(sliceSpans(spans, start.body, starts[i + 1]?.at)) }))
}

export function hasContent(section: LeadSection | undefined): boolean {
  return section !== undefined && (section.items.length > 0 || section.blocks.length > 0 || spansText(section.lead.slice(1)).trim() !== '')
}

function itemMarker(item: Extract<Block, { kind: 'list' }>['items'][number]): string | undefined {
  if (item.marker === 'number') return item.number
  return item.marker === 'bullet' ? '-' : undefined
}

function simpleList(b: Block): b is Extract<Block, { kind: 'list' }> {
  return b.kind === 'list' && b.items.every(item => itemMarker(item) !== undefined && item.blocks.length === 1 && item.blocks[0]?.kind === 'paragraph')
}

class Reader {
  readonly sections = new Map<Label, LeadSection>()

  private last: Label | undefined

  private target: Span[] | undefined

  private inItem = false

  constructor(private readonly pending: (line: Span[]) => boolean) {}

  line(line: Span[], last: boolean): Step {
    if (last && this.pending(line)) return 'took'
    const label = labelOf(line)
    if (label !== undefined) return this.open(label, line) ? 'took' : 'refused'
    const section = this.current()
    const item = section === undefined ? null : ITEM_START.exec(spansText(line))
    if (section !== undefined && item !== null) {
      this.push(section, { marker: item[1] ?? '-', spans: trimmedEnd(sliceSpans(line, item[0].length)) })
      return 'took'
    }
    if (this.target === undefined) return 'refused'
    if (!this.inItem && SENTENCE_END.test(spansText(this.target).trimEnd())) return 'stopped'
    this.target.push(JOIN, ...line)
    return 'took'
  }

  item(marker: string, spans: Span[], last: boolean): boolean {
    const section = this.current()
    if (section === undefined) return false
    const [first = [], ...rest] = lines(spans)
    this.push(section, { marker, spans: first })
    return rest.every((line, i) => this.line(line, last && i === rest.length - 1) === 'took')
  }

  private push(section: LeadSection, item: LeadItem): void {
    section.items.push(item)
    this.target = item.spans
    this.inItem = true
  }

  list(b: Block): void {
    this.current()?.blocks.push(b)
    this.target = undefined
  }

  current(): LeadSection | undefined {
    return this.last === undefined ? undefined : this.sections.get(this.last)
  }

  private open(label: Label, line: Span[]): boolean {
    if (this.sections.has(label) || (this.last !== undefined && ORDER.indexOf(label) < ORDER.indexOf(this.last))) return false
    const [labelSpan, ...after] = line
    const items = inlineItems(after)
    const section: LeadSection = { lead: items === undefined ? [...line] : labelSpan ? [labelSpan] : [], items: [], blocks: [] }
    this.sections.set(label, section)
    this.last = label
    this.target = section.lead
    this.inItem = false
    for (const item of items ?? []) this.push(section, item)
    return true
  }
}

type Read = { ok: boolean; rest?: Block }

type List = Extract<Block, { kind: 'list' }>

function readLines(reader: Reader, all: Span[][], isLast: boolean): Read {
  for (const [i, line] of all.entries()) {
    const step = reader.line(line, isLast && i === all.length - 1)
    if (step === 'refused') return { ok: false }
    if (step === 'stopped') return { ok: true, rest: { kind: 'paragraph', spans: joinedLines(all.slice(i)) } }
  }
  return { ok: true }
}

function joinedLines(found: Span[][]): Span[] {
  return found.flatMap((line, i) => (i === 0 ? line : [{ text: '\n', kind: 'plain' } as Span, ...line]))
}

function asWritten(items: List['items']): List['items'] {
  return items.map(item => (item.marker === 'number' && item.number !== undefined && item.written !== undefined ? { ...item, number: item.number.replace(/^\d+/, String(item.written)) } : item))
}

function restartsAfter(items: List['items'], i: number): boolean {
  const [item, next] = [items[i], items[i + 1]]
  if (item === undefined || next === undefined) return false
  if ((item.marker === 'number') !== (next.marker === 'number')) return true
  return item.written !== undefined && next.written !== undefined && next.written !== item.written + 1
}

function splitAtGap(b: List): { head: List; rest?: List } {
  const cut = b.loose ? b.items.findIndex((item, i) => item.gapAfter === true && restartsAfter(b.items, i)) : -1
  if (cut === -1) return { head: b }
  const tail = b.items.slice(cut + 1)
  const head = b.items.slice(0, cut + 1)
  return { head: { ...b, loose: head.slice(0, -1).some(item => item.gapAfter === true), items: head }, rest: { ...b, loose: tail.some(item => item.gapAfter === true), items: asWritten(tail) } }
}

function readList(reader: Reader, b: List, isLast: boolean): boolean {
  let section = reader.current()
  let restart = 0
  return b.items.every((item, i) => {
    if (reader.current() !== section) {
      section = reader.current()
      restart = i
    }
    const marker = itemMarker(item) ?? '-'
    const renumbered = restart > 0 && item.marker === 'number' ? marker.replace(/^\d+/, String(i - restart + 1)) : marker
    const body = item.blocks[0]
    return body?.kind === 'paragraph' && reader.item(renumbered, body.spans, isLast && i === b.items.length - 1)
  })
}

function absorbs(reader: Reader, b: Block): boolean {
  const section = reader.current()
  if (b.kind === 'list') return section !== undefined && opensList(section)
  return b.kind === 'paragraph' && labelOf(lines(b.spans)[0] ?? []) !== undefined
}

function isHeldParagraph(b: Block, held: boolean): boolean {
  if (!held || b.kind !== 'paragraph') return false
  const [only, ...more] = lines(b.spans)
  return only !== undefined && more.length === 0 && isPendingLabel(only)
}

function isLabelParagraph(b: Block | undefined): boolean {
  return b?.kind === 'paragraph' && labelOf(lines(b.spans)[0] ?? []) !== undefined
}

export function leadHeaderOf(blocks: ReadonlyArray<Block>, streaming = false): LeadHeader | undefined {
  const [first, second] = blocks
  if (first?.kind !== 'paragraph') return undefined
  const all = lines(first.spans)
  const [line1, ...rest] = all
  if (line1 === undefined || spansText(line1).trim() === '' || labelOf(line1) !== undefined) return undefined
  const isLast = (i: number) => streaming && i === blocks.length - 1
  const labelAt = rest.findIndex(line => labelOf(line) !== undefined)
  const pendingAt = isLast(0) && rest.length > 0 && isPendingLabel(rest.at(-1) ?? []) ? rest.length - 1 : -1
  const headAt = labelAt === -1 ? pendingAt : labelAt
  let held = false
  const reader = new Reader(line => {
    held = streaming && isPendingLabel(line)
    return held
  })
  const answerLines = headAt === -1 ? all : all.slice(0, headAt + 1)
  const answer = answerLines.flatMap((line, i) => (i === 0 ? line : [JOIN, ...line]))
  const sectionsOf = (size: number, rest?: Block): LeadHeader => ({ answer, decide: reader.sections.get('decide'), unsure: reader.sections.get('unsure'), size, ...(rest ? { rest } : {}) })
  if (headAt !== -1) {
    const read = readLines(reader, rest.slice(headAt), isLast(0))
    if (!read.ok || (reader.sections.size === 0 && !held)) return undefined
    if (read.rest) return sectionsOf(1, read.rest)
  }
  if (reader.sections.size === 0) {
    if (held) return { answer, size: 1 }
    if (second !== undefined && isHeldParagraph(second, isLast(1))) return { answer, size: 2 }
    if (!isLabelParagraph(second)) return undefined
  }
  let size = 1
  for (const b of blocks.slice(1)) {
    if (isHeldParagraph(b, isLast(size))) return sectionsOf(size + 1)
    if (!absorbs(reader, b)) break
    if (b.kind === 'list') {
      const { head, rest } = splitAtGap(b)
      if (!simpleList(head)) reader.list(head)
      else if (!readList(reader, head, isLast(size) && rest === undefined)) break
      if (rest) return sectionsOf(size + 1, rest)
    } else {
      const read = b.kind === 'paragraph' ? readLines(reader, lines(b.spans), isLast(size)) : { ok: false }
      if (!read.ok) break
      if (read.rest) return sectionsOf(size + 1, read.rest)
    }
    size += 1
  }
  if (reader.sections.size === 0) return undefined
  return sectionsOf(size)
}

function wordsIn(spans: Span[]): number {
  return spansText(spans).trim().split(/\s+/).filter(word => word !== '').length
}

function answerRuns(draw: Draw, spans: Span[]): Run[] {
  const runs = spanRuns(spans, draw.palette, [], true, false)
  const count = wordsIn(spans)
  if (count > ANSWER_WORDS) appendRun(runs, ` · ${count} words`, { color: draw.palette.muted })
  return runs
}

function taggedRuns(draw: Draw, spans: Span[], runs: Run[] = []): Run[] {
  const { palette } = draw
  for (const span of spans) {
    if (span.kind !== 'plain') {
      spanRuns([span], palette, runs, true, false)
      continue
    }
    let last = 0
    for (const tag of span.text.matchAll(TAG)) {
      const at = tag.index ?? 0
      spanRuns([{ ...span, text: span.text.slice(last, at) }], palette, runs, true, false)
      appendRun(runs, tag[0], { color: palette.muted, italic: true })
      last = at + tag[0].length
    }
    spanRuns([{ ...span, text: span.text.slice(last) }], palette, runs, true, false)
  }
  return runs
}

function decideLead(draw: Draw, spans: Span[]): Run[] {
  const [label, ...rest] = spans
  const runs: Run[] = []
  if (label) appendRun(runs, label.text, { color: draw.palette.strong, bold: true })
  return spanRuns(rest, draw.palette, runs, true, false)
}

function unsureLead(draw: Draw, spans: Span[]): Run[] {
  const [label, ...rest] = spans
  const runs: Run[] = []
  if (label) appendRun(runs, label.text, { color: draw.palette.muted, bold: true })
  return taggedRuns(draw, rest, runs)
}

function barred(draw: Draw, bar: string | undefined, body: RenderNode, top = 0): RenderNode {
  const { Box } = draw.kit
  return (
    <Box flexDirection="row" marginTop={top}>
      <Box width={BAR} flexShrink={0} backgroundColor={bar} />
      <Box flexDirection="column" flexGrow={1} paddingLeft={GUTTER - BAR}>
        {body}
      </Box>
    </Box>
  )
}

function itemRow(draw: Draw, item: LeadItem, markerWidth: number, color: string, runsOf: (spans: Span[]) => Run[]): RenderNode {
  const { Box, Text } = draw.kit
  return (
    <Box flexDirection="row">
      <Box width={markerWidth + 1} flexShrink={0}>
        <Text color={draw.palette.muted}>{item.marker}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text color={color}>{drawRuns(draw, runsOf(item.spans))}</Text>
      </Box>
    </Box>
  )
}

export type DrawLeadBlock = (b: Block, palette: Palette) => RenderNode

const quiet = new WeakMap<Palette, Palette>()

function quietPalette(palette: Palette): Palette {
  const known = quiet.get(palette) ?? { ...palette, text: palette.muted }
  quiet.set(palette, known)
  return known
}

function taggedSpans(spans: Span[]): Span[] {
  return spans.flatMap(span => {
    if (span.kind !== 'plain') return [span]
    const parts: Span[] = []
    let last = 0
    for (const tag of span.text.matchAll(TAG)) {
      const at = tag.index ?? 0
      if (at > last) parts.push({ ...span, text: span.text.slice(last, at) })
      parts.push({ ...span, text: tag[0], italic: true })
      last = at + tag[0].length
    }
    if (last < span.text.length) parts.push({ ...span, text: span.text.slice(last) })
    return parts
  })
}

const tagged = new WeakMap<Block, Block>()

function taggedBlock(b: Block): Block {
  const known = tagged.get(b)
  if (known) return known
  const made: Block =
    b.kind === 'paragraph'
      ? { ...b, spans: taggedSpans(b.spans) }
      : b.kind === 'list'
        ? { ...b, items: b.items.map(item => ({ ...item, blocks: item.blocks.map(taggedBlock) })) }
        : b.kind === 'quote'
          ? { ...b, blocks: b.blocks.map(taggedBlock) }
          : b
  tagged.set(b, made)
  return made
}

type Look = { bar: string | undefined; color: string; leadRuns: Run[]; runsOf: (spans: Span[]) => Run[]; top: number; nested: (b: Block) => RenderNode }

function section(draw: Draw, part: LeadSection, look: Look): RenderNode {
  const { Box, Text } = draw.kit
  const markerWidth = Math.max(0, ...part.items.map(item => cellWidth(item.marker)))
  return barred(
    draw,
    hasContent(part) ? look.bar : undefined,
    <Box flexDirection="column">
      <Text color={look.color}>{drawRuns(draw, look.leadRuns)}</Text>
      {part.items.map(item => itemRow(draw, item, markerWidth, look.color, look.runsOf))}
      {part.blocks.map(look.nested)}
    </Box>,
    look.top,
  )
}

export function leadHeader(draw: Draw, header: LeadHeader, asking: boolean, drawBlock: DrawLeadBlock): RenderNode {
  const { Box, Text } = draw.kit
  const { palette } = draw
  const plainRuns = (spans: Span[]) => spanRuns(spans, palette, [], true, false)
  const { decide, unsure } = header
  return (
    <Box flexDirection="column">
      {barred(
        draw,
        palette.muted,
        <Text color={palette.strong} bold>
          {drawRuns(draw, answerRuns(draw, header.answer))}
        </Text>,
      )}
      {decide ? section(draw, decide, { bar: asking ? palette.accent : palette.faint, color: palette.text, leadRuns: decideLead(draw, decide.lead), runsOf: plainRuns, top: 1, nested: b => drawBlock(b, palette) }) : null}
      {unsure ? section(draw, unsure, { bar: undefined, color: palette.muted, leadRuns: unsureLead(draw, unsure.lead), runsOf: spans => taggedRuns(draw, spans), top: decide ? 0 : 1, nested: b => drawBlock(taggedBlock(b), quietPalette(palette)) }) : null}
    </Box>
  )
}
