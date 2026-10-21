import { describe, expect, test } from 'claude-code/testing'

import { contrast, dark, fromLucid, groundOfTerminal, isLucidTone, light, toneFor } from '../hooks/palette'
import { LUCID_TONES } from './fixtures/lucid-palette'

function hue(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const span = max - Math.min(r, g, b)
  if (span === 0) return -1
  if (max === r) return (((g - b) / span) * 60 + 360) % 360
  return max === g ? ((b - r) / span) * 60 + 120 : ((r - g) / span) * 60 + 240
}

const PITWALL_DARK_GROUNDS = ['#141311', '#1d1c19', '#0e0d0c', '#000000', '#1e1e1e']
const PITWALL_LIGHT_GROUNDS = ['#f5f4f0', '#ffffff']
const DARK_GROUNDS = ['#000000', '#141311', '#0e0d0c', '#181926', '#1e1e1e', '#24273a', '#282c34', '#2e3440', '#1d1c19']
const LIGHT_GROUNDS = ['#ffffff', '#f5f4f0', '#fafafa', '#eff1f5', '#fdf6e3']

describe('tone', () => {
  test('gives the Pitwall tones to the tuned, daltonized and ANSI themes', async () => {
    expect(toneFor('dark')).toBe(dark)
    expect(toneFor('dark-daltonized')).toBe(dark)
    expect(toneFor('dark-ansi')).toBe(dark)
    expect(toneFor('light')).toBe(light)
    expect(toneFor('light-daltonized')).toBe(light)
    expect(toneFor('light-ansi')).toBe(light)
  })

  test('resolves auto from the terminal ground, and dark when the terminal does not say', async () => {
    expect(toneFor('auto', 'light')).toBe(light)
    expect(toneFor('auto', 'dark')).toBe(dark)
    expect(toneFor('auto')).toBe(dark)
    expect(toneFor(undefined, 'light')).toBe(light)
  })

  test('resolves a custom theme by its name', async () => {
    expect(toneFor('solarized-light-custom')).toBe(light)
    expect(toneFor('my_light')).toBe(light)
    expect(toneFor('solarized-custom')).toBe(dark)
    expect(toneFor('highlighter')).toBe(dark)
  })

  test('reads the terminal ground from COLORFGBG', async () => {
    expect(groundOfTerminal('0;15')).toBe('light')
    expect(groundOfTerminal('15;default;7')).toBe('light')
    expect(groundOfTerminal('15;0')).toBe('dark')
    expect(groundOfTerminal(undefined)).toBeUndefined()
    expect(groundOfTerminal('garbage')).toBeUndefined()
  })

  test('greys the marker with the muted colour lucid draws for every theme lucid gives a colour', async () => {
    const unset = Object.entries(LUCID_TONES).filter(([key]) => key.endsWith(' on unset'))
    expect(unset.length).toBeGreaterThan(0)
    for (const [key, tone] of unset) expect(toneFor(key.replace(/ on unset$/, '')).muted).toBe(tone.muted)
  })

  test('takes the Pitwall orange lucid draws, not a lighter stand-in', async () => {
    expect(dark.accent).toBe('#d4734f')
    expect(light.accent).toBe('#c96442')
  })

  test('the hovered chip is orange on dark, where the Pitwall orange reads at 4.5:1 on the Pitwall grounds', async () => {
    expect(dark.pointed).toBe(dark.accent)
    for (const ground of PITWALL_DARK_GROUNDS) expect(contrast(dark.pointed, ground)).toBeGreaterThanOrEqual(4.5)
  })

  test('the hovered chip is orange on light too, a deeper Pitwall orange, as #c96442 reads under 4.5:1 there', async () => {
    for (const ground of PITWALL_LIGHT_GROUNDS) expect(contrast(light.accent, ground)).toBeLessThan(4.5)
    for (const ground of LIGHT_GROUNDS) expect(contrast(light.pointed, ground)).toBeGreaterThanOrEqual(4.5)
    expect(Math.abs(hue(light.pointed) - hue(light.accent))).toBeLessThan(3)
    expect(Math.abs(hue(dark.pointed) - hue(dark.accent))).toBeLessThan(3)
  })

  test('contrast is 21 for black on white, 1 for a colour on itself, and the same either way round', async () => {
    expect(Math.round(contrast('#000000', '#ffffff') * 1000)).toBe(21000)
    expect(contrast('#ab4f2d', '#ab4f2d')).toBe(1)
    expect(contrast('#ab4f2d', '#f5f4f0')).toBe(contrast('#f5f4f0', '#ab4f2d'))
  })

  test('marker and chips reach 4.5:1 on every ground', async () => {
    for (const ground of DARK_GROUNDS) for (const role of [dark.muted, dark.text]) expect(contrast(role, ground)).toBeGreaterThanOrEqual(4.5)
    for (const ground of LIGHT_GROUNDS) for (const role of [light.muted, light.text]) expect(contrast(role, ground)).toBeGreaterThanOrEqual(4.5)
  })

  test('resolves a custom theme with no ground in its name from the terminal, as lucid does', async () => {
    expect(toneFor('highlighter', 'light')).toBe(light)
    expect(toneFor('solarized-custom', 'light')).toBe(light)
    expect(toneFor('dark-ansi', 'light')).toBe(dark)
    expect(groundOfTerminal('')).toBeUndefined()
  })

  test('the hovered chip reads at 4.5:1 on the ground ditto paints under it', async () => {
    expect(contrast(dark.pointed, dark.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(light.pointed, light.background)).toBeGreaterThanOrEqual(4.5)
    expect([dark.background, light.background]).toEqual(['#141311', '#f5f4f0'])
  })

  test('under the pointer takes lucid\'s accent when it reads at 4.5:1 on the ground, and ditto\'s deeper orange when it does not', async () => {
    const palette = { text: '#2e2c27', strong: '#1c1b18', muted: '#625e56' }
    expect(fromLucid({ ground: 'light', palette: { ...palette, accent: '#a04020' } }).pointed).toBe('#a04020')
    expect(fromLucid({ ground: 'light', palette: { ...palette, accent: '#c96442' } }).pointed).toBe(light.pointed)
    expect(fromLucid({ ground: 'dark', palette: { ...palette, accent: '#5a2a1a' } }).pointed).toBe(dark.pointed)
  })

  test('maps the tone lucid drew to its own, orange on both grounds under the pointer', async () => {
    const palette = { text: '#d8d5cc', strong: '#ecebe6', muted: '#a39e94', accent: '#d4734f' }
    expect(fromLucid({ ground: 'dark', palette })).toEqual(dark)
    expect(fromLucid({ ground: 'light', palette: { text: '#2e2c27', strong: '#1c1b18', muted: '#625e56', accent: '#c96442' } })).toEqual(light)
  })

  test('refuses a lucid tone that is missing, half filled or not hex, so ditto falls back to its own', async () => {
    const palette = { text: '#d8d5cc', strong: '#ecebe6', muted: '#a39e94', accent: '#d4734f' }
    expect(isLucidTone({ ground: 'dark', palette })).toBe(true)
    expect(isLucidTone(undefined)).toBe(false)
    expect(isLucidTone(null)).toBe(false)
    expect(isLucidTone({ ground: 'dim', palette })).toBe(false)
    expect(isLucidTone({ ground: 'dark' })).toBe(false)
    expect(isLucidTone({ ground: 'dark', palette: { ...palette, accent: 'orange' } })).toBe(false)
    expect(isLucidTone({ ground: 'dark', palette: { ...palette, strong: undefined } })).toBe(false)
  })
})
