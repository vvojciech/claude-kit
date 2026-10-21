import type { EngineInterface } from 'claude-code'

export type Tone = { muted: string; text: string; accent: string; pointed: string }

export type Ground = 'dark' | 'light'

export const dark: Tone = { muted: '#a39e94', text: '#d8d5cc', accent: '#d4734f', pointed: '#d4734f' }

export const light: Tone = { muted: '#625e56', text: '#2e2c27', accent: '#c96442', pointed: '#1c1b18' }

const LIGHT_NAME = /(?:^|[-_ ])light(?:$|[-_ ])/i

const DARK_NAME = /(?:^|[-_ ])dark(?:$|[-_ ])/i

const LIGHT_BACKGROUND_INDEX = new Set([7, 15])

export function groundOfTerminal(colorFgBg: string | undefined): Ground | undefined {
  if (colorFgBg === undefined || colorFgBg.trim() === '') return undefined
  const background = Number(colorFgBg.split(';').at(-1))
  if (Number.isNaN(background)) return undefined
  return LIGHT_BACKGROUND_INDEX.has(background) ? 'light' : 'dark'
}

export function groundOf(theme: unknown, terminal?: Ground): Ground {
  if (typeof theme !== 'string') return terminal ?? 'dark'
  if (LIGHT_NAME.test(theme)) return 'light'
  if (DARK_NAME.test(theme)) return 'dark'
  return terminal ?? 'dark'
}

export function toneFor(theme: unknown, terminal?: Ground): Tone {
  return groundOf(theme, terminal) === 'light' ? light : dark
}

async function themeName($: EngineInterface): Promise<unknown> {
  const rows = await $.config.list().catch(() => [])
  return rows.find(row => row.key === 'theme')?.value
}

async function terminalGround($: EngineInterface): Promise<Ground | undefined> {
  return groundOfTerminal(await $.env.get('COLORFGBG').catch(() => undefined))
}

let current: Promise<Tone> | undefined

export function themeTone($: EngineInterface): Promise<Tone> {
  current ??= Promise.all([themeName($), terminalGround($)]).then(([theme, terminal]) => toneFor(theme, terminal))
  return current
}

export function forgetTone(): void {
  current = undefined
}
