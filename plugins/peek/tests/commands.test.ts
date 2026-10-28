import { describe, expect, test } from 'claude-code/testing'

import { ON_CLIPBOARD, clipboardScript } from '../hooks/actions'
import { USAGE, parseCommand, runPeek } from '../hooks/commands'
import { pastedFile, placesOf, projectSlug } from '../hooks/places'
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
  test('reads help and a path', () => {
    expect(parseCommand('')).toEqual({ kind: 'help' })
    expect(parseCommand(' help ')).toEqual({ kind: 'help' })
    expect(parseCommand('last')).toEqual({ kind: 'path', path: 'last' })
    expect(parseCommand('~/a.png')).toEqual({ kind: 'path', path: '~/a.png' })
    expect(parseCommand('"/tmp/a b.png"')).toEqual({ kind: 'path', path: '/tmp/a b.png' })
    expect(parseCommand('/tmp/a\\ b.png')).toEqual({ kind: 'path', path: '/tmp/a b.png' })
    expect(parseCommand('/tmp/shot\\(1\\).png')).toEqual({ kind: 'path', path: '/tmp/shot(1).png' })
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
    expect(scripts(host.runs)[0]).toMatch(/^set the clipboard to \(read \(POSIX file "\/c\/[0-9a-f]{16}-full\.\w+"\)/)
  })

  test('removes the full-size conversion once the clipboard holds it', async () => {
    const host = fakeHost({ '/h/p.jpg': { base64: 'x' } }, both(sipsWrites(WIDE_PNG), clipboard('«class PNGf», 9')))
    expect((await runPeek(host, PLACES, parseCommand('~/p.jpg'))).ok).toBe(true)
    expect([...host.files.keys()]).toEqual(['/h/p.jpg'])
  })

  test('says so when the file is missing, not an image, or the clipboard refuses', async () => {
    const host = fakeHost({ '/w/a.txt': { base64: 'x' }, '/w/b.png': { base64: WIDE_PNG } }, clipboard('«class utf8», 3'))
    expect((await runPeek(host, PLACES, parseCommand('/w/none.png'))).text).toBe('No such file: /w/none.png')
    expect((await runPeek(host, PLACES, parseCommand('a.txt'))).text).toBe('Not an image: /w/a.txt')
    expect(await runPeek(host, PLACES, parseCommand('b.png'))).toEqual({ text: 'The clipboard did not take b.png', ok: false })
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

  test('keeps the cache in a private folder of its own, and moves it home when the temp folder is not', async () => {
    const engine = { env: { get: async (name: string) => (name === 'HOME' ? '/h' : '/t') }, session: { id: async () => 's1' } } as never
    const owner = (stat: string): Answer => argv => (argv[0] === '/usr/bin/id' ? { stdout: '501\n' } : argv[0] === '/usr/bin/stat' ? { stdout: stat } : undefined)
    const mine = fakeHost({}, owner('501 700 Directory\n'))
    expect((await placesOf(engine, mine, '/w')).cacheDir).toBe('/t/claude-501/peek')
    expect(mine.runs).toContainEqual(['/bin/mkdir', '-p', '-m', '700', '/t/claude-501'])
    const shared = fakeHost({}, argv => (argv[0] === '/usr/bin/id' ? { stdout: '501\n' } : argv[0] === '/usr/bin/stat' ? { stdout: argv.at(-1) === '/t/claude-501' ? '502 755 Directory\n' : '501 700 Directory\n' } : undefined))
    expect((await placesOf(engine, shared, '/w')).cacheDir).toBe('/h/Library/Caches/peek')
  })

  test('checks the folder it falls back to as well, and makes a fresh private one when that is shared too', async () => {
    const engine = { env: { get: async (name: string) => (name === 'HOME' ? '/h' : '/t') }, session: { id: async () => 's1' } } as never
    const host = fakeHost({}, argv => {
      if (argv[0] === '/usr/bin/id') return { stdout: '501\n' }
      if (argv[0] === '/usr/bin/stat') return { stdout: '501 755 Directory\n' }
      if (argv[0] === '/usr/bin/mktemp') return { stdout: '/t/peek.Ab12Cd\n' }
      return undefined
    })
    expect((await placesOf(engine, host, '/w')).cacheDir).toBe('/t/peek.Ab12Cd')
  })

  test('keeps no cache when every folder is shared and mktemp fails, rather than use a shared one', async () => {
    const engine = { env: { get: async (name: string) => (name === 'HOME' ? '/h' : '/t') }, session: { id: async () => 's1' } } as never
    const host = fakeHost({}, argv => {
      if (argv[0] === '/usr/bin/id') return { stdout: '501\n' }
      if (argv[0] === '/usr/bin/stat') return { stdout: '501 755 Directory\n' }
      if (argv[0] === '/usr/bin/mktemp') return { exitCode: 1, stderr: 'mktemp: failed' }
      return undefined
    })
    expect((await placesOf(engine, host, '/w')).cacheDir).toBeUndefined()
  })
})
