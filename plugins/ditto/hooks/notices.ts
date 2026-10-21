import { TERMINAL_ROUTE } from './clipboard'
import type { CopyOutcome } from './clipboard'
import type { Target } from './targets'

export const NOT_OUTERMOST = 'No ⧉: list ditto first in CLAUDE_CODE_PLUGIN_DIRS (a plugin listed earlier draws replies)'

export const FIRST_RUN = 'Hover ⧉ to copy a reply, block or tool output; /ditto help lists commands'

export const NO_FULLSCREEN = 'No ⧉ outside fullscreen, as clicks cannot land; /ditto still copies (/ditto help)'

export const LARGE_FOR_TERMINAL = 100_000

export const NO_SELECTION = 'Nothing selected: drag over part of a reply in fullscreen, then run /ditto selection'

export const SELECTION_ELSEWHERE = 'The selection is not in a reply ditto can read: select inside one reply Claude wrote'

export function selectionRepeats(places: number): string {
  return `ditto copied nothing: the selected text appears in ${places} places, so select more of it to say which`
}

export function lineCount(text: string): number {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return text === '' ? 0 : body.split('\n').length
}

export function confirmation(outcome: CopyOutcome, what: string, text: string): string {
  if (!outcome.ok) return `Copy failed: ${outcome.error}`
  const count = lineCount(text)
  return `Copied ${what} (${count} ${count === 1 ? 'line' : 'lines'}, ${route(outcome.via, text)})`
}

export function flashOf(outcome: CopyOutcome): string {
  return outcome.ok ? `copied (${outcome.via})` : 'copy failed'
}

function route(via: string, text: string): string {
  if (via !== TERMINAL_ROUTE) return via
  return text.length > LARGE_FOR_TERMINAL ? `${via}, paste to check: terminals often cut copies this large` : `${via}, paste to check`
}

export function failure(error: unknown): string {
  return `Copy failed: ${error instanceof Error ? error.message : String(error)}`
}

export function moreTargets(hidden: Target[]): string {
  return `Also in this reply: ${hidden.map(t => t.name).join(', ')}. Copy one with /ditto <name>`
}

export function sharedTailNote(replies: number[]): string {
  return `reply: /ditto ${replies.join(' or ')}`
}

export function sharedTail(replies: number[]): string {
  return `${replies.length} replies end with this block, so ⧉ reply cannot tell which; /ditto ${replies.join(' or /ditto ')} copies each whole`
}

export function withWarning(text: string, warning: string | undefined): string {
  return warning === undefined ? text : `${text}\n${warning}`
}
