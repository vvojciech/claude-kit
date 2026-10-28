import { describe, expect, test } from 'claude-code/testing'

import { openFor, pictureFor } from '../hooks/api'
import { resetCapability } from '../hooks/capability'
import { forgetThumbs, hashOf } from '../hooks/convert'
import type { Places } from '../hooks/places'
import { imageKey } from '../hooks/view'
import { WIDE_PNG, fakeHost } from './support'

const WHERE: Places = { home: '/h', cwd: '/w', imagesDir: '/tmp/i', cacheDir: '/tmp/peek' }

function fresh(): void {
  forgetThumbs()
  resetCapability()
}

describe('peek.picture', () => {
  test('answers a local image as png bytes, cells, name, size and the key to draw it under', async () => {
    fresh()
    const host = fakeHost({ '/w/out/c.png': { base64: WIDE_PNG } })
    expect(await pictureFor(host, { path: 'out/c.png', columns: 100, isFullscreen: true }, WHERE)).toEqual({
      source: { png: WIDE_PNG },
      columns: 8,
      rows: 2,
      alt: '▣ c.png',
      path: '/w/out/c.png',
      name: 'c.png',
      caption: '40×20',
      open: '⤢ open',
      key: imageKey(`reply-${hashOf('/w/out/c.png')}`),
    })
  })

  test('resolves against the cwd it is given, ~/ and a file:// link', async () => {
    fresh()
    const host = fakeHost({ '/elsewhere/c.png': { base64: WIDE_PNG }, '/abs/d.png': { base64: WIDE_PNG }, '/h/e.png': { base64: WIDE_PNG } })
    const paths = await Promise.all(['c.png', 'file:///abs/d.png', '~/e.png'].map(path => pictureFor(host, { path, cwd: '/elsewhere', isFullscreen: true }, WHERE)))
    expect(paths.map(p => ('path' in p ? p.path : p.fallback))).toEqual(['/elsewhere/c.png', '/abs/d.png', '/h/e.png'])
  })

  test('answers pictures-off when not fullscreen or once the capability check said no', async () => {
    fresh()
    const host = fakeHost({ '/w/a.png': { base64: WIDE_PNG } })
    expect(await pictureFor(host, { path: '/w/a.png', isFullscreen: false }, WHERE)).toEqual({ fallback: 'pictures-off' })
    resetCapability('line')
    expect(await pictureFor(host, { path: '/w/a.png', isFullscreen: true }, WHERE)).toEqual({ fallback: 'pictures-off' })
  })

  test('answers unresolved for a missing file or one that is not an image', async () => {
    fresh()
    const host = fakeHost({ '/w/a.md': { base64: WIDE_PNG } })
    expect(await pictureFor(host, { path: '/w/gone.png', isFullscreen: true }, WHERE)).toEqual({ fallback: 'unresolved' })
    expect(await pictureFor(host, { path: '/w/a.md', isFullscreen: true }, WHERE)).toEqual({ fallback: 'unresolved' })
  })

  test('answers unresolved for a file URL on another host rather than read it under the cwd', async () => {
    fresh()
    const host = fakeHost({ '/w/server/a.png': { base64: WIDE_PNG } })
    expect(await pictureFor(host, { path: 'file://server/a.png', isFullscreen: true }, WHERE)).toEqual({ fallback: 'unresolved' })
    expect(await openFor(host, { path: 'file://server/a.png' }, WHERE)).toEqual({ error: 'Not a local file: file://server/a.png' })
    expect(host.runs).toEqual([])
  })
})

describe('peek.open', () => {
  test('opens the resolved path in Preview', async () => {
    fresh()
    const host = fakeHost()
    expect(await openFor(host, { path: 'a.png' }, WHERE)).toEqual({})
    expect(host.runs).toEqual([['/usr/bin/open', '-a', 'Preview', '/w/a.png']])
  })

  test('answers the reason when Preview and open both fail', async () => {
    fresh()
    const host = fakeHost({}, () => ({ exitCode: 1, stderr: 'nope' }))
    expect(await openFor(host, { path: '/w/a.png' }, WHERE)).toEqual({ error: 'Could not open a.png: nope' })
  })
})
