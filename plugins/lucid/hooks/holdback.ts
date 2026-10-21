import type { Token, Tokens } from './vendor/marked.js'

import { lexBlocks } from './lexer'

const WINDOW = 2048

const PENDING_MARKUP = /(\n[ \t]*)?\n([ \t]*[-=|:][-=|: \t]*)$/

const THEMATIC_BREAK = /^[ \t]*(?:-[ \t]*){3,}$/

const PENDING_LINE = /(?:^|\n)(?: {0,3}#{1,6}|[ \t]*(?:[*+]{1,2}|\d{1,9}[.)])|(?: {0,3}>[ \t]?)+\[(?:![A-Za-z]*)?)[ \t]*$/

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
