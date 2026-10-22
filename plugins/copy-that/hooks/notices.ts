import { TERMINAL_ROUTE } from './clipboard'
import type { CopyOutcome } from './clipboard'
import type { Target } from './targets'
import { cellWidth } from './width'

export const NOT_OUTERMOST = 'Put copy-that first in CLAUDE_CODE_PLUGIN_DIRS (a plugin listed earlier draws replies)'

export const FIRST_RUN = 'Hover ⧉ to copy; /copy-that help'

export const NO_FULLSCREEN = '⧉ needs fullscreen; use /copy-that'

export const LARGE_FOR_TERMINAL = 100_000

export const NO_SELECTION = 'Nothing selected: drag over part of a reply in fullscreen, then run /copy-that selection'

export const SELECTION_ELSEWHERE = 'The selection is not in a reply copy-that can read: select inside one reply Claude wrote'

export function selectionRepeats(places: number): string {
  return `copy-that copied nothing: the selected text appears in ${places} places, so select more of it to say which`
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

export function flashSuffices(outcome: CopyOutcome): boolean {
  return outcome.ok && outcome.via !== TERMINAL_ROUTE
}

export function flashOf(outcome: CopyOutcome): string {
  return outcome.ok ? `copied (${outcome.via})` : 'copy failed'
}

const ROUTES = ['pbcopy', 'wl-copy', 'xclip', 'xsel', TERMINAL_ROUTE]

const FLASHES = [...ROUTES.map(via => flashOf({ ok: true, via })), flashOf({ ok: false, error: '' })]

export const LONGEST_FLASH = FLASHES.reduce((longest, text) => (cellWidth(text) > cellWidth(longest) ? text : longest))

function route(via: string, text: string): string {
  if (via !== TERMINAL_ROUTE) return via
  return text.length > LARGE_FOR_TERMINAL ? `${via}, paste to check: terminals often cut copies this large` : `${via}, paste to check`
}

export function failure(error: unknown): string {
  return `Copy failed: ${error instanceof Error ? error.message : String(error)}`
}

export function moreTargets(hidden: Target[]): string {
  return `Also in this reply: ${hidden.map(t => t.name).join(', ')}. Copy one with /copy-that <name>`
}

export const TOAST_WIDTH = 37

const TOAST_FRAME = 6

export function toastWidth(columns: number | undefined): number {
  return columns === undefined ? TOAST_WIDTH : Math.max(1, Math.min(TOAST_WIDTH, columns - TOAST_FRAME))
}

export const TOAST_LINES = 3

const BY_NAME = '/copy-that <name>'

export function toastLines(text: string, width = TOAST_WIDTH): string[] {
  const lines: string[] = []
  for (const word of text.split(' ').filter(Boolean)) {
    const last = lines.at(-1)
    if (last !== undefined && cellWidth(`${last} ${word}`) <= width) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(...brokenWord(word, width))
  }
  return lines
}

function brokenWord(word: string, width: number): string[] {
  const pieces: string[] = []
  let piece = ''
  for (const char of word) {
    if (piece !== '' && cellWidth(piece + char) > width) {
      pieces.push(piece)
      piece = ''
    }
    piece += char
  }
  return [...pieces, piece]
}

function fitsToast(text: string, width: number): boolean {
  return toastLines(text, width).length <= TOAST_LINES
}

function listing(lead: string, names: string[], kept: number): string {
  const rest = names.length - kept
  const shown = names.slice(0, kept).join(', ')
  const more = rest === 0 ? '' : `${kept === 0 ? '' : ' '}+${rest}`
  return `${lead} ${shown}${more}`
}

function fittedList(lead: string, calls: Target[], width: number): string {
  const names = calls.map(call => call.name)
  for (let kept = names.length; kept > 0; kept--) {
    const text = listing(lead, names, kept)
    if (fitsToast(text, width)) return text
  }
  return listing(lead, names, 0)
}

export function callsInGroup(calls: Target[], width = TOAST_WIDTH): string {
  return fittedList(`Copy with ${BY_NAME}:`, calls, width)
}

export function sharedTailNote(replies: number[]): string {
  return `reply: /copy-that ${replies.join(' or ')}`
}

export function sharedTail(replies: number[]): string {
  const each = `/copy-that ${replies.join(' or /copy-that ')} copies each whole`
  return `${replies.length} replies end with this block, so ⧉ reply cannot tell which; ${each}`
}

export function withWarning(text: string, warning: string | undefined): string {
  return warning === undefined ? text : `${text}\n${warning}`
}
