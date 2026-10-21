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

const PRE = /^[ \t]*<pre(\s[^>]*)?>\n?([\s\S]*?)(?:<\/pre>[ \t]*\n?([\s\S]*))?$/i

const CODE_WRAPPER = /^<code(\s[^>]*)?>([\s\S]*?)<\/code>\s*$/i

const MARKUP = /<\/?[a-z][a-z\d]*(?:\s[^<>]*)?\/?>/g

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][a-zA-Z\d]{1,31}));/g

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

function decoded(text: string): string {
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
  const pre = PRE.exec(token.text)
  if (!pre) return flowBlocks(token.text, token.raw, depth)
  const wrapper = CODE_WRAPPER.exec(pre[2] ?? '')
  const body = wrapper ? (wrapper[2] ?? '') : (pre[2] ?? '')
  const text = decoded(body.replace(COMMENT, '').replace(MARKUP, '')).replace(/\n$/, '')
  const code: Block = { kind: 'code', source: token.raw, depth, lang: languageOf(`${pre[1] ?? ''} ${wrapper?.[1] ?? ''}`), text }
  return [code, ...flowBlocks(pre[3] ?? '', token.raw, depth)]
}

function isBareAlert(token: Token | undefined): boolean {
  if (token?.type !== 'paragraph') return false
  const [lead, ...rest] = (token as Tokens.Paragraph).tokens
  if (lead?.type !== 'text') return false
  const alert = ALERT.exec((lead as Tokens.Text).text)
  return alert !== null && (lead as Tokens.Text).text.length === alert[0].length && rest.length === 0
}

function quoteBlocks(token: Tokens.Blockquote, depth: number): Block[] {
  const inside = isBareAlert(token.tokens[0]) ? token.tokens.slice(1) : token.tokens
  return [{ kind: 'quote', source: token.raw, depth }, ...blocksOfTokens(inside, depth + 1)]
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

const cache = new Map<string, Block[]>()

let cachedChars = 0

function remember(text: string, blocks: Block[]): Block[] {
  cache.set(text, blocks)
  cachedChars += text.length
  while (cachedChars > CACHE_CHARS && cache.size > 1) {
    const [oldest] = cache.keys()
    if (oldest === undefined) break
    cache.delete(oldest)
    cachedChars -= oldest.length
  }
  return blocks
}

export function blocksOf(text: string): Block[] {
  const cached = cache.get(text)
  if (cached) {
    cache.delete(text)
    cache.set(text, cached)
    return cached
  }
  try {
    return remember(text, lexed(text))
  } catch {
    return remember(text, [])
  }
}

export function cacheChars(): number {
  return cachedChars
}
