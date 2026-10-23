import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGM4UWEzIIhh1OJRi0ctHrV41OJRi0ctHrV45FgMANL1o70iON74AAAAAElFTkSuQmCC'

const VIEW = { columns: 100, rows: 40, isFullscreen: true }

type Asked = { path: string; requestId?: string; columns?: number; isFullscreen?: boolean }

function pictureOf(path: string) {
  const name = path.split('/').pop() ?? path
  return { source: { png: PNG }, columns: 8, rows: 2, alt: `▣ ${name}`, path, name, caption: '40×20', open: '⤢ open', key: `peek-img-reply-${name}` }
}

function withPeek(on: On, answer: (args: Asked) => unknown = args => pictureOf(args.path)) {
  const asked: Asked[] = []
  const opened: { path: string }[] = []
  const peek = {
    picture: async (args: Asked) => {
      asked.push(args)
      return answer(args)
    },
    open: async (args: { path: string }) => {
      opened.push(args)
      return {}
    },
  }
  on('engine.create', async (_, e, next) => ({ ...(await next(e)), peek }) as never)
  return { asked, opened }
}

async function draw($: Engine, text: string) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: VIEW, requestId: 'r1' } as never)
}

async function order(ui: Awaited<ReturnType<typeof draw>>, marks: string[]) {
  const tree = JSON.stringify(await ui.drawn())
  return marks.map(mark => tree.indexOf(mark))
}

describe('reply images drawn in place through peek', () => {
  test('draws the picture between the paragraphs around it, not as a placeholder', async ($, on) => {
    withPeek(on)
    const ui = await draw($, 'First.\n\n![probe](/x/probe.png)\n\nSecond.')
    const [image] = await ui.findAll({ type: 'Image' })
    expect(image?.props).toMatchObject({ source: { png: PNG }, columns: 8, rows: 2, alt: '▣ probe.png', key: 'peek-img-reply-probe.png' })
    expect(await ui.find({ type: 'Text', text: '[image: probe]' })).toBeUndefined()
    const [first, picture, second] = await order(ui, ['First.', '"Image"', 'Second.'])
    expect(first).toBeLessThan(picture ?? -1)
    expect(picture).toBeLessThan(second ?? -1)
  })

  test("shows peek's name, size and open button beside it, and the button opens the image", async ($, on) => {
    const { opened } = withPeek(on)
    const ui = await draw($, '![probe](/x/probe.png)')
    expect(await ui.find({ type: 'Text', text: 'probe.png' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '40×20' })).toBeDefined()
    const button = await ui.find({ type: 'Button', key: 'lucid-open-peek-img-reply-probe.png' })
    expect(button?.props.label).toBe('⤢ open')
    await ui.press({ key: 'lucid-open-peek-img-reply-probe.png' })
    expect(opened).toEqual([{ path: '/x/probe.png' }])
  })

  test('asks peek with the message, the viewport and the link as written', async ($, on) => {
    const { asked } = withPeek(on)
    await (await draw($, '![probe](out/probe.png)')).drawn()
    expect(asked).toEqual([{ path: 'out/probe.png', requestId: 'r1', columns: 100, isFullscreen: true }])
  })

  test('breaks an inline image onto its own block between the words around it', async ($, on) => {
    withPeek(on)
    const ui = await draw($, 'Look ![p](a.png) here')
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: '[image: p]' })).toBeUndefined()
    const [look, picture, here] = await order(ui, ['Look', '"Image"', 'here'])
    expect(look).toBeLessThan(picture ?? -1)
    expect(picture).toBeLessThan(here ?? -1)
  })

  test('asks once for an image linked twice and draws both under distinct keys', async ($, on) => {
    const { asked } = withPeek(on)
    const ui = await draw($, '![a](a.png)\n\n![again](a.png)')
    expect(asked).toHaveLength(1)
    expect((await ui.findAll({ type: 'Image' })).map(i => i.props.key)).toEqual(['peek-img-reply-a.png', 'peek-img-reply-a.png-2'])
  })

  test('leaves an image inside a list as its placeholder, for peek to show under the reply', async ($, on) => {
    const { asked } = withPeek(on)
    const ui = await draw($, '- ![nested](n.png)')
    expect(asked).toEqual([])
    expect(await ui.find({ type: 'Text', text: /\[image: nested\]/ })).toBeDefined()
  })

  test('leaves a web image as its placeholder and never asks peek for it', async ($, on) => {
    const { asked } = withPeek(on)
    const ui = await draw($, '![web](https://e.com/x.png)')
    expect(asked).toEqual([])
    expect(await ui.find({ type: 'Text', text: '[image: web]' })).toBeDefined()
  })
})

describe('the placeholder when peek cannot draw', () => {
  test('keeps [image: alt] when peek is not loaded', async $ => {
    const ui = await draw($, 'First.\n\n![probe](/x/probe.png)\n\nSecond.')
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: '[image: probe]' })).toBeDefined()
  })

  test('keeps [image: alt] when peek answers a fallback', async ($, on) => {
    withPeek(on, () => ({ fallback: 'pictures-off' }))
    const ui = await draw($, '![probe](/x/probe.png)')
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: '[image: probe]' })).toBeDefined()
  })

  test('keeps [image: alt] when peek throws or answers something malformed', async ($, on) => {
    withPeek(on, args => {
      if (args.path === 'a.png') throw new Error('boom')
      return { source: {} }
    })
    const ui = await draw($, '![a](a.png)\n\n![b](b.png)')
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: '[image: a]' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[image: b]' })).toBeDefined()
  })
})
