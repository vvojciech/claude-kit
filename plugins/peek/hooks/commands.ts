import { ON_CLIPBOARD, clipboardHoldsImage, copyImage } from './actions'
import type { Host } from './host'
import { resolvePath, unescaped } from './paths'
import type { Places } from './places'
import { newestScreenshot } from './places'

export const COMMAND = 'peek'

export const DESCRIPTION = 'Put an image on the clipboard for ctrl+v: a path, the newest screenshot, or check the clipboard'

export const ARGUMENT_HINT = '<path> | last | clipboard-check'

export const USAGE = '/peek <path> puts that image on the clipboard; /peek last takes the newest screenshot in Desktop or Downloads; /peek clipboard-check says whether the clipboard holds an image. Then press ctrl+v.'

export const NO_SCREENSHOT = 'No screenshot found in Desktop or Downloads'

export const CLIPBOARD_EMPTY = 'No image on the clipboard'

export type Parsed = { kind: 'help' } | { kind: 'last' } | { kind: 'check' } | { kind: 'path'; path: string }

function unquote(text: string): string {
  const quoted = text.match(/^(['"])(.*)\1$/)
  return quoted ? (quoted[2] ?? '') : unescaped(text)
}

export function parseCommand(args: string): Parsed {
  const text = args.trim()
  if (text === '' || text === 'help') return { kind: 'help' }
  if (text === 'last') return { kind: 'last' }
  if (text === 'clipboard-check') return { kind: 'check' }
  return { kind: 'path', path: unquote(text) }
}

export type Outcome = { text: string; ok: boolean }

async function copied(host: Host, places: Places, path: string): Promise<Outcome> {
  const text = await copyImage(host, path, places.cacheDir)
  return { text, ok: text === ON_CLIPBOARD }
}

export async function runPeek(host: Host, places: Places, parsed: Parsed): Promise<Outcome> {
  if (parsed.kind === 'help') return { text: USAGE, ok: true }
  if (parsed.kind === 'check') return (await clipboardHoldsImage(host)) ? { text: ON_CLIPBOARD, ok: true } : { text: CLIPBOARD_EMPTY, ok: false }
  if (parsed.kind === 'path') return copied(host, places, resolvePath(parsed.path, places.cwd, places.home))
  const newest = await newestScreenshot(host, places.home)
  return newest === undefined ? { text: NO_SCREENSHOT, ok: false } : copied(host, places, newest)
}
