import type { EngineInterface } from 'claude-code'

export type Tone = { muted: string; text: string; accent: string }

export const dark: Tone = { muted: '#a39e94', text: '#d8d5cc', accent: '#e08a68' }

export const light: Tone = { muted: '#625e56', text: '#2e2c27', accent: '#ad4f2c' }

type Ground = 'dark' | 'light'

const LIGHT_NAME = /(?:^|[-_ ])light(?:$|[-_ ])/i

const LIGHT_BACKGROUND_INDEX = new Set([7, 15])

export function groundOfTerminal(colorFgBg: string | undefined): Ground | undefined {
  const background = Number(colorFgBg?.split(';').at(-1))
  if (colorFgBg === undefined || Number.isNaN(background)) return undefined
  return LIGHT_BACKGROUND_INDEX.has(background) ? 'light' : 'dark'
}

export function groundOf(theme: unknown, terminal: Ground | undefined): Ground {
  if (typeof theme !== 'string' || theme === 'auto') return terminal ?? 'dark'
  if (LIGHT_NAME.test(theme)) return 'light'
  return 'dark'
}

export function toneFor(theme: unknown, terminal?: Ground): Tone {
  return groundOf(theme, terminal) === 'light' ? light : dark
}


function isTone(value: unknown): value is Tone {
  const tone = value as Partial<Tone> | undefined
  return typeof tone?.muted === 'string' && typeof tone.text === 'string' && typeof tone.accent === 'string'
}

async function ownTone($: EngineInterface): Promise<Tone> {
  const rows = await $.config.list().catch(() => [])
  const terminal = groundOfTerminal(await $.env.get('COLORFGBG').catch(() => undefined))
  return toneFor(rows.find(row => row.key === 'theme')?.value, terminal)
}

async function readTone($: EngineInterface): Promise<Tone> {
  return ownTone($)
}

let current: Promise<Tone> | undefined

export function themeTone($: EngineInterface): Promise<Tone> {
  current ??= readTone($)
  return current
}

export function forgetTone(): void {
  current = undefined
}
