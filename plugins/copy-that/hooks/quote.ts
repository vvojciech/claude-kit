import type { Block } from './model'

export const QUOTE = 'quote'

export const ALERTS = ['note', 'tip', 'important', 'warning', 'caution'] as const

const MARKER = /^ {0,3}>[ \t]?/

export const ALERT_LINE = /^\[!(note|tip|important|warning|caution)\][ \t]*$/i

function unquotedLines(source: string): string[] {
  return source.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(MARKER, ''))
}

function alertOf(lines: string[]): string | undefined {
  return ALERT_LINE.exec(lines[0] ?? '')?.[1]?.toLowerCase()
}

export function quoteName(block: Block): string {
  return alertOf(unquotedLines(block.source)) ?? QUOTE
}

export function quoteText(block: Block): string {
  const lines = unquotedLines(block.source)
  const body = alertOf(lines) === undefined ? lines : lines.slice(1)
  return body.join('\n').replace(/^\n+|\s+$/g, '')
}

export function outerQuotes(blocks: Block[]): Set<Block> {
  const open: number[] = []
  const outer = new Set<Block>()
  for (const block of blocks) {
    while (open.length > 0 && (open.at(-1) ?? 0) >= block.depth) open.pop()
    if (block.kind !== 'quote') continue
    if (open.length === 0) outer.add(block)
    open.push(block.depth)
  }
  return outer
}
