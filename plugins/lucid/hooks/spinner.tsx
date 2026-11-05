import type { ClientModule } from 'claude-code'

export type SpinnerProps = { frames: string[]; color: string; ms: number }

const FASTEST_MS = 50

export function paceOf(ms: number): number {
  return Number.isFinite(ms) ? Math.max(FASTEST_MS, ms) : FASTEST_MS
}

export function frameAt(now: number, ms: number, count: number): number {
  return count === 0 ? 0 : Math.floor(now / paceOf(ms)) % count
}

export function spinnerOn(now: () => number): ClientModule<SpinnerProps, number> {
  return (props, surface) => {
    const { Text } = surface.elements
    if (surface.state === undefined) {
      let shown = frameAt(now(), props.ms, props.frames.length)
      surface.every(FASTEST_MS, () => {
        const frame = frameAt(now(), props.ms, props.frames.length)
        if (frame === shown) return
        shown = frame
        surface.setState(frame)
      })
      surface.setState(shown)
    }
    return <Text color={props.color}>{props.frames[surface.state ?? 0] ?? props.frames[0] ?? ''}</Text>
  }
}

export default spinnerOn(() => Date.now())
