import { describe, expect, test } from 'claude-code/testing'

import { clipboardCommands, missingToolHint } from '../hooks/clipboard'
import { confirmation, failure } from '../hooks/notices'

describe('clipboardCommands', () => {
  test('uses pbcopy over stdin with a UTF-8 locale on macOS', async () => {
    expect(clipboardCommands({ os: 'Darwin', wayland: false, x11: false })).toEqual([{ argv: ['/usr/bin/pbcopy'], env: { LANG: 'en_US.UTF-8', LC_CTYPE: 'UTF-8' } }])
  })

  test('prefers wl-copy, then xclip, on Linux', async () => {
    expect(clipboardCommands({ os: 'Linux', wayland: true, x11: true }).map(c => c.argv[0])).toEqual(['wl-copy', 'xclip'])
    expect(clipboardCommands({ os: 'Linux', wayland: false, x11: true })[0]?.argv).toEqual(['xclip', '-selection', 'clipboard', '-in'])
  })

  test('has nothing to run on a headless Linux or another OS', async () => {
    expect(clipboardCommands({ os: 'Linux', wayland: false, x11: false })).toEqual([])
    expect(clipboardCommands({ os: 'FreeBSD', wayland: false, x11: false })).toEqual([])
  })
})

describe('missingToolHint', () => {
  test('suggests the Linux tools on Linux alone', async () => {
    expect(missingToolHint({ os: 'Linux', wayland: false, x11: false })).toContain('xclip')
    expect(missingToolHint({ os: 'FreeBSD', wayland: false, x11: false })).toBe('no clipboard command known for FreeBSD')
    expect(missingToolHint({ os: '', wayland: false, x11: false })).toBe('no clipboard command known for this system')
  })
})

describe('confirmation', () => {
  test('says what was copied and how long it is', async () => {
    expect(confirmation({ ok: true, via: 'x' }, 'code block', 'a\nb')).toBe('Copied code block (2 lines)')
    expect(confirmation({ ok: true, via: 'x' }, 'table', 'a')).toBe('Copied table (1 line)')
    expect(confirmation({ ok: true, via: 'x' }, 'table', '')).toBe('Copied table (0 lines)')
    expect(confirmation({ ok: false, error: 'pbcopy exited 1' }, 'table', 'a')).toBe('Copy failed: pbcopy exited 1')
  })

  test('failure carries the error message', async () => {
    expect(failure(new Error('gone'))).toBe('Copy failed: gone')
    expect(failure('plain')).toBe('Copy failed: plain')
  })
})
