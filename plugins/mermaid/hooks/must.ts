// a value the drawing code knows is there; failing here beats drawing from undefined, and the
// caller already falls back to the diagram's source when drawing throws
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`mermaid: missing ${what}`)
  return value
}
