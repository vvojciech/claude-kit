import { fullPng } from './convert'
import type { Host } from './host'
import { isImagePath, nameOf } from './paths'

export const OSASCRIPT = '/usr/bin/osascript'

export const OPEN = '/usr/bin/open'

export const ON_CLIPBOARD = 'Image on clipboard: press ctrl+v'

export function appleString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function clipboardScript(pngPath: string): string {
  return `set the clipboard to (read (POSIX file ${appleString(pngPath)}) as «class PNGf»)`
}

export async function openImage(host: Host, path: string): Promise<string | undefined> {
  const preview = await host.run([OPEN, '-a', 'Preview', path])
  if (preview.exitCode === 0) return undefined
  const plain = await host.run([OPEN, path])
  return plain.exitCode === 0 ? undefined : `Could not open ${nameOf(path)}: ${plain.stderr.trim() || preview.stderr.trim() || 'open failed'}`
}

export async function clipboardHoldsImage(host: Host): Promise<boolean> {
  const info = await host.run([OSASCRIPT, '-e', 'clipboard info'])
  return info.exitCode === 0 && /PNGf|TIFF/.test(info.stdout)
}

export async function clipboardHoldsPng(host: Host): Promise<boolean> {
  const info = await host.run([OSASCRIPT, '-e', 'clipboard info'])
  return info.exitCode === 0 && info.stdout.includes('PNGf')
}

export async function copyImage(host: Host, path: string, cacheDir: string): Promise<string> {
  if (!isImagePath(path)) return `Not an image: ${path}`
  if ((await host.stat(path)) === undefined) return `No such file: ${path}`
  const png = await fullPng(host, path, cacheDir)
  if (png === undefined) return `Could not convert ${nameOf(path)} to PNG`
  const set = await host.run([OSASCRIPT, '-e', clipboardScript(png)])
  if (set.exitCode !== 0) return `Could not put ${nameOf(path)} on the clipboard: ${set.stderr.trim()}`
  return (await clipboardHoldsPng(host)) ? ON_CLIPBOARD : `The clipboard did not take ${nameOf(path)}`
}
