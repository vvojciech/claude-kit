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

function wholeLines(source: string, from: number, to: number): string {
  const start = source.lastIndexOf('\n', from - 1) + 1
  const newline = source.indexOf('\n', to)
  return source.slice(start, newline === -1 ? source.length : newline)
}

type Span = { from: number; to: number }

function exactSpan(projection: Projection, wanted: string): Span | undefined {
  const start = projection.letters.indexOf(wanted)
  return start === -1 ? undefined : { from: start, to: start + wanted.length - 1 }
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

function spanIn(projection: Projection, selected: string): Span | undefined {
  const lines = selected.split('\n').map(lettersOf).filter(line => line !== '')
  return exactSpan(projection, lines.join('')) ?? lineSpan(projection, lines)
}

function literalSpan(source: string, selected: string): string | undefined {
  const wanted = selected.trim()
  if (wanted === '') return undefined
  const at = source.indexOf(wanted)
  return at === -1 ? undefined : wholeLines(source, at, at + wanted.length - 1)
}

export function sourceBehind(source: string, selected: string): string | undefined {
  if (lettersOf(selected) === '') return literalSpan(source, selected)
  for (const fences of [true, false]) {
    const projection = project(source, fences)
    const span = spanIn(projection, selected)
    if (span) return wholeLines(source, projection.at[span.from] ?? 0, projection.at[span.to] ?? source.length - 1)
  }
  return undefined
}

export function firstSourceBehind(sources: string[], selected: string): string | undefined {
  for (const source of sources) {
    const found = sourceBehind(source, selected)
    if (found !== undefined) return found
  }
  return undefined
}
