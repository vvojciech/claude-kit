import type { CopyOutcome } from './clipboard'
import type { Target } from './targets'

export const NOT_OUTERMOST = 'No ⧉ marker: a plugin listed before ditto draws replies itself. Put ditto first in CLAUDE_CODE_PLUGIN_DIRS.'

export const NO_SELECTION = 'Nothing selected: drag over part of a reply in fullscreen, then run /ditto selection'

export const SELECTION_ELSEWHERE = 'The selection is not in a reply ditto can read: select inside one reply Claude wrote'

function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

export function confirmation(outcome: CopyOutcome, what: string, text: string): string {
  if (!outcome.ok) return `Copy failed: ${outcome.error}`
  const count = lineCount(text)
  return `Copied ${what} (${count} ${count === 1 ? 'line' : 'lines'})`
}

export function failure(error: unknown): string {
  return `Copy failed: ${error instanceof Error ? error.message : String(error)}`
}

export function moreTargets(hidden: Target[]): string {
  return `Also in this reply: ${hidden.map(t => t.name).join(', ')}. Copy one with /ditto <name>`
}

export function sharedTailNote(replies: number[]): string {
  return `md: /ditto ${replies.join(' or ')}`
}

export function sharedTail(replies: number[]): string {
  return `${replies.length} replies end with this block, so ⧉ md cannot tell which; /ditto ${replies.join(' or /ditto ')} copies each whole`
}
