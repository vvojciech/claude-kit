import type { EngineInterface } from 'claude-code'

import { clipCells } from './width'

type Files = Pick<EngineInterface, 'fs' | 'session' | 'clock'>

const TEMP_ROOTS = ['/private/tmp', '/tmp']

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g

const MISS_BACKOFF_MS = 30_000

const TAIL_BYTES = 8192

export const MAX_TAIL_FILE = 512 * 1024

export const TAIL_CELLS = 72

type Found = { session: string; dir: string | undefined; at: number }

let found: Found | undefined

const seen = new Map<string, { mtimeMs: number; size: number; tail: string | undefined }>()

async function tempRoots($: Files): Promise<string[]> {
  const roots: string[] = []
  for (const root of TEMP_ROOTS) {
    const real = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root
    if ((await $.fs.exists(real).catch(() => false)) && !roots.includes(real)) roots.push(real)
  }
  return roots
}

async function findTasksDir($: Files, session: string): Promise<string | undefined> {
  for (const root of await tempRoots($)) {
    const owners = await $.fs.list(root).catch(() => [])
    for (const owner of owners.filter(entry => entry.name.startsWith('claude-'))) {
      const projects = await $.fs.list(`${root}/${owner.name}`).catch(() => [])
      for (const project of projects) {
        const dir = `${root}/${owner.name}/${project.name}/${session}/tasks`
        if (await $.fs.exists(dir).catch(() => false)) return dir
      }
    }
  }
  return undefined
}

async function tasksDir($: Files): Promise<string | undefined> {
  const session = await $.session.id()
  const now = await $.clock.now()
  if (found?.session === session && (found.dir !== undefined || now - found.at < MISS_BACKOFF_MS)) return found.dir
  found = { session, dir: await findTasksDir($, session).catch(() => undefined), at: now }
  return found.dir
}

export function lastLine(text: string): string | undefined {
  const lines = text.slice(-TAIL_BYTES).replace(ANSI, '').split(/\r?\n|\r/).map(line => line.trim()).filter(line => line !== '')
  const last = lines.at(-1)
  return last === undefined ? undefined : clipCells(last, TAIL_CELLS)
}

export async function tailOf($: Files, taskId: string): Promise<string | undefined> {
  const dir = await tasksDir($)
  if (dir === undefined) return undefined
  const path = `${dir}/${taskId}.output`
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined || stat.size > MAX_TAIL_FILE) return undefined
  const known = seen.get(path)
  if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known.tail
  const text = await $.fs.read(path).catch(() => undefined)
  const tail = typeof text === 'string' ? lastLine(text) : undefined
  seen.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, tail })
  return tail
}

export function forgetTail(taskId: string): void {
  for (const path of seen.keys()) if (path.endsWith(`/${taskId}.output`)) seen.delete(path)
}
