import type { EngineInterface, RenderElement } from 'claude-code'

import { copyImage, openImage } from './actions'
import { drawsPictures, probe } from './capability'
import { thumbnail } from './convert'
import { MAX_COLUMNS, fitCells } from './fit'
import type { Host } from './host'
import { nameOf } from './paths'
import type { Places } from './places'
import { toneOf } from './tone'
import { gallery, imageKey, shownOf } from './view'
import type { Action, Kit, Shown } from './view'

export const MOST = 4

export const CLIP = '⧉ clip'

export type Wanted = { id: string; path: string; name?: string; clip?: boolean }

export type Frame = { host: Host; places: Places; kit: Kit; requestId: string; pictures: boolean; maxColumns: number; maxRows: number }

function openAction($: EngineInterface, frame: Frame, wanted: Wanted): Action {
  return {
    key: `peek-open-${wanted.id}`,
    label: '⤢ open',
    press: () => void openImage(frame.host, wanted.path).then(error => error !== undefined && $.ui.toast(error)),
  }
}

function clipAction($: EngineInterface, frame: Frame, wanted: Wanted): Action {
  return {
    key: `peek-clip-${wanted.id}`,
    label: CLIP,
    press: () => void copyImage(frame.host, wanted.path, frame.places.cacheDir).then(text => $.ui.toast(text)),
  }
}

function actionsOf($: EngineInterface, frame: Frame, wanted: Wanted): Action[] {
  return [openAction($, frame, wanted), ...(wanted.clip ? [clipAction($, frame, wanted)] : [])]
}

async function pictured(frame: Frame, wanted: Wanted, base: Shown): Promise<Shown | undefined> {
  const thumb = await thumbnail(frame.host, wanted.path, frame.places.cacheDir)
  if (thumb === undefined) return undefined
  return { ...base, png: thumb.png, caption: `${thumb.size.width}×${thumb.size.height}`, cells: fitCells(thumb.size, frame.maxRows, frame.maxColumns) }
}

export async function shownFor($: EngineInterface, frame: Frame, wanted: Wanted): Promise<Shown | undefined> {
  const base: Shown = { id: wanted.id, name: wanted.name ?? nameOf(wanted.path), actions: actionsOf($, frame, wanted) }
  if (frame.pictures) return pictured(frame, wanted, base)
  return (await frame.host.stat(wanted.path)) === undefined ? undefined : base
}

export function maxColumnsFor(columns: number | undefined): number {
  return Math.max(8, Math.min(MAX_COLUMNS, (columns ?? 80) - 24))
}

export function picturesFor(isFullscreen: boolean | undefined): boolean {
  return drawsPictures(isFullscreen)
}

export async function itemsFor($: EngineInterface, frame: Frame, wanted: Wanted[]): Promise<RenderElement[]> {
  const shown = (await Promise.all(wanted.slice(0, MOST).map(w => shownFor($, frame, w)))).filter((s): s is Shown => s !== undefined)
  if (shown.length === 0) return []
  const tone = await toneOf($)
  const first = shown.find(s => s.png !== undefined)
  if (frame.pictures && first?.png !== undefined) probe($, frame.requestId, imageKey(first.id), { png: first.png })
  return shown.map(s => shownOf(frame.kit, tone, s, frame.pictures))
}

export async function withThumbs($: EngineInterface, frame: Frame, drawn: RenderElement, wanted: Wanted[]): Promise<RenderElement> {
  if (wanted.length === 0) return drawn
  const items = await itemsFor($, frame, wanted)
  return items.length === 0 ? drawn : gallery(frame.kit, drawn, items)
}

type Node = { type?: unknown; props?: { key?: unknown }; children?: unknown }

export function imageKeysIn(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (typeof node !== 'object' || node === null) return found
  const { type, props, children } = node as Node
  if (type === 'Image' && typeof props?.key === 'string') found.add(props.key)
  if (Array.isArray(children)) for (const child of children) imageKeysIn(child, found)
  return found
}
