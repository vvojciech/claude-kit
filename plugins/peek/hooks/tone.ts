import type { EngineInterface } from 'claude-code'

export type Tone = { muted: string; text: string }

const darkGreys: Tone = { muted: '#9b9b9b', text: '#c8c8c8' }

const lightGreys: Tone = { muted: '#5f5f5f', text: '#3a3a3a' }

declare module 'claude-code' {
  interface EngineInterface {
    lucid: { tone: () => Promise<unknown> }
  }
}

const HEX = /^#[0-9a-f]{6}$/i

function fromLucid(value: unknown): Tone | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const palette = (value as { palette?: { muted?: unknown; text?: unknown } }).palette
  const { muted, text } = palette ?? {}
  return typeof muted === 'string' && typeof text === 'string' && HEX.test(muted) && HEX.test(text) ? { muted, text } : undefined
}

function greysFor(theme: unknown): Tone {
  return typeof theme === 'string' && /light/i.test(theme) ? lightGreys : darkGreys
}

async function theme($: EngineInterface): Promise<unknown> {
  const rows = await $.config.list().catch(() => [])
  return rows.find(row => row.key === 'theme')?.value
}

async function lucid($: EngineInterface): Promise<unknown> {
  try {
    return await $.lucid.tone()
  } catch {
    return undefined
  }
}

export async function toneOf($: EngineInterface): Promise<Tone> {
  return fromLucid(await lucid($)) ?? greysFor(await theme($))
}
