import type { ClientModule } from 'claude-code'

export type RaceKind = 'depth' | 'comet' | 'pit'

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

type Role = 'error' | 'faint' | 'muted' | 'strong' | 'title' | 'prompt' | 'progress'

export type RaceProps = { kind: RaceKind; startedAt: number | null; colors: Record<Role, string> }

export type Cell = { glyph: string; role: Role }

type Shown = { key: string; mounted: number }

export const RACE_CELLS = 5

export const RACE_WIDTH = RACE_CELLS + 1

export const LIGHTS_OUT_MS = 450

export const LIGHTS_MS = 2_000

export const OPENING_MS = LIGHTS_MS + LIGHTS_OUT_MS

const LIGHT_MS = 400

const COMET_STEP_MS = 90

const COMET_LAPS = RACE_CELLS + 3

const TYRE_MS = 150

const TICK_MS = 50

const KIND_OF: Record<SpinnerMode, RaceKind> = { requesting: 'comet', thinking: 'depth', responding: 'comet', 'tool-input': 'comet', 'tool-use': 'pit' }

const DEPTH: ReadonlyArray<{ until: number; cell: Cell }> = [
  { until: 3_000, cell: { glyph: '·', role: 'muted' } },
  { until: 8_000, cell: { glyph: '✧', role: 'prompt' } },
  { until: 15_000, cell: { glyph: '✦', role: 'prompt' } },
  { until: 30_000, cell: { glyph: '✷', role: 'title' } },
  { until: Infinity, cell: { glyph: '✺', role: 'title' } },
]

const TAIL: ReadonlyArray<Cell> = [
  { glyph: '✦', role: 'title' },
  { glyph: '•', role: 'strong' },
  { glyph: '∙', role: 'muted' },
  { glyph: '·', role: 'faint' },
]

const TYRE = ['◐', '◓', '◑', '◒']

const BLANK: Cell = { glyph: ' ', role: 'faint' }

export function raceKindOf(mode: SpinnerMode): RaceKind {
  return KIND_OF[mode]
}

function lights(elapsed: number): Cell[] {
  const lit = Math.min(RACE_CELLS, Math.floor(elapsed / LIGHT_MS) + 1)
  return Array.from({ length: RACE_CELLS }, (_, i) => (i < lit ? { glyph: '●', role: 'error' } : { glyph: '○', role: 'faint' }))
}

function depth(elapsed: number): Cell[] {
  const star = (DEPTH.find(step => elapsed < step.until) ?? DEPTH[DEPTH.length - 1])?.cell ?? BLANK
  return Array.from({ length: RACE_CELLS }, (_, i) => (i === Math.floor(RACE_CELLS / 2) ? star : BLANK))
}

function comet(elapsed: number): Cell[] {
  const head = Math.floor(elapsed / COMET_STEP_MS) % COMET_LAPS
  return Array.from({ length: RACE_CELLS }, (_, i) => TAIL[head - i] ?? BLANK)
}

function pit(elapsed: number): Cell[] {
  const tyre = TYRE[Math.floor(elapsed / TYRE_MS) % TYRE.length] ?? TYRE[0] ?? '◐'
  return [{ glyph: tyre, role: 'progress' }, ...[...' pit'].map(glyph => ({ glyph, role: 'muted' as const }))]
}

export function raceFrame(kind: RaceKind, sinceMount: number, sinceStart = Infinity): Cell[] {
  if (sinceStart < LIGHTS_MS) return lights(sinceStart)
  if (sinceStart < OPENING_MS) return Array.from({ length: RACE_CELLS }, () => ({ glyph: '○', role: 'faint' }))
  const elapsed = Math.min(sinceMount, sinceStart - OPENING_MS)
  if (kind === 'depth') return depth(elapsed)
  if (kind === 'pit') return pit(elapsed)
  return comet(elapsed)
}

function frameAt(props: RaceProps, mounted: number, at: number): Cell[] {
  return raceFrame(props.kind, at - mounted, props.startedAt === null ? Infinity : at - props.startedAt)
}

function keyOf(cells: Cell[]): string {
  return cells.map(cell => `${cell.glyph}${cell.role}`).join('|')
}

export function raceOn(now: () => number): ClientModule<RaceProps, Shown> {
  const latest = new WeakMap<object, RaceProps>()
  return (props, surface) => {
    const { Text } = surface.elements
    latest.set(surface, props)
    if (surface.state === undefined) {
      const mounted = now()
      const shownAt = (at: number): Shown => ({ key: keyOf(frameAt(latest.get(surface) ?? props, mounted, at)), mounted })
      let shown = shownAt(mounted)
      surface.every(TICK_MS, () => {
        const next = shownAt(now())
        if (next.key === shown.key) return
        shown = next
        surface.setState(next)
      })
      surface.setState(shown)
    }
    const at = now()
    const cells = frameAt(props, surface.state?.mounted ?? at, at)
    return (
      <Text>
        {cells.map((cell, i) => (
          <Text key={String(i)} color={props.colors[cell.role]}>
            {cell.glyph}
          </Text>
        ))}
        <Text> </Text>
      </Text>
    )
  }
}

export default raceOn(() => Date.now())
