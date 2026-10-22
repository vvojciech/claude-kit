const VISIBLE = /[\p{L}\p{N}]/u

const HIDDEN_MARKUP = [/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, /<[^>\n]*>/g, /&(?:#x?[\da-f]+|[a-z][a-z\d]*);/gi, /^[ \t]*\[[^\]]+\]:[^\n]*$/gm]

const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm

type Projection = { letters: string; at: number[] }

function hiddenRanges(source: string, fences: boolean): boolean[] {
  const hidden: boolean[] = new Array(source.length).fill(false)
  for (const pattern of fences ? HIDDEN_MARKUP : [...HIDDEN_MARKUP, FENCE_LINE]) {
    for (const match of source.matchAll(pattern)) {
      const from = (match.index ?? 0) + (match[0].startsWith(']') ? 1 : 0)
      for (let i = from; i < (match.index ?? 0) + match[0].length; i++) hidden[i] = true
    }
  }
  return hidden
}

function project(source: string, fences: boolean): Projection {
  const hidden = hiddenRanges(source, fences)
  let letters = ''
  const at: number[] = []
  let index = 0
  for (const char of source) {
    if (!hidden[index] && VISIBLE.test(char)) {
      letters += char
      at.push(index)
    }
    index += char.length
  }
  return { letters, at }
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
  /(`+)[^`\n]+?\1/g,
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
  const to = last + ((source.codePointAt(last) ?? 0) > 0xffff ? 2 : 1)
  const cut = balanced(line, withEdges(line, balanced(line, { from: from - start, to: to - start }), selected))
  return line.slice(cut.from, cut.to)
}

type Span = { from: number; to: number }

export type Behind = { text: string } | { places: number }

function occurrences(haystack: string, wanted: string): number[] {
  const found: number[] = []
  for (let at = haystack.indexOf(wanted); at !== -1; at = haystack.indexOf(wanted, at + wanted.length)) found.push(at)
  return found
}

function exactSpans(projection: Projection, wanted: string): Span[] {
  if (wanted === '') return []
  return occurrences(projection.letters, wanted).map(start => ({ from: start, to: start + wanted.length - 1 }))
}

function lineSpan(projection: Projection, lines: string[]): Span | undefined {
  if (lines.length < 2) return undefined
  const first = lines[0] ?? ''
  const last = lines[lines.length - 1] ?? ''
  const head = projection.letters.indexOf(first)
  if (head === -1) return undefined
  const tail = projection.letters.lastIndexOf(last)
  return tail < head + first.length ? undefined : { from: head, to: tail + last.length - 1 }
}

function spansIn(projection: Projection, selected: string): Span[] {
  const lines = selected.split('\n').map(lettersOf).filter(line => line !== '')
  const exact = exactSpans(projection, lines.join(''))
  if (exact.length > 0) return exact
  const anchored = lineSpan(projection, lines)
  return anchored ? [anchored] : []
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
