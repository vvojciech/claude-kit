import { describe, expect, test } from 'claude-code/testing'

import { DIRECT_BYTES, forgetThumbs, fullPng, sipsArgs, thumbnail } from '../hooks/convert'
import { MAX_PNG_BYTES, decodedBytes, pngSize } from '../hooks/png'
import { TALL_PNG, WIDE_PNG, fakeHost, sipsWrites } from './support'

const CACHE = '/c'

function sipsRuns(runs: string[][]): string[][] {
  return runs.filter(r => r[0] === '/usr/bin/sips')
}

const HUGE = 'A'.repeat(Math.ceil(((MAX_PNG_BYTES + 10) * 4) / 3))

describe('png bytes', () => {
  test('reads width and height from the header', () => {
    expect(pngSize(WIDE_PNG)).toEqual({ width: 40, height: 20 })
    expect(pngSize(TALL_PNG)).toEqual({ width: 20, height: 40 })
    expect(pngSize('/9j/4AAQSkZJRgABAQ')).toBeUndefined()
  })

  test('counts decoded bytes from base64 length', () => {
    expect(decodedBytes('QUJD')).toBe(3)
    expect(decodedBytes('QUI=')).toBe(2)
    expect(decodedBytes(HUGE)).toBeGreaterThan(MAX_PNG_BYTES)
  })
})

describe('making a thumbnail', () => {
  test('uses a small PNG as it is, with no sips', async () => {
    forgetThumbs()
    const host = fakeHost({ '/a/s.png': { base64: WIDE_PNG } })
    const thumb = await thumbnail(host, '/a/s.png', CACHE)
    expect(thumb).toEqual({ path: '/a/s.png', name: 's.png', png: WIDE_PNG, size: { width: 40, height: 20 } })
    expect(host.runs).toEqual([])
  })

  test('converts a JPEG to an 800px PNG in the cache with /usr/bin/sips', async () => {
    forgetThumbs()
    const host = fakeHost({ '/a/p.jpg': { base64: '/9j/', mtimeMs: 7 } }, sipsWrites(WIDE_PNG))
    const thumb = await thumbnail(host, '/a/p.jpg', CACHE)
    const [run] = sipsRuns(host.runs)
    expect(run?.slice(0, 7)).toEqual(['/usr/bin/sips', '-s', 'format', 'png', '-Z', '800', '/a/p.jpg'])
    expect(run?.[7]).toBe('--out')
    expect(run?.[8]).toMatch(/^\/c\/[0-9a-f]{8}-800\.png$/)
    expect(thumb?.png).toBe(WIDE_PNG)
    expect(thumb?.path).toBe('/a/p.jpg')
  })

  test('scales a big PNG down too, so the bytes sent stay small', async () => {
    forgetThumbs()
    const host = fakeHost({ '/a/big.png': { base64: WIDE_PNG, size: DIRECT_BYTES + 1 } }, sipsWrites(TALL_PNG))
    expect((await thumbnail(host, '/a/big.png', CACHE))?.png).toBe(TALL_PNG)
    expect(sipsRuns(host.runs)).toHaveLength(1)
  })

  test('steps down to 512 then 256 while the PNG is over 2 MiB', async () => {
    forgetThumbs()
    let made = 0
    const host = fakeHost({ '/a/h.heic': { base64: 'x' } }, (argv, h) => {
      if (argv[0] !== '/usr/bin/sips') return undefined
      made += 1
      h.files.set(argv[argv.length - 1] ?? '', { base64: made < 3 ? WIDE_PNG + HUGE : TALL_PNG })
      return { exitCode: 0 }
    })
    const thumb = await thumbnail(host, '/a/h.heic', CACHE)
    expect(sipsRuns(host.runs).map(r => r[5])).toEqual(['800', '512', '256'])
    expect(thumb?.png).toBe(TALL_PNG)
  })

  test('gives up when every size is still over 2 MiB or sips fails', async () => {
    forgetThumbs()
    const big = fakeHost({ '/a/h.gif': { base64: 'x' } }, sipsWrites(WIDE_PNG + HUGE))
    expect(await thumbnail(big, '/a/h.gif', CACHE)).toBeUndefined()
    const broken = fakeHost({ '/a/b.webp': { base64: 'x' } }, () => ({ exitCode: 1, stderr: 'bad' }))
    expect(await thumbnail(broken, '/a/b.webp', CACHE)).toBeUndefined()
  })

  test('answers a missing file with nothing', async () => {
    forgetThumbs()
    expect(await thumbnail(fakeHost(), '/nope.png', CACHE)).toBeUndefined()
  })
})

describe('the cache', () => {
  test('keys on path and mtime: the same file converts once, a changed one again', async () => {
    forgetThumbs()
    const host = fakeHost({ '/a/p.jpg': { base64: 'x', mtimeMs: 1 } }, sipsWrites(WIDE_PNG))
    await thumbnail(host, '/a/p.jpg', CACHE)
    await thumbnail(host, '/a/p.jpg', CACHE)
    expect(sipsRuns(host.runs)).toHaveLength(1)
    host.files.set('/a/p.jpg', { base64: 'y', mtimeMs: 2 })
    await thumbnail(host, '/a/p.jpg', CACHE)
    const outs = sipsRuns(host.runs).map(r => r[8])
    expect(outs).toHaveLength(2)
    expect(outs[0]).not.toBe(outs[1])
  })

  test('reuses a converted file already on disk after a reload', async () => {
    forgetThumbs()
    const host = fakeHost({ '/a/p.jpg': { base64: 'x', mtimeMs: 1 } }, sipsWrites(WIDE_PNG))
    await thumbnail(host, '/a/p.jpg', CACHE)
    forgetThumbs()
    await thumbnail(host, '/a/p.jpg', CACHE)
    expect(sipsRuns(host.runs)).toHaveLength(1)
  })
})

describe('a full-size PNG for the clipboard', () => {
  test('passes a PNG through and converts anything else without scaling', async () => {
    const host = fakeHost({ '/a/p.jpg': { base64: 'x' } }, sipsWrites(WIDE_PNG))
    expect(await fullPng(host, '/a/s.png', CACHE)).toBe('/a/s.png')
    const out = await fullPng(host, '/a/p.jpg', CACHE)
    expect(out).toMatch(/-full\.png$/)
    expect(sipsRuns(host.runs)[0]).toEqual(sipsArgs('/a/p.jpg', out ?? ''))
    expect(sipsRuns(host.runs)[0]).not.toContain('-Z')
  })
})
