import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { dark, light, lightDaltonized, toneFor } from '../hooks/palette'
import { clipCells, firstLine, sliceCells } from '../hooks/width'

function countThemeReads(on: On, theme: () => string): { reads: number } {
  const seen = { reads: 0 }
  on('config.list', async () => {
    seen.reads += 1
    return { value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { kind: 'engine' }, isLocked: false }] } as never
  })
  on('env.get', async () => ({ value: undefined }) as never)
  return seen
}

async function draw($: Engine, text: string) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns: 60, rows: 20 } } as never)
}

describe('theme cache', () => {
  test('reads the theme once across renders, and again only after the theme is set', async ($, on) => {
    let theme = 'dark'
    const seen = countThemeReads(on, () => theme)
    on('config.set', async (_, e) => ({ value: e.value }))
    await (await draw($, 'one')).drawn()
    await (await draw($, 'two')).drawn()
    expect(seen.reads).toBe(1)
    theme = 'light'
    await $.config.set({ key: 'theme', value: 'light' } as never)
    const tree = JSON.stringify(await (await draw($, '`three`')).drawn())
    expect(tree).toContain(light.chip)
    expect(seen.reads).toBe(2)
  })

  test('keeps the cached theme when a theme change is denied', async ($, on) => {
    const seen = countThemeReads(on, () => 'dark')
    on('config.set', async () => ({ deny: 'locked' }) as never)
    await (await draw($, 'one')).drawn()
    await $.config.set({ key: 'theme', value: 'light' } as never).catch(() => undefined)
    await (await draw($, 'two')).drawn()
    expect(seen.reads).toBe(1)
  })
})

describe('lucid.tone', () => {
  test('resolves a dark-ansi theme to the Pitwall dark hex palette', () => {
    expect(toneFor('dark-ansi')).toEqual({ ground: 'dark', daltonized: false, palette: dark })
  })

  test('resolves a daltonized light theme and a custom theme on a light terminal', () => {
    expect(toneFor('light-daltonized')).toEqual({ ground: 'light', daltonized: true, palette: lightDaltonized })
    expect(toneFor('my-custom', '0;15').ground).toBe('light')
    expect(toneFor(undefined).palette).toEqual(dark)
  })

  test('returns a frozen tone, so a caller cannot repaint lucid', () => {
    const tone = toneFor('dark')
    expect(Object.isFrozen(tone) && Object.isFrozen(tone.palette)).toBe(true)
    expect(tone.palette).not.toBe(dark)
  })
})

describe('cell truncation', () => {
  test('keeps a joined emoji whole when clipping by cells', () => {
    expect(clipCells('ab👨‍👩‍👧cd', 5)).toBe('ab👨‍👩‍👧…')
    expect(sliceCells('ab👨‍👩‍👧cd', 3)).toBe('ab')
    expect(sliceCells('ab👨‍👩‍👧cd', 4, true)).toBe('👨‍👩‍👧cd')
  })

  test('returns text that fits untouched, and only the ellipsis when no cell is left', () => {
    expect(clipCells('fits', 4)).toBe('fits')
    expect(clipCells('wide', 1)).toBe('…')
    expect(clipCells('wide', 0)).toBe('…')
    expect(clipCells('', 0)).toBe('')
  })

  test('clips a long line in linear time', () => {
    const long = 'x'.repeat(200000)
    const started = performance.now()
    expect(clipCells(long, 150000).length).toBe(150000)
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test('takes the first non-blank line, trimmed, or nothing', () => {
    expect(firstLine('\n  \n  hello  \nworld')).toBe('hello')
    expect(firstLine('\n \n')).toBe('')
  })
})
