import { describe, expect, test } from 'claude-code/testing'

import { dark } from '../hooks/palette'
import { LIGHTS_MS, OPENING_MS, RACE_CELLS, raceFrame, raceKindOf, raceOn } from '../hooks/race'
import type { RaceProps } from '../hooks/race'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const element = (type: string) => (props: Record<string, unknown>) => ({ type, props, children: [] })

const COLORS = { error: dark.error, faint: dark.faint, muted: dark.muted, strong: dark.strong, title: dark.title, prompt: dark.prompt, progress: dark.progress }

const glyphs = (kind: RaceProps['kind'], sinceMount: number, sinceStart?: number) =>
  raceFrame(kind, sinceMount, sinceStart)
    .map(cell => cell.glyph)
    .join('')

describe('race kind', () => {
  test('streams a comet while the model writes, burns while thinking and pits for tools', () => {
    expect(raceKindOf('requesting')).toBe('comet')
    expect(raceKindOf('responding')).toBe('comet')
    expect(raceKindOf('tool-input')).toBe('comet')
    expect(raceKindOf('thinking')).toBe('depth')
    expect(raceKindOf('tool-use')).toBe('pit')
  })
})

describe('race frame', () => {
  test('always fills the same cells, so the stock line never shifts between modes', () => {
    for (const kind of ['depth', 'comet', 'pit'] as const) {
      for (const elapsed of [0, 450, 3_000, 40_000]) {
        expect(raceFrame(kind, elapsed)).toHaveLength(RACE_CELLS)
        expect(raceFrame(kind, elapsed, elapsed)).toHaveLength(RACE_CELLS)
      }
    }
  })

  test('opens a turn on red start lights, one every 400ms, holding all five', () => {
    expect(glyphs('comet', 0, 0)).toBe('●○○○○')
    expect(glyphs('comet', 1_250, 1_250)).toBe('●●●●○')
    expect(glyphs('pit', 1_900, 1_900)).toBe('●●●●●')
    expect(raceFrame('comet', 0, 0)[0]?.role).toBe('error')
    expect(raceFrame('comet', 0, 0)[1]?.role).toBe('faint')
  })

  test('drops every light at once, then goes', () => {
    expect(glyphs('comet', LIGHTS_MS, LIGHTS_MS)).toBe('○○○○○')
    expect(raceFrame('comet', LIGHTS_MS, LIGHTS_MS).every(cell => cell.role === 'faint')).toBe(true)
    expect(glyphs('pit', OPENING_MS, OPENING_MS)).toBe('◐ pit')
  })

  test('starts a mode that began during the opening from lights out, not from when it mounted', () => {
    expect(glyphs('pit', 1_000 + 150, OPENING_MS + 150)).toBe('◓ pit')
  })

  test('skips the opening when the turn start is unknown', () => {
    expect(glyphs('pit', 0)).toBe('◐ pit')
  })

  test('grows its own star the longer it thinks, never one of the stock spinner glyphs, turning sand at depth', () => {
    const star = (ms: number) => raceFrame('depth', ms).find(cell => cell.glyph.trim() !== '')
    expect([1_000, 5_000, 10_000, 20_000, 45_000].map(ms => star(ms)?.glyph).join('')).toBe('·✧✦✷✺')
    expect(star(45_000)?.role).toBe('title')
  })

  test('runs a sand-headed comet with a fading tail across the cells', () => {
    expect(glyphs('comet', 4 * 90)).toBe(' ·∙•✦')
    expect(raceFrame('comet', 4 * 90)[4]?.role).toBe('title')
  })

  test('spins a tyre in the pits while a tool runs', () => {
    expect(glyphs('pit', 0)).toBe('◐ pit')
    expect(glyphs('pit', 150)).toBe('◓ pit')
    expect(raceFrame('pit', 0)[0]?.role).toBe('progress')
  })
})

describe('race module', () => {
  function fakeSurface() {
    const timers: { ms: number; fn: () => void }[] = []
    const surface = {
      elements: { Text: element('Text') },
      state: undefined as { key: string } | undefined,
      setState(next: { key: string }) {
        surface.state = next
      },
      every(ms: number, fn: () => void) {
        timers.push({ ms, fn })
        return () => {}
      },
    }
    return { surface, timers }
  }

  const cellsOf = (drawn: unknown) => ((drawn as Drawn).props?.children as Drawn[]).map(cell => cell.props?.children).join('')

  test('draws the frame for the time since it mounted and only redraws on a change', () => {
    let now = 1_000
    const { surface, timers } = fakeSurface()
    const props: RaceProps = { kind: 'pit', startedAt: null, colors: COLORS }
    const draw = raceOn(() => now)
    expect(cellsOf(draw(props, surface as never))).toBe('◐ pit ')
    expect(timers).toHaveLength(1)
    const before = surface.state
    now += 50
    timers[0]?.fn()
    expect(surface.state).toBe(before)
    now += 150
    timers[0]?.fn()
    expect(surface.state).not.toBe(before)
  })

  test('ticks against the latest props, so a turn start that arrives after mounting reaches the timer', () => {
    let now = 10_000
    const { surface, timers } = fakeSurface()
    const draw = raceOn(() => now)
    draw({ kind: 'comet', startedAt: null, colors: COLORS }, surface as never)
    now += 3_000
    draw({ kind: 'comet', startedAt: now - 500, colors: COLORS }, surface as never)
    timers[0]?.fn()
    expect(surface.state?.key).toContain('●')
  })
})
