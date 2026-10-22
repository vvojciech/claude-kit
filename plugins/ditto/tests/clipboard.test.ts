import { describe, expect, test } from 'claude-code/testing'

import { clipboardCommands, missingToolHint } from '../hooks/clipboard'
import { FIRST_RUN, NOT_OUTERMOST, NO_FULLSCREEN, TOAST_LINES, TOAST_WIDTH, callsInGroup, confirmation, failure, moreCalls, toastLines, toastWidth } from '../hooks/notices'
import { target } from '../hooks/targets'
import type { Target, ToolKind } from '../hooks/targets'
import { cellWidth } from '../hooks/width'

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

  test('hint toasts and the load-order status fit one line at 110 columns, after the engine prefix', async () => {
    for (const notice of [FIRST_RUN, NO_FULLSCREEN, NOT_OUTERMOST]) expect(notice.length).toBeLessThanOrEqual(ROOM)
  })

  test('the load-order status names the setting to change before anything the line could lose', async () => {
    expect(NOT_OUTERMOST.indexOf('CLAUDE_CODE_PLUGIN_DIRS')).toBeGreaterThanOrEqual(0)
    expect(NOT_OUTERMOST.indexOf('CLAUDE_CODE_PLUGIN_DIRS') + 'CLAUDE_CODE_PLUGIN_DIRS'.length).toBeLessThanOrEqual(50)
  })

  test('the load-order status says why ditto must come first in words that read as a reason', async () => {
    expect(NOT_OUTERMOST).toContain('(a plugin listed earlier draws replies)')
  })

  test('hint toasts fit one line at 60 columns, after the engine prefix', async () => {
    const NARROW_ROOM = 60 - (110 - ROOM)
    for (const notice of [FIRST_RUN, NO_FULLSCREEN]) expect(cellWidth(notice)).toBeLessThanOrEqual(NARROW_ROOM)
  })

  test('toasts under the plugin name do not repeat it', async () => {
    for (const notice of [FIRST_RUN, NO_FULLSCREEN]) expect(notice.startsWith('ditto:')).toBe(false)
  })
})

describe('group toasts', () => {
  const call = (kind: ToolKind, name: string) => target(kind, name, 'x', kind)
  const live = [call('output', 'bash #1'), call('file', 'palette.ts'), call('output', 'bash #2'), call('file', 'out.md')]
  const fits = (text: string) => toastLines(text).length <= TOAST_LINES

  test('the toast text gets the 37 cells measured at 110 columns, and 6 cells less than a narrower pane, as 34 at 40', async () => {
    expect(TOAST_WIDTH).toBe(37)
    expect(TOAST_LINES).toBe(3)
    expect([toastWidth(undefined), toastWidth(110), toastWidth(43), toastWidth(40), toastWidth(3)]).toEqual([37, 37, 37, 34, 1])
  })

  const accounted = (text: string, calls: Target[], width: number) => {
    const shown = toastLines(text, width)
    const listed = shown.join(' ').split(': ')[1] ?? ''
    const plus = Number(/\+(\d+)$/.exec(listed)?.[1] ?? 0)
    return { lines: shown.length, counted: calls.filter(c => listed.includes(c.name)).length + plus }
  }

  test('at 37 cells, which the old 39-cell box overran, every name is listed or counted in +N within 3 lines', async () => {
    const names = ['markers.ts', 'clipboard.test.ts', 'lucid-palette.ts', 'README.md', 'register.tsx', 'commands.ts']
    const files = names.map(name => call('file', name))
    for (const kept of [3, 4, 5, 6]) {
      const fit = accounted(moreCalls(files.slice(0, kept), 37), files.slice(0, kept), 37)
      expect(fit.lines).toBeLessThanOrEqual(TOAST_LINES)
      expect(fit.counted).toBe(kept)
    }
  })

  test('at a 40-column pane every name is inside the 34-cell box or counted in +N, as README.md once vanished', async () => {
    const calls = [call('output', 'bash #1'), call('file', 'check-clipboard.sh'), call('output', 'bash #2'), call('file', 'README.md')]
    for (const widenable of [true, false]) {
      const fit = accounted(callsInGroup(calls, widenable, toastWidth(40)), calls, 34)
      expect(fit.lines).toBeLessThanOrEqual(TOAST_LINES)
      expect(fit.counted).toBe(calls.length)
    }
  })

  test('the commands always survive the box, which once cut the command off the end', async () => {
    for (const widenable of [true, false]) {
      const shown = toastLines(callsInGroup(live, widenable)).slice(0, TOAST_LINES).join(' ')
      expect(shown).toContain('/ditto <name>')
    }
  })

  test('names that overflow the box fold into +N, keeping it within 3 lines of the 37-cell box', async () => {
    const many = Array.from({ length: 30 }, (_, i) => call('output', `bash #${i + 1}`))
    const text = callsInGroup(many, false)
    expect(fits(text)).toBe(true)
    expect(text).toMatch(/bash #1, .* \+\d+$/)
    expect(toastLines(text).every(line => line.length <= TOAST_WIDTH)).toBe(true)
  })

  test('a file name wider than the box leaves only the count', async () => {
    const text = moreCalls([call('file', `${'x'.repeat(200)}.md`)])
    expect(text).toBe('Widen for chips, or /ditto <name>: +1')
  })

  test('points at the call names, which read top-down like the list, not at counts from the last call', async () => {
    expect(callsInGroup([call('file', 'a.md'), call('file', 'b.md')], false)).toBe('Copy with /ditto <name>: a.md, b.md')
    expect(callsInGroup([call('plan', 'plan'), call('output', 'bash')], false)).toBe('Copy with /ditto <name>: plan, bash')
  })
})
