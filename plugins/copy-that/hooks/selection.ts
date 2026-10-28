import { lexBlocks, lexInline } from './bounded-lexer'
import { ENTITY, SizedCache, decoded } from './lexer'
import type { Token, Tokens } from './vendor/marked.js'

const LETTER = /[\p{L}\p{N}]/gu

const CACHE_CHARS = 1_000_000

const NEAR = 1_000

const SPANS = new Set(['strong', 'em', 'del', 'link', 'image', 'codespan'])

const HIDDEN = new Set(['escape', 'checkbox', 'br', 'hr', 'space', 'def'])

type Cut = { from: number; to: number }

type Piece = Cut & { text: string }

type Projection = { letters: string; at: number[]; ends: number[]; spans: Cut[] }

type Walk = Projection & { source: string; labels: boolean; cursor: number; limit: number }

type Span = Cut

type Behind = { text: string } | { places: number }

function lettersAt(text: string, offset: number): Piece[] {
  return [...text.matchAll(LETTER)].map(match => {
    const from = offset + (match.index ?? 0)
    return { text: match[0], from, to: from + match[0].length }
  })
}

function lettersOf(text: string): string {
  return lettersAt(text, 0)
    .map(piece => piece.text)
    .join('')
}

// an entity counts as the letters it decodes to, each spanning the whole entity
function textPieces(raw: string): Piece[] {
  const pieces: Piece[] = []
  let from = 0
  for (const entity of raw.matchAll(ENTITY)) {
    const at = entity.index ?? 0
    const to = at + entity[0].length
    pieces.push(...lettersAt(raw.slice(from, at), from), ...lettersAt(decoded(entity[0]), 0).map(piece => ({ ...piece, from: at, to })))
    from = to
  }
  return [...pieces, ...lettersAt(raw.slice(from), from)]
}

function codePieces(walk: Walk, token: Tokens.Code): Piece[] {
  if (walk.labels || token.codeBlockStyle === 'indented') return lettersAt(token.raw, 0)
  const body = token.raw.indexOf('\n') + 1
  return body === 0 ? [] : lettersAt(token.raw.slice(body), body)
}

function imagePieces(token: Tokens.Image): Piece[] {
  const at = token.text === '' ? -1 : token.raw.indexOf(token.text)
  return at === -1 ? [] : lettersAt(token.text, at)
}

// the letters a leaf draws, by where they sit in its raw; undefined for a token drawn through its children
function piecesOf(walk: Walk, token: Token): Piece[] | undefined {
  if (HIDDEN.has(token.type) || (token.type === 'html' && !(token as Tokens.HTML).block)) return []
  if (token.type === 'text' && (token as Tokens.Text).tokens === undefined) return textPieces(token.raw)
  if (token.type === 'codespan') return lettersAt(token.raw, 0)
  if (token.type === 'code') return codePieces(walk, token as Tokens.Code)
  if (token.type === 'image') return imagePieces(token as Tokens.Image)
  return undefined
}

function childrenOf(token: Token): Token[] {
  if (token.type === 'list') return (token as Tokens.List).items
  if (token.type === 'html') return lexInline(token.raw)
  if (token.type === 'table') {
    const { header, rows } = token as Tokens.Table
    return [...header, ...rows.flat()].flatMap(cell => cell.tokens)
  }
  return 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
}

// a raw starts at the cursor or after a few hidden markers, so the search stays near it and linear
function locate(walk: Walk, raw: string): number | undefined {
  if (walk.source.startsWith(raw, walk.cursor)) return walk.cursor
  const near = walk.source.slice(walk.cursor, Math.min(walk.limit, walk.cursor + raw.length + NEAR))
  const at = near.indexOf(raw)
  return at === -1 ? undefined : walk.cursor + at
}

function take(walk: Walk, piece: Piece, shift: number): void {
  walk.letters += piece.text
  // one entry per UTF-16 unit, so an indexOf into letters lines up with at
  for (let unit = 0; unit < piece.text.length; unit++) {
    walk.at.push(piece.from + shift)
    walk.ends.push(piece.to + shift)
  }
}

// a raw the lexer rewrote, as quote markers stripped from its lines or a table cell's escaped pipe
// unescaped, is found piece by piece instead
function byPiece(walk: Walk, raw: string, pieces: Piece[]): void {
  for (const piece of pieces) {
    const at = locate(walk, raw.slice(piece.from, piece.to))
    if (at === undefined) continue
    take(walk, piece, at - piece.from)
    walk.cursor = at + piece.to - piece.from
  }
}

function emit(walk: Walk, raw: string, pieces: Piece[]): void {
  const start = locate(walk, raw)
  if (start === undefined) {
    byPiece(walk, raw, pieces)
    return
  }
  for (const piece of pieces) take(walk, piece, start)
  walk.cursor = start + raw.length
}

function walkToken(walk: Walk, token: Token): void {
  const start = SPANS.has(token.type) ? locate(walk, token.raw) : undefined
  if (start !== undefined) {
    walk.spans.push({ from: start, to: start + token.raw.length })
    walk.cursor = start
  }
  const pieces = piecesOf(walk, token)
  if (pieces !== undefined) emit(walk, token.raw, pieces)
  else for (const child of childrenOf(token)) walkToken(walk, child)
  if (start !== undefined) walk.cursor = Math.max(walk.cursor, start + token.raw.length)
}

// what the renderer draws, as letters, each mapped to the source it came from
function projected(source: string, tokens: Token[], labels: boolean): Projection {
  const walk: Walk = { source, labels, cursor: 0, limit: source.length, letters: '', at: [], ends: [], spans: [] }
  let offset = 0
  for (const token of tokens) {
    const found = source.startsWith(token.raw, offset) ? offset : source.indexOf(token.raw, offset)
    walk.cursor = found === -1 ? offset : found
    walk.limit = found === -1 ? source.length : found + token.raw.length
    walkToken(walk, token)
    offset = found === -1 ? walk.cursor : walk.limit
  }
  return { letters: walk.letters, at: walk.at, ends: walk.ends, spans: walk.spans }
}

type Projections = { labelled: Projection; plain: Projection }

const projections = new SizedCache<Projections>(CACHE_CHARS)

function projectionsOf(source: string): Projections {
  const tokens = lexBlocks(source)
  return { labelled: projected(source, tokens, true), plain: projected(source, tokens, false) }
}

function lineStart(source: string, from: number): number {
  return source.lastIndexOf('\n', from - 1) + 1
}

function lineEnd(source: string, to: number): number {
  const newline = source.indexOf('\n', to)
  return newline === -1 ? source.length : newline
}

function wholeLines(source: string, from: number, to: number): string {
  return source.slice(lineStart(source, from), lineEnd(source, to))
}

function straddled(spans: Cut[], cut: Cut): Cut | undefined {
  const span = spans.find(({ from, to }) => from < cut.to && to > cut.from && (from < cut.from || to > cut.to))
  return span && { from: Math.min(span.from, cut.from), to: Math.max(span.to, cut.to) }
}

function balanced(spans: Cut[], cut: Cut): Cut {
  let current = cut
  for (let next = straddled(spans, current); next; next = straddled(spans, current)) current = next
  return current
}

// punctuation the selection starts or ends with, taken when the source has it right there
function withEdges(source: string, cut: Cut, selected: string): Cut {
  const trimmed = selected.trim()
  const found = lettersAt(trimmed, 0)
  const lead = trimmed.slice(0, found[0]?.from ?? 0)
  const tail = trimmed.slice(found.at(-1)?.to ?? trimmed.length)
  const from = lead !== '' && source.slice(cut.from - lead.length, cut.from) === lead ? cut.from - lead.length : cut.from
  const to = tail !== '' && source.slice(cut.to, cut.to + tail.length) === tail ? cut.to + tail.length : cut.to
  return { from, to }
}

function firstFrom(at: number[], offset: number): number {
  let low = 0
  let high = at.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((at[middle] ?? 0) < offset) low = middle + 1
    else high = middle
  }
  return low
}

function lettersWithin(projection: Projection, start: number, end: number): number {
  return firstFrom(projection.at, end) - firstFrom(projection.at, start)
}

function excerpt(source: string, projection: Projection, span: Span, selected: string): string {
  const from = projection.at[span.from] ?? 0
  const last = projection.at[span.to] ?? source.length - 1
  const start = lineStart(source, from)
  const end = lineEnd(source, last)
  if (lineStart(source, last) !== start || lettersWithin(projection, start, end) === span.to - span.from + 1) return source.slice(start, end)
  const exact = { from, to: projection.ends[span.to] ?? last + 1 }
  const cut = balanced(projection.spans, withEdges(source, balanced(projection.spans, exact), selected))
  return source.slice(cut.from, cut.to)
}

function occurrences(haystack: string, wanted: string): number[] {
  const found: number[] = []
  for (let at = haystack.indexOf(wanted); at !== -1; at = haystack.indexOf(wanted, at + 1)) found.push(at)
  return found
}

function exactSpans(projection: Projection, wanted: string): Span[] {
  if (wanted === '') return []
  return occurrences(projection.letters, wanted).map(start => ({ from: start, to: start + wanted.length - 1 }))
}

// one span per place the first line starts, ending at the last line as often as the selection
// itself repeats it, so repeated sections stay separate places instead of one span across them
function lineSpans(projection: Projection, lines: string[]): Span[] {
  if (lines.length < 2) return []
  const first = lines[0] ?? ''
  const last = lines[lines.length - 1] ?? ''
  const lastCount = occurrences(lines.slice(1).join(''), last).length
  return occurrences(projection.letters, first).flatMap(head => {
    const tail = occurrences(projection.letters.slice(head + first.length), last)[lastCount - 1]
    return tail === undefined ? [] : [{ from: head, to: head + first.length + tail + last.length - 1 }]
  })
}

function spansIn(projection: Projection, selected: string): Span[] {
  const lines = selected
    .split('\n')
    .map(lettersOf)
    .filter(line => line !== '')
  const exact = exactSpans(projection, lines.join(''))
  if (exact.length > 0) return exact
  return lineSpans(projection, lines)
}

function settled(texts: string[]): Behind | undefined {
  const distinct = [...new Set(texts)]
  if (distinct.length === 0) return undefined
  return distinct.length === 1 ? { text: distinct[0] ?? '' } : { places: distinct.length }
}

function literalSpans(source: string, selected: string): Behind | undefined {
  const wanted = selected.trim()
  if (wanted === '') return undefined
  return settled(occurrences(source, wanted).map(at => wholeLines(source, at, at + wanted.length - 1)))
}

export function sourceBehind(source: string, selected: string): Behind | undefined {
  if (lettersOf(selected) === '') return literalSpans(source, selected)
  const both = projections.get(source) ?? projections.set(source, projectionsOf(source))
  for (const projection of [both.labelled, both.plain]) {
    const found = settled(spansIn(projection, selected).map(span => excerpt(source, projection, span, selected)))
    if (found) return found
  }
  return undefined
}

export function behindAny(sources: string[], selected: string): Behind | undefined {
  const found = sources.flatMap(source => sourceBehind(source, selected) ?? [])
  const repeated = found.find(behind => 'places' in behind)
  if (repeated) return repeated
  return settled(found.flatMap(behind => ('text' in behind ? [behind.text] : [])))
}
