import type { Token } from './vendor/marked.js'

import { settledText, settledTokens, withoutPendingPreClose } from './holdback'
import { lexBlocks } from './lexer'
import { codePiece, footnoteLabels, pieceOf, withFootnoteBodies } from './markdown'
import type { Block, Footnotes, OutlineEntry, Piece } from './markdown'

export type ParseOptions = { streaming?: boolean }

type Parse = {
  text: string
  streaming: boolean
  bodyStart: number
  stable: Piece[]
  stableEnd: number
  hasDefinitions: boolean
  open: Map<number, Piece>
  pieces: Piece[]
  blocks: Block[]
  outline?: OutlineEntry[]
}

type Front = { piece: Piece; bodyStart: number }

const CACHED_CHARS = 4_000_000

const RECENT = 4

const OPEN_BLOCKS = 2

const FRONT_MATTER_LINES = 200

const FRONT_MATTER_KEY = /^[a-z_][a-z\d_-]*:(?:[ \t]+(.*))?$/

const FRONT_MATTER_LINE = /^(?:[ \t]|- |#|$)/

const FRONT_MATTER_FENCE = /^---[ \t]*$/

const SENTENCE = /\s.*[.!?]$/

const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m

const cache = new Map<string, Parse>()

let cachedChars = 0

let recent: Parse[] = []

export function parseBlocks(text: string, options: ParseOptions = {}): Block[] {
  return parsed(text, options.streaming === true).blocks
}

export function blocksOf(text: string, options: ParseOptions = {}): OutlineEntry[] {
  const parse = parsed(text, options.streaming === true)
  parse.outline ??= locatedOutline(parse, text)
  return parse.outline
}

export function parseAfresh(text: string, options: ParseOptions = {}): { blocks: Block[]; outline: OutlineEntry[] } {
  const parse = parseMessage(normalised(text), options.streaming === true, () => undefined)
  return { blocks: parse.blocks, outline: locatedOutline(parse, text) }
}

function locatedOutline(parse: Parse, original: string): OutlineEntry[] {
  const toOriginal = originalOffsets(original)
  const outline: OutlineEntry[] = []
  let offset = 0
  for (const piece of parse.pieces) {
    outline.push(...locatedPiece(piece, parse.text, offset).map(entry => ({ ...entry, start: toOriginal(entry.start ?? 0), end: toOriginal(entry.end ?? 0) })))
    offset += piece.source.length
  }
  return outline
}

function locatedPiece(piece: Piece, text: string, offset: number): OutlineEntry[] {
  const cursors: number[] = [offset]
  return piece.outline.map(entry => {
    if (entry.depth === 0) {
      const found = text.indexOf(entry.source, cursors[0])
      const start = found === -1 ? offset : found
      cursors.length = 0
      cursors.push(start + entry.source.length, start)
      return { ...entry, start, end: start + entry.source.length }
    }
    const [start, end] = linesSpan(text, entry.source, cursors[entry.depth] ?? offset)
    cursors[entry.depth] = end
    cursors[entry.depth + 1] = start
    return { ...entry, start, end }
  })
}

function linesSpan(text: string, source: string, from: number): [number, number] {
  let start: number | undefined
  let end = from
  for (const line of source.split('\n')) {
    const content = line.trim()
    if (content === '') continue
    const at = contentAt(text, content, end)
    if (at === -1) continue
    start ??= at
    end = at + content.length
  }
  return [start ?? from, end]
}

const CONTAINER_PREFIX = /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*(?:\[[ xX]\][ \t]*)?$/

const BLANK = /^[ \t]*$/

function contentAt(text: string, content: string, from: number): number {
  for (let at = text.indexOf(content, from); at !== -1; at = text.indexOf(content, at + 1)) if (isLineContent(text, at, content.length)) return at
  return text.indexOf(content, from)
}

function isLineContent(text: string, at: number, length: number): boolean {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const lineEnd = text.indexOf('\n', at + length)
  return CONTAINER_PREFIX.test(text.slice(lineStart, at)) && BLANK.test(text.slice(at + length, lineEnd === -1 ? undefined : lineEnd))
}

function originalOffsets(original: string): (offset: number) => number {
  const mark = original.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0
  if (!original.includes('\r')) return offset => offset + mark
  const removed: number[] = []
  for (const match of original.matchAll(/\r\n/g)) removed.push((match.index ?? 0) - removed.length)
  return offset => offset + mark + countBelow(removed, offset + mark)
}

function countBelow(sorted: number[], value: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((sorted[middle] ?? 0) < value) low = middle + 1
    else high = middle
  }
  return low
}

const BYTE_ORDER_MARK = '\uFEFF'

function normalised(text: string): string {
  const unmarked = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  return unmarked.includes('\r') ? unmarked.replace(/\r\n?/g, '\n') : unmarked
}

function parsed(text: string, streaming: boolean): Parse {
  const key = `${streaming ? 's' : 'f'}${text}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const parse = parseMessage(normalised(text), streaming, (body, bodyStart) => baseFor(body, bodyStart, streaming))
  remember(key, parse)
  return parse
}

function remember(key: string, parse: Parse): void {
  cache.set(key, parse)
  cachedChars += key.length
  while (cachedChars > CACHED_CHARS && cache.size > 1) {
    const [oldest] = cache.keys()
    if (oldest === undefined) break
    cache.delete(oldest)
    cachedChars -= oldest.length
  }
  recent = [parse, ...recent.filter(other => other !== parse)].slice(0, RECENT)
}

function baseFor(text: string, bodyStart: number, streaming: boolean): Parse | undefined {
  let best: Parse | undefined
  for (const candidate of recent) {
    if (candidate.streaming !== streaming || candidate.bodyStart !== bodyStart || candidate.text.length > text.length || !text.startsWith(candidate.text)) continue
    if (!best || candidate.stableEnd > best.stableEnd) best = candidate
  }
  return best
}

function parseMessage(text: string, streaming: boolean, findBase: (text: string, bodyStart: number) => Parse | undefined): Parse {
  const front = frontMatterOf(text)
  const bodyStart = front?.bodyStart ?? 0
  const body = bodyStart === 0 ? text : text.slice(bodyStart)
  const base = findBase(text, bodyStart)
  const resumeAt = base && !base.hasDefinitions ? base.stableEnd : 0
  const hasDefinitions = DEFINITION.test(resumeAt === 0 ? body : body.slice(resumeAt))
  const from = hasDefinitions ? 0 : resumeAt
  const tokens = lexBlocks(body.slice(from))
  const split = hasDefinitions ? { settled: [], rest: tokens, length: 0 } : splitSettled(tokens, body.length - from)
  const pieces = new Pieces(hasDefinitions ? undefined : base?.open, footnotesOf(body, hasDefinitions))
  const stable = [...(from === 0 ? [] : (base?.stable ?? [])), ...pieces.of(split.settled, from)]
  const stableEnd = from + split.length
  const tail = streaming ? shownPieces(body, stableEnd, pieces) : pieces.of(split.rest, stableEnd)
  const all = [...(front ? [front.piece] : []), ...stable, ...tail]
  return { text, streaming, bodyStart, stable, stableEnd, hasDefinitions, open: pieces.made, pieces: all, blocks: all.flatMap(piece => piece.blocks) }
}

function footnotesOf(body: string, hasDefinitions: boolean): Footnotes | undefined {
  return hasDefinitions ? footnoteLabels(body) : undefined
}

class Pieces {
  readonly made = new Map<number, Piece>()

  constructor(
    private readonly known: Map<number, Piece> | undefined,
    private readonly footnotes: Footnotes | undefined,
  ) {}

  of(tokens: Token[], start: number): Piece[] {
    let offset = start
    return withFootnoteBodies(tokens).map(token => {
      const prior = this.known?.get(offset)
      const piece = prior?.source === token.raw ? prior : pieceOf(token, this.footnotes)
      this.made.set(offset, piece)
      offset += token.raw.length
      return piece
    })
  }
}

function splitSettled(tokens: Token[], length: number): { settled: Token[]; rest: Token[]; length: number } {
  const lengths = tokens.map(token => token.raw.length)
  if (lengths.reduce((sum, raw) => sum + raw, 0) !== length) return { settled: [], rest: tokens, length: 0 }
  const cut = openBlocksStart(tokens)
  return { settled: tokens.slice(0, cut), rest: tokens.slice(cut), length: lengths.slice(0, cut).reduce((sum, raw) => sum + raw, 0) }
}

function openBlocksStart(tokens: Token[]): number {
  let open = 0
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]?.type === 'space') continue
    open++
    if (open === OPEN_BLOCKS) return i
  }
  return 0
}

function shownPieces(body: string, stableEnd: number, pieces: Pieces): Piece[] {
  const { shown, tokens } = shownTail(settledText(body).slice(stableEnd))
  return shown === '' ? [] : pieces.of(tokens, stableEnd).map(trimmedTo(shown))
}

function shownTail(settled: string): { shown: string; tokens: Token[] } {
  const tokens = settledTokens(settled)
  const shown = withoutPendingPreClose(settled, tokens)
  return shown === settled ? { shown, tokens } : { shown, tokens: settledTokens(shown) }
}

function trimmedTo(shown: string): (piece: Piece, index: number, pieces: Piece[]) => Piece {
  return (piece, index, pieces) => {
    const before = pieces.slice(0, index).reduce((sum, other) => sum + other.source.length, 0)
    const source = shown.slice(before, before + piece.source.length)
    if (source === piece.source) return piece
    return { ...piece, source, outline: piece.outline.map(entry => (entry.depth === 0 ? { ...entry, source } : entry)) }
  }
}

function frontMatterOf(text: string): Front | undefined {
  if (!text.startsWith('---\n')) return undefined
  const lines: string[] = []
  let start = 4
  while (lines.length < FRONT_MATTER_LINES) {
    const end = text.indexOf('\n', start)
    const line = text.slice(start, end === -1 ? undefined : end)
    if (FRONT_MATTER_FENCE.test(line)) return frontOf(text, lines, end === -1 ? text.length : end + 1)
    if (end === -1) return undefined
    lines.push(line)
    start = end + 1
  }
  return undefined
}

function frontOf(text: string, lines: string[], bodyStart: number): Front | undefined {
  if (!FRONT_MATTER_KEY.test(lines[0] ?? '') || !lines.every(isFrontMatterLine)) return undefined
  return { piece: codePiece(text.slice(0, bodyStart), 'yaml', lines.join('\n')), bodyStart }
}

function isFrontMatterLine(line: string): boolean {
  const key = FRONT_MATTER_KEY.exec(line)
  if (key) return !SENTENCE.test(key[1] ?? '')
  return FRONT_MATTER_LINE.test(line)
}
