import type { Token, Tokens } from './vendor/marked.js'

import { preOf } from './html'
import { lexBlocks } from './lexer'

const WINDOW = 2048

const PENDING_MARKUP = /(\n[ \t]*)?\n([ \t]*[-=|:][-=|: \t]*)$/

const THEMATIC_BREAK = /^[ \t]*(?:-[ \t]*){3,}$/

const PENDING_LINE = new RegExp(
  [
    '(?:^|\\n)(?: {0,3}>[ \\t]?)*(?:',
    [' {0,3}#{1,6}', '[ \\t]*(?:(?:[-*+]|\\d{1,9}[.)])[ \\t]+)*(?:[-*+]{1,2}|\\d{1,9}[.)]?)', '(?: {0,3}>[ \\t]?)+(?:\\[(?:![A-Za-z]*)?)?', '[ \\t]*`{3,}[^`\\n]*', '[ \\t]*~{3,}[^\\n]*', '[ \\t]*[-*+][ \\t]+\\[[ xX]?\\]?', '[ \\t]*\\[\\^[^\\]\\s]*(?:\\]:?)?', '[ \\t]*\\[(?:[^\\]\\n^][^\\]\\n]*)?(?:\\]:|\\])?', '[ \\t]*(?:`{1,2}|~{1,2})', '[ \\t]*\\|[^|\\n]*'].join('|'),
    ')[ \\t]*$',
  ].join(''),
)

const PIPE_ROW = /^[ \t]*\|[^\n]*\|/

const DELIMITER_STARTED = /\n[ \t]*(?:\|[ \t]*:?-|:?-+[ \t]*:?[ \t]*\|)[-:| \t]*$/

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
  const settled = withoutPendingLine(withoutPendingMarkup(text))
  return DELIMITER_STARTED.test(text) ? settled : withoutLoneHeaderRow(settled)
}

function withoutLoneHeaderRow(text: string): string {
  const row = trailingHeaderRow(text)
  return row === undefined ? text : text.slice(0, text.lastIndexOf(row))
}

function trailingHeaderRow(text: string): string | undefined {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const start = body.lastIndexOf('\n') + 1
  const row = body.slice(start)
  const previous = start === 0 ? '' : body.slice(body.lastIndexOf('\n', start - 2) + 1, start - 1)
  return PIPE_ROW.test(row) && !previous.includes('|') ? row : undefined
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

const PARTIAL_PRE_CLOSE = /<(?:\/(?:p(?:re?)?)?)?$/i

export function withoutPendingPreClose(text: string, tokens: Token[]): string {
  const last = lastLeaf(tokens)
  if (last?.type !== 'html' || !preOf((last as Tokens.HTML).text)) return text
  const partial = PARTIAL_PRE_CLOSE.exec(text)
  return partial ? text.slice(0, partial.index) : text
}

function lastLeaf(tokens: Token[]): Token | undefined {
  const last = tokens.findLast(token => token.type !== 'space')
  if (last?.type === 'list') return lastLeaf((last as Tokens.List).items.at(-1)?.tokens ?? [])
  if (last?.type === 'blockquote') return lastLeaf((last as Tokens.Blockquote).tokens)
  return last
}
