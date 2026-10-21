import { describe, expect, test } from 'claude-code/testing'

import { clipboardCommands, missingToolHint } from '../hooks/clipboard'
import { confirmation, failure } from '../hooks/notices'

describe('clipboardCommands', () => {
  test('uses pbcopy over stdin with a UTF-8 locale on macOS', async () => {
    expect(clipboardCommands({ os: 'Darwin', wayland: false, x11: false, remote: false })).toEqual([{ argv: ['/usr/bin/pbcopy'], env: { LANG: 'en_US.UTF-8', LC_CTYPE: 'UTF-8' } }])
  })

  test('prefers wl-copy, then xclip, then xsel, on Linux', async () => {
    expect(clipboardCommands({ os: 'Linux', wayland: true, x11: true, remote: false }).map(c => c.argv[0])).toEqual(['wl-copy', 'xclip', 'xsel'])
    expect(clipboardCommands({ os: 'Linux', wayland: false, x11: true, remote: false })[0]?.argv).toEqual(['xclip', '-selection', 'clipboard', '-in'])
  })

  test('runs no clipboard tool over SSH, where it would fill the remote machine clipboard', async () => {
    expect(clipboardCommands({ os: 'Darwin', wayland: false, x11: false, remote: true })).toEqual([])
    expect(clipboardCommands({ os: 'Linux', wayland: true, x11: true, remote: true })).toEqual([])
    expect(missingToolHint({ os: 'Darwin', wayland: false, x11: false, remote: true })).toContain('OSC 52')
  })

  test('has nothing to run on a headless Linux or another OS', async () => {
    expect(clipboardCommands({ os: 'Linux', wayland: false, x11: false, remote: false })).toEqual([])
    expect(clipboardCommands({ os: 'FreeBSD', wayland: false, x11: false, remote: false })).toEqual([])
  })
})

describe('missingToolHint', () => {
  test('suggests the Linux tools on Linux alone', async () => {
    expect(missingToolHint({ os: 'Linux', wayland: false, x11: false, remote: false })).toContain('xclip')
    expect(missingToolHint({ os: 'FreeBSD', wayland: false, x11: false, remote: false })).toBe('no clipboard command known for FreeBSD')
    expect(missingToolHint({ os: '', wayland: false, x11: false, remote: false })).toBe('no clipboard command known for this system')
  })
})

describe('confirmation', () => {
  test('says what was copied and how long it is', async () => {
    expect(confirmation({ ok: true, via: 'pbcopy' }, 'code block', 'a\nb')).toBe('Copied code block (2 lines, pbcopy)')
    expect(confirmation({ ok: true, via: 'xclip' }, 'table', 'a')).toBe('Copied table (1 line, xclip)')
    expect(confirmation({ ok: true, via: 'pbcopy' }, 'table', '')).toBe('Copied table (0 lines, pbcopy)')
    expect(confirmation({ ok: false, error: 'pbcopy exited 1' }, 'table', 'a')).toBe('Copy failed: pbcopy exited 1')
  })

  test('names the terminal route and says to paste to check, as OSC 52 never reports back', async () => {
    expect(confirmation({ ok: true, via: 'OSC 52' }, 'table', 'a')).toBe('Copied table (1 line, OSC 52, paste to check)')
    expect(confirmation({ ok: true, via: 'OSC 52' }, 'file', 'x'.repeat(100_001))).toContain('terminals often cut copies this large')
    expect(confirmation({ ok: true, via: 'pbcopy' }, 'file', 'x'.repeat(100_001))).toBe('Copied file (1 line, pbcopy)')
  })

  test('failure carries the error message', async () => {
    expect(failure(new Error('gone'))).toBe('Copy failed: gone')
    expect(failure('plain')).toBe('Copy failed: plain')
  })
})
