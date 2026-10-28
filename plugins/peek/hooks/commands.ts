import { ON_CLIPBOARD, copyImage } from './actions'
import type { Host } from './host'
import { resolvePath, unquoted } from './paths'
import type { Places } from './places'

export const COMMAND = 'peek'

export const DESCRIPTION = 'Put an image on the clipboard for ctrl+v'

export const ARGUMENT_HINT = '<path>'

export const USAGE = '/peek <path> puts that image on the clipboard. Then press ctrl+v.'

type Parsed = { kind: 'help' } | { kind: 'path'; path: string }

export function parseCommand(args: string): Parsed {
  const text = args.trim()
  if (text === '' || text === 'help') return { kind: 'help' }
  return { kind: 'path', path: unquoted(text) }
}

type Outcome = { text: string; ok: boolean }

async function copied(host: Host, places: Places, path: string): Promise<Outcome> {
  const text = await copyImage(host, path, places.cacheDir)
  return { text, ok: text === ON_CLIPBOARD }
}

export async function runPeek(host: Host, places: Places, parsed: Parsed): Promise<Outcome> {
  if (parsed.kind === 'help') return { text: USAGE, ok: true }
  return copied(host, places, resolvePath(parsed.path, places.cwd, places.home))
}
