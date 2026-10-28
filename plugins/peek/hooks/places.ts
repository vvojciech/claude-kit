import type { EngineInterface } from 'claude-code'

import type { Entry, Host } from './host'
import { isImagePath } from './paths'

export type Places = { home: string; cwd: string; imagesDir: string; cacheDir: string }

export function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function claudeTmp(base: string | undefined, uid: string): string {
  return `${(base ?? '/tmp').replace(/\/$/, '')}/claude-${uid}`
}

export async function placesOf($: EngineInterface, host: Host, cwd: string): Promise<Places> {
  const [uid, base, home, session] = await Promise.all([
    host.run(['/usr/bin/id', '-u']).then(r => r.stdout.trim() || '0'),
    $.env.get('CLAUDE_CODE_TMPDIR').catch(() => undefined),
    $.env.get('HOME').catch(() => undefined),
    $.session.id(),
  ])
  const tmp = claudeTmp(base, uid)
  const preferred = (await isPrivate(host, tmp, uid)) ? `${tmp}/peek` : `${home ?? ''}/Library/Caches/peek`
  const cacheDir = (await isPrivate(host, preferred, uid)) ? preferred : await freshDir(host, preferred)
  return { home: home ?? '', cwd, imagesDir: `${tmp}/${projectSlug(cwd)}/${session}/images`, cacheDir }
}

async function freshDir(host: Host, otherwise: string): Promise<string> {
  const made = await host.run(['/usr/bin/mktemp', '-d', '-t', 'peek'])
  const dir = made.stdout.trim()
  return made.exitCode === 0 && dir !== '' ? dir : otherwise
}

async function isPrivate(host: Host, dir: string, uid: string): Promise<boolean> {
  await host.run(['/bin/mkdir', '-p', '-m', '700', dir])
  const made = await host.run(['/usr/bin/stat', '-f', '%u %Lp %HT', dir])
  return made.exitCode === 0 && made.stdout.trim() === `${uid} 700 Directory`
}

export function pastedFile(entries: Entry[], n: number): string | undefined {
  return entries.find(e => e.name.startsWith(`${n}.`) && isImagePath(e.name))?.name
}

export async function pastedImage(host: Host, places: Places, n: number): Promise<string | undefined> {
  const name = pastedFile(await host.list(places.imagesDir), n)
  return name === undefined ? undefined : `${places.imagesDir}/${name}`
}

export function isScreenshotLike(name: string): boolean {
  return isImagePath(name) && (/^Screenshot/i.test(name) || /\.png$/i.test(name))
}

export function screenshotDirs(home: string, configured: string | undefined): string[] {
  const own = configured?.trim() ? [configured.trim().replace(/^~/, home).replace(/\/$/, '')] : []
  return [...new Set([...own, `${home}/Desktop`, `${home}/Downloads`])]
}

async function configuredDir(host: Host): Promise<string | undefined> {
  const ran = await host.run(['/usr/bin/defaults', 'read', 'com.apple.screencapture', 'location'])
  return ran.exitCode === 0 ? ran.stdout : undefined
}

export async function newestScreenshot(host: Host, home: string): Promise<string | undefined> {
  const dirs = screenshotDirs(home, await configuredDir(host))
  const found = await Promise.all(dirs.map(async dir => (await host.list(dir)).filter(e => isScreenshotLike(e.name)).map(e => ({ ...e, path: `${dir}/${e.name}` }))))
  return found.flat().sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path
}
