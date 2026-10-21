import { describe, expect, test } from 'claude-code/testing'

import { dark, groundOfTerminal, light, toneFor } from '../hooks/palette'
import { LUCID_MUTED } from './fixtures/lucid-palette'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r = 0, g = 0, b = 0] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

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
    expect(Object.keys(LUCID_MUTED).length).toBeGreaterThan(0)
    for (const [theme, muted] of Object.entries(LUCID_MUTED)) expect(toneFor(theme).muted).toBe(muted)
  })

  test('marker, chips and the hovered chip reach 4.5:1 on every ground', async () => {
    for (const ground of DARK_GROUNDS) for (const role of [dark.muted, dark.text, dark.accent]) expect(contrast(role, ground)).toBeGreaterThanOrEqual(4.5)
    for (const ground of LIGHT_GROUNDS) for (const role of [light.muted, light.text, light.accent]) expect(contrast(role, ground)).toBeGreaterThanOrEqual(4.5)
  })
})
