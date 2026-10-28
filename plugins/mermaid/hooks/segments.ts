import { Lexer } from './vendor/marked.js'
import type { Links, Token, Tokens } from './vendor/marked.js'

export type Segment = { kind: 'text'; text: string } | { kind: 'sequence' | 'flow'; source: string; fence: string } | { kind: 'other'; type: string }

type Fence = { from: number; to: number; code: Tokens.Code }

const isMermaid = (code: Tokens.Code) => (code.lang ?? '').split(' ')[0]?.split('\t')[0] === 'mermaid'

const count = (text: string, from: number, to: number) => {
  let lines = 0
  for (let at = text.indexOf('\n', from); at !== -1 && at < to; at = text.indexOf('\n', at + 1)) lines++
  return lines
}

const lineCount = (raw: string) => count(raw.trimEnd(), 0, raw.length) + 1

// container text keeps the lines of the raw it came from, so a token's line in the text is its line in the reply
function collect(tokens: Token[], text: string, row: number, fences: Fence[]): void {
  let at = 0
  let line = row
  for (const token of tokens) {
    const start = text.indexOf(token.raw, at)
    if (start === -1) continue
    line += count(text, at, start)
    if (token.type === 'code' && isMermaid(token as Tokens.Code)) fences.push({ from: line, to: line + lineCount(token.raw) - 1, code: token as Tokens.Code })
    if (token.type === 'blockquote') collect((token as Tokens.Blockquote).tokens, (token as Tokens.Blockquote).text, line, fences)
    if (token.type === 'list') collect((token as Tokens.List).items, token.raw, line, fences)
    if (token.type === 'list_item') collect((token as Tokens.ListItem).tokens, (token as Tokens.ListItem).text, line, fences)
    line += count(text, start, start + token.raw.length)
    at = start + token.raw.length
  }
}

function isClosed(raw: string): boolean {
  const lines = raw.trimEnd().split('\n')
  const opening = (lines[0] ?? '').trimStart()
  const mark = opening.charAt(0)
  let length = 0
  while (opening[length] === mark) length++
  const closing = (lines.at(-1) ?? '').trim()
  return lines.length > 1 && closing.length >= length && [...closing].every(char => char === mark)
}

// a fence stays text while it may still be streaming: unclosed with nothing after it
function isDone(fence: Fence, lines: string[]): boolean {
  if (isClosed(fence.code.raw)) return true
  for (let at = fence.to + 1; at < lines.length; at++) if ((lines[at] ?? '').trim() !== '') return true
  return false
}

// a fence is cut out only where the reply's lines end in the fence marked read, so a miscount never garbles prose
function isInPlace(fence: Fence, lines: string[]): boolean {
  const raw = fence.code.raw.trimEnd().split('\n')
  return raw.every((line, i) => (lines[fence.from + i] ?? '').trimEnd().endsWith(line.trimEnd()))
}

function lexed(markdown: string): { fences: Fence[]; links: Links } {
  const lexer = new Lexer()
  const fences: Fence[] = []
  try {
    collect(lexer.blockTokens(markdown), markdown, 0, fences)
    return { fences, links: lexer.tokens.links }
  } catch {
    return { fences: [], links: {} }
  }
}

const escaped = (text: string, chars: string) => [...text].map(char => (chars.includes(char) ? `\\${char}` : char)).join('')

// link reference definitions, first of each label, for the prose cut away from them by a diagram
const definitionsOf = (links: Links) =>
  Object.entries(links)
    .map(([label, { href, title }]) => `[${label}]: <${escaped(href, '\\<>')}>${title ? ` "${escaped(title, '\\"')}"` : ''}`)
    .join('\n')

function trimmed(lines: string[]): string {
  let [from, to] = [0, lines.length]
  while (from < to && (lines[from] ?? '').trim() === '') from++
  while (to > from && (lines[to - 1] ?? '').trim() === '') to--
  return lines.slice(from, to).join('\n')
}

// Each piece is drawn by its own next(), so a diagram inside a list restarts the list after it.
export function segmentsOf(markdown: string, typeOf: (source: string) => string): Segment[] {
  if (!markdown.includes('mermaid')) return [{ kind: 'text', text: markdown }]
  const text = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const { fences, links } = lexed(text)
  const lines = text.split('\n')
  const definitions = definitionsOf(links)
  const parts: Segment[] = []
  let at = 0
  const prose = (to: number) => {
    const piece = trimmed(lines.slice(at, to))
    if (piece !== '') parts.push({ kind: 'text', text: definitions ? `${definitions}\n\n${piece}` : piece })
  }
  for (const fence of fences.filter(one => isDone(one, lines) && isInPlace(one, lines))) {
    const type = typeOf(fence.code.text)
    if (type === 'sequence' || type === 'flow') {
      prose(fence.from)
      parts.push({ kind: type, source: fence.code.text, fence: fence.code.raw.trimEnd() })
    } else {
      prose(fence.to + 1)
      parts.push({ kind: 'other', type })
    }
    at = fence.to + 1
  }
  prose(lines.length)
  return parts
}
