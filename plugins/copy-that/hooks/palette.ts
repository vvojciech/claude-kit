import type { EngineInterface } from 'claude-code'

type Ground = 'dark' | 'light'

export type Tone = { ground: Ground; background: string; muted: string; text: string; accent: string; pointed: string }

type LucidTone = { ground: Ground; palette: { text: string; strong: string; muted: string; accent: string } }

export const dark: Tone = { ground: 'dark', background: '#141311', muted: '#a39e94', text: '#d8d5cc', accent: '#d4734f', pointed: '#d4734f' }

export const light: Tone = { ground: 'light', background: '#f5f4f0', muted: '#625e56', text: '#2e2c27', accent: '#c96442', pointed: '#ab4f2d' }



const LIGHT_BACKGROUND_INDEX = new Set([7, 15])

export function groundOfTerminal(colorFgBg: string | undefined): Ground | undefined {
  if (colorFgBg === undefined || colorFgBg.trim() === '') return undefined
  const background = Number(colorFgBg.split(';').at(-1))
  if (Number.isNaN(background)) return undefined
  return LIGHT_BACKGROUND_INDEX.has(background) ? 'light' : 'dark'
}

const namesWord = (theme: string, word: string) => theme.toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ').split(' ').includes(word)

function groundOf(theme: unknown, terminal?: Ground): Ground {
  if (typeof theme !== 'string') return terminal ?? 'dark'
  if (namesWord(theme, 'light')) return 'light'
  if (namesWord(theme, 'dark')) return 'dark'
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

function themeTone($: EngineInterface): Promise<Tone> {
  current ??= Promise.all([themeName($), terminalGround($)]).then(([theme, terminal]) => toneFor(theme, terminal))
  return current
}

export function forgetTone(): void {
  current = undefined
}

const HEX = /^#[0-9a-f]{6}$/i

function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

export function isLucidTone(value: unknown): value is LucidTone {
  if (typeof value !== 'object' || value === null) return false
  const { ground, palette } = value as Partial<LucidTone>
  if (ground !== 'dark' && ground !== 'light') return false
  return typeof palette === 'object' && palette !== null && [palette.text, palette.strong, palette.muted, palette.accent].every(isHex)
}

const TEXT_CONTRAST = 4.5

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r = 0, g = 0, b = 0] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function pointedOn(base: Tone, accent: string): string {
  return contrast(accent, base.background) >= TEXT_CONTRAST ? accent : base.pointed
}

export function fromLucid(tone: LucidTone): Tone {
  const { ground, palette } = tone
  const base = ground === 'light' ? light : dark
  return { ...base, muted: palette.muted, text: palette.text, accent: palette.accent, pointed: pointedOn(base, palette.accent) }
}

async function lucidTone($: EngineInterface): Promise<unknown> {
  try {
    return await $.lucid.tone()
  } catch {
    return undefined
  }
}

export async function drawnTone($: EngineInterface): Promise<Tone> {
  const theirs = await lucidTone($)
  return isLucidTone(theirs) ? fromLucid(theirs) : themeTone($)
}
