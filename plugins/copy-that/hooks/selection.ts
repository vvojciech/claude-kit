import { ENTITY, decoded } from './lexer'

const VISIBLE = /[\p{L}\p{N}]/u

const HIDDEN_MARKUP = [/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, /\]\[[^\]\n]*\]/g, /<[^>\n]*>/g, /^[ \t]*\[[^\]]+\]:[^\n]*$/gm]

const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm

const INLINE_CODE = /(`+)[^`\n]+?\1/g

type Projection = { letters: string; at: number[]; ends: number[] }

// inline spans and fenced block bodies, where the renderer draws `<a>` or `&amp;` as written
function codeRanges(source: string, withInline = true): Cut[] {
  const ranges: Cut[] = []
  let opened: number | undefined
  let offset = 0
  for (const line of source.split('\n')) {
    const end = offset + line.length
    const isFence = /^[ \t]*(?:`{3,}|~{3,})/.test(line)
    if (isFence && opened === undefined) opened = end
    else if (isFence && opened !== undefined) {
      ranges.push({ from: opened, to: offset })
      opened = undefined
    } else if (withInline && opened === undefined) {
      for (const match of line.matchAll(INLINE_CODE)) {
        const from = offset + (match.index ?? 0)
        ranges.push({ from, to: from + match[0].length })
      }
    }
    offset = end + 1
  }
  if (opened !== undefined) ranges.push({ from: opened, to: source.length })
  return ranges
}

function hiddenRanges(source: string, fences: boolean): boolean[] {
  const hidden: boolean[] = new Array(source.length).fill(false)
  for (const pattern of fences ? HIDDEN_MARKUP : [...HIDDEN_MARKUP, FENCE_LINE]) {
    for (const match of source.matchAll(pattern)) {
      const from = (match.index ?? 0) + (match[0].startsWith(']') ? 1 : 0)
      for (let i = from; i < (match.index ?? 0) + match[0].length; i++) hidden[i] = true
    }
  }
  for (const { from, to } of codeRanges(source)) hidden.fill(false, from, to)
  return hidden
}

// entities the renderer decodes, outside code, by where they start: their letters are what shows
function drawnEntities(source: string, hidden: boolean[]): Map<number, { length: number; text: string }> {
  const code = codeRanges(source)
  const found = new Map<number, { length: number; text: string }>()
  for (const match of source.matchAll(ENTITY)) {
    const start = match.index ?? 0
    const text = decoded(match[0])
    const isCode = code.some(range => start >= range.from && start < range.to)
    if (text !== match[0] && !isCode && !hidden[start]) found.set(start, { length: match[0].length, text })
  }
  return found
}

function project(source: string, fences: boolean): Projection {
  const hidden = hiddenRanges(source, fences)
  const entities = drawnEntities(source, hidden)
  let letters = ''
  const at: number[] = []
  const ends: number[] = []
  const take = (char: string, index: number, end: number) => {
    letters += char
    // one entry per UTF-16 unit, so an indexOf into letters lines up with at
    for (let unit = 0; unit < char.length; unit++) {
      at.push(index)
      ends.push(end)
    }
  }
  for (let index = 0; index < source.length; ) {
    const entity = entities.get(index)
    if (entity) {
      for (const char of entity.text) if (VISIBLE.test(char)) take(char, index, index + entity.length)
      index += entity.length
      continue
    }
    const char = String.fromCodePoint(source.codePointAt(index) ?? 0)
    if (!hidden[index] && VISIBLE.test(char)) take(char, index, index + char.length)
    index += char.length
  }
  return { letters, at, ends }
}

function lettersOf(text: string): string {
  return [...text].filter(char => VISIBLE.test(char)).join('')
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

const INLINE_MARKUP = [
  /\*\*[^*\n]+\*\*/g,
  /__[^_\n]+__/g,
  /~~[^~\n]+~~/g,
  INLINE_CODE,
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,
  /(?<![*\w])\*[^*\s][^*\n]*\*(?![*\w])/g,
  /(?<![_\w])_[^_\s][^_\n]*_(?![_\w])/g,
]

type Cut = { from: number; to: number }

function widened(line: string, cut: Cut): Cut | undefined {
  for (const pattern of INLINE_MARKUP) {
    for (const match of line.matchAll(pattern)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      const straddles = start < cut.to && end > cut.from && (start < cut.from || end > cut.to)
      if (straddles) return { from: Math.min(start, cut.from), to: Math.max(end, cut.to) }
    }
  }
  return undefined
}

function balanced(line: string, cut: Cut): Cut {
  let current = cut
  for (let next = widened(line, current); next; next = widened(line, current)) current = next
  return current
}

function edges(selected: string): { lead: string; tail: string } {
  const trimmed = selected.trim()
  return { lead: /^[^\p{L}\p{N}]*/u.exec(trimmed)?.[0] ?? '', tail: /[^\p{L}\p{N}]*$/u.exec(trimmed)?.[0] ?? '' }
}

function withEdges(line: string, cut: Cut, selected: string): Cut {
  const { lead, tail } = edges(selected)
  const from = lead !== '' && line.slice(cut.from - lead.length, cut.from) === lead ? cut.from - lead.length : cut.from
  const to = tail !== '' && line.slice(cut.to, cut.to + tail.length) === tail ? cut.to + tail.length : cut.to
  return { from, to }
}

function lettersWithin(projection: Projection, start: number, end: number): number {
  return projection.at.filter(index => index >= start && index < end).length
}

function excerpt(source: string, projection: Projection, span: Span, selected: string): string {
  const from = projection.at[span.from] ?? 0
  const last = projection.at[span.to] ?? source.length - 1
  const start = lineStart(source, from)
  const end = lineEnd(source, last)
  const line = source.slice(start, end)
  if (line.includes('\n') || lettersWithin(projection, start, end) === span.to - span.from + 1) return line
  const to = projection.ends[span.to] ?? last + 1
  // code draws `**` and `_` as written, so a fenced line is cut where the letters are, not widened to markup
  const isFenced = codeRanges(source, false).some(range => start >= range.from && start < range.to)
  const exact = { from: from - start, to: to - start }
  const cut = isFenced ? withEdges(line, exact, selected) : balanced(line, withEdges(line, balanced(line, exact), selected))
  return line.slice(cut.from, cut.to)
}

type Span = { from: number; to: number }

export type Behind = { text: string } | { places: number }

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
  const lines = selected.split('\n').map(lettersOf).filter(line => line !== '')
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
  for (const fences of [true, false]) {
    const projection = project(source, fences)
    const lines = spansIn(projection, selected).map(span => excerpt(source, projection, span, selected))
    const found = settled(lines)
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
