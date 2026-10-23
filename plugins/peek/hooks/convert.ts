import type { Host } from './host'
import { extensionOf, nameOf } from './paths'
import { MAX_PNG_BYTES, decodedBytes, pngSize } from './png'
import type { Size } from './png'

export const SIPS = '/usr/bin/sips'

export const DIRECT_BYTES = 512 * 1024

export const EDGES = [800, 512, 256] as const

const REMEMBERED = 64

export type Thumb = { path: string; name: string; png: string; size: Size }

const made = new Map<string, Promise<Thumb | undefined>>()

export function forgetThumbs(): void {
  made.clear()
}

export function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function sipsArgs(path: string, out: string, edge?: number): string[] {
  const scale = edge === undefined ? [] : ['-Z', String(edge)]
  return [SIPS, '-s', 'format', 'png', ...scale, path, '--out', out]
}

async function asThumb(host: Host, path: string, file: string): Promise<Thumb | undefined> {
  const png = await host.read(file).catch(() => undefined)
  const size = png === undefined ? undefined : pngSize(png)
  return png === undefined || size === undefined ? undefined : { path, name: nameOf(path), png, size }
}

async function converted(host: Host, path: string, out: string, edge?: number): Promise<boolean> {
  if (await host.exists(out)) return true
  return (await host.run(sipsArgs(path, out, edge))).exitCode === 0
}

async function scaled(host: Host, path: string, stem: string): Promise<Thumb | undefined> {
  for (const edge of EDGES) {
    const out = `${stem}-${edge}.png`
    if (!(await converted(host, path, out, edge))) return undefined
    const thumb = await asThumb(host, path, out)
    if (thumb !== undefined && decodedBytes(thumb.png) <= MAX_PNG_BYTES) return thumb
  }
  return undefined
}

async function make(host: Host, path: string, cacheDir: string, key: string, size: number): Promise<Thumb | undefined> {
  if (extensionOf(path) === 'png' && size <= DIRECT_BYTES) return asThumb(host, path, path)
  return scaled(host, path, `${cacheDir}/${hashOf(key)}`)
}

function remember(key: string, thumb: Promise<Thumb | undefined>): Promise<Thumb | undefined> {
  if (made.size >= REMEMBERED) made.delete(made.keys().next().value ?? '')
  made.set(key, thumb)
  return thumb
}

export async function thumbnail(host: Host, path: string, cacheDir: string): Promise<Thumb | undefined> {
  const stat = await host.stat(path)
  if (stat === undefined) return undefined
  const key = `${path}@${stat.mtimeMs}`
  return made.get(key) ?? remember(key, make(host, path, cacheDir, key, stat.size).catch(() => undefined))
}

export async function fullPng(host: Host, path: string, cacheDir: string): Promise<string | undefined> {
  if (extensionOf(path) === 'png') return path
  const stat = await host.stat(path)
  if (stat === undefined) return undefined
  const out = `${cacheDir}/${hashOf(`${path}@${stat.mtimeMs}`)}-full.png`
  return (await converted(host, path, out)) ? out : undefined
}
