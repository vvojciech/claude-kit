import type { Token, Tokens } from './vendor/marked.js'

import { decodeEntities } from './entities'
import { flowOfBlock, isComment, preOf, subscript, superscript, tagOf } from './html'
import type { Tag } from './html'
import { lexBlocks, lexInline } from './lexer'
import { cellWidth } from './width'
import type { LucidBlock } from '../types'

export type Align = 'left' | 'right' | 'center'

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type ListItem = {
  marker: 'bullet' | 'number' | 'todo' | 'done'
  number?: string
  blocks: Block[]
}

export type Block = (
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; loose: boolean; items: ListItem[] }
  | { kind: 'code'; language: string; source: string }
  | { kind: 'table'; header: Span[][]; align: (Align | undefined)[]; rows: Span[][][] }
  | { kind: 'quote'; alert?: AlertKind; blocks: Block[] }
  | { kind: 'rule' }
) & { hang?: number }

export type OutlineEntry = LucidBlock

export type Piece = { source: string; blocks: Block[]; outline: OutlineEntry[] }

export type SpanKind = 'plain' | 'code' | 'url' | 'path' | 'line' | 'image' | 'footnote'

export type ShellKind = 'command' | 'subcommand' | 'flag' | 'string' | 'number' | 'path' | 'variable' | 'operator' | 'word' | 'space'

export type Span = {
  text: string
  kind: SpanKind | ShellKind
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
  href?: string
  src?: string
}

export type Footnotes = { has(label: string): boolean; readonly size: number }

type Style = { bold?: boolean; italic?: boolean; strike?: boolean; underline?: boolean; href?: string; inLink?: boolean; footnotes?: Footnotes }

type Trail = { depth: number; outline: OutlineEntry[]; footnotes: Footnotes }

const NO_FOOTNOTES: Footnotes = new Set()

export function pieceOf(token: Token, footnotes: Footnotes = NO_FOOTNOTES): Piece {
  const outline: OutlineEntry[] = []
  return { source: token.raw, blocks: blocksOf([token], { depth: 0, outline, footnotes }), outline }
}

const FOOTNOTE_LABEL = /^ {0,3}\[\^([^\]\s]+)\]:/gm

export function footnoteLabels(markdown: string): Footnotes {
  return new Set(Array.from(markdown.matchAll(FOOTNOTE_LABEL), match => footnoteKey(match[1] ?? '')))
}

function footnoteKey(label: string): string {
  return label.toLowerCase()
}

type FootnoteToken = { type: 'footnote'; raw: string; tokens: Token[] }

export function withFootnoteBodies(tokens: Token[]): Token[] {
  const folded: Token[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token
    const end = isFootnoteLead(token) ? continuationEnd(tokens, i + 1) : i + 1
    folded.push(end === i + 1 ? token : footnoteToken(tokens.slice(i, end)))
    i = end - 1
  }
  return folded
}

function isFootnoteLead(token: Token): boolean {
  if (token.type !== 'paragraph') return false
  return FOOTNOTE_DEFINITION.test(token.raw.split(NEXT_FOOTNOTE_DEFINITION).at(-1) ?? '')
}

function isContinuation(token: Token | undefined): boolean {
  return token?.type === 'code' && (token as Tokens.Code).codeBlockStyle === 'indented'
}

function continuationEnd(tokens: Token[], from: number): number {
  let end = from
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i]
    if (isContinuation(token)) end = i + 1
    else if (token?.type !== 'space') break
  }
  return end
}

function footnoteBlocks(footnote: FootnoteToken, trail: Trail): Block[] {
  const [lead, ...rest] = footnote.tokens
  const leadBlocks = lead ? blockOf(lead, trail) : []
  const label = FOOTNOTE_DEFINITION.exec(lead?.raw.split(NEXT_FOOTNOTE_DEFINITION).at(-1) ?? '')?.[1] ?? ''
  const hang = cellWidth(`[${label}] `)
  return [...leadBlocks, ...blocksOf(rest, deeper(trail)).map(block => ({ ...block, hang }))]
}

function footnoteToken([lead, ...rest]: Token[]): Token {
  const body = rest.filter(isContinuation).map(token => (token as Tokens.Code).text).join('\n\n')
  const footnote: FootnoteToken = { type: 'footnote', raw: [lead, ...rest].map(token => token?.raw ?? '').join(''), tokens: [lead as Token, ...lexBlocks(body)] }
  return footnote as unknown as Token
}

export function codePiece(source: string, language: string, code: string): Piece {
  return { source, blocks: [{ kind: 'code', language, source: code }], outline: [{ kind: 'code', source: withoutTrailingNewlines(source), depth: 0, lang: language, text: code }] }
}

function withoutTrailingNewlines(source: string): string {
  return source.replace(/\n+$/, '')
}

function noted<B extends Block>(trail: Trail, block: B, source: string): B {
  const entry: OutlineEntry = { kind: block.kind, source: withoutTrailingNewlines(source), depth: trail.depth }
  if (block.kind === 'code') Object.assign(entry, { lang: block.language, text: block.source })
  trail.outline.push(entry)
  return block
}

function deeper(trail: Trail): Trail {
  return { ...trail, depth: trail.depth + 1 }
}

function blocksOf(tokens: Token[], trail: Trail): Block[] {
  return tokens.flatMap(token => blockOf(token, trail))
}

function blockOf(token: Token, trail: Trail): Block[] {
  switch (token.type) {
    case 'heading':
      return [noted(trail, { kind: 'heading', level: (token as Tokens.Heading).depth, spans: spansOf((token as Tokens.Heading).tokens, baseStyle(trail)) }, token.raw)]
    case 'paragraph':
    case 'text':
      return footnoteParagraphs(token as Tokens.Paragraph | Tokens.Text, trail)
    case 'code':
      return [noted(trail, codeOf(token as Tokens.Code), token.raw)]
    case 'list':
      return [listOf(token as Tokens.List, trail)]
    case 'table':
      return [noted(trail, tableOf(token as Tokens.Table, baseStyle(trail)), token.raw)]
    case 'blockquote':
      return [quoteOf(token as Tokens.Blockquote, trail)]
    case 'hr':
      return [noted(trail, { kind: 'rule' }, token.raw)]
    case 'html':
      return htmlBlockOf(token as Tokens.HTML, trail)
    case 'footnote':
      return footnoteBlocks(token as unknown as FootnoteToken, trail)
    default:
      return []
  }
}

const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*/

const NEXT_FOOTNOTE_DEFINITION = /(?<=\n)(?= {0,3}\[\^[^\]\s]+\]:)/

function footnoteParagraphs(token: Tokens.Paragraph | Tokens.Text, trail: Trail): Block[] {
  const sources = token.raw.split(NEXT_FOOTNOTE_DEFINITION)
  if (sources.length === 1) return [noted(trail, paragraphOf(token.tokens ?? [token], trail), token.raw)]
  return sources.map(source => noted(trail, paragraphOf(lexInline(source.trim()), trail), source))
}

function baseStyle(trail: Trail): Style {
  return trail.footnotes.size > 0 ? { footnotes: trail.footnotes } : {}
}

function paragraphOf(tokens: Token[], trail: Trail): Block {
  const [first, ...rest] = [lineStart(tokens[0]), ...tokens.slice(1)].filter(token => token !== undefined)
  const definition = first?.type === 'text' ? FOOTNOTE_DEFINITION.exec((first as Tokens.Text).text) : null
  if (!first || !definition) return { kind: 'paragraph', spans: spansOf([first, ...rest].filter(token => token !== undefined), baseStyle(trail)) }
  const body = { ...first, text: (first as Tokens.Text).text.slice(definition[0].length) } as Token
  return { kind: 'paragraph', spans: [{ text: `[${definition[1]}] `, kind: 'footnote' }, ...spansOf([body, ...rest], baseStyle(trail))] }
}

function codeOf(token: Tokens.Code): Block {
  const language = (token.lang ?? '').trim().split(/\s+/)[0] ?? ''
  return { kind: 'code', language: language.toLowerCase(), source: token.text }
}

function markerOf(list: Tokens.List, item: Tokens.ListItem): ListItem['marker'] {
  if (item.task) return item.checked ? 'done' : 'todo'
  return list.ordered ? 'number' : 'bullet'
}

const ORDERED_MARKER = /^[ \t]*\d{1,9}([.)])/

function listOf(token: Tokens.List, trail: Trail): Block {
  const list: Extract<Block, { kind: 'list' }> = noted(trail, { kind: 'list', loose: token.loose, items: [] }, token.raw)
  const start = typeof token.start === 'number' ? token.start : 1
  const delimiter = ORDERED_MARKER.exec(token.items[0]?.raw ?? '')?.[1] ?? '.'
  token.items.forEach((item, index) => {
    const marker = markerOf(token, item)
    const blocks = blocksOf(item.tokens, deeper(trail))
    list.items.push(marker === 'number' ? { marker, number: `${start + index}${delimiter}`, blocks } : { marker, blocks })
  })
  return list
}

function tableOf(token: Tokens.Table, style: Style): Block {
  return {
    kind: 'table',
    header: token.header.map(cell => cellSpans(cell.tokens, style)),
    align: token.align.map(align => align ?? undefined),
    rows: token.rows.map(row => row.map(cell => cellSpans(cell.tokens, style))),
  }
}

function cellSpans(tokens: Token[], style: Style): Span[] {
  const spans = spansOf(tokens, style)
  const first = spans[0]
  const last = spans.at(-1)
  if (first) first.text = first.text.replace(/^\n+/, '')
  if (last) last.text = last.text.replace(/\n+$/, '')
  return spans.filter(span => span.text !== '')
}

const ALERT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i

function quoteOf(token: Tokens.Blockquote, trail: Trail): Block {
  const quote: Extract<Block, { kind: 'quote' }> = noted(trail, { kind: 'quote', blocks: [] }, token.raw)
  const [first, ...others] = token.tokens
  const paragraph = first?.type === 'paragraph' ? (first as Tokens.Paragraph) : undefined
  const [lead, ...inline] = paragraph?.tokens ?? []
  const alert = lead?.type === 'text' ? ALERT.exec((lead as Tokens.Text).text) : null
  if (!paragraph || !lead || !alert) {
    quote.blocks.push(...blocksOf(token.tokens, deeper(trail)))
    return quote
  }
  const remainder = (lead as Tokens.Text).text.slice(alert[0].length)
  const body = remainder === '' ? inline : [{ ...lead, text: remainder } as Token, ...inline]
  quote.alert = (alert[1] ?? 'note').toLowerCase() as AlertKind
  const alertBody = { ...paragraph, raw: paragraph.raw.slice(alert[0].length), text: paragraph.text.slice(alert[0].length), tokens: body }
  quote.blocks.push(...blocksOf(body.length > 0 ? [alertBody, ...others] : others, deeper(trail)))
  return quote
}

function htmlBlockOf(token: Tokens.HTML, trail: Trail): Block[] {
  const pre = preOf(token.text)
  if (pre) return [noted(trail, { kind: 'code', language: pre.language, source: pre.source }, token.raw), ...flowBlocks(pre.rest, token.raw, trail)]
  return flowBlocks(token.text, token.raw, trail)
}

function flowBlocks(html: string, source: string, trail: Trail): Block[] {
  const flow = flowOfBlock(html)
  return flow === '' ? [] : [noted(trail, { kind: 'paragraph', spans: inlineSpans(flow, baseStyle(trail)) }, source)]
}

export function inlineSpans(text: string, style: Style = {}): Span[] {
  return spansOf(lexInline(text), style)
}

function spansOf(tokens: Token[], style: Style = {}): Span[] {
  const spans: Span[] = []
  const tags = tokens.map(tagOfToken)
  const closes = closingIndexes(tags)
  for (let i = 0; i < tokens.length; i++) {
    const token = afterGap(tokens, i, spans)
    const tag = tags[i]
    const close = closes.get(i) ?? -1
    const produced = tag && close !== -1 ? taggedSpans(tag, tokens.slice(i + 1, close), style) : spansOfToken(token, style)
    if (isBreak(token, tag)) trimLineEnd(spans)
    for (const span of produced) push(spans, span)
    if (close !== -1) i = close
  }
  return spans
}

function afterGap(tokens: Token[], i: number, spans: Span[]): Token {
  const previous = tokens[i - 1]
  const token = tokens[i] as Token
  if (isBreak(previous, tagOfToken(previous))) return lineStart(token) as Token
  return isHiddenComment(previous) && /\s$/.test(spans.at(-1)?.text ?? '') ? (lineStart(token) as Token) : token
}

function isBreak(token: Token | undefined, tag: Tag | undefined): boolean {
  return token?.type === 'br' || tag?.role === 'break'
}

function tagOfToken(token: Token | undefined): Tag | undefined {
  return token?.type === 'html' ? tagOf((token as Tokens.Tag).text) : undefined
}

function trimLineEnd(spans: Span[]): void {
  const last = spans.at(-1)
  if (!last) return
  last.text = last.text.replace(/[ \t]+$/, '')
  if (last.text === '') spans.pop()
}

function isHiddenComment(token: Token | undefined): boolean {
  return token?.type === 'html' && isComment((token as Tokens.Tag).text)
}

function closingIndexes(tags: (Tag | undefined)[]): Map<number, number> {
  const closes = new Map<number, number>()
  const open = new Map<string, number[]>()
  tags.forEach((tag, index) => {
    if (!tag || tag.empty) return
    const stack = open.get(tag.name) ?? []
    open.set(tag.name, stack)
    if (!tag.closing) stack.push(index)
    else if (stack.length > 0) closes.set(stack.pop() as number, index)
  })
  return closes
}

const CONTINUATION_INDENT = /\n[ \t]+/g

function lineStart(token: Token | undefined): Token | undefined {
  if (token?.type !== 'text') return token
  return { ...token, text: (token as Tokens.Text).text.replace(/^[ \t]+/, '') } as Token
}

function rawOf(tokens: Token[]): string {
  return tokens.map(token => token.raw).join('')
}

function textOf(spans: Span[]): string {
  return spans.map(span => span.text).join('')
}

function taggedSpans(tag: Tag, inner: Token[], style: Style): Span[] {
  switch (tag.role) {
    case 'bold':
      return spansOf(inner, { ...style, bold: true })
    case 'italic':
      return spansOf(inner, { ...style, italic: true })
    case 'strike':
      return spansOf(inner, { ...style, strike: true })
    case 'underline':
      return spansOf(inner, { ...style, underline: true })
    case 'code':
      return codeSpans(decodeEntities(rawOf(inner)), style)
    case 'link':
      return tag.attributes.href ? linkSpans({ type: 'link', raw: '', href: tag.attributes.href, title: null, text: rawOf(inner), tokens: inner }, style) : spansOf(inner, style)
    case 'quote':
      return [styled('“', plainKind(style), style), ...spansOf(inner, style), styled('”', plainKind(style), style)]
    case 'superscript':
      return [styled(superscript(textOf(spansOf(inner, style))), plainKind(style), style)]
    case 'subscript':
      return [styled(subscript(textOf(spansOf(inner, style))), plainKind(style), style)]
    default:
      return spansOf(inner, style)
  }
}

const STYLING_ROLES = new Set<Tag['role']>(['bold', 'italic', 'strike', 'underline', 'code', 'link', 'text', 'quote', 'superscript', 'subscript'])

function inlineHtmlSpans(markup: string, style: Style): Span[] {
  if (isComment(markup)) return []
  const tag = tagOf(markup)
  if (!tag || STYLING_ROLES.has(tag.role) || tag.role === 'block') return [styled(markup, plainKind(style), style)]
  if (tag.role === 'break') return [styled('\n', plainKind(style), style)]
  if (tag.role === 'image') return [imageOf(tag.attributes.alt ?? '', tag.attributes.src ?? '', style)]
  return []
}

function push(spans: Span[], span: Span): void {
  if (span.text === '') return
  const previous = spans.at(-1)
  if (previous && previous.kind === span.kind && span.kind !== 'path' && sameStyle(previous, span)) previous.text += span.text
  else spans.push(span)
}

function sameStyle(a: Span, b: Span): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.underline === b.underline && a.href === b.href
}

function spansOfToken(token: Token, style: Style): Span[] {
  switch (token.type) {
    case 'text':
      return textTokenSpans(token as Tokens.Text, style)
    case 'escape':
      return [styled((token as Tokens.Escape).text, plainKind(style), style)]
    case 'codespan':
      return codeSpans((token as Tokens.Codespan).text, style)
    case 'strong':
      return spansOf((token as Tokens.Strong).tokens, { ...style, bold: true })
    case 'em':
      return spansOf((token as Tokens.Em).tokens, { ...style, italic: true })
    case 'del':
      return spansOf((token as Tokens.Del).tokens, { ...style, strike: true })
    case 'link':
      return linkSpans(token as Tokens.Link, style)
    case 'image':
      return [imageOf((token as Tokens.Image).text, (token as Tokens.Image).href, style)]
    case 'br':
      return [styled('\n', plainKind(style), style)]
    case 'html':
      return inlineHtmlSpans((token as Tokens.Tag).text, style)
    case 'checkbox':
      return []
    default:
      return [styled(token.raw, plainKind(style), style)]
  }
}

function textTokenSpans(token: Tokens.Text, style: Style): Span[] {
  if (token.tokens && token.tokens.length > 0) return spansOf(token.tokens, style)
  const prose = token.text.replace(CONTINUATION_INDENT, '\n')
  const text = token.escaped ? prose : decodeEntities(prose)
  return style.inLink ? [styled(text, 'url', style)] : proseSpans(text, style)
}

function styled(text: string, kind: Span['kind'], style: Style): Span {
  const span: Span = { text, kind }
  if (style.bold) span.bold = true
  if (style.italic) span.italic = true
  if (style.strike) span.strike = true
  if (style.underline) span.underline = true
  if (style.href !== undefined) span.href = style.href
  return span
}

function plainKind(style: Style): SpanKind {
  return style.inLink ? 'url' : 'plain'
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i

const OPENABLE_SCHEME = /^(?:https?|mailto|file):/i

function hrefStyle(href: string): Style {
  return OPENABLE_SCHEME.test(href) ? { href } : {}
}

function linkSpans(token: Tokens.Link, style: Style): Span[] {
  if (!SCHEME.test(token.href)) return localLinkSpans(token, style)
  if (!OPENABLE_SCHEME.test(token.href)) return unopenableLinkSpans(token, style)
  const linkStyle: Style = { ...style, inLink: true, href: token.href }
  const spans = spansOf(token.tokens, linkStyle)
  return spans.length > 0 ? spans : [styled(token.href, 'url', linkStyle)]
}

function unopenableLinkSpans(token: Tokens.Link, style: Style): Span[] {
  const label = spansOf(token.tokens, style)
  return label.length > 0 ? label : [styled(token.href, plainKind(style), style)]
}

function localLinkSpans(token: Tokens.Link, style: Style): Span[] {
  const label = spansOf(token.tokens, style)
  const target = token.href.trim()
  if (target === '' || target.startsWith('#')) return label
  if (label.length === 0 || textOf(label) === target) return pathSpans(target, style)
  return [...label, styled(' ', 'plain', style), ...pathSpans(target, style)]
}

function imageOf(alt: string, href: string, style: Style): Span {
  const label = decodeEntities(alt).trim()
  const span = styled(label === '' ? '[image]' : `[image: ${label}]`, 'image', { ...style, ...hrefStyle(href) })
  return href.trim() === '' ? span : { ...span, src: href.trim() }
}

const PATH_SEGMENT = '[\\w@.+-]*[\\w@+-]'

const PROSE_PATH = new RegExp(`(?<![\\w/.~@-])((?:(?:~|\\.{1,2})\\/${PATH_SEGMENT}(?:\\/${PATH_SEGMENT})*|\\/?${PATH_SEGMENT}(?:\\/${PATH_SEGMENT})+)\\/?(?::\\d+(?::\\d+)?)?)`, 'g')

const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g

function proseSpans(text: string, style: Style): Span[] {
  return splitBy(text, FOOTNOTE_REFERENCE, match => footnoteReference(match[1] ?? '', style), style).flatMap(span =>
    span.kind === 'plain' ? splitBy(span.text, PROSE_PATH, match => (isProsePath(match[0]) ? pathSpans(match[0], style) : undefined), style) : [span],
  )
}

function footnoteReference(label: string, style: Style): Span[] | undefined {
  return style.footnotes?.has(footnoteKey(label)) ? [styled(`[${label}]`, 'footnote', style)] : undefined
}

function splitBy(text: string, pattern: RegExp, replace: (match: RegExpExecArray) => Span[] | undefined, style: Style): Span[] {
  const spans: Span[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const replacement = replace(match)
    if (!replacement) continue
    const index = match.index ?? 0
    if (index > last) spans.push(styled(text.slice(last, index), 'plain', style))
    spans.push(...replacement)
    last = index + match[0].length
  }
  if (last < text.length) spans.push(styled(text.slice(last), 'plain', style))
  return spans
}

export function isProsePath(text: string): boolean {
  const path = text.replace(/(?::\d+){1,2}$/, '')
  if (/^(?:~|\.{1,2})\//.test(path)) return true
  if (path.startsWith('/')) return path.split('/').filter(Boolean).length >= 2
  return FILE_WITH_EXTENSION.test(path.split('/').pop() ?? '')
}

const COMMANDS = new Set([
  'git', 'gh', 'bundle', 'rails', 'rake', 'ruby', 'gem', 'rspec', 'rubocop', 'npm', 'npx', 'yarn', 'pnpm', 'node', 'bun', 'deno',
  'cd', 'ls', 'cat', 'grep', 'rg', 'find', 'fd', 'sed', 'awk', 'jq', 'curl', 'wget', 'echo', 'export', 'source', 'mkdir', 'rm', 'cp', 'mv',
  'touch', 'chmod', 'tail', 'head', 'less', 'make', 'docker', 'kubectl', 'helm', 'terraform', 'aws', 'brew', 'tmux', 'ssh', 'scp',
  'python', 'python3', 'pip', 'go', 'cargo', 'claude', 'jira', 'sem', 'snow', 'newrelic', 'bd', 'tsc', 'sudo', 'env', 'which', 'kill',
  'open', 'code', 'vim', 'nvim', 'psql', 'mongosh', 'redis-cli', 'bin/rails', 'bin/rspec', 'bin/packwerk', 'bin/dev', 'bin/setup',
])

const SUBCOMMANDED = new Set([
  'git', 'gh', 'bundle', 'rails', 'bin/rails', 'rake', 'gem', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno', 'docker', 'kubectl', 'helm',
  'terraform', 'aws', 'brew', 'tmux', 'pip', 'go', 'cargo', 'claude', 'jira', 'sem', 'snow', 'newrelic', 'bd', 'make', 'sudo',
])

const PATH_WITH_SLASH = /^(?:~|\.{1,2})?\/?(?:[\w@.+-]+\/)+[\w@.+-]*(?::\d+(?::\d+)?)?$/
const FILE_WITH_EXTENSION = /^[\w.@+-]*\.(?:rb|rake|ts|tsx|js|jsx|mjs|cjs|md|mdx|json|ya?ml|py|go|rs|erb|haml|sh|zsh|toml|css|scss|html|sql|txt|lock|gemspec|ru|xml|csv|kt|java|swift|tf|gitignore)(?::\d+(?::\d+)?)?$/i

export function isPath(text: string): boolean {
  if (/\s/.test(text) || text.length < 3) return false
  if (/^https?:/.test(text)) return false
  if (FILE_WITH_EXTENSION.test(text)) return true
  if (!PATH_WITH_SLASH.test(text)) return false
  return /^(~|\.{1,2})?\//.test(text) || text.split('/').length > 2 || FILE_WITH_EXTENSION.test(text.split('/').pop() ?? '')
}

const SHELL_ARGUMENT = /^(?:--?[a-z]|\||&&|;|>|<|\$)/i

export function looksLikeCommand(text: string): boolean {
  if (text.includes('`')) return false
  const [first = '', ...rest] = text.trim().split(/\s+/)
  if (COMMANDS.has(first) || /^\.?\/?(bin|script)\/[\w-]+$/.test(first)) return rest.some(word => SHELL_ARGUMENT.test(word) || isPath(word))
  return /^[a-z][\w-]*$/.test(first) && rest.some(word => /^--?[a-z]/i.test(word))
}

const OPERATORS = new Set(['|', '||', '|&', '&&', ';', '>', '>>', '<', '<<', '<<<', '2>', '2>&1', '&', '$(', '(', ')'])

const SHELL_TOKEN = /(\s+)|("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\|\||\|&|&&|2>&1|2>|>>|<<<|<<|[|;&<>]|\$\(|[()])|([^\s"'|;&<>()]+)/g

function startsCommand(operator: string): boolean {
  return OPERATORS.has(operator) && operator !== ')' && !/^[<>]|^2>$/.test(operator)
}

function wordKind(word: string, previous: Span | undefined): ShellKind {
  if (/^--?[\w-]/.test(word)) return 'flag'
  if (/^\$/.test(word)) return 'variable'
  if (/^-?\d+(\.\d+)?$/.test(word)) return 'number'
  if (isPath(word) || /^[~.]?\//.test(word)) return 'path'
  if (previous?.kind === 'command' && SUBCOMMANDED.has(previous.text) && /^[a-z][\w:-]*$/.test(word)) return 'subcommand'
  return 'word'
}

function shellSpan(text: string, quoted: string | undefined, operator: string | undefined, expectCommand: boolean, previous: Span | undefined): Span {
  if (quoted) return { text, kind: 'string' }
  if (operator) return { text, kind: 'operator' }
  if (expectCommand && /^\w+=/.test(text)) return { text, kind: 'variable' }
  if (expectCommand) return { text, kind: 'command' }
  return { text, kind: wordKind(text, previous) }
}

export function shellSpans(source: string): Span[] {
  const spans: Span[] = []
  let expectCommand = true
  let previous: Span | undefined
  for (const [text, space, quoted, operator] of source.matchAll(SHELL_TOKEN)) {
    if (space) {
      spans.push({ text, kind: 'space' })
      continue
    }
    const span = shellSpan(text, quoted, operator, expectCommand, previous)
    if (operator) expectCommand = startsCommand(operator)
    else expectCommand = expectCommand && span.kind === 'variable'
    spans.push(span)
    previous = span
  }
  return spans
}

const LINE_SUFFIX = /^(.*?)((?::\d+){1,2}|#L\d+(?:-L?\d+)?)$/

function pathSpans(text: string, style: Style): Span[] {
  const match = LINE_SUFFIX.exec(text)
  if (!match || !match[1] || !match[2]) return [styled(text, 'path', style)]
  return [styled(match[1], 'path', style), styled(match[2], 'line', style)]
}

export function codeSpans(source: string, style: Style = {}): Span[] {
  if (style.inLink) return [styled(source, 'code', style)]
  if (isPath(source)) return pathSpans(source, style)
  if (/\s/.test(source.trim()) && looksLikeCommand(source)) return shellSpans(source).map(span => styled(span.text, span.kind, style))
  return [styled(source, 'code', style)]
}

export function spansWidth(spans: Span[]): number {
  return spans.reduce((sum, span) => sum + cellWidth(span.text), 0)
}

export function isNumeric(text: string): boolean {
  return /^[-+]?[£$€]?\d[\d,]*(\.\d+)?%?[kKmM]?$/.test(text.trim())
}
