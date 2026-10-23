import { describe, expect, test } from 'claude-code/testing'

import { ON_CLIPBOARD, clipboardScript } from '../hooks/actions'
import { CLIPBOARD_EMPTY, NO_SCREENSHOT, USAGE, parseCommand, runPeek } from '../hooks/commands'
import { isScreenshotLike, pastedFile, projectSlug, screenshotDirs } from '../hooks/places'
import { WIDE_PNG, fakeHost, sipsWrites } from './support'
import type { Answer } from './support'

const PLACES = { home: '/h', cwd: '/w', imagesDir: '/t/images', cacheDir: '/c' }

function clipboard(info: string): Answer {
  return argv => (argv[0] === '/usr/bin/osascript' && argv[2] === 'clipboard info' ? { stdout: info } : undefined)
}

function both(...answers: Answer[]): Answer {
  return (argv, host) => answers.map(a => a(argv, host)).find(r => r !== undefined)
}

function scripts(runs: string[][]): string[] {
  return runs.filter(r => r[0] === '/usr/bin/osascript').map(r => r[2] ?? '')
}

describe('parsing /peek', () => {
  test('reads help, last, clipboard-check and a path', () => {
    expect(parseCommand('')).toEqual({ kind: 'help' })
    expect(parseCommand(' help ')).toEqual({ kind: 'help' })
    expect(parseCommand('last')).toEqual({ kind: 'last' })
    expect(parseCommand('clipboard-check')).toEqual({ kind: 'check' })
    expect(parseCommand('~/a.png')).toEqual({ kind: 'path', path: '~/a.png' })
    expect(parseCommand('"/tmp/a b.png"')).toEqual({ kind: 'path', path: '/tmp/a b.png' })
    expect(parseCommand('/tmp/a\\ b.png')).toEqual({ kind: 'path', path: '/tmp/a b.png' })
  })
})

describe('running /peek', () => {
  test('puts a PNG on the clipboard as PNGf and checks it took', async () => {
    const host = fakeHost({ '/w/shots/a.png': { base64: WIDE_PNG } }, clipboard('«class PNGf», 1234'))
    expect(await runPeek(host, PLACES, parseCommand('shots/a.png'))).toEqual({ text: ON_CLIPBOARD, ok: true })
    expect(scripts(host.runs)).toEqual([clipboardScript('/w/shots/a.png'), 'clipboard info'])
    expect(clipboardScript('/a "b".png')).toBe('set the clipboard to (read (POSIX file "/a \\"b\\".png") as «class PNGf»)')
  })

  test('converts a JPEG first and copies the converted PNG', async () => {
    const host = fakeHost({ '/h/p.jpg': { base64: 'x' } }, both(sipsWrites(WIDE_PNG), clipboard('«class PNGf», 9')))
    expect((await runPeek(host, PLACES, parseCommand('~/p.jpg'))).ok).toBe(true)
    expect(scripts(host.runs)[0]).toMatch(/^set the clipboard to \(read \(POSIX file "\/c\/[0-9a-f]{8}-full\.png"\)/)
  })

  test('says so when the file is missing, not an image, or the clipboard refuses', async () => {
    const host = fakeHost({ '/w/a.txt': { base64: 'x' }, '/w/b.png': { base64: WIDE_PNG } }, clipboard('«class utf8», 3'))
    expect((await runPeek(host, PLACES, parseCommand('/w/none.png'))).text).toBe('No such file: /w/none.png')
    expect((await runPeek(host, PLACES, parseCommand('a.txt'))).text).toBe('Not an image: /w/a.txt')
    expect(await runPeek(host, PLACES, parseCommand('b.png'))).toEqual({ text: 'The clipboard did not take b.png', ok: false })
  })

  test('last takes the newest screenshot-like file across Desktop and Downloads', async () => {
    const host = fakeHost({ '/h/Downloads/Screenshot 2.jpg': { base64: 'x' } }, both(sipsWrites(WIDE_PNG), clipboard('PNGf')))
    host.dirs.set('/h/Desktop', [{ name: 'Screenshot 1.png', mtimeMs: 5 }, { name: 'notes.txt', mtimeMs: 99 }])
    host.dirs.set('/h/Downloads', [{ name: 'Screenshot 2.jpg', mtimeMs: 9 }, { name: 'photo.jpg', mtimeMs: 50 }])
    expect((await runPeek(host, PLACES, parseCommand('last'))).ok).toBe(true)
    expect(host.runs.find(r => r[0] === '/usr/bin/sips')?.[4]).toBe('/h/Downloads/Screenshot 2.jpg')
  })

  test('last says when there is no screenshot', async () => {
    expect(await runPeek(fakeHost(), PLACES, parseCommand('last'))).toEqual({ text: NO_SCREENSHOT, ok: false })
  })

  test('clipboard-check reads clipboard info', async () => {
    expect((await runPeek(fakeHost({}, clipboard('«class PNGf», 5')), PLACES, parseCommand('clipboard-check'))).ok).toBe(true)
    expect(await runPeek(fakeHost({}, clipboard('«class utf8», 5')), PLACES, parseCommand('clipboard-check'))).toEqual({ text: CLIPBOARD_EMPTY, ok: false })
  })

  test('help is the usage', async () => {
    expect((await runPeek(fakeHost(), PLACES, parseCommand(''))).text).toBe(USAGE)
  })
})

describe('places', () => {
  test('spells the project folder as Claude Code does and finds a pasted image by number', () => {
    expect(projectSlug('/home/a.b/workspace')).toBe('-home-a-b-workspace')
    expect(pastedFile([{ name: '12.png', mtimeMs: 1 }, { name: '2.jpeg', mtimeMs: 1 }], 2)).toBe('2.jpeg')
    expect(pastedFile([{ name: '12.png', mtimeMs: 1 }], 1)).toBeUndefined()
  })

  test('screenshot dirs put the configured location first', () => {
    expect(screenshotDirs('/h', '~/Pictures/Shots\n')).toEqual(['/h/Pictures/Shots', '/h/Desktop', '/h/Downloads'])
    expect(screenshotDirs('/h', undefined)).toEqual(['/h/Desktop', '/h/Downloads'])
    expect(isScreenshotLike('Screenshot 2026.jpg')).toBe(true)
    expect(isScreenshotLike('photo.jpg')).toBe(false)
  })
})
