import type { Token, Tokens } from './vendor/marked.js'

import { isTagNamePrefix, tagOf } from './html'
import { lexBlocks } from './lexer'

const WINDOW = 2048

const PENDING_MARKUP = /(\n[ \t]*)?\n([ \t]*[-=|:][-=|: \t]*)$/

const THEMATIC_BREAK = /^[ \t]*(?:-[ \t]*){3,}$/

const PENDING_LINE = new RegExp(
  [
    '(?:^|\\n)(?:',
    [' {0,3}#{1,6}', '[ \\t]*(?:[-*+]{1,2}|\\d{1,9}[.)]?)', '(?: {0,3}>[ \\t]?)+(?:\\[(?:![A-Za-z]*)?)?', '[ \\t]*`{3,}[^`\\n]*', '[ \\t]*~{3,}[^\\n]*', '[ \\t]*[-*+][ \\t]+\\[[ xX]?\\]?', '[ \\t]*\\[(?:\\^[^\\]\\s]*|[^\\]\\n]*)(?:\\]:?)?', '[ \\t]*(?:`{1,2}|~{1,2})', '[ \\t]*\\|[^|\\n]*'].join('|'),
    ')[ \\t]*$',
  ].join(''),
)

const PIPE_ROW = /^[ \t]*\|[^\n]*\|/

const PIPE_LINE = /^[ \t]*\|/

function windowStart(text: string): number {
  return Math.max(0, text.length - WINDOW)
}

function withoutPendingMarkup(text: string): string {
  const start = windowStart(text)
  const pending = PENDING_MARKUP.exec(text.slice(start))
  if (!pending) return text
  const settledBreak = pending[1] !== undefined && THEMATIC_BREAK.test(pending[2] ?? '')
  return settledBreak ? text : text.slice(0, start + pending.index + (pending[1]?.length ?? 0))
}

function withoutPendingLine(text: string): string {
  const start = windowStart(text)
  const pending = PENDING_LINE.exec(text.slice(start))
  return pending ? text.slice(0, start + pending.index) : text
}

export function settledText(text: string): string {
  return withoutPendingLine(withoutPendingMarkup(text))
}

function trailingHeaderRow(text: string): string | undefined {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const start = body.lastIndexOf('\n') + 1
  const row = body.slice(start)
  const previous = start === 0 ? '' : body.slice(body.lastIndexOf('\n', start - 2) + 1, start - 1)
  return PIPE_ROW.test(row) && !PIPE_LINE.test(previous) ? row : undefined
}

function delimiterRowFor(row: string): string {
  const cells = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/)
  return `|${'---|'.repeat(cells.length)}`
}

export function settledTokens(text: string): Token[] {
  const tokens = lexBlocks(text)
  const row = trailingHeaderRow(text)
  if (!row || tokens.at(-1)?.type === 'table') return tokens
  const provisional = lexBlocks(`${text.replace(/\n$/, '')}\n${delimiterRowFor(row)}`)
  const table = provisional.at(-1)
  return table?.type === 'table' && (table as Tokens.Table).rows.length === 0 ? provisional : tokens
}

const BRACKET_REACH = 80

const PROSE_LEAVES = new Set(['paragraph', 'text', 'heading', 'html'])

const PARTIAL_TAG = /^<\/?([A-Za-z][A-Za-z\d]*)(\s[^<>]*)?(>?)/

const PARTIAL_MARKUP = /^<(?:\/|!(?:-|--(?:(?!-->)[\s\S])*)?)?$/

const ATTRIBUTE_NAME = '[A-Za-z_:][-\\w:.]*'

const TYPED_ATTRIBUTES = new RegExp(`^(?:\\s+${ATTRIBUTE_NAME}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))*(?:\\s+(?:${ATTRIBUTE_NAME}(?:\\s*=\\s*(?:"[^"]*|'[^']*|[^\\s"'=<>\`]*))?)?)?$`)

const ITEM_OR_HEADING_LINE = /^(?:[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)| {0,3}#{1,6}(?:[ \t]|$))/

const PARAGRAPH_BREAK_LINE = /^(?:[ \t]*$| {0,3}#{1,6}(?:[ \t]|$)|[ \t]*(?:`{3,}|~{3,})|[ \t]*(?:[-=*_][ \t]*){3,}$|[ \t]*=+[ \t]*$)/

type Opener = { mark: string; at: number; run: number }

export function withoutPendingInline(text: string, tokens: Token[]): string {
  const leaf = lastLeaf(tokens)?.type ?? ''
  if (leaf !== 'table' && !PROSE_LEAVES.has(leaf)) return text
  const start = leaf === 'table' ? text.lastIndexOf('\n') + 1 : paragraphStart(text)
  const cut = pendingOpener(text.slice(start))
  return cut === undefined ? text : text.slice(0, start + cut).replace(/[ \t]+$/, '')
}

function paragraphStart(text: string): number {
  const floor = windowStart(text)
  let start = text.lastIndexOf('\n') + 1
  while (start > floor && !ITEM_OR_HEADING_LINE.test(lineAt(text, start))) {
    const previous = text.lastIndexOf('\n', start - 2) + 1
    if (PARAGRAPH_BREAK_LINE.test(text.slice(previous, start - 1))) break
    start = previous
  }
  return Math.max(start, floor)
}

function lineAt(text: string, start: number): string {
  const end = text.indexOf('\n', start)
  return text.slice(start, end === -1 ? undefined : end)
}

function lastLeaf(tokens: Token[]): Token | undefined {
  const last = tokens.findLast(token => token.type !== 'space')
  if (last?.type === 'list') return lastLeaf((last as Tokens.List).items.at(-1)?.tokens ?? [])
  if (last?.type === 'blockquote') return lastLeaf((last as Tokens.Blockquote).tokens)
  return last
}

export function pendingOpener(paragraph: string): number | undefined {
  const open: Opener[] = []
  let i = 0
  while (i < paragraph.length) {
    const step = stepAt(paragraph, i, open)
    if (step === undefined) break
    i = step
  }
  const holding = open.filter(opener => opener.mark !== '[' || isNearBracket(paragraph, opener.at)).map(opener => opener.at)
  return holding.length > 0 ? Math.min(...holding) : undefined
}

function isNearBracket(paragraph: string, at: number): boolean {
  return at >= paragraph.length - BRACKET_REACH && !paragraph.includes('\n', at)
}

function stepAt(line: string, i: number, open: Opener[]): number | undefined {
  const char = line[i] ?? ''
  if (char === '\\') return i + 2
  if (char === '`') return codeSpanEnd(line, i, open)
  if (char === '<') return tagEnd(line, i, open)
  if (char === '[') return pushed(open, { mark: '[', at: line[i - 1] === '!' ? i - 1 : i, run: 1 }, i + 1)
  if (char === ']') return bracketEnd(line, i, open)
  if (char === '!' && i + 1 === line.length) return pushed(open, { mark: '[', at: i, run: 1 }, i + 1)
  if (char === '*' || char === '_' || char === '~') return delimiterEnd(line, i, open)
  return i + 1
}

function pushed(open: Opener[], opener: Opener, next: number): number {
  open.push(opener)
  return next
}

function runOf(line: string, i: number): string {
  const char = line[i] ?? ''
  let end = i
  while (line[end] === char) end++
  return line.slice(i, end)
}

function codeSpanEnd(line: string, i: number, open: Opener[]): number | undefined {
  const run = runOf(line, i)
  const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'g')
  close.lastIndex = i + run.length
  const found = close.exec(line)
  if (found) return found.index + run.length
  open.push({ mark: '`', at: i, run: run.length })
  return undefined
}

function tagEnd(line: string, i: number, open: Opener[]): number | undefined {
  if (PARTIAL_MARKUP.test(line.slice(i))) return pushed(open, { mark: '<', at: i, run: 1 }, line.length)
  const partial = PARTIAL_TAG.exec(line.slice(i))
  if (!partial) return i + 1
  if (partial[3] !== '>') return isTypedTag(line, i, partial) ? pushed(open, { mark: '<', at: i, run: 1 }, line.length) : i + 1
  const tag = tagOf(partial[0])
  if (!tag || tag.empty) return i + partial[0].length
  if (!tag.closing) return pushed(open, { mark: `<${tag.name}`, at: i, run: 1 }, i + partial[0].length)
  removeLast(open, `<${tag.name}`)
  return i + partial[0].length
}

function isTypedTag(line: string, i: number, partial: RegExpExecArray): boolean {
  return i + partial[0].length === line.length && isTagNamePrefix(partial[1] ?? '') && TYPED_ATTRIBUTES.test(partial[2] ?? '')
}

function bracketEnd(line: string, i: number, open: Opener[]): number | undefined {
  const bracket = open.findLastIndex(opener => opener.mark === '[')
  if (bracket === -1) return i + 1
  if (i + 1 === line.length) return undefined
  const next = line[i + 1]
  if (next !== '(' && next !== '[') {
    open.splice(bracket, 1)
    return i + 1
  }
  const close = line.indexOf(next === '(' ? ')' : ']', i + 2)
  if (close === -1) return undefined
  open.splice(bracket, 1)
  return close + 1
}

function delimiterEnd(line: string, i: number, open: Opener[]): number {
  const run = runOf(line, i)
  const char = run[0] ?? ''
  const next = i + run.length
  const before = line[i - 1]
  const after = line[next]
  const closes = before !== undefined && !/\s/.test(before)
  const opens = after === undefined || !(char === '~' ? /[\s/]/ : /\s/).test(after)
  const intraword = char === '_' && before !== undefined && after !== undefined && /\w/.test(before) && /\w/.test(after)
  if (intraword) return next
  const opener = closes ? open.findLastIndex(candidate => candidate.mark === char) : -1
  if (opener !== -1) {
    closeUnlessPartial(open, opener, run.length, next === line.length)
    return next
  }
  if (opens) open.push({ mark: char, at: i, run: run.length })
  return next
}

function closeUnlessPartial(open: Opener[], index: number, run: number, atEnd: boolean): void {
  const opener = open[index]
  if (opener && !(atEnd && run < opener.run)) open.splice(index, 1)
}

function removeLast(open: Opener[], mark: string): boolean {
  const index = open.findLastIndex(opener => opener.mark === mark)
  if (index === -1) return false
  open.splice(index, 1)
  return true
}
