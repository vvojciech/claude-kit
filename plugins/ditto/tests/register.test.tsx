import { describe, expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { FIRST_RUN, NOT_OUTERMOST, NO_FULLSCREEN, NO_SELECTION, SELECTION_ELSEWHERE, selectionRepeats } from '../hooks/notices'
import { hinted } from '../hooks/session'
import { USAGE, noGroupCall } from '../hooks/commands'
import { dark, light } from '../hooks/palette'
import { COMPACT_KEY, COPIED, COVER_KEY, MARKER_ROOM, NOT_COPIED, STRIP_LEAD, headWidth, headerRow } from '../hooks/row'
import { rowWidth } from '../hooks/targets'

type On = Parameters<TestBody>[1]
type Transcript = { messages: SessionMessage[] }
type Host = {
  os?: string
  pbcopyExit?: number
  theme?: string
  colorFgBg?: string
  ssh?: boolean
  terminalCopies?: boolean
  selection?: { text: string; requestId?: string }
  agents?: Record<string, SessionMessage[]>
  label?: string
  detail?: string
  engine?: boolean
}

const HINTS = [FIRST_RUN, NO_FULLSCREEN]

function withLucidTone(on: On, tone: unknown) {
  on('engine.create', async (_, e, next) => ({ ...(await next(e)), lucid: { tone: () => tone, blocks: () => undefined } }) as never)
}

type DrawnNode = { type?: string; hover?: unknown; children?: unknown[] }

function hoversOn(tree: unknown, text: string): unknown[] {
  if (Array.isArray(tree)) return tree.flatMap(node => hoversOn(node, text))
  if (typeof tree !== 'object' || tree === null) return []
  const node = tree as DrawnNode
  const own = node.type === 'Text' && node.children?.join('') === text ? [node.hover] : []
  return [...own, ...hoversOn(node.children ?? [], text)]
}

function underTheEngineInverse(hover: unknown): { ink: unknown; ground: unknown } {
  const { color, backgroundColor } = (hover ?? {}) as { color?: string; backgroundColor?: string }
  return { ink: backgroundColor, ground: color }
}

const pause = (ms: number) => new Promise(done => setTimeout(done, ms))

const REPLY = '# Plan\n\nRun this:\n\n```bash\ngit status\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |'
const BEFORE_TOOL = 'Checking the branch first.'
const CHIPS = ['⧉ reply', '⧉ bash', '⧉ table']

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
  const hints: string[] = []
  const statuses: (string | undefined)[] = []
  const terminal: string[] = []
  const surfaces: (string | undefined)[] = []
  hinted.clear()
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/pbcopy') copied.push(e.init?.stdin ?? '')
    const exitCode = e.argv[0] === '/usr/bin/pbcopy' ? (host.pbcopyExit ?? 0) : 0
    return { value: { ...ok(e.argv[0] === 'uname' ? `${host.os ?? 'Darwin'}\n` : ''), exitCode, stderr: exitCode === 0 ? '' : 'pasteboard busy' } }
  })
  on('env.get', (_, e) => ({ value: e.name === 'COLORFGBG' ? host.colorFgBg : e.name === 'SSH_CONNECTION' && host.ssh ? '10.0.0.1 22 10.0.0.2 22' : undefined }))
  on('config.list', () => ({ value: host.theme === undefined ? [] : [{ key: 'theme', value: host.theme }] }) as never)
  on('ui.toast', (_, e) => {
    ;(HINTS.includes(e.text) ? hints : toasts).push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', (_, e) => {
    surfaces.push(e.surface)
    if (!host.terminalCopies) return { value: { isCopied: false, reason: 'no-clipboard' } }
    terminal.push(e.text)
    return { value: { isCopied: true } }
  })
  on('command.register', () => ({ value: { command: 'ditto' } }))
  on('ui.selection', () => ({ value: host.selection }))
  on('session.messages', (_, e) => ({ value: e.agentId === undefined ? transcript.messages : (host.agents?.[e.agentId] ?? { deny: `no agent ${e.agentId}` }) }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', () => ({ turnId: 't' }) as never)
  on('session.end', () => ({ sessionId: 's' }))
  on('session.start', () => ({ cwd: '/w' }))
  on('ui.render', ($, e) => drawnRow($.ui.resolve(e), host))
  return { copied, toasts, hints, statuses, terminal, surfaces }
}

type RowKit = { Box: (props: object) => unknown; Text: (props: object) => unknown }

function drawnRow(kit: RowKit, host: Host) {
  if (host.engine) return { type: 'engine', ref: 1 } as never
  return host.label === undefined ? kit.Text({ children: ['beneath'] }) : labelledRow(kit, host.label, host.detail)
}

function labelledRow({ Box, Text }: RowKit, label: string, detail = '') {
  const gutter = Box({ width: 2, flexShrink: 0, children: [Text({ children: ['●'] })] })
  const head = Text({ wrap: 'truncate-end', children: [Text({ bold: true, children: [label] }), detail === '' ? '' : ' ', detail] })
  return Box({ flexDirection: 'column', marginTop: 1, children: [Box({ flexDirection: 'row', children: [gutter, head] }), Text({ children: ['  ⎿  more'] })] }) as never
}

async function write($: Engine, uuid: string, text: string, agentId?: string) {
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }, door: 'response', origin: { kind: 'model', model: 'm' }, uuid, agentId })
}

async function finishTurn($: Engine, agentId?: string) {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId } as never)
}

async function run($: Engine, args: string, origin: { kind: 'composer' } | { kind: 'bridge' } = { kind: 'composer' }) {
  return $.command.run({ command: 'ditto', args, origin, presentation: { isFullscreen: true, columns: 100 } })
}

type View = { columns?: number; isFullscreen?: boolean; requestId?: string }

async function mount($: Engine, text: string, view: View = {}) {
  const viewport = { columns: view.columns ?? 100, rows: 40, isFullscreen: view.isFullscreen ?? true }
  return $.ui.mount({ plugin: 'ditto', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport, requestId: view.requestId })
}

type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>

async function chipsOf(ui: Mounted) {
  return (await ui.findAll({ type: 'Button' })).filter(b => b.props.key !== COVER_KEY)
}

async function labels($: Engine, text: string, view?: View) {
  const ui = await mount($, text, view)
  return (await chipsOf(ui)).map(b => b.props.label)
}

const withTools = (): Transcript => ({ messages: [prompt('check'), said(BEFORE_TOOL), called(), answered(), said(REPLY)] })

async function liveTurn($: Engine, blocks: [string, string][]) {
  for (const [uuid, text] of blocks) await write($, uuid, text)
  await finishTurn($)
}

describe('the copy marker', () => {
  test('wraps the drawn reply with a muted ⧉ that the chips cover on hover', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY)
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(dark.muted)
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(CHIPS)
    const strip = (await ui.findAll({ type: 'Box' })).find(b => b.props.display === 'none')
    expect(strip?.props.position).toBe('absolute')
    expect(strip?.props.right).toBe(0)
    expect(strip?.props.top).toBe(0)
    expect((await ui.findAll({ type: 'Text' })).filter(t => t.text.startsWith('⧉ ') && t.text.length === 2)).toHaveLength(1)
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.key === COVER_KEY).map(b => b.props.label)).toEqual(['⧉'])
    expect(JSON.stringify(await ui.drawn())).toContain('"hover":{"display":"flex"}')
  })

  test('sits on its own row under the end of the reply, so a reply taller than the pane shows it where reading stops', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY, { columns: 200 })
    const end = (await ui.findAll({ type: 'Box' })).find(b => b.props.key === 'ditto-undefined' || String(b.props.key ?? '').startsWith('ditto-'))
    expect(end?.props.height).toBe(1)
    expect(end?.props.position).toBeUndefined()
    expect(end?.props.top).toBeUndefined()
  })

  test('aligns the marker to the right edge of the row it gets, with no guess at how far the renderer beneath indents', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY, { columns: 80 })
    const boxes = await ui.findAll({ type: 'Box' })
    expect(boxes.some(b => b.props.justifyContent === 'flex-end' && b.props.height === 1)).toBe(true)
    expect(boxes.every(b => b.props.left === undefined)).toBe(true)
  })

  test('colours ⧉ muted, chips as text, and a pointed chip bold underlined orange, its hover colours swapped for the engine inverse', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'light' })
    const ui = await mount($, REPLY)
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(light.muted)
    const chips = (await ui.findAll({ type: 'Text' })).filter(t => CHIPS.includes(t.text))
    expect(chips.map(t => t.props.color)).toEqual(CHIPS.map(() => light.text))
    const drawn = await ui.drawn()
    expect(CHIPS.map(chip => hoversOn(drawn, chip))).toEqual(CHIPS.map(() => [{ color: light.background, backgroundColor: light.pointed, bold: true, underline: true }]))
    expect(CHIPS.map(chip => underTheEngineInverse(hoversOn(drawn, chip)[0]))).toEqual(CHIPS.map(() => ({ ink: light.pointed, ground: light.background })))
    expect((await ui.findAll({ type: 'Button' })).every(b => b.props.dimColor !== true)).toBe(true)
  })

  test('on dark the pointed chip shows Pitwall orange on the ground, not an orange slab', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'dark-ansi' })
    const ui = await mount($, REPLY)
    expect(hoversOn(await ui.drawn(), '⧉ reply').map(underTheEngineInverse)).toEqual([{ ink: dark.accent, ground: dark.background }])
  })

  test('takes the tone lucid last drew with when lucid is loaded, over its own reading of the theme', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'dark' })
    withLucidTone(on, { ground: 'light', daltonized: false, palette: { text: '#101010', strong: '#000000', muted: '#505050', accent: '#a04020' } })
    const ui = await mount($, REPLY)
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe('#505050')
    const chip = (await ui.findAll({ type: 'Text' })).find(t => t.text === '⧉ reply')
    expect(chip?.props.color).toBe('#101010')
    expect(hoversOn(await ui.drawn(), '⧉ reply').map(underTheEngineInverse)).toEqual([{ ink: '#a04020', ground: light.background }])
  })

  test('falls back to its own tone when lucid has not drawn yet or answers with something else', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { theme: 'light' })
    withLucidTone(on, { ground: 'light', palette: { muted: 'grey' } })
    const ui = await mount($, REPLY)
    expect((await ui.find({ type: 'Text', text: '⧉' }))?.props.color).toBe(light.muted)
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

  test('says once, outside fullscreen, why there is no marker', async ($, on) => {
    const { hints } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await mount($, REPLY, { isFullscreen: false })
    await mount($, REPLY, { isFullscreen: false })
    expect(hints).toEqual([NO_FULLSCREEN])
  })

  test('gives a one-time hint the first time a marker is drawn', async ($, on) => {
    const { hints } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await mount($, REPLY)
    await mount($, REPLY)
    await $.session.start({ source: 'clear', isInteractive: true, cwd: '/w' } as never)
    await mount($, REPLY)
    expect(hints).toEqual([FIRST_RUN])
  })

  test('at 40 columns confirms a pbcopy copy on the pressed chip, never on the status line', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY, { columns: 40, requestId: 'narrow' })
    await ui.press({ key: 'copy-bash' })
    expect(toasts).toEqual([])
    expect(statuses).toEqual([])
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ reply', 'copied (pbcopy)', '⧉ table'])
    expect(await ui.find({ type: 'Text', text: 'copied (pbcopy)' })).toBeDefined()
  })

  test('shows +N for the chips a narrow terminal cannot hold, and +N names them in a toast', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    const ui = await mount($, REPLY, { columns: 25 })
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ reply', '⧉ bash', '+1'])
    await ui.press({ key: 'copy-more' })
    expect(toasts).toEqual(['Also in this reply: table. Copy one with /ditto <name>'])
    expect(statuses).toEqual([])
  })

  test('keeps only +N when not even md fits', async ($, on) => {
    fakeHost(on, { messages: [prompt('plan'), said(REPLY)] })
    expect(await labels($, REPLY, { columns: 6 })).toEqual(['+3'])
  })

  test('offers md on a one-line reply, the kind most often copied whole', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('branch?'), said('feature/r4-copy')] })
    const ui = await mount($, 'feature/r4-copy')
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ reply'])
    await ui.press({ key: 'copy-reply' })
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
    await ui.press({ key: 'copy-reply' })
    await ui.press({ key: 'copy-bash' })
    expect(copied).toEqual([`${BEFORE_TOOL}\n\n${REPLY}`, 'git status'])
    expect(toasts).toEqual([])
    expect((await chipsOf(ui)).map(b => b.props.label)).toContain('copied (pbcopy)')
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
    await first.press({ key: 'copy-reply' })
    const second = await mount($, tail, { requestId: 'b-tail' })
    await second.press({ key: 'copy-reply' })
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
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ bash', '⧉ table', 'reply: /ditto 2 or 3'])
    await ui.press({ key: 'copy-bash' })
    await ui.press({ key: 'copy-note' })
    expect(copied).toEqual(['git status'])
    expect(toasts.at(-1)).toBe('2 replies end with this block, so ⧉ reply cannot tell which; /ditto 2 or /ditto 3 copies each whole')
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
    await ui.press({ key: 'copy-reply' })
    expect(toasts).toEqual([])
    expect((await chipsOf(ui)).map(b => b.props.label)).toContain('copied (pbcopy)')
  })

  test('owns an interrupted reply the engine never stored, from what was drawn, never the earlier reply', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('Use **bold** here.'), prompt('count')] })
    await $.turn.start({ text: 'count', turnId: 't' } as never)
    const ui = await mount($, 'one\ntwo\nthree', { requestId: 'cut' })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't', reason: 'aborted' } as never)
    expect(await ui.find({ type: 'Text', text: 'partial' })).toBeDefined()
    await ui.press({ key: 'copy-reply' })
    expect(copied).toEqual(['one\ntwo\nthree'])
  })

  test('a reply row drawn before the turn and drawn again during it keeps its marker and stays out of an aborted reply', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('Old answer.'), prompt('count')] })
    await (await mount($, 'Old answer.', { requestId: 'old' })).unmount()
    await $.turn.start({ text: 'count', turnId: 't' } as never)
    const redrawn = await mount($, 'Old answer.', { requestId: 'old' })
    const cut = await mount($, 'one\ntwo', { requestId: 'cut' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't', reason: 'aborted' } as never)
    expect((await redrawn.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
    await cut.press({ key: 'copy-reply' })
    await redrawn.press({ key: 'copy-reply' })
    expect(copied).toEqual(['one\ntwo', 'Old answer.'])
  })

  test('never matches a row drawn during a turn against the transcript by its tail', async ($, on) => {
    fakeHost(on, { messages: [prompt('a'), said('All tests pass.')] })
    await $.turn.start({ text: 'again', turnId: 't' } as never)
    const ui = await mount($, 'All tests pass.', { requestId: 'drawn-live' })
    await finishTurn($)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })

  test('lexes each block of the reply as it was drawn, not the reply joined', async ($, on) => {
    fakeHost(on, { messages: [] })
    await liveTurn($, [
      ['u-list', '- install the gem'],
      ['u-code', '    bundle add foo'],
    ])
    expect(await labels($, '    bundle add foo', { requestId: 'u-code' })).toEqual(['⧉ reply', '⧉ code'])
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
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(CHIPS)
  })
})

describe('failures', () => {
  test('toasts what failed on macOS, with no Linux install hint', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [prompt('plan'), said(REPLY)] }, { pbcopyExit: 1 })
    const ui = await mount($, REPLY)
    await ui.press({ key: 'copy-reply' })
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
  test('warns once, on a status line that stays, when a renderer before ditto keeps replies from it', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [prompt('a'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await liveTurn($, [['one', REPLY]])
    await liveTurn($, [['two', REPLY]])
    await liveTurn($, [['three', REPLY]])
    await pause(2500)
    expect(statuses).toEqual([NOT_OUTERMOST])
    expect(toasts).toEqual([])
  })

  test('warns after the first settled reply, when someone is deciding whether ditto works, and repeats it under every /ditto', async ($, on) => {
    const { statuses } = fakeHost(on, { messages: [prompt('a'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await liveTurn($, [['one', REPLY]])
    await pause(2500)
    expect(statuses).toEqual([NOT_OUTERMOST])
    expect((await run($, 'help')).text).toContain(NOT_OUTERMOST)
  })

  test('does not warn when the reply is drawn just after the turn ends', async ($, on) => {
    const { statuses } = fakeHost(on, { messages: [prompt('a'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await liveTurn($, [['one', REPLY]])
    await mount($, REPLY, { requestId: 'one' })
    await pause(2500)
    expect(statuses).toEqual([])
  })

  test('stays quiet when replies reach it', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [prompt('a'), said(REPLY)] })
    await $.session.start({ source: 'startup', isInteractive: true, cwd: '/w' } as never)
    await $.turn.start({ prompt: 'a', turnId: 't' } as never)
    await mount($, REPLY, { requestId: 'one' })
    await liveTurn($, [['one', REPLY]])
    await liveTurn($, [['two', REPLY]])
    await pause(2500)
    expect(toasts).toEqual([])
    expect(statuses).toEqual([])
    expect((await run($, 'help')).text).not.toContain(NOT_OUTERMOST)
  })
})

describe('/ditto', () => {
  test('copies the last reply whole, a block by its chip name and an earlier reply', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('older reply'), ...withTools().messages] })
    expect((await run($, '')).text).toBe('Copied last reply (13 lines, pbcopy)')
    expect((await run($, 'bash')).text).toBe('Copied bash block (1 line, pbcopy)')
    expect((await run($, '2')).text).toBe('Copied reply 2 back (1 line, pbcopy)')
    expect(copied).toEqual([`${BEFORE_TOOL}\n\n${REPLY}`, 'git status', 'older reply'])
  })

  test('reads a resumed transcript with no turn in this process', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('from before the resume\nline two\nline three')] })
    expect((await run($, '')).text).toBe('Copied last reply (3 lines, pbcopy)')
    expect(copied).toEqual(['from before the resume\nline two\nline three'])
  })

  test('selection copies the markdown behind what was selected in a reply row', async ($, on) => {
    const { copied } = fakeHost(on, withTools(), { selection: { text: 'Run this:\ngit status', requestId: 'u-reply' } })
    await mount($, REPLY, { requestId: 'u-reply' })
    expect((await run($, 'selection')).text).toBe('Copied selection as markdown (4 lines, pbcopy)')
    expect(copied).toEqual(['Run this:\n\n```bash\ngit status'])
  })

  test('selection across rows of one reply searches the reply whole', async ($, on) => {
    const { copied } = fakeHost(on, withTools(), { selection: { text: `${BEFORE_TOOL}\nBash(git status)\n# Plan` } })
    await liveTurn($, [
      ['u-before', BEFORE_TOOL],
      ['u-reply', REPLY],
    ])
    expect((await run($, 'selection')).text).toBe('Copied selection as markdown (3 lines, pbcopy)')
    expect(copied).toEqual([`${BEFORE_TOOL}\n\n# Plan`])
  })

  test('selection of a word the reply repeats on another line copies nothing and asks for more', async ($, on) => {
    const twice = 'Run tests first.\nThen run **tests** again with `-v`.'
    const { copied } = fakeHost(on, { messages: [prompt('a'), said(twice)] }, { selection: { text: 'tests', requestId: 'u-twice' } })
    await mount($, twice, { requestId: 'u-twice' })
    expect((await run($, 'selection')).text).toBe(selectionRepeats(2))
    expect(selectionRepeats(2)).toMatch(/^ditto copied nothing: /)
    expect(copied).toEqual([])
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

type Call = { tool: string; input: Record<string, unknown>; output?: unknown; isRunning?: boolean; isErrored?: boolean }

let toolRows = 0

async function mountTool($: Engine, call: Call, view: View = {}) {
  const requestId = view.requestId ?? `toolu_${++toolRows}`
  const viewport = { columns: view.columns ?? 100, rows: 40, isFullscreen: view.isFullscreen ?? true }
  const props = { tool_use_id: requestId, isRunning: false, isErrored: false, isInterrupted: false, ...call }
  return $.ui.mount({ plugin: 'ditto', surface: 'terminal', component: 'ToolUse', props, viewport, requestId } as never)
}

function expectBesideRow(boxes: { props: Record<string, unknown> }[], scope: string) {
  const [outer] = boxes
  const chip = boxes.find(b => b.props.key === scope)
  expect(outer?.props.flexDirection).toBe('row')
  expect(boxes.find(b => b.props.key === 'tool')?.props.flexGrow).toBe(1)
  expect(chip?.props.position).toBeUndefined()
  expect(chip?.props.flexShrink).toBe(0)
  expect(chip?.props.marginTop).toBe(0)
  expect(chip?.props.paddingLeft).toBe(2)
}

const used = (call: Call): SessionMessage => ({ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'toolu', tool: call.tool, input: call.input, result: call.output }] })

const WRITE: Call = { tool: 'Write', input: { file_path: '/w/notes.md', content: '# Notes\n\n```ruby\nputs 1\n```' }, output: { type: 'create', filePath: '/w/notes.md', content: '# Notes' } }
const PLAN: Call = { tool: 'ExitPlanMode', input: { plan: '## Plan\n\n1. Do it' }, output: { plan: '## Plan\n\n1. Do it', isAgent: false } }
const LAUNCHED: Call = { tool: 'Agent', input: { prompt: 'look' }, output: { status: 'async_launched', agentId: 'a7', description: 'look', prompt: 'look', outputFile: '/tmp/a7' } }
const handbackStub = (id: string) =>
  `This agent's report was delivered to you as a message from "${id}" (its SubagentHandback call). Read it there; it is not repeated here.`
const stubbed = (id: string) =>
  prompt(`<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<result>${handbackStub(id)}\n</result>\n</task-notification>`)
const BASH: Call = { tool: 'Bash', input: { command: 'ls' }, output: { stdout: '\u001b[32mok\u001b[0m\nfile.md', stderr: '', interrupted: false } }

describe('tool rows', () => {
  test('wraps the tool row beneath with a ⧉ file chip that copies what Write wrote', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] })
    const ui = await mountTool($, WRITE)
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ file'])
    await ui.press({ key: 'copy-file' })
    expect(copied).toEqual([WRITE.input.content as string])
  })

  test('a pbcopy chip copy confirms on the chip alone, as a toast hid the ⧉ markers under it', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [] })
    const ui = await mountTool($, WRITE, { columns: 110, requestId: 'toolu_quiet' })
    await ui.press({ key: 'copy-file' })
    expect(toasts).toEqual([])
    expect(statuses).toEqual([])
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['copied (pbcopy)'])
  })

  test('a chip copy through OSC 52 still toasts, naming the file, since only a paste can prove the terminal took it', async ($, on) => {
    const { toasts, terminal } = fakeHost(on, { messages: [] }, { ssh: true, terminalCopies: true })
    const ui = await mountTool($, WRITE, { columns: 110, requestId: 'toolu_osc' })
    await ui.press({ key: 'copy-file' })
    expect(terminal).toEqual([WRITE.input.content as string])
    expect(toasts).toEqual(['Copied file notes.md (5 lines, OSC 52, paste to check)'])
  })

  test('a failed chip copy still toasts the reason, which the short chip flash cannot hold', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [] }, { pbcopyExit: 1 })
    const ui = await mountTool($, WRITE, { columns: 110, requestId: 'toolu_fail' })
    await ui.press({ key: 'copy-file' })
    expect(toasts).toEqual(['Copy failed: /usr/bin/pbcopy exited 1: pasteboard busy, and the terminal did not take it either'])
  })

  test('at 40 columns a failed copy toasts its whole reason, as the status line cut it and drew ⚠', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [] }, { pbcopyExit: 1 })
    const ui = await mountTool($, WRITE, { columns: 40, requestId: 'toolu_fail_narrow' })
    await ui.press({ key: 'copy-file' })
    expect(statuses).toEqual([])
    expect(toasts).toEqual(['Copy failed: /usr/bin/pbcopy exited 1: pasteboard busy, and the terminal did not take it either'])
  })

  test('at 40 columns an OSC 52 copy toasts "paste to check" whole, never on the status line', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [] }, { ssh: true, terminalCopies: true })
    const ui = await mountTool($, WRITE, { columns: 40, requestId: 'toolu_osc_narrow' })
    await ui.press({ key: 'copy-file' })
    expect(statuses).toEqual([])
    expect(toasts).toEqual(['Copied file notes.md (5 lines, OSC 52, paste to check)'])
  })

  test('a tool-row flash swaps ⧉ for ✓ in place, its words only in the hover strip, so the column keeps its width', async ($, on) => {
    fakeHost(on, { messages: [] })
    const ui = await mountTool($, WRITE, { columns: 40, requestId: 'toolu_flash_width' })
    const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(await texts()).toEqual(['beneath', '⧉ ', '  ', '⧉ file', '  ', '⧉', ' '])
    await ui.press({ key: 'copy-file' })
    expect(await texts()).toEqual(['beneath', `${COPIED} `, '  ', 'copied (pbcopy)', '  ', COPIED, ' '])
  })

  test('a failed tool-row copy marks the glyph ✗ in place', async ($, on) => {
    fakeHost(on, { messages: [] }, { pbcopyExit: 1 })
    const ui = await mountTool($, WRITE, { columns: 40, requestId: 'toolu_flash_fail' })
    await ui.press({ key: 'copy-file' })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).slice(0, 2)).toEqual(['beneath', `${NOT_COPIED} `])
  })

  test('puts the chip in cells of its own after the tool row, past a gap, so it never draws over the row text', async ($, on) => {
    fakeHost(on, { messages: [] })
    const ui = await mountTool($, WRITE, { requestId: 'toolu_1' })
    expectBesideRow(await ui.findAll({ type: 'Box' }), 'ditto-tool-toolu_1')
  })

  test('at 40 columns confirms a tool copy, route included, on the chip and never in the status line', async ($, on) => {
    const { toasts, statuses } = fakeHost(on, { messages: [] })
    const ui = await mountTool($, BASH, { columns: 40, requestId: 'toolu_narrow' })
    await ui.press({ key: 'copy-output' })
    expect(toasts).toEqual([])
    expect(statuses).toEqual([])
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['copied (pbcopy)'])
  })

  test('drops the chip past the spacer the renderer beneath tops its row with, onto the line that names the tool', async () => {
    expect(headerRow({ type: 'Box', props: { marginTop: 1 } } as never)).toBe(1)
    expect(headerRow({ type: 'engine', ref: 3 })).toBe(1)
    expect(headerRow({ type: 'Text', props: {} } as never)).toBe(0)
  })

  test('confirms a copy on the chip in the expanded ctrl+o view, where no toast shows', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] })
    const ui = await mountTool($, { ...BASH, isExpanded: true } as Call, { requestId: 'toolu_x' })
    await ui.press({ key: 'copy-output' })
    expect(copied).toEqual(['ok\nfile.md'])
    expect((await ui.findAll({ type: 'Text' })).filter(t => t.text === 'copied (pbcopy)').length).toBeGreaterThan(0)
  })

  test('a background Agent row gets ⧉ output once its report arrives, and none before', async ($, on) => {
    const notice = prompt('<task-notification>\n<task-id>a7</task-id>\n<status>completed</status>\n<result>Found 3 callers.\nDone.</result>\n</task-notification>')
    const transcript = { messages: [prompt('go'), used(LAUNCHED)] }
    const { copied } = fakeHost(on, transcript)
    expect(await (await mountTool($, LAUNCHED, { requestId: 'toolu_bg1' })).findAll({ type: 'Button' })).toEqual([])
    transcript.messages.push(notice)
    const ui = await mountTool($, LAUNCHED, { requestId: 'toolu_bg2' })
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ output'])
    await ui.press({ key: 'copy-output' })
    expect(copied).toEqual(['Found 3 callers.\nDone.'])
  })

  test('a background Agent row whose report only reached the session as an unreadable message gets no chip', async ($, on) => {
    fakeHost(on, { messages: [prompt('go'), used(LAUNCHED), stubbed('a7')] })
    expect(await (await mountTool($, LAUNCHED, { requestId: 'toolu_bg3' })).findAll({ type: 'Button' })).toEqual([])
  })

  test('a background Agent row takes the SubagentHandback report when the notification only points to it', async ($, on) => {
    const agents = { a7: [prompt('look'), { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'h', tool: 'SubagentHandback', input: { message: 'Real report.' } }] } as SessionMessage] }
    const { copied } = fakeHost(on, { messages: [prompt('go'), used(LAUNCHED), stubbed('a7')] }, { agents })
    const ui = await mountTool($, LAUNCHED, { requestId: 'toolu_bg4' })
    await ui.press({ key: 'copy-output' })
    expect(copied).toEqual(['Real report.'])
  })

  test('/ditto output copies a background Agent report once its task notification arrives', async ($, on) => {
    const launched: Call = { tool: 'Agent', input: { prompt: 'look' }, output: { status: 'async_launched', agentId: 'a7', description: 'look', prompt: 'look', outputFile: '/tmp/a7' } }
    const notice = prompt('<task-notification>\n<task-id>a7</task-id>\n<status>completed</status>\n<result>Found 3 callers.\nDone.</result>\n</task-notification>')
    const transcript = { messages: [prompt('go'), used(launched)] }
    const { copied } = fakeHost(on, transcript)
    expect((await run($, 'output')).text).toBe('No tool output to copy in this session yet')
    transcript.messages.push(notice)
    expect((await run($, 'output')).text).toBe('Copied last agent output (2 lines, pbcopy)')
    expect(copied).toEqual(['Found 3 callers.\nDone.'])
  })

  test('/ditto output copies the SubagentHandback report, not the stub that says it was delivered as a message', async ($, on) => {
    const transcript = { messages: [prompt('go'), used(LAUNCHED), stubbed('a7')] }
    const agents = { a7: [prompt('look'), { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'h', tool: 'SubagentHandback', input: { message: 'Real report.\nDone.' } }] } as SessionMessage] }
    const { copied } = fakeHost(on, transcript, { agents })
    expect((await run($, 'output')).text).toBe('Copied last agent output (2 lines, pbcopy)')
    transcript.messages.splice(2, 1)
    expect((await run($, 'output')).text).toBe('Copied last agent output (2 lines, pbcopy)')
    expect(copied).toEqual(['Real report.\nDone.', 'Real report.\nDone.'])
  })

  test('/ditto output says the report is not available, and copies nothing, when only the stub can be read', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('go'), used(LAUNCHED), stubbed('a7')] })
    expect((await run($, 'output')).text).toBe('Cannot copy the last agent output: the report of agent a7 reached the session as a message ditto cannot read, so nothing was copied')
    expect(copied).toEqual([])
  })

  test('offers ⧉ plan on ExitPlanMode and ⧉ output on Bash, colours stripped', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] })
    const plan = await mountTool($, PLAN)
    await plan.press({ key: 'copy-plan' })
    const bash = await mountTool($, BASH)
    await bash.press({ key: 'copy-output' })
    expect(copied).toEqual(['## Plan\n\n1. Do it', 'ok\nfile.md'])
  })

  test('draws no chip while the call runs, when it failed, outside fullscreen, or when it has nothing to copy', async ($, on) => {
    fakeHost(on, { messages: [] })
    const buttons = async (call: Call, view?: View) => (await (await mountTool($, call, view)).findAll({ type: 'Button' })).length
    expect(await buttons({ ...WRITE, isRunning: true })).toBe(0)
    expect(await buttons({ ...BASH, isErrored: true })).toBe(0)
    expect(await buttons(WRITE, { isFullscreen: false })).toBe(0)
    expect(await buttons({ tool: 'TodoWrite', input: { todos: [] }, output: {} })).toBe(0)
    expect(await buttons({ tool: 'Bash', input: { command: 'true' }, output: { stdout: '', stderr: '' } })).toBe(0)
  })

  test('/ditto file, plan and output copy the latest of each from the transcript, and count back with N', async ($, on) => {
    const edit: Call = { tool: 'Edit', input: { file_path: '/w/a.rb', old_string: 'old', new_string: 'new' }, output: { originalFile: 'x = old\ny = 1', oldString: 'old', newString: 'new', replaceAll: false } }
    const { copied } = fakeHost(on, { messages: [prompt('go'), used(WRITE), used(BASH), used(edit), used(PLAN)] })
    expect((await run($, 'file')).text).toBe('Copied last file a.rb (2 lines, pbcopy)')
    expect((await run($, 'file 2')).text).toBe('Copied file notes.md, 2 back (5 lines, pbcopy)')
    expect((await run($, 'plan')).text).toBe('Copied last plan (3 lines, pbcopy)')
    expect((await run($, 'output')).text).toBe('Copied last bash output (2 lines, pbcopy)')
    expect(copied).toEqual(['x = new\ny = 1', WRITE.input.content, '## Plan\n\n1. Do it', 'ok\nfile.md'])
  })

  test('/ditto file says how many there are when N reaches past them', async ($, on) => {
    fakeHost(on, { messages: [prompt('go'), used(WRITE)] })
    expect((await run($, 'file 3')).text).toBe('Only 1 file so far, not 3')
    expect((await run($, 'plan')).text).toBe('No plan to copy in this session yet')
  })
})

describe('/ditto and group chip names', () => {
  test('/ditto palette.ts copies the file its chip names, as typing a chip name once answered that the reply had no such block', async ($, on) => {
    const palette: Call = { ...WRITE, input: { file_path: '/w/palette.ts', content: 'export const dark = 1' } }
    const { copied } = fakeHost(on, { messages: [prompt('go'), used(palette), used(WRITE), said('Done.')] })
    expect((await run($, 'palette.ts')).text).toBe('Copied last file palette.ts (1 line, pbcopy)')
    expect(copied).toEqual(['export const dark = 1'])
    expect((await run($, '2 palette.ts')).text).toMatch(/^Only 1 reply so far$|^No "palette.ts" in reply 2 back/)
    expect((await run($, 'theme.ts')).text).toMatch(/^No "theme.ts" in the last reply/)
  })

  test('/ditto bash copies the last Bash output a group chip ⧉ bash names, unless the last reply has a bash block', async ($, on) => {
    const transcript = { messages: [prompt('go'), used(BASH), said('Done.')] }
    const { copied } = fakeHost(on, transcript)
    expect((await run($, 'bash')).text).toBe('Copied last bash output (2 lines, pbcopy)')
    expect(copied).toEqual(['ok\nfile.md'])
    transcript.messages.push(said('```bash\ngit status\n```'))
    expect((await run($, 'bash')).text).toBe('Copied bash block (1 line, pbcopy)')
    expect((await run($, 'grep')).text).toMatch(/^No "grep" in the last reply/)
  })

  test('/ditto bash #2 with no group shown says so and copies nothing, while /ditto bash 2 still copies the second bash block', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('go'), said('```bash\none\n```\n\n```bash\ntwo\n```')] })
    expect((await run($, 'bash #2')).text).toBe(noGroupCall('bash #2'))
    expect(copied).toEqual([])
    expect((await run($, 'bash 2')).text).toBe('Copied bash block (1 line, pbcopy)')
  })
})

describe('clipboard route', () => {
  test('over SSH copies through the terminal, never the remote pbcopy, and says so', async ($, on) => {
    const { copied, terminal } = fakeHost(on, { messages: [prompt('a'), said('one line')] }, { ssh: true, terminalCopies: true })
    expect((await run($, '')).text).toBe('Copied last reply (1 line, OSC 52, paste to check)')
    expect(copied).toEqual([])
    expect(terminal).toEqual(['one line'])
  })

  test('a /ditto typed at the terminal copies there; one from the bridge leaves the surface to the engine', async ($, on) => {
    const { surfaces } = fakeHost(on, { messages: [prompt('a'), said('one line')] }, { ssh: true, terminalCopies: true })
    await run($, '')
    await run($, 'reply')
    await run($, '', { kind: 'bridge' })
    expect(surfaces).toEqual(['terminal', 'terminal', undefined])
  })

  test('over SSH with a terminal that refuses, fails and says why, rather than filling the remote clipboard', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [prompt('a'), said('one line')] }, { ssh: true })
    expect((await run($, '')).text).toContain('over SSH ditto copies through your terminal (OSC 52) only')
    expect(copied).toEqual([])
  })
})

describe('/ditto help', () => {
  test('prints the usage for help and its usual spellings', async ($, on) => {
    fakeHost(on, { messages: [] })
    for (const word of ['help', '--help', '-h', '?']) expect((await run($, word)).text).toBe(USAGE)
  })
})

type GroupCall = Call & { tool_use_id?: string }

async function mountGroup($: Engine, calls: GroupCall[], extra: { isActive?: boolean; isExpanded?: boolean } = {}, view: View = {}) {
  const viewport = { columns: view.columns ?? 100, rows: 40, isFullscreen: view.isFullscreen ?? true }
  const props = { calls: calls.map(call => ({ isRunning: false, isErrored: false, isInterrupted: false, ...call })), isActive: false, isExpanded: false, isCallsOnly: true, ...extra }
  return $.ui.mount({ plugin: 'ditto', surface: 'terminal', component: 'ToolGroup', props, viewport, requestId: view.requestId } as never)
}

const READ: GroupCall = { tool: 'Read', input: { file_path: '/w/a.md' }, output: { type: 'text', file: { filePath: '/w/a.md', content: 'line 1\nline 2\n' } } }

describe('grouped tool rows', () => {
  test('give the folded line a chip per call, named by file or tool, numbered from the top where names repeat', async ($, on) => {
    const { copied, toasts } = fakeHost(on, { messages: [] })
    const ui = await mountGroup($, [BASH, READ, { ...BASH, output: { stdout: 'two', stderr: '' } }])
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ bash #1', '⧉ a.md', '⧉ bash #2'])
    await ui.press({ key: 'copy-bash-#2' })
    await ui.press({ key: 'copy-a.md' })
    expect(copied).toEqual(['two', 'line 1\nline 2\n'])
    expect(toasts).toEqual([])
  })

  test('no group chip reads as a /ditto output or file count, which later calls would shift', async ($, on) => {
    const later: GroupCall = { ...BASH, output: { stdout: 'two', stderr: '' } }
    fakeHost(on, { messages: [] })
    const ui = await mountGroup($, [BASH, later, READ, { ...READ, input: { file_path: '/w/b.md' } }])
    const labels = (await chipsOf(ui)).map(b => b.props.label)
    expect(labels).toEqual(['⧉ bash #1', '⧉ bash #2', '⧉ a.md', '⧉ b.md'])
    expect(labels.some(label => /^⧉ (output|file)( \d+)?$/.test(String(label)))).toBe(false)
    expect(USAGE).toContain('Chips on a group with more name each call instead')
  })

  test('a group the engine draws for one Bash call offers ⧉ output, the name /ditto output answers to, and copies that call', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] })
    const ui = await mountGroup($, [BASH])
    expect((await chipsOf(ui)).map(b => b.props.label)).toEqual(['⧉ output'])
    await ui.press({ key: 'copy-output' })
    expect(copied).toEqual(['ok\nfile.md'])
  })

  test('a copy confirmation on a narrow group keeps the strip inside the pane', async ($, on) => {
    fakeHost(on, { messages: [] })
    const later = (stdout: string): GroupCall => ({ ...BASH, output: { stdout, stderr: '' } })
    const ui = await mountGroup($, [BASH, later('two'), READ, later('three')], {}, { columns: 57, requestId: 'gflash' })
    await ui.press({ key: 'copy-bash-#3' })
    const labels = (await chipsOf(ui)).map(b => String(b.props.label))
    expect(rowWidth(labels)).toBeLessThanOrEqual(57 - MARKER_ROOM - STRIP_LEAD - 'beneath'.length)
    expect(labels).toEqual(['⧉ bash #1', '⧉ bash #2', '⧉ a.md', '+1'])
  })

  test('on a narrow group the strip leaves the label and a ground-coloured gap clear', async ($, on) => {
    const label = 'Ran 2 commands'
    fakeHost(on, { messages: [] }, { label })
    const ui = await mountGroup($, [BASH, { ...BASH, output: { stdout: 'two', stderr: '' } }], {}, { columns: 40, requestId: 'glabel' })
    const labels = (await chipsOf(ui)).map(b => String(b.props.label))
    expect(labels).toEqual(['⧉ bash #1', '+1'])
    expect(2 + label.length + STRIP_LEAD + rowWidth(labels) + MARKER_ROOM).toBeLessThanOrEqual(40)
    const grounded = (await ui.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor === dark.background)
    expect(grounded.map(t => t.text)).toEqual([' '.repeat(STRIP_LEAD)])
  })

  test('a label too long for its one chip keeps a ⧉ that copies the call, as a lone +1 once toasted instead', async ($, on) => {
    const label = 'Listed 1 directory, ran 1 cmd'
    const { copied, toasts } = fakeHost(on, { messages: [] }, { label })
    const ui = await mountTool($, BASH, { columns: 40, requestId: 'toolu_long_label' })
    expect((await chipsOf(ui)).map(b => String(b.props.label))).toEqual(['⧉ output'])
    expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')).toEqual([])
    await ui.press({ key: COMPACT_KEY })
    expect(copied).toEqual(['ok\nfile.md'])
    expect(toasts).toEqual([])
  })

  test('a label that leaves no room even for +1 keeps a ⧉ that copies the call, as the row once lost its marker', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] }, { label: 'Listed 1 directory, ran 1 shell command' })
    const ui = await mountTool($, BASH, { columns: 40, requestId: 'toolu_full_label' })
    expect((await chipsOf(ui)).map(b => String(b.props.label))).toEqual(['⧉ output'])
    expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')).toEqual([])
    await ui.press({ key: COMPACT_KEY })
    expect(copied).toEqual(['ok\nfile.md'])
    expect(await ui.find({ type: 'Text', text: COPIED })).toBeDefined()
  })

  test('a lucid row whose argument fills the row keeps the argument clear: only ⧉, never a strip over the path', async ($, on) => {
    fakeHost(on, { messages: [] }, { label: 'Read', detail: 'hooks/palette.ts and a long tail' })
    const ui = await mountTool($, WRITE, { columns: 40, requestId: 'toolu_lucid_path' })
    const absolute = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')
    expect(absolute).toEqual([])
    expect((await chipsOf(ui)).map(b => String(b.props.label))).toEqual(['⧉ file'])
  })

  test('a lucid row with a short argument counts the argument before placing the strip', async ($, on) => {
    const label = 'Read'
    const detail = 'a.md'
    fakeHost(on, { messages: [] }, { label, detail })
    const ui = await mountTool($, WRITE, { columns: 40, requestId: 'toolu_lucid_short' })
    const labels = (await chipsOf(ui)).map(b => String(b.props.label))
    expect(labels).toEqual(['⧉ file'])
    expect(2 + label.length + 1 + detail.length + STRIP_LEAD + rowWidth(labels) + MARKER_ROOM).toBeLessThanOrEqual(40)
  })

  test('a row the engine draws, which ditto cannot measure, gets only ⧉ at any width, so nothing covers its label', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] }, { engine: true })
    for (const columns of [40, 110]) {
      const ui = await mountTool($, BASH, { columns, requestId: `toolu_engine_${columns}` })
      const absolute = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')
      expect(absolute).toEqual([])
      await ui.press({ key: COMPACT_KEY })
    }
    expect(copied).toEqual(['ok\nfile.md', 'ok\nfile.md'])
  })

  test('an engine-drawn group of several calls names them and the commands on ⧉, copying nothing it would have to guess', async ($, on) => {
    const { copied, toasts } = fakeHost(on, { messages: [] }, { engine: true })
    const ui = await mountGroup($, [BASH, READ, { ...BASH, output: { stdout: 'two', stderr: '' } }], {}, { columns: 110, requestId: 'gengine' })
    expect((await chipsOf(ui)).map(b => String(b.props.label))).toEqual(['⧉ +3'])
    await ui.press({ key: COMPACT_KEY })
    expect(copied).toEqual([])
    expect(toasts.at(-1)).toBe('Copy with /ditto <name>: bash #1, a.md, bash #2')
    expect(toasts.at(-1)).not.toMatch(/widen|click/i)
  })

  test('/ditto bash #2 copies the call the stock group toast names, from the latest group shown', async ($, on) => {
    const BASH_ID = { ...BASH, tool_use_id: 'b1' }
    const early: GroupCall = { ...BASH, tool_use_id: 'b2', output: { stdout: 'early', stderr: '' } }
    const late: GroupCall = { ...BASH, tool_use_id: 'b4', output: { stdout: 'late', stderr: '' } }
    const use = (id: string) => ({ tool_use_id: id, tool: 'Bash', input: {} })
    const transcript = { messages: [prompt('go'), { ...called(), toolUses: ['b1', 'b2', 'b3', 'b4'].map(use) }] }
    const { copied, toasts } = fakeHost(on, transcript, { engine: true })
    const ui = await mountGroup($, [BASH_ID, early], {}, { columns: 110, requestId: 'gearly' })
    await mountGroup($, [{ ...BASH, tool_use_id: 'b3' }, late], {}, { columns: 110, requestId: 'glate' })
    await ui.press({ key: COMPACT_KEY })
    expect(toasts.at(-1)).toBe('Copy with /ditto <name>: bash #1, bash #2')
    expect((await run($, 'bash #2')).text).toBe('Copied bash output #2 (1 line, pbcopy)')
    expect(copied).toEqual(['late'])
    expect((await run($, 'bash #3')).text).toBe(noGroupCall('bash #3'))
    expect(copied).toEqual(['late'])
  })

  test('the ⧉ closing a strip is a control, so a click on it never falls through to expand the row', async ($, on) => {
    const { copied, toasts } = fakeHost(on, { messages: [] }, { label: 'Ran 2 commands' })
    const ui = await mountGroup($, [BASH, { ...BASH, output: { stdout: 'two', stderr: '' } }], {}, { columns: 110, requestId: 'gcover' })
    const cover = (await ui.findAll({ type: 'Button' })).filter(b => b.props.key === COVER_KEY)
    expect(cover.map(b => String(b.props.label))).toEqual(['⧉'])
    await ui.press({ key: COVER_KEY })
    expect(copied).toEqual([])
    expect(toasts).toEqual([])
  })

  test('the ⧉ closing a one-call strip copies that call, as the compact ⧉ does', async ($, on) => {
    const { copied } = fakeHost(on, { messages: [] }, { label: 'Ran 1 command' })
    const ui = await mountTool($, BASH, { columns: 110, requestId: 'toolu_cover' })
    await ui.press({ key: COVER_KEY })
    expect(copied).toEqual(['ok\nfile.md'])
    expect(await ui.find({ type: 'Text', text: COPIED })).toBeDefined()
  })

  test('a group label that fills the row still shows ⧉, as the marker once vanished there', async ($, on) => {
    fakeHost(on, { messages: [] }, { label: "Ran 2 commands, couldn't read 1 file" })
    const ui = await mountGroup($, [BASH, { ...BASH, output: { stdout: 'two', stderr: '' } }], {}, { columns: 40, requestId: 'gfull' })
    expect((await chipsOf(ui)).map(b => String(b.props.label))).toEqual(['⧉ +2'])
  })

  test('a lucid group too narrow for chips says widening brings them, as a wider pane does', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [] }, { label: "Ran 2 commands, couldn't read 1 file" })
    const ui = await mountGroup($, [BASH, { ...BASH, output: { stdout: 'two', stderr: '' } }], {}, { columns: 40, requestId: 'gwiden' })
    await ui.press({ key: COMPACT_KEY })
    expect(toasts.at(-1)).toBe('Widen for chips, or /ditto <name>: bash #1, bash #2')
  })

  test('while a narrow group flashes, its chips stay beside the label, as the flash once moved them over it', async ($, on) => {
    const label = 'Ran 2 commands'
    fakeHost(on, { messages: [] }, { label })
    const calls = [BASH, { ...BASH, output: { stdout: 'two', stderr: '' } }]
    const ui = await mountGroup($, calls, {}, { columns: 40, requestId: 'gflash' })
    await ui.press({ key: 'copy-bash-#1' })
    const labels = (await chipsOf(ui)).map(b => String(b.props.label))
    expect(labels.length).toBeGreaterThan(0)
    expect(2 + label.length + STRIP_LEAD + rowWidth(labels) + MARKER_ROOM).toBeLessThanOrEqual(40)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect([texts.filter(t => t === `${COPIED} `), texts.filter(t => t === COPIED)]).toEqual([[`${COPIED} `], [COPIED]])
  })

  test('headWidth counts the whole head line, the argument after the bold name included, and nothing it cannot read', async () => {
    const text = (children: unknown[], props: object = {}) => ({ type: 'Text', props, children })
    const box = (children: unknown[], props: object = {}) => ({ type: 'Box', props, children })
    const row = box([box([box([text(['●'])], { width: 2 }), text([text(['Read'], { bold: true }), ' hooks/palette.ts'])]), text(['next line'])], { flexDirection: 'column' })
    expect(headWidth(row as never)).toBe(2 + 'Read hooks/palette.ts'.length)
    expect(headWidth(text(['no name']) as never)).toBe(7)
    expect(headWidth({ type: 'engine', ref: 1 } as never)).toBeUndefined()
    expect(headWidth(box([text(['a']), { type: 'engine', ref: 2 }]) as never)).toBeUndefined()
    expect(headWidth(box([]) as never)).toBe(0)
  })

  test('the +N on a group names the hidden calls as group calls, not reply blocks, and says how to reach them', async ($, on) => {
    const { toasts } = fakeHost(on, { messages: [] })
    const ui = await mountGroup($, [BASH, READ, BASH, READ], {}, { columns: 30 })
    await ui.press({ key: 'copy-more' })
    expect(toasts.at(-1)).toMatch(/^Widen for chips, or \/ditto <name>: .*a\.md/)
  })

  test('put the chip after the folded line in cells of its own, on the same row a single tool uses', async ($, on) => {
    fakeHost(on, { messages: [] })
    const ui = await mountGroup($, [BASH, READ], {}, { requestId: 'g1' })
    expectBesideRow(await ui.findAll({ type: 'Box' }), 'ditto-group-g1')
  })

  test('draw no chip on a live, unfolded, non-fullscreen or failed group', async ($, on) => {
    fakeHost(on, { messages: [] })
    const buttons = async (calls: GroupCall[], extra = {}, view?: View) => (await (await mountGroup($, calls, extra, view)).findAll({ type: 'Button' })).length
    expect(await buttons([BASH], { isActive: true })).toBe(0)
    expect(await buttons([BASH], { isExpanded: true })).toBe(0)
    expect(await buttons([BASH], {}, { isFullscreen: false })).toBe(0)
    expect(await buttons([{ ...BASH, isErrored: true }, { ...READ, isRunning: true }])).toBe(0)
    expect(await buttons([])).toBe(0)
  })

  test('folds what does not fit at 40 columns into +N', async ($, on) => {
    fakeHost(on, { messages: [] })
    const ui = await mountGroup($, [BASH, READ, BASH, READ], {}, { columns: 40 })
    const shown = (await chipsOf(ui)).map(b => b.props.label)
    expect(shown.at(-1)).toMatch(/^\+\d$/)
  })
})
