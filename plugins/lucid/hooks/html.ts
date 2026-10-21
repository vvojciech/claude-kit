import { decodeEntities } from './entities'

export type TagRole = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'image' | 'text' | 'quote' | 'superscript' | 'subscript' | 'break' | 'block' | 'hidden'

export type Tag = { name: string; role: TagRole; closing: boolean; empty: boolean; attributes: Record<string, string> }

export type Pre = { language: string; source: string; rest: string }

const ROLES: Record<string, TagRole> = {
  ...roles('bold', ['b', 'strong']),
  ...roles('italic', ['i', 'em', 'cite', 'dfn', 'var']),
  ...roles('strike', ['del', 's', 'strike']),
  ...roles('code', ['code', 'kbd', 'samp', 'tt']),
  ...roles('text', ['span', 'u', 'ins', 'mark', 'small', 'big', 'abbr', 'time', 'data', 'bdi', 'bdo', 'font']),
  ...roles('block', ['p', 'div', 'details', 'summary', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'center', 'figure', 'figcaption', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr']),
  a: 'link',
  img: 'image',
  q: 'quote',
  sup: 'superscript',
  sub: 'subscript',
  br: 'break',
  wbr: 'hidden',
}

const VOID = new Set(['br', 'wbr', 'img', 'hr'])

const TAG = /^<(\/?)([a-z][a-z\d]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/

const ATTRIBUTE = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g

const MARKUP = /<\/?[a-z][a-z\d]*(?:\s[^<>]*)?\/?>/g

const PRE = /^[ \t]*<pre(\s[^>]*)?>\n?([\s\S]*?)(?:<\/pre>[ \t]*\n?([\s\S]*))?$/i

const CODE_WRAPPER = /^<code(\s[^>]*)?>([\s\S]*?)<\/code>\s*$/i

const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' }

const SUBSCRIPT: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' }

function roles(role: TagRole, names: string[]): Record<string, TagRole> {
  return Object.fromEntries(names.map(name => [name, role]))
}

export function tagOf(markup: string): Tag | undefined {
  const match = TAG.exec(markup)
  const name = match?.[2]
  const role = name !== undefined && Object.hasOwn(ROLES, name) ? ROLES[name] : undefined
  if (!match || name === undefined || role === undefined) return undefined
  const closing = match[1] === '/'
  if (closing && (match[3] !== '' || match[4] !== '')) return undefined
  return { name, role, closing, empty: VOID.has(name) || match[4] === '/', attributes: attributesOf(match[3] ?? '') }
}

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [, name = '', double, single, bare] of source.matchAll(ATTRIBUTE)) attributes[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '')
  return attributes
}

export function isComment(markup: string): boolean {
  return markup.startsWith('<!--')
}

function shifted(text: string, table: Record<string, string>, marker: string): string {
  const chars = [...text]
  return chars.length > 0 && chars.every(char => table[char] !== undefined) ? chars.map(char => table[char]).join('') : `${marker}(${text})`
}

export function superscript(text: string): string {
  return shifted(text, SUPERSCRIPT, '^')
}

export function subscript(text: string): string {
  return shifted(text, SUBSCRIPT, '_')
}

function blockMarkupText(markup: string): string {
  const tag = tagOf(markup)
  if (!tag) return markup
  return tag.role === 'block' || tag.role === 'break' ? '\n' : markup
}

export function flowOfBlock(html: string): string {
  return html.replace(COMMENT, '').replace(MARKUP, blockMarkupText).replace(/[ \t]*\n\s*/g, '\n').trim()
}

function languageOf(attributes: string): string {
  const named = /\blang(?:uage)?\s*=\s*["']?([\w+#.-]+)/i.exec(attributes)?.[1]
  const classed = /\bclass\s*=\s*["']?[^"'>]*\blang(?:uage)?-([\w+#.-]+)/i.exec(attributes)?.[1]
  return (named ?? classed ?? '').toLowerCase()
}

function withoutMarkup(source: string): string {
  return source.replace(COMMENT, '').replace(MARKUP, markup => (tagOf(markup) ? '' : markup))
}

export function preOf(html: string): Pre | undefined {
  const match = PRE.exec(html)
  if (!match) return undefined
  const wrapper = CODE_WRAPPER.exec(match[2] ?? '')
  const body = wrapper ? (wrapper[2] ?? '') : (match[2] ?? '')
  const source = decodeEntities(withoutMarkup(body)).replace(/\n$/, '')
  return { language: languageOf(`${match[1] ?? ''} ${wrapper?.[1] ?? ''}`), source, rest: match[3] ?? '' }
}
