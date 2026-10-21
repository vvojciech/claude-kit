import type { Block } from './model'
import { cellWidth } from './width'

export type TargetKind = 'reply' | 'code' | 'table'

export type Target = { kind: TargetKind; name: string; label: string; text: string; what: string }

export type Row = { shown: Target[]; hidden: Target[] }

export type Resolved = { text: string; partial: boolean; blocks: Block[] }

export const GLYPH = '⧉'
export const REPLY = 'md'
export const GAP = 2
const TABLE = 'table'
const UNNAMED_CODE = 'code'
const REPLY_LANGUAGE = 'markdown'

function copyable(block: Block): boolean {
  return block.kind === 'code' || block.kind === 'table'
}

function baseName(block: Block): string {
  if (block.kind === 'table') return TABLE
  const lang = block.lang ?? ''
  if (lang === '') return UNNAMED_CODE
  return lang === REPLY ? REPLY_LANGUAGE : lang
}

function bodyOf(block: Block): string {
  return block.kind === 'table' ? block.source.trimEnd() : (block.text ?? '')
}

function whatOf(block: Block, base: string): string {
  if (block.kind === 'table') return TABLE
  return base === UNNAMED_CODE ? 'code block' : `${base} block`
}

function numbered(names: string[]): string[] {
  const totals = new Map<string, number>()
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return names.map(name => {
    const index = (seen.get(name) ?? 0) + 1
    seen.set(name, index)
    return (totals.get(name) ?? 0) < 2 ? name : `${name} ${index}`
  })
}

function target(kind: TargetKind, name: string, text: string, what: string): Target {
  return { kind, name, label: `${GLYPH} ${name}`, text, what }
}

export function replyTarget(reply: Pick<Resolved, 'text' | 'partial'>): Target {
  return target('reply', REPLY, reply.text, reply.partial ? 'partial reply as markdown' : 'reply as markdown')
}

export function blockTargets(blocks: Block[]): Target[] {
  const drawn = blocks.filter(copyable)
  const names = numbered(drawn.map(baseName))
  return drawn.flatMap((block, i) => {
    const text = bodyOf(block)
    return text.trim() === '' ? [] : [target(block.kind === 'table' ? 'table' : 'code', names[i] ?? baseName(block), text, whatOf(block, baseName(block)))]
  })
}

export function replyTargets(reply: Resolved): Target[] {
  if (reply.text.trim() === '') return []
  return [replyTarget(reply), ...blockTargets(reply.blocks)]
}

export function overflowLabel(hidden: number): string {
  return `+${hidden}`
}

export function rowWidth(labels: string[]): number {
  return labels.reduce((sum, label, i) => sum + cellWidth(label) + (i > 0 ? GAP : 0), 0)
}

export function fitRow(targets: Target[], columns: number): Row {
  const labels = targets.map(t => t.label)
  if (rowWidth(labels) <= columns) return { shown: targets, hidden: [] }
  for (let count = targets.length - 1; count > 0; count--) {
    const hidden = targets.slice(count)
    if (rowWidth([...labels.slice(0, count), overflowLabel(hidden.length)]) <= columns) return { shown: targets.slice(0, count), hidden }
  }
  return { shown: [], hidden: targets }
}
