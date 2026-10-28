import { openImage } from './actions'
import { drawsPictures } from './capability'
import { hashOf, thumbnail } from './convert'
import { maxColumnsFor } from './draws'
import { THUMB_ROWS, fitCells } from './fit'
import type { Host } from './host'
import { fromFileUrl, isImagePath, resolvePath } from './paths'
import type { Places } from './places'
import { MARK, OPEN, imageKey } from './view'
import type { PeekFallback, PeekOpenArgs, PeekOpened, PeekPicture, PeekPictureArgs } from '../types'

export const PICTURES_OFF: PeekFallback = { fallback: 'pictures-off' }

export const UNRESOLVED: PeekFallback = { fallback: 'unresolved' }

export function pathFor(path: string, cwd: string | undefined, where: Places): string {
  return resolvePath(fromFileUrl(path), cwd ?? where.cwd, where.home)
}

export function replyImageKey(path: string): string {
  return imageKey(`reply-${hashOf(path)}`)
}

export async function pictureFor(host: Host, args: PeekPictureArgs, where: Places): Promise<PeekPicture | PeekFallback> {
  if (!drawsPictures(args.isFullscreen)) return PICTURES_OFF
  const path = pathFor(args.path, args.cwd, where)
  const thumb = isImagePath(path) ? await thumbnail(host, path, where.cacheDir) : undefined
  if (thumb === undefined) return UNRESOLVED
  const cells = fitCells(thumb.size, THUMB_ROWS, maxColumnsFor(args.columns))
  return { source: { png: thumb.png }, ...cells, alt: `${MARK} ${thumb.name}`, path, name: thumb.name, caption: `${thumb.source.width}×${thumb.source.height}`, open: OPEN, key: replyImageKey(path) }
}

export async function openFor(host: Host, args: PeekOpenArgs, where: Places): Promise<PeekOpened> {
  const error = await openImage(host, pathFor(args.path, args.cwd, where))
  return error === undefined ? {} : { error }
}
