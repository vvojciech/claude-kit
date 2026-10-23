import { describe, expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { forgetThumbs } from '../hooks/convert'
import { ON_CLIPBOARD } from '../hooks/actions'
import { USAGE } from '../hooks/commands'
import { CLIP } from '../hooks/draws'
import { BAND_KEY, GALLERY_KEY } from '../hooks/view'
import { WIDE_PNG } from './support'

type On = Parameters<TestBody>[1]

type World = {
  files?: Record<string, string>
  program?: string
  version?: string
  tmux?: string
  openFails?: boolean
  clipboard?: string
  lucid?: unknown
  pressed?: string[]
}

const IMAGES = '/tmp/claude-501/-w/s1/images'

function ok(stdout = '', exitCode = 0) {
  return { exitCode, stdout, stderr: exitCode === 0 ? '' : 'nope', isStdoutTruncated: false, isStderrTruncated: false }
}

function answer(argv: readonly string[], world: World) {
  if (argv[0] === '/usr/bin/id') return ok('501\n')
  if (argv[0] === '/usr/bin/open') return ok('', world.openFails ? 1 : 0)
  if (argv[0] === '/usr/bin/osascript') return ok(argv[2] === 'clipboard info' ? (world.clipboard ?? '«class PNGf», 10') : '')
  return ok()
}

function host(on: On, world: World = {}) {
  const runs: string[][] = []
  const toasts: string[] = []
  const files = world.files ?? {}
  forgetThumbs()
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: answer(e.argv, world) }
  })
  on('fs.stat', (_, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 100, mtimeMs: 1, isLink: false } } as never
  })
  on('fs.read', (_, e) => ({ value: { base64: files[e.path] ?? '' } }) as never)
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(f => f.startsWith(`${e.path}/`)).map(f => ({ name: f.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 1, isLink: false })) }) as never)
  on('env.get', (_, e) => ({ value: { TERM_PROGRAM: world.program ?? 'iTerm.app', HOME: '/h', TMUX: world.tmux }[e.name] }) as never)
  on('session.version', () => ({ value: { version: world.version ?? '2.1.309' } }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('config.list', () => ({ value: [] }) as never)
  on('command.register', () => ({ value: { command: 'peek' } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/w' }))
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('clock.after', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => beneath($.ui.resolve(e) as never, world) as never)
  if (world.lucid !== undefined) on('engine.create', async (_, e, next) => ({ ...(await next(e)), lucid: { tone: () => world.lucid } }) as never)
  return { runs, toasts }
}

type Changes = { change: (e: object) => Promise<unknown> }

async function changed($: Engine, text: string) {
  await ($.prompt as unknown as Changes).change({ text, cursor: 0, origin: { kind: 'paste' } })
}

type Beneath = { Box: (p: object) => unknown; Text: (p: object) => unknown; Button: (p: object) => unknown }

function beneath(kit: Beneath, world: World) {
  if (world.pressed === undefined) return kit.Text({ children: ['beneath'] })
  const chip = kit.Button({ key: 'copy-cover', plain: true, label: '⧉', onPress: () => world.pressed?.push('⧉'), children: [kit.Text({ children: ['⧉'] })] })
  return kit.Box({ flexDirection: 'column', children: [kit.Text({ children: ['beneath'] }), chip] })
}

async function start($: Engine) {
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
}

const VIEW = { columns: 100, rows: 40, isFullscreen: true }

async function toolRow($: Engine, tool: string, input: unknown, view = VIEW) {
  const props = { tool_use_id: 't1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }
  return $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'ToolUse', props, viewport: view, requestId: 't1' })
}

async function reply($: Engine, text: string) {
  return $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: VIEW, requestId: 'r1' })
}

type Mounted = Awaited<ReturnType<typeof reply>>

async function images(ui: Pick<Mounted, 'findAll'>) {
  return ui.findAll({ type: 'Image' })
}

describe('thumbnails under transcript rows', () => {
  test('draws the row beneath first, then a picture of the PNG Claude read with an open button', async ($, on) => {
    host(on, { files: { '/w/a.png': WIDE_PNG } })
    await start($)
    const ui = await toolRow($, 'Read', { file_path: 'a.png' })
    const drawn = (await ui.drawn()) as unknown as { children: { type?: string; props?: { key?: string } }[] }
    expect(drawn.children[0]?.type).toBe('Text')
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    expect(await ui.find({ key: GALLERY_KEY })).toBeDefined()
    const [image] = await images(ui)
    expect(image?.props.source).toEqual({ png: WIDE_PNG })
    expect([image?.props.columns, image?.props.rows]).toEqual([8, 2])
    expect(await ui.find({ type: 'Button', key: 'peek-open-tool-0' })).toBeDefined()
  })

  test('leaves a row alone when it names no image, still runs or failed', async ($, on) => {
    host(on, { files: { '/w/a.png': WIDE_PNG } })
    await start($)
    expect(await (await toolRow($, 'Read', { file_path: 'a.md' })).find({ key: GALLERY_KEY })).toBeUndefined()
    const props = { tool_use_id: 't2', tool: 'Write', input: { file_path: '/w/a.png' }, isRunning: true, isErrored: false, isInterrupted: false }
    const running = await $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'ToolUse', props, viewport: VIEW, requestId: 't2' })
    expect(await images(running)).toHaveLength(0)
  })

  test('shows the images of a folded group of Reads, once the group settles', async ($, on) => {
    host(on, { files: { '/w/a.png': WIDE_PNG, '/w/b.png': WIDE_PNG } })
    await start($)
    const call = (path: string) => ({ tool: 'Read', input: { file_path: path }, isRunning: false, isErrored: false, isInterrupted: false })
    const props = { calls: [call('/w/a.png'), call('/w/b.png'), call('/w/c.md')], isActive: false, isExpanded: false }
    const ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'ToolGroup', props, viewport: VIEW, requestId: 'g1' })
    expect((await images(ui)).map(i => i.props.alt)).toEqual(['▣ a.png', '▣ b.png'])
    const live = await $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'ToolGroup', props: { ...props, isActive: true }, viewport: VIEW, requestId: 'g2' })
    expect(await images(live)).toHaveLength(0)
  })

  test('shows a local markdown image in a reply and skips a URL', async ($, on) => {
    host(on, { files: { '/w/out/c.png': WIDE_PNG } })
    await start($)
    const ui = await reply($, 'Here: ![chart](out/c.png) and ![web](https://e.com/x.png)')
    expect(await images(ui)).toHaveLength(1)
    expect((await images(ui))[0]?.props.alt).toBe('▣ c.png')
  })

  test('shows the pasted image a prompt carries from the session image cache', async ($, on) => {
    host(on, { files: { [`${IMAGES}/3.png`]: WIDE_PNG } })
    await start($)
    const props = { text: 'what is this [Image #3]', origin: { kind: 'composer' }, isExpanded: false }
    const ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'UserMessage', props: props as never, viewport: VIEW, requestId: 'u1' })
    expect(await ui.find({ type: 'Text', text: 'Image #3' })).toBeDefined()
    expect(await images(ui)).toHaveLength(1)
  })
})

describe('composing with other mods', () => {
  test("keeps another mod's tree and its ⧉ chip working above the thumbnail", async ($, on) => {
    const pressed: string[] = []
    host(on, { files: { '/w/out/c.png': WIDE_PNG }, pressed })
    await start($)
    const ui = await reply($, '![chart](out/c.png)')
    await ui.press({ key: 'copy-cover', plugin: 'test' })
    expect(pressed).toEqual(['⧉'])
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.props.key)
    expect(keys).toEqual(['copy-cover', 'peek-open-reply-0'])
  })
})

describe('the fallback line', () => {
  test('draws one quiet line with the open button when not fullscreen', async ($, on) => {
    host(on, { files: { '/w/a.png': WIDE_PNG } })
    await start($)
    const ui = await toolRow($, 'Read', { file_path: '/w/a.png' }, { ...VIEW, isFullscreen: false })
    expect(await images(ui)).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: '▣ a.png' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'peek-open-tool-0' })).toBeDefined()
  })

  test('draws the line inside tmux and on a CLI before 2.1.305', async ($, on) => {
    host(on, { files: { '/w/a.png': WIDE_PNG }, tmux: '/tmp/tmux-1/default' })
    await start($)
    expect(await images(await toolRow($, 'Read', { file_path: '/w/a.png' }))).toHaveLength(0)
  })

  test('skips a file that is gone', async ($, on) => {
    host(on, { version: '2.1.304' })
    await start($)
    expect(await (await toolRow($, 'Read', { file_path: '/w/gone.png' })).find({ key: GALLERY_KEY })).toBeUndefined()
  })
})

describe('opening an image', () => {
  test('⤢ opens the original in Preview', async ($, on) => {
    const { runs } = host(on, { files: { '/w/a.png': WIDE_PNG } })
    await start($)
    const ui = await toolRow($, 'Read', { file_path: '/w/a.png' })
    await ui.press({ key: 'peek-open-tool-0' })
    expect(runs.filter(r => r[0] === '/usr/bin/open')).toEqual([['/usr/bin/open', '-a', 'Preview', '/w/a.png']])
  })

  test('falls back to open, then toasts when that fails too', async ($, on) => {
    const { runs, toasts } = host(on, { files: { '/w/a.png': WIDE_PNG }, openFails: true })
    await start($)
    await (await toolRow($, 'Read', { file_path: '/w/a.png' })).press({ key: 'peek-open-tool-0' })
    expect(runs.filter(r => r[0] === '/usr/bin/open').map(r => r.length)).toEqual([4, 2])
    expect(toasts).toEqual(['Could not open a.png: nope'])
  })
})

describe('the /peek command', () => {
  test('toasts that the image is on the clipboard', async ($, on) => {
    const { toasts, runs } = host(on, { files: { '/w/a.png': WIDE_PNG } })
    await start($)
    const result = await $.command.run({ command: 'peek', args: 'a.png', origin: { kind: 'composer' } } as never)
    expect(result.text).toBeUndefined()
    expect(toasts).toEqual([ON_CLIPBOARD])
    expect(runs.some(r => r[2]?.includes('«class PNGf»'))).toBe(true)
  })

  test('prints usage with no arguments', async ($, on) => {
    host(on)
    await start($)
    expect((await $.command.run({ command: 'peek', args: '', origin: { kind: 'composer' } } as never)).text).toBe(USAGE)
  })
})

describe('the band above the prompt', () => {
  async function band($: Engine) {
    return $.ui.mount({ plugin: 'peek', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100 } as never, viewport: VIEW, requestId: 'band' })
  }

  test('shows pasted images and a dragged path in the draft, the path with a clip button', async ($, on) => {
    host(on, { files: { [`${IMAGES}/2.png`]: WIDE_PNG, '/h/s s.png': WIDE_PNG } })
    await start($)
    await changed($, 'look [Image #2] and /h/s\\ s.png')
    const ui = await band($)
    expect(await ui.find({ key: BAND_KEY })).toBeDefined()
    expect(await images(ui)).toHaveLength(2)
    expect((await ui.find({ type: 'Button', key: 'peek-clip-bare-0' }))?.props.label).toBe(CLIP)
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  })

  test('stays out of the way with no images in the draft', async ($, on) => {
    host(on)
    await start($)
    await changed($, 'plain words')
    expect(await (await band($)).find({ key: BAND_KEY })).toBeUndefined()
  })
})

describe('tone', () => {
  test("takes lucid's muted grey when lucid is loaded", async ($, on) => {
    host(on, { files: { '/w/a.png': WIDE_PNG }, lucid: { ground: 'dark', palette: { muted: '#8a8580', text: '#d0ccc4', strong: '#ffffff', accent: '#d4734f' } } })
    await start($)
    const ui = await toolRow($, 'Read', { file_path: '/w/a.png' }, { ...VIEW, isFullscreen: false })
    expect((await ui.find({ type: 'Text', text: '▣ a.png' }))?.props.color).toBe('#8a8580')
  })
})
