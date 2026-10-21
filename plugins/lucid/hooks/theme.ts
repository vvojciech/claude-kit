import type { EngineInterface } from 'claude-code'

import { toneFor } from './palette'
import type { Palette, Tone } from './palette'

type ThemeReader = Pick<EngineInterface, 'config' | 'env'>

let resolved: Promise<Tone> | undefined

let drawn: Tone | undefined

async function themeName($: Pick<EngineInterface, 'config'>): Promise<unknown> {
  const rows = await $.config.list().catch(() => [])
  return rows.find(row => row.key === 'theme')?.value
}

async function terminalColours($: Pick<EngineInterface, 'env'>): Promise<string | undefined> {
  return $.env.get('COLORFGBG').catch(() => undefined)
}

async function readTone($: ThemeReader): Promise<Tone> {
  const [theme, colorFgBg] = await Promise.all([themeName($), terminalColours($)])
  drawn = toneFor(theme, colorFgBg)
  return drawn
}

function themeTone($: ThemeReader): Promise<Tone> {
  resolved ??= readTone($)
  return resolved
}

export function forgetTheme(): void {
  resolved = undefined
}

export function drawnTone(): Tone | undefined {
  return drawn
}

export async function themePalette($: ThemeReader): Promise<Palette> {
  return (await themeTone($)).palette
}
