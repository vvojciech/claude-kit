import type { Block } from './model'
import { ALERTS, QUOTE, outerQuotes, quoteName, quoteText } from './quote'

export type TargetKind = 'reply' | 'code' | 'table' | 'quote' | ToolKind

export type ToolKind = 'file' | 'plan' | 'output'

export type Target = { kind: TargetKind; name: string; label: string; text: string; what: string; unavailable?: string; callId?: string }

export type Row = { shown: Target[]; hidden: Target[] }

export type Resolved = { text: string; partial: boolean; blocks: Block[] }

export const GLYPH = '⧉'
export const REPLY = 'reply'
export const TOOL_KINDS: readonly ToolKind[] = ['file', 'plan', 'output']
export const OUTPUT = 'output'
export const TOOL_WHAT: Record<ToolKind, string> = { file: 'file', plan: 'plan', output: `tool ${OUTPUT}` }
export const GAP = 2
export const CODE = 'code'
const TABLE = 'table'
const RESERVED = new Set([TABLE, CODE, REPLY, QUOTE, ...ALERTS, 'selection', 'help', ...TOOL_KINDS])

function copyable(outer: Set<Block>): (block: Block) => boolean {
  return block => block.kind === 'code' || block.kind === 'table' || outer.has(block)
}

function baseName(block: Block): string {
  if (block.kind === 'table') return TABLE
  if (block.kind === 'quote') return quoteName(block)
  const lang = block.lang ?? ''
  if (lang === '') return CODE
  return RESERVED.has(lang.toLowerCase()) ? `${lang}-${CODE}` : lang
}

function bodyOf(block: Block): string {
  if (block.kind === 'quote') return quoteText(block)
  return block.kind === 'table' ? block.source.trimEnd() : (block.text ?? '')
}

function whatOf(block: Block, base: string): string {
  if (block.kind === 'table') return TABLE
  if (block.kind === 'quote') return `${base} as markdown`
  return base === CODE ? 'code block' : `${base} block`
}

function kindOf(block: Block): TargetKind {
  return block.kind === 'table' || block.kind === 'quote' ? block.kind : 'code'
}

export const CALL_MARK = '#'

export function numbered(names: string[], mark = ''): string[] {
  const totals = new Map<string, number>()
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return names.map(name => {
    const index = (seen.get(name) ?? 0) + 1
    seen.set(name, index)
    return (totals.get(name) ?? 0) < 2 ? name : `${name} ${mark}${index}`
  })
}

export function target(kind: TargetKind, name: string, text: string, what: string): Target {
  return { kind, name, label: `${GLYPH} ${name}`, text, what }
}

export function replyTarget(reply: Pick<Resolved, 'text' | 'partial'>): Target {
  return target('reply', REPLY, reply.text, reply.partial ? 'partial reply as markdown' : 'reply as markdown')
}

export function blockTargets(blocks: Block[]): Target[] {
  const drawn = blocks.filter(copyable(outerQuotes(blocks)))
  const names = numbered(drawn.map(baseName))
  return drawn.flatMap((block, i) => {
    const text = bodyOf(block)
    const base = baseName(block)
    return text.trim() === '' ? [] : [target(kindOf(block), names[i] ?? base, text, whatOf(block, base))]
  })
}

export function replyTargets(reply: Resolved): Target[] {
  if (reply.text.trim() === '') return []
  return [replyTarget(reply), ...blockTargets(reply.blocks)]
}

export function overflowLabel(hidden: number): string {
  return `+${hidden}`
}
