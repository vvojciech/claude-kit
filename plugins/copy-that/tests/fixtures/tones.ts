import { groundOfTerminal, toneFor } from '../../hooks/palette'
import type { Tone } from '../../hooks/palette'

export const CONTRACT = 'bun dev/contract.ts'

export const REGENERATE = `${CONTRACT} --write`

export const THEMES = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
  'auto',
  'solarized-light-custom',
  'highlighter',
  'my_light',
  'solarized-custom',
]

export const TERMINALS = ['unset', '15;0', '0;15'] as const

export type Terminal = (typeof TERMINALS)[number]

export type ToneEntry = Pick<Tone, 'ground' | 'muted' | 'text' | 'accent'>

export function toneKey(theme: string, terminal: Terminal): string {
  return `${theme} on ${terminal}`
}

export function colorFgBg(terminal: Terminal): string | undefined {
  return terminal === 'unset' ? undefined : terminal
}

export function copyThatTones(): Record<string, ToneEntry> {
  return Object.fromEntries(
    THEMES.flatMap(theme =>
      TERMINALS.map(terminal => {
        const { ground, muted, text, accent } = toneFor(theme, groundOfTerminal(colorFgBg(terminal)))
        return [toneKey(theme, terminal), { ground, muted, text, accent }]
      }),
    ),
  )
}
