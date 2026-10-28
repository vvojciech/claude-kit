import { lexBlocks } from './bounded-lexer'
import type { Token, Tokens } from './vendor/marked.js'

import type { Block } from './model'

const CACHE_CHARS = 4_000_000

const FRONT_MATTER_LINES = 200

const FRONT_MATTER_KEY = /^[a-z_][a-z\d_-]*:(?:[ \t]+(.*))?$/

const FRONT_MATTER_LINE = /^(?:[ \t]|- |#|$)/

const FRONT_MATTER_FENCE = /^---[ \t]*$/

const SENTENCE = /\s.*[.!?]$/

const ALERT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g

type Pre = { attributes: string; body: string; after: string }

// a `<pre>` block opening the html, its body up to the first `</pre>`, and whatever follows that
function preOf(html: string): Pre | undefined {
  const lower = html.toLowerCase()
  let at = 0
  while (html[at] === ' ' || html[at] === '\t') at++
  if (!lower.startsWith('<pre', at)) return undefined
  const open = at + '<pre'.length
  if (html[open] !== '>' && !/\s/.test(html[open] ?? '')) return undefined
  const close = html.indexOf('>', open)
  if (close < 0) return undefined
  const start = html[close + 1] === '\n' ? close + 2 : close + 1
  const end = lower.indexOf('</pre>', start)
  if (end < 0) return { attributes: html.slice(open, close), body: html.slice(start), after: '' }
  let rest = end + '</pre>'.length
  while (html[rest] === ' ' || html[rest] === '\t') rest++
  if (html[rest] === '\n') rest++
  return { attributes: html.slice(open, close), body: html.slice(start, end), after: html.slice(rest) }
}

// a `<code>` element wrapping the whole of a `<pre>` body
function codeWrapperOf(body: string): { attributes: string; inner: string } | undefined {
  const lower = body.toLowerCase()
  if (!lower.startsWith('<code')) return undefined
  const open = '<code'.length
  const next = body[open]
  if (next === undefined || (next !== '>' && next.trim() !== '')) return undefined
  const close = body.indexOf('>', open)
  const end = lower.lastIndexOf('</code>')
  if (close < 0 || end <= close || body.slice(end + '</code>'.length).trim() !== '') return undefined
  return { attributes: body.slice(open, close), inner: body.slice(close + 1, end) }
}

const MARKUP = /<\/?[a-z][a-z\d]*(?:\s[^<>]*)?\/?>/g

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

export const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][a-zA-Z\d]{1,31}));/g

type Front = { block: Block; bodyStart: number }

function isFrontMatterLine(line: string): boolean {
  const key = FRONT_MATTER_KEY.exec(line)
  if (key) return !SENTENCE.test(key[1] ?? '')
  return FRONT_MATTER_LINE.test(line)
}

function frontMatterOf(text: string): Front | undefined {
  if (!text.startsWith('---\n')) return undefined
  const lines: string[] = []
  let start = 4
  while (lines.length < FRONT_MATTER_LINES) {
    const end = text.indexOf('\n', start)
    const line = text.slice(start, end === -1 ? undefined : end)
    if (FRONT_MATTER_FENCE.test(line)) {
      const bodyStart = end === -1 ? text.length : end + 1
      if (!FRONT_MATTER_KEY.test(lines[0] ?? '') || !lines.every(isFrontMatterLine)) return undefined
      return { block: { kind: 'code', source: text.slice(0, bodyStart), depth: 0, lang: 'yaml', text: lines.join('\n') }, bodyStart }
    }
    if (end === -1) return undefined
    lines.push(line)
    start = end + 1
  }
  return undefined
}

function codeBlock(token: Tokens.Code, depth: number): Block {
  const lang = ((token.lang ?? '').trim().split(/\s+/)[0] ?? '').toLowerCase()
  return { kind: 'code', source: token.raw, depth, lang, text: token.text }
}

export function decoded(text: string): string {
  return text.replace(ENTITY, (whole: string, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return ENTITIES[name] ?? whole
    const code = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'
  })
}

function languageOf(attributes: string): string {
  const named = /\blang(?:uage)?\s*=\s*["']?([\w+#.-]+)/i.exec(attributes)?.[1]
  const classed = /\bclass\s*=\s*["']?[^"'>]*\blang(?:uage)?-([\w+#.-]+)/i.exec(attributes)?.[1]
  return (named ?? classed ?? '').toLowerCase()
}

function flowBlocks(html: string, source: string, depth: number): Block[] {
  const visible = html.replace(COMMENT, '').replace(MARKUP, '').trim()
  return visible === '' ? [] : [{ kind: 'paragraph', source, depth }]
}

function htmlBlocks(token: Tokens.HTML, depth: number): Block[] {
  const pre = preOf(token.text)
  if (!pre) return flowBlocks(token.text, token.raw, depth)
  const wrapper = codeWrapperOf(pre.body)
  const body = wrapper ? wrapper.inner : pre.body
  const text = decoded(body.replace(COMMENT, '').replace(MARKUP, '')).replace(/\n$/, '')
  const code: Block = { kind: 'code', source: token.raw, depth, lang: languageOf(`${pre.attributes} ${wrapper?.attributes ?? ''}`), text }
  return [code, ...flowBlocks(pre.after, token.raw, depth)]
}

function alertMarker(token: Token | undefined): string | undefined {
  if (token?.type !== 'paragraph') return undefined
  const lead = (token as Tokens.Paragraph).tokens[0]
  if (lead?.type !== 'text') return undefined
  return ALERT.exec((lead as Tokens.Text).text)?.[0]
}

function withoutAlert(tokens: Token[], depth: number): Block[] {
  const [first, ...others] = tokens
  const marker = alertMarker(first)
  if (first === undefined || marker === undefined) return blocksOfTokens(tokens, depth)
  const body = first.raw.slice(marker.length)
  const lead = body.trim() === '' ? [] : [{ kind: 'paragraph', source: body, depth } as Block]
  return [...lead, ...blocksOfTokens(others, depth)]
}

function quoteBlocks(token: Tokens.Blockquote, depth: number): Block[] {
  return [{ kind: 'quote', source: token.raw, depth }, ...withoutAlert(token.tokens, depth + 1)]
}

function blocksOfToken(token: Token, depth: number): Block[] {
  switch (token.type) {
    case 'code':
      return [codeBlock(token as Tokens.Code, depth)]
    case 'table':
      return [{ kind: 'table', source: token.raw, depth }]
    case 'heading':
      return [{ kind: 'heading', source: token.raw, depth }]
    case 'paragraph':
    case 'text':
      return [{ kind: 'paragraph', source: token.raw, depth }]
    case 'hr':
      return [{ kind: 'rule', source: token.raw, depth }]
    case 'html':
      return htmlBlocks(token as Tokens.HTML, depth)
    case 'blockquote':
      return quoteBlocks(token as Tokens.Blockquote, depth)
    case 'list':
      return [{ kind: 'list', source: token.raw, depth }, ...(token as Tokens.List).items.flatMap(item => blocksOfTokens(item.tokens, depth + 1))]
    default:
      return []
  }
}

function blocksOfTokens(tokens: Token[], depth: number): Block[] {
  return tokens.flatMap(token => blocksOfToken(token, depth))
}

function lexed(text: string): Block[] {
  const normal = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
  const front = frontMatterOf(normal)
  const body = front ? normal.slice(front.bodyStart) : normal
  const blocks = blocksOfTokens(lexBlocks(body), 0)
  return front ? [front.block, ...blocks] : blocks
}

export class SizedCache<T> {
  private readonly entries = new Map<string, T>()
  private total = 0

  constructor(private readonly limit: number) {}

  get(key: string): T | undefined {
    const found = this.entries.get(key)
    if (found === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, found)
    return found
  }

  set(key: string, value: T): T {
    this.entries.set(key, value)
    this.total += key.length
    this.evict()
    return value
  }

  chars(): number {
    return this.total
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  private evict(): void {
    for (const oldest of this.entries.keys()) {
      if (this.total <= this.limit || this.entries.size <= 1) return
      this.entries.delete(oldest)
      this.total -= oldest.length
    }
  }
}

const cache = new SizedCache<Block[]>(CACHE_CHARS)

export function blocksOf(text: string): Block[] {
  const cached = cache.get(text)
  if (cached) return cached
  try {
    return cache.set(text, lexed(text))
  } catch {
    return cache.set(text, [])
  }
}

export function cacheChars(): number {
  return cache.chars()
}
