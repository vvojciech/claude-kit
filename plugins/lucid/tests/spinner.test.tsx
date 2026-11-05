import { describe, expect, test } from 'claude-code/testing'

import { dark } from '../hooks/palette'
import { frameAt, paceOf, spinnerOn } from '../hooks/spinner'
import type { SpinnerProps } from '../hooks/spinner'
import { RUNNING_FRAMES, SETTLE_FLASH_MS, renderToolRow } from '../hooks/tool-rows'
import Settle from '../hooks/settle'
import type { ToolState } from '../hooks/tools'
import { cellWidth } from '../hooks/width'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const element = (type: string) => (props: Record<string, unknown>) => ({ type, props, children: [] })

const KIT = { Box: element('Box'), Text: element('Text'), Link: element('Link') } as never

const TERMINAL_KIT = { Box: element('Box'), Text: element('Text'), Link: element('Link'), Client: element('Client') } as never

const ROW = { name: 'Bash', detail: [] }

function nodes(node: unknown): Drawn[] {
  if (node === null || typeof node !== 'object') return []
  const drawn = node as Drawn
  return [drawn, ...[...(drawn.children ?? []), ...((drawn.props?.children as unknown[] | undefined) ?? [])].flat().flatMap(nodes)]
}

function textOf(node: Drawn | undefined): string {
  return [node?.props?.children].flat().join('')
}

function row(kit: never, state: ToolState): Drawn[] {
  return nodes(renderToolRow({ kit, palette: dark }, ROW, state, 80))
}

function fakeSurface() {
  const timers: { ms: number; fn: () => void }[] = []
  const surface = {
    elements: { Text: element('Text') },
    state: undefined as number | undefined,
    setState(next: number) {
      surface.state = next
    },
    every(ms: number, fn: () => void) {
      timers.push({ ms, fn })
      return () => {}
    },
  }
  return { surface, timers, draw: (props: SpinnerProps) => Spinner(props, surface as never) as unknown as Drawn }
}

const PROPS: SpinnerProps = { frames: RUNNING_FRAMES, color: dark.progress, ms: 150 }

describe('running glyph', () => {
  test('turns while a call runs on a surface that draws surface modules', () => {
    const clients = row(TERMINAL_KIT, 'running').filter(n => n.type === 'Client')
    expect(clients.map(n => n.props)).toEqual([expect.objectContaining({ module: 'hooks/spinner.tsx', width: 1, props: { frames: RUNNING_FRAMES, color: dark.progress, ms: 150 } })])
  })

  test('stops turning once the call ends', () => {
    for (const state of ['done', 'failed', 'pending', 'interrupted'] as const) expect(row(TERMINAL_KIT, state).some(n => n.type === 'Client')).toBe(false)
  })

  test('holds the first frame still where the surface cannot draw a surface module', () => {
    const drawn = row(KIT, 'running')
    expect(drawn.some(n => n.type === 'Client')).toBe(false)
    expect(drawn.some(n => n.type === 'Text' && textOf(n) === RUNNING_FRAMES[0])).toBe(true)
  })

  test('keeps every frame one cell wide, so the row never shifts as it turns', () => {
    for (const frame of RUNNING_FRAMES) expect(cellWidth(frame)).toBe(1)
  })
})

let clock = 0

const Spinner = spinnerOn(() => clock)

function at<T>(now: number, run: () => T): T {
  clock = now
  return run()
}

describe('spinner surface module', () => {
  test('starts one timer and draws the frame the clock is on, in the given colour', () => {
    const { timers, draw } = fakeSurface()
    const first = at(300, () => draw(PROPS))
    expect([first.props?.color, textOf(first)]).toEqual([dark.progress, RUNNING_FRAMES[2]])
    expect(timers.map(t => t.ms)).toEqual([50])
  })

  test('takes each tick from the clock, so rows started apart turn in step', () => {
    const early = fakeSurface()
    const late = fakeSurface()
    at(0, () => early.draw(PROPS))
    at(170, () => late.draw(PROPS))
    const frames = [450, 600, 750].map(now =>
      at(now, () => {
        early.timers[0]?.fn()
        late.timers[0]?.fn()
        return [textOf(early.draw(PROPS)), textOf(late.draw(PROPS))]
      }),
    )
    expect(frames).toEqual([[RUNNING_FRAMES[3], RUNNING_FRAMES[3]], [RUNNING_FRAMES[0], RUNNING_FRAMES[0]], [RUNNING_FRAMES[1], RUNNING_FRAMES[1]]])
    expect([early.timers.length, late.timers.length]).toEqual([1, 1])
  })

  test('wraps the frame index and holds still with no frames', () => {
    expect([0, 149, 150, 599, 600].map(now => frameAt(now, 150, 4))).toEqual([0, 0, 1, 3, 0])
    expect(frameAt(1000, 150, 0)).toBe(0)
  })

  test('never ticks faster than 50ms, whatever pace it is handed', () => {
    expect([0, -5, Number.NaN, 10, 150].map(paceOf)).toEqual([50, 50, 50, 50, 150])
    const { timers, draw } = fakeSurface()
    at(0, () => draw({ ...PROPS, ms: 0 }))
    expect(timers.map(t => t.ms)).toEqual([50])
  })

  test('shows each frame once and in order even when ticks land either side of a frame edge', () => {
    const { surface, timers, draw } = fakeSurface()
    at(0, () => draw(PROPS))
    const shown: number[] = []
    const setState = surface.setState.bind(surface)
    surface.setState = (next: number) => {
      shown.push(next)
      setState(next)
    }
    for (const now of [49, 149, 151, 199, 301, 449, 451]) at(now, () => timers[0]?.fn())
    expect(shown).toEqual([1, 2, 3])
  })
})

describe('group rows', () => {
  const running = { label: 'Running', detail: [], state: 'running' as const, tool: 'Bash' }
  const failed = { label: "Couldn't run", detail: [], state: 'failed' as const, tool: 'Bash' }
  const done = { label: 'Ran', detail: [], state: 'done' as const, tool: 'Bash' }

  test('gives every turning glyph in one group its own key, so none of them restarts another', () => {
    const drawn = nodes(renderToolRow({ kit: TERMINAL_KIT, palette: dark }, { name: 'Ran 2 commands', detail: [], lines: [running, running] }, 'running', 80))
    const keys = drawn.filter(n => n.type === 'Client').map(n => n.props?.key)
    expect(keys).toEqual(['running', 'running-0', 'running-1'])
  })

  test('keeps a failed group header still while a call inside it turns, so a failure is never hidden behind motion', () => {
    const drawn = nodes(renderToolRow({ kit: TERMINAL_KIT, palette: dark }, { name: 'Ran 1 of 3 commands', detail: [], lines: [done, failed, running] }, 'failed', 80))
    expect(drawn.filter(n => n.type === 'Client').map(n => n.props?.key)).toEqual(['running-2'])
    expect(drawn.some(n => n.type === 'Text' && textOf(n) === '✗' && n.props?.color === dark.error)).toBe(true)
  })

  test('marks a failed line with a red cross in the kind slot, so it reads as failed without colour too', () => {
    const drawn = nodes(renderToolRow({ kit: KIT, palette: dark }, { name: 'Ran 2 commands', detail: [], lines: [done, failed] }, 'failed', 80))
    const slots = drawn.filter(n => n.type === 'Text' && ['$', '✗'].includes(textOf(n))).map(n => [textOf(n), n.props?.color])
    expect(slots).toEqual([['✗', dark.error], ['$', dark.muted], ['✗', dark.error]])
  })
})

describe('settle flash module', () => {
  test('shows one bright frame, then the settled glyph, from a single timer', () => {
    const timers: { ms: number; fn: () => void }[] = []
    const surface = {
      elements: { Text: element('Text') },
      state: undefined as true | undefined,
      setState(next: true) {
        surface.state = next
      },
      every(ms: number, fn: () => void) {
        timers.push({ ms, fn })
        return () => {
          timers.length = 0
        }
      },
    }
    const props = { flash: '◉', flashColor: dark.strong, glyph: '●', color: dark.done, ms: SETTLE_FLASH_MS }
    const first = Settle(props, surface as never) as unknown as Drawn
    expect([textOf(first), first.props?.color, timers.map(t => t.ms)]).toEqual(['◉', dark.strong, [SETTLE_FLASH_MS]])
    timers[0]?.fn()
    const settled = Settle(props, surface as never) as unknown as Drawn
    expect([textOf(settled), settled.props?.color, timers.length]).toEqual(['●', dark.done, 0])
  })
})
