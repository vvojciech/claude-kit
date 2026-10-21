import { describe, expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { NOT_OUTERMOST, NO_SELECTION, SELECTION_ELSEWHERE } from '../hooks/notices'
import { dark, light } from '../hooks/palette'

type On = Parameters<TestBody>[1]
type Transcript = { messages: SessionMessage[] }
type Host = { os?: string; pbcopyExit?: number; theme?: string; colorFgBg?: string; selection?: { text: string; requestId?: string } }

const REPLY = '# Plan\n\nRun this:\n\n```bash\ngit status\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'
const BEFORE_TOOL = 'Checking the branch first.'
const CHIPS = ['⧉ md', '⧉ bash', '⧉ table']

const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const said = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const called = (): SessionMessage => ({ role: 'assistant', text: '', toolUses: [] })
const answered = (): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't', text: 'ok', isError: false, result: undefined }] })

function ok(stdout = '') {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

function fakeHost(on: On, transcript: Transcript, host: Host = {}) {
  const copied: string[] = []
  const toasts: string[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/pbcopy') copied.push(e.init?.stdin ?? '')
    const exitCode = e.argv[0] === '/usr/bin/pbcopy' ? (host.pbcopyExit ?? 0) : 0
    return { value: { ...ok(e.argv[0] === 'uname' ? `${host.os ?? 'Darwin'}\n` : ''), exitCode, stderr: exitCode === 0 ? '' : 'pasteboard busy' } }
  })
  on('env.get', (_, e) => ({ value: e.name === 'COLORFGBG' ? host.colorFgBg : undefined }))
  on('config.list', () => ({ value: host.theme === undefined ? [] : [{ key: 'theme', value: host.theme }] }) as never)
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  on('command.register', () => ({ value: { command: 'ditto' } }))
  on('ui.selection', () => ({ value: host.selection }))
  on('session.messages', () => ({ value: transcript.messages }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', () => ({ sessionId: 's' }))
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))
  return { copied, toasts }
}

async function write($: Engine, uuid: string, text: string, agentId?: string) {
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }, door: 'response', origin: { kind: 'model', model: 'm' }, uuid, agentId })
}

async function finishTurn($: Engine, agentId?: string) {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId } as never)
}

async function run($: Engine, args: string) {
  return $.command.run({ command: 'ditto', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
}

type View = { columns?: number; isFullscreen?: boolean; requestId?: string }

async function mount($: Engine, text: string, view: View = {}) {
  const viewport = { columns: view.columns ?? 100, rows: 40, isFullscreen: view.isFullscreen ?? true }
  return $.ui.mount({ plugin: 'ditto', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport, requestId: view.requestId })
}

async function labels($: Engine, text: string, view?: View) {
  const ui = await mount($, text, view)
  return (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
}

const withTools = (): Transcript => ({ messages: [prompt('check'), said(BEFORE_TOOL), called(), answered(), said(REPLY)] })

async function liveTurn($: Engine, blocks: [string, string][]) {
  for (const [uuid, text] of blocks) await write($, uuid, text)
  await finishTurn($)
}

describe('the copy marker', () => {
  test('wraps what the renderer beneath drew with a muted marker that reveals the chips beside it on hover', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY)
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(dark.muted)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(CHIPS)
    const strip = (await ui.findAll({ type: 'Box' })).find(b => b.props.display === 'none')
    expect(strip?.props.position).toBe('absolute')
    expect(strip?.props.right).toBe(1)
    expect(strip?.props.top).toBe(0)
    expect(JSON.stringify(await ui.drawn())).toContain('"hover":{"display":"flex"}')
  })

  test('sits on the blank row above the block, at the right edge of what was drawn, not past the next row', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY)
    const boxes = await ui.findAll({ type: 'Box' })
    expect(boxes[0]?.props.alignSelf).toBe('flex-start')
    const marker = boxes.find(b => b.props.position === 'absolute' && b.props.width === 1)
    expect(marker?.props.top).toBe(0)
    expect(marker?.props.right).toBe(0)
    expect(boxes.every(b => b.props.bottom === undefined || (b.props.bottom as number) >= 0)).toBe(true)
  })

  test('colours the marker muted and the chips as body text, turning orange and underlined under the pointer', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'light' })
    const ui = await mount($, REPLY)
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(light.muted)
    const chips = (await ui.findAll({ type: 'Text' })).filter(t => CHIPS.includes(t.text))
    expect(chips.map(t => t.props.color)).toEqual(CHIPS.map(() => light.text))
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.split(JSON.stringify({ color: light.accent, underline: true })).length - 1).toBe(CHIPS.length)
    expect((await ui.findAll({ type: 'Button' })).every(b => b.props.dimColor !== true)).toBe(true)
  })

  test('takes the light tone under auto on a light terminal', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'auto', colorFgBg: '0;15' })
    const ui = await mount($, REPLY)
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(light.muted)
  })

  test('takes the Pitwall dark tone under dark-ansi', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'dark-ansi' })
    const ui = await mount($, REPLY)
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(dark.muted)
  })

  test('draws nothing where clicks cannot land: outside fullscreen', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    expect(await labels($, REPLY, { isFullscreen: false })).toEqual([])
    const ui = await mount($, REPLY, { isFullscreen: false })
    expect((await ui.drawn()).type).toBe('Text')
  })

  test('shows +N for the chips a narrow terminal cannot hold, md first, and +N names them', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY, { columns: 21 })
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['⧉ md', '⧉ bash', '+1'])
    await ui.press({ key: 'copy-more' })
    expect(toasts).toEqual(['Also in this reply: table. Copy one with /ditto <name>'])
  })

  test('keeps only +N when not even md fits', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    expect(await labels($, REPLY, { columns: 6 })).toEqual(['+3'])
  })

  test('offers md on a one-line reply, the kind most often copied whole', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('branch?'), said('feature/r4-copy')] })
    const ui = await mount($, 'feature/r4-copy')
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['⧉ md'])
    await ui.press({ key: 'copy-md' })
    expect(copied).toEqual(['feature/r4-copy'])
  })

  test('returns what lucid drew when its own work after next fails', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, undefined as never)
    expect((await ui.drawn()).type).toBe('Text')
  })
})

describe('which reply a marker copies', () => {
  test('finds the reply by the id of the block drawn, under its last block only', async ($, on) => {
    fakeHost(on, withTools())
    await liveTurn($, [
      ['u-before', BEFORE_TOOL],
      ['u-tool', ''],
      ['u-reply', REPLY],
    ])
    expect(await labels($, BEFORE_TOOL, { requestId: 'u-before' })).toEqual([])
    expect(await labels($, REPLY, { requestId: 'u-reply' })).toEqual(CHIPS)
  })

  test('copies the whole reply, text before the tool call included, and the bare code', async ($, on) => {
    const { copied, toasts } = fakeHost(on, withTools())
    await liveTurn($, [
      ['u-before', BEFORE_TOOL],
      ['u-reply', REPLY],
    ])
    const ui = await mount($, REPLY, { requestId: 'u-reply' })
    await ui.press({ key: 'copy-md' })
    await ui.press({ key: 'copy-bash' })
    expect(copied).toEqual([`${BEFORE_TOOL}\n\n${REPLY}`, 'git status'])
    expect(toasts).toEqual(['Copied reply as markdown (13 lines)', 'Copied bash block (1 line)'])
  })

  test('copies its own reply when a later reply ends with the same block', async ($, on) => {
    const tail = '```txt\nSAMETAIL\n```'
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('Intro alpha.'), said(tail), prompt('b'), said(tail)] })
    await liveTurn($, [
      ['a-intro', 'Intro alpha.'],
      ['a-tail', tail],
    ])
    await liveTurn($, [['b-tail', tail]])
    const first = await mount($, tail, { requestId: 'a-tail' })
    await first.press({ key: 'copy-md' })
    const second = await mount($, tail, { requestId: 'b-tail' })
    await second.press({ key: 'copy-md' })
    expect(copied).toEqual([`Intro alpha.\n\n${tail}`, tail])
  })

  test('draws no marker on a block of a reply still being written', async ($, on) => {
    fakeHost(on, { messages: [prompt('a'), said(REPLY), prompt('b'), said(REPLY)] })
    await write($, 'streaming', REPLY)
    expect(await labels($, REPLY, { requestId: 'streaming' })).toEqual([])
  })

  test('ignores what a subagent writes', async ($, on) => {
    fakeHost(on, { messages: [] })
    await write($, 'agent-row', REPLY, 'agent-1')
    await finishTurn($, 'agent-1')
    await finishTurn($)
    expect(await labels($, REPLY, { requestId: 'agent-row' })).toEqual([])
  })

  test('shows the marker on a resumed transcript when its last block is unique', async ($, on) => {
    fakeHost(on, { messages: [said('compacted summary'), prompt('plan'), said(REPLY)] })
    expect(await labels($, REPLY)).toEqual(CHIPS)
  })

  test('on a resumed reply whose last block another reply shares, offers the shared blocks and says how to copy each whole', async ($, on) => {
    const { copied, toasts } = fakeHost(on, { messages: [prompt('a'), said('Looking.'), said(REPLY), prompt('b'), said(REPLY), prompt('c'), said('other')] })
    const ui = await mount($, REPLY)
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['⧉ bash', '⧉ table', 'md: /ditto 2 or 3'])
    await ui.press({ key: 'copy-bash' })
    await ui.press({ key: 'copy-note' })
    expect(copied).toEqual(['git status'])
    expect(toasts.at(-1)).toBe('2 replies end with this block, so ⧉ md cannot tell which; /ditto 2 or /ditto 3 copies each whole')
  })

  test('draws no marker during a live turn on a row not yet settled, even when an earlier reply ends the same way', async ($, on) => {
    fakeHost(on, { messages: [prompt('a'), said('All tests pass.')] })
    await write($, 'other-block', 'Writing now.')
    expect(await labels($, 'All tests pass.', { requestId: 'streaming' })).toEqual([])
    await finishTurn($)
  })

  test('marks the row of an interrupted reply partial', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [prompt('a'), said('Half a reply')] })
    await write($, 'cut', 'Half a reply')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't', reason: 'aborted' } as never)
    const ui = await mount($, 'Half a reply', { requestId: 'cut' })
    expect(await ui.find({ type: 'Text', text: 'partial' })).toBeDefined()
    await ui.press({ key: 'copy-md' })
    expect(toasts).toEqual(['Copied partial reply as markdown (1 line)'])
  })

  test('lexes each block of the reply as it was drawn, not the reply joined', async ($, on) => {
    fakeHost(on, { messages: [] })
    await liveTurn($, [
      ['u-list', '- install the gem'],
      ['u-code', '    bundle add foo'],
    ])
    expect(await labels($, '    bundle add foo', { requestId: 'u-code' })).toEqual(['⧉ md', '⧉ code'])
  })

  test('reads the transcript again after the session ends, as on /clear or /resume', async ($, on) => {
    const transcript: Transcript = { messages: [prompt('plan'), said(REPLY)] }
    fakeHost(on, transcript)
    expect(await labels($, REPLY)).toHaveLength(3)
    transcript.messages = []
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as never)
    expect(await labels($, REPLY)).toEqual([])
  })

  test('picks up a reply that ended after the first draw', async ($, on) => {
    const transcript: Transcript = { messages: [] }
    fakeHost(on, transcript)
    const ui = await mount($, REPLY, { requestId: 'late' })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    transcript.messages = [prompt('plan'), said(REPLY)]
    await liveTurn($, [['late', REPLY]])
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(CHIPS)
  })
})

describe('failures', () => {
  test('toasts what failed on macOS, with no Linux install hint', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { pbcopyExit: 1 })
    const ui = await mount($, REPLY)
    await ui.press({ key: 'copy-md' })
    expect(toasts).toEqual(['Copy failed: /usr/bin/pbcopy exited 1: pasteboard busy, and the terminal did not take it either'])
  })

  test('/ditto falls back to the terminal copy and names the missing Linux tool', async ($, on) => {
    fakeHost(on, { messages: [prompt('a'), said('a\nb\nc')] }, { os: 'Linux' })
    expect((await run($, '')).text).toBe('Copy failed: no clipboard tool found: install wl-clipboard (Wayland) or xclip (X11), and the terminal did not take it either')
  })

  test('/ditto names the real error rather than blaming the transcript', async ($, on) => {
    on('command.register', () => ({ value: { command: 'ditto' } }))
    on('ui.log', () => ({ value: undefined }))
    on('session.messages', () => ({ value: [prompt('a'), said('a\nb\nc')] }))
    on('process.run', () => ({ value: ok('Darwin\n') }))
    on('env.get', () => {
      throw new Error('env unreadable')
    })
    const text = (await run($, '')).text
    expect(text).toMatch(/^Copy failed: .*env\.get/)
    expect(text).not.toContain('transcript')
  })

  test('/ditto says the transcript could not be read when that is what failed', async ($, on) => {
    on('command.register', () => ({ value: { command: 'ditto' } }))
    on('ui.log', () => ({ value: undefined }))
    on('session.messages', () => {
      throw new Error('transcript gone')
    })
    expect((await run($, '')).text).toMatch(/^Copy failed: .*session\.messages/)
  })
})

describe('load order', () => {
  test('warns once when no reply reaches ditto because a renderer before it does not pass replies on', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [prompt('a'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await liveTurn($, [['one', REPLY]])
    await liveTurn($, [['two', REPLY]])
    await liveTurn($, [['three', REPLY]])
    expect(toasts).toEqual([NOT_OUTERMOST])
  })

  test('stays quiet when replies reach it', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [prompt('a'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await liveTurn($, [['one', REPLY]])
    await mount($, REPLY, { requestId: 'one' })
    await liveTurn($, [['two', REPLY]])
    expect(toasts).toEqual([])
  })
})

describe('/ditto', () => {
  test('copies the last reply whole, a block by its chip name and an earlier reply', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('older reply'), ...withTools().messages] })
    expect((await run($, '')).text).toBe('Copied last reply (13 lines)')
    expect((await run($, 'bash')).text).toBe('Copied bash block (1 line)')
    expect((await run($, '2')).text).toBe('Copied reply 2 back (1 line)')
    expect(copied).toEqual([`${BEFORE_TOOL}\n\n${REPLY}`, 'git status', 'older reply'])
  })

  test('reads a resumed transcript with no turn in this process', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('from before the resume\nline two\nline three')] })
    expect((await run($, '')).text).toBe('Copied last reply (3 lines)')
    expect(copied).toEqual(['from before the resume\nline two\nline three'])
  })

  test('selection copies the markdown behind what was selected in a reply row', async ($, on) => {
    const { copied } = fakeHost(on, withTools(), { selection: { text: 'Run this:\ngit status', requestId: 'u-reply' } })
    await mount($, REPLY, { requestId: 'u-reply' })
    expect((await run($, 'selection')).text).toBe('Copied selection as markdown (4 lines)')
    expect(copied).toEqual(['Run this:\n\n```bash\ngit status'])
  })

  test('selection across rows of one reply searches the reply whole', async ($, on) => {
    const { copied } = fakeHost(on, withTools(), { selection: { text: `${BEFORE_TOOL}\nBash(git status)\n# Plan` } })
    await liveTurn($, [
      ['u-before', BEFORE_TOOL],
      ['u-reply', REPLY],
    ])
    expect((await run($, 'selection')).text).toBe('Copied selection as markdown (3 lines)')
    expect(copied).toEqual([`${BEFORE_TOOL}\n\n# Plan`])
  })

  test('selection says what to do when nothing is selected, or it lies outside a reply', async ($, on) => {
    const host: Host = {}
    const { copied } = fakeHost(on, withTools(), host)
    expect((await run($, 'selection')).text).toBe(NO_SELECTION)
    host.selection = { text: 'ls -la', requestId: 'toolu_1' }
    expect((await run($, 'selection')).text).toBe(SELECTION_ELSEWHERE)
    expect(copied).toEqual([])
  })

  test('says so when there is nothing to copy', async ($, on) => {
    fakeHost(on, { messages: [] })
    expect((await run($, '')).text).toBe('No reply to copy yet')
  })
})
