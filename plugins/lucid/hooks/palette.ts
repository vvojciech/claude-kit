export type Palette = {
  text: string
  strong: string
  muted: string
  faint: string
  accent: string
  progress: string
  done: string
  error: string
  added: string
  removed: string
  panel: string
  chip: string
}

export type Ground = 'dark' | 'light'

export const dark: Palette = {
  text: '#d8d5cc',
  strong: '#ecebe6',
  muted: '#a39e94',
  faint: '#858076',
  accent: '#d4734f',
  progress: '#7aa2ff',
  done: '#5dc58b',
  error: '#f37a70',
  added: '#5dc58b',
  removed: '#f37a70',
  panel: '#2d2b27',
  chip: '#2d2b27',
}

export const light: Palette = {
  text: '#2e2c27',
  strong: '#1c1b18',
  muted: '#625e56',
  faint: '#8a857b',
  accent: '#c96442',
  progress: '#2f5fc4',
  done: '#1f6e44',
  error: '#a8322b',
  added: '#237a4b',
  removed: '#a8322b',
  panel: '#ebe9e3',
  chip: '#e3e0d8',
}

export const darkDaltonized: Palette = { ...dark, done: dark.strong, added: dark.progress }

export const lightDaltonized: Palette = { ...light, done: light.strong, added: light.progress }

const LIGHT_NAME = /(?:^|[-_ ])light(?:$|[-_ ])/i

const DARK_NAME = /(?:^|[-_ ])dark(?:$|[-_ ])/i

const DALTONIZED_NAME = /daltoni[sz]ed/i

const LIGHT_BACKGROUND_INDEX = new Set([7, 15])

export function groundOfTerminal(colorFgBg: string | undefined): Ground | undefined {
  if (colorFgBg === undefined) return undefined
  const background = Number(colorFgBg.split(';').at(-1))
  if (colorFgBg.trim() === '' || Number.isNaN(background)) return undefined
  return LIGHT_BACKGROUND_INDEX.has(background) ? 'light' : 'dark'
}

export function groundOf(theme: unknown, terminal?: Ground): Ground {
  if (typeof theme !== 'string') return terminal ?? 'dark'
  if (LIGHT_NAME.test(theme)) return 'light'
  if (DARK_NAME.test(theme)) return 'dark'
  return terminal ?? 'dark'
}

function isDaltonized(theme: unknown): boolean {
  return typeof theme === 'string' && DALTONIZED_NAME.test(theme)
}

function paletteOf(ground: Ground, daltonized: boolean): Palette {
  if (ground === 'light') return daltonized ? lightDaltonized : light
  return daltonized ? darkDaltonized : dark
}

export function paletteFor(theme: unknown, terminal?: Ground): Palette {
  return paletteOf(groundOf(theme, terminal), isDaltonized(theme))
}

export type Tone = Readonly<{ ground: Ground; daltonized: boolean; palette: Readonly<Palette> }>

export function toneFor(theme: unknown, colorFgBg?: string): Tone {
  const ground = groundOf(theme, groundOfTerminal(colorFgBg))
  const daltonized = isDaltonized(theme)
  return Object.freeze({ ground, daltonized, palette: Object.freeze({ ...paletteOf(ground, daltonized) }) })
}
