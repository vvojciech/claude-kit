import type { Owners } from '../types'

export type Written = { uuid: string; text: string }

type Content = { type: string; [field: string]: unknown }

export function writtenText(content: Content[]): string {
  return content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n\n')
}

export function ownersOf(blocks: Written[], partial: boolean): Owners {
  const written = blocks.filter(b => b.text.trim() !== '')
  const tail = written.at(-1)
  if (tail === undefined) return {}
  const owners: Owners = Object.fromEntries(written.map(b => [b.uuid, null]))
  owners[tail.uuid] = { texts: written.map(b => b.text), partial }
  return owners
}
