import { describe, expect, test } from 'claude-code/testing'

import { clipboardCommands, missingToolHint } from '../hooks/clipboard'
import { FIRST_RUN, NOT_OUTERMOST, NO_FULLSCREEN, confirmation, failure } from '../hooks/notices'

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

describe('standing notices', () => {
  const ROOM = 90

  test('the first-run and no-fullscreen toasts and the load-order status fit in one line of a 110-column terminal, room left for the name the engine puts before them', async () => {
    for (const notice of [FIRST_RUN, NO_FULLSCREEN, NOT_OUTERMOST]) expect(notice.length).toBeLessThanOrEqual(ROOM)
  })

  test('the load-order status names the setting to change before anything the line could lose', async () => {
    expect(NOT_OUTERMOST.indexOf('CLAUDE_CODE_PLUGIN_DIRS')).toBeGreaterThanOrEqual(0)
    expect(NOT_OUTERMOST.indexOf('CLAUDE_CODE_PLUGIN_DIRS') + 'CLAUDE_CODE_PLUGIN_DIRS'.length).toBeLessThanOrEqual(50)
  })

  test('the load-order status says why ditto must come first in words that read as a reason', async () => {
    expect(NOT_OUTERMOST).toContain('(a plugin listed earlier draws replies)')
  })

  test('toasts under the plugin name do not repeat it', async () => {
    for (const notice of [FIRST_RUN, NO_FULLSCREEN]) expect(notice.startsWith('ditto:')).toBe(false)
  })
})
