import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { PALETTE, TINT, notDrawn } from '../hooks/register'

type On = Parameters<TestBody>[1]
type Surface = 'terminal' | 'desktop'

const SEQUENCE = 'The flow:\n\n```mermaid\nsequenceDiagram\nparticipant C as Bazaar\nC->>Gate: rate\nGate-->>C: quotes\n```\n\nThat is all.'
const FLOWCHART = 'Before.\n\n```mermaid\nflowchart LR\nA[Start]-->B[Stop]\n```'
const PIE = 'Before.\n\n```mermaid\npie\n"a": 1\n```'

function beneath(on: On, seen: { text: string; isFirst: boolean }[] = [], theme?: string) {
  on('ui.render', ($, e) => {
    const props = e.props as { text: string; isFirstOfReply: boolean }
    seen.push({ text: props.text, isFirst: props.isFirstOfReply })
    return $.ui.resolve(e).Text({ children: [`engine: ${props.text}`] })
  })
  on('ui.log', () => ({ value: undefined }))
  on('config.list', () => ({ value: theme === undefined ? [] : [{ key: 'theme', value: theme }] }) as never)
}

async function mount($: Engine, text: string, surface: Surface = 'terminal') {
  const viewport = { columns: 100, rows: 40, isFullscreen: true }
  return $.ui.mount({ plugin: 'mermaid', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport } as never)
}

async function texts(ui: Awaited<ReturnType<typeof mount>>) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text)
}

test('draws a sequence diagram in place of its fence, between the text around it', async ($, on) => {
  const seen: { text: string; isFirst: boolean }[] = []
  beneath(on, seen)
  const ui = await mount($, SEQUENCE)
  const all = await texts(ui)
  const before = all.indexOf('engine: The flow:')
  const after = all.indexOf('engine: That is all.')
  const bazaar = all.findIndex(t => t.includes('Bazaar'))
  expect(before).toBe(0)
  expect(bazaar).toBeGreaterThan(before)
  expect(after).toBeGreaterThan(bazaar)
  expect(all.some(t => t.includes('sequenceDiagram'))).toBe(false)
  expect(seen).toEqual([
    { text: 'The flow:', isFirst: true },
    { text: 'That is all.', isFirst: false },
  ])
  await ui.unmount()
})

test('a reply that is only a diagram asks the engine for nothing', async ($, on) => {
  const seen: { text: string; isFirst: boolean }[] = []
  beneath(on, seen)
  const ui = await mount($, '```mermaid\nsequenceDiagram\nA->>B: hi\n```')
  expect(seen).toEqual([])
  expect((await texts(ui)).some(t => t.includes('hi'))).toBe(true)
  await ui.unmount()
})

test('leaves a reply without mermaid as drawn', async ($, on) => {
  beneath(on)
  const ui = await mount($, 'No diagrams here.\n\n```ts\nconst x = 1\n```')
  expect(await texts(ui)).toEqual(['engine: No diagrams here.\n\n```ts\nconst x = 1\n```'])
  await ui.unmount()
})

test('draws a flowchart in place of its fence', async ($, on) => {
  beneath(on)
  const ui = await mount($, FLOWCHART)
  const all = await texts(ui)
  expect(all[0]).toBe('engine: Before.')
  expect(all.some(t => t.includes('Start'))).toBe(true)
  expect(all.some(t => t.includes('Stop'))).toBe(true)
  expect(all.some(t => t.includes('flowchart LR'))).toBe(false)
  await ui.unmount()
})

test('keeps another kind of diagram as source and says it is not drawn yet beneath it', async ($, on) => {
  beneath(on)
  const ui = await mount($, PIE)
  const all = await texts(ui)
  expect(all[0]).toBe('engine: Before.\n\n```mermaid\npie\n"a": 1\n```')
  expect(all[1]).toBe(notDrawn('pie'))
  expect(notDrawn('pie')).toBe('mermaid: pie not drawn yet, sequenceDiagram and flowchart only')
  await ui.unmount()
})

test('leaves an unclosed fence to the engine while it streams', async ($, on) => {
  beneath(on)
  const ui = await mount($, 'The flow:\n\n```mermaid\nsequenceDiagram\nA->>B: hi')
  expect(await texts(ui)).toEqual(['engine: The flow:\n\n```mermaid\nsequenceDiagram\nA->>B: hi'])
  await ui.unmount()
})

test('leaves other surfaces alone', async ($, on) => {
  beneath(on)
  const ui = await mount($, SEQUENCE, 'desktop')
  expect(await texts(ui)).toEqual([`engine: ${SEQUENCE}`])
  await ui.unmount()
})

test('boxes a note by default, italic and not dimmed', async ($, on) => {
  beneath(on)
  const ui = await mount($, '```mermaid\nsequenceDiagram\nA->>B: hi\nNote over A,B: shared\n```')
  const note = await ui.find({ type: 'Text', text: /shared/ })
  expect(note?.props.backgroundColor).toBeUndefined()
  expect(note?.props.italic).toBe(true)
  expect((await texts(ui)).some(text => text.includes('╭'))).toBe(true)
  await ui.unmount()
})

test('colours each sender and dims only the stroke of a return', async ($, on) => {
  beneath(on)
  const ui = await mount($, '```mermaid\nsequenceDiagram\nA->>B: ask\nB-->>A: answer\n```')
  const name = await ui.find({ type: 'Text', text: /^ ?A ?$/ })
  expect(name?.props.color).toBe(PALETTE[0])
  const answer = await ui.find({ type: 'Text', text: /answer/ })
  expect(answer?.props.dimColor).toBeUndefined()
  await ui.unmount()
})

test('tints a note in plain style, italic and not dimmed, darker on a dark theme', async ($, on) => {
  beneath(on)
  on('env.get', (_, e) => ({ value: e.name === 'MERMAID_STYLE' ? 'plain' : undefined }))
  const ui = await mount($, '```mermaid\nsequenceDiagram\nA->>B: hi\nNote over A,B: shared\n```')
  const note = await ui.find({ type: 'Text', text: /shared/ })
  expect(note?.props.backgroundColor).toBe(TINT.dark)
  expect(note?.props.italic).toBe(true)
  expect(note?.props.dimColor).toBeUndefined()
  await ui.unmount()
})

test('draws arrows at normal weight and dims autonumbers', async ($, on) => {
  beneath(on)
  const ui = await mount($, '```mermaid\nsequenceDiagram\nautonumber\nA->>B: hi\n```')
  const arrow = await ui.find({ type: 'Text', text: /▶/ })
  expect(arrow?.props.dimColor).toBeUndefined()
  const number = await ui.find({ type: 'Text', text: /^1 ?$/ })
  expect(number?.props.dimColor).toBe(true)
  expect(number?.props.bold).toBeUndefined()
  await ui.unmount()
})

test('shows the source with its problems when a diagram cannot be read', async ($, on) => {
  const seen: { text: string; isFirst: boolean }[] = []
  beneath(on, seen)
  const broken = '```mermaid\nsequenceDiagram\nthis is not mermaid\n->>\n```'
  const ui = await mount($, `Look:\n\n${broken}`)
  const all = await texts(ui)
  expect(seen.map(s => s.text)).toEqual(['Look:', broken])
  expect(all.some(t => t.includes('not understood'))).toBe(true)
  await ui.unmount()
})

test('an empty mermaid fence says there is no diagram type', async ($, on) => {
  beneath(on)
  const ui = await mount($, '```mermaid\n```')
  const all = await texts(ui)
  expect(all.at(-1)).toBe('mermaid: no diagram type')
  await ui.unmount()
})

test('leaves one blank row between a diagram and its footnotes', async ($, on) => {
  beneath(on)
  const ui = await mount($, `\`\`\`mermaid\nsequenceDiagram\nA->>B: hi\nloop ${'every five seconds until the cache answers '.repeat(4)}\nA->>B: poll\nend\n\`\`\``)
  const all = await texts(ui)
  const first = all.findIndex(t => t.startsWith('[1] '))
  expect(first).toBeGreaterThan(0)
  expect(all[first - 1]!.trim()).toBe('')
  await ui.unmount()
})

test('a diagram mermaid rejects shows as source without undrawing the others in the reply', async ($, on) => {
  const seen: { text: string; isFirst: boolean }[] = []
  beneath(on, seen)
  const fence = (body: string) => `\`\`\`mermaid\nsequenceDiagram\n${body}\n\`\`\``
  const bad = fence('Gamma->>Delta: odd #9999999; and #0; here')
  const reply = [fence('Alpha->>Beta: one'), bad, fence('Echo->>Fox: three #0; end')].join('\n\n')
  const ui = await mount($, reply)
  const all = await texts(ui)
  for (const name of ['Alpha', 'Echo']) expect(all.some(t => t.includes(name))).toBe(true)
  expect(all).toContain(`engine: ${bad}`)
  expect(all.some(t => t.includes('character code #9999999; is out of range'))).toBe(true)
  expect(all.some(t => t.includes('empty diagram'))).toBe(false)
  expect(all.join('').includes('\u0000')).toBe(false)
  expect(seen.map(one => one.text)).toEqual([bad])
  await ui.unmount()
})

test('keeps the text around a diagram whose boxes send details to the legend, at a wide terminal', async ($, on) => {
  beneath(on)
  const names = ['Bazaar journey<br/>(QuotingService::Common)', 'Bazaar GateAdapter<br/>(offerset_generation/gate_adapter.rb)', 'Gate API<br/>(offerset_generation v1)', 'Gate GenerateOfferset', 'Risk Profiler', 'Contact (ACCT)', 'Tarif (in-process gem)<br/>Tarif::Rating', 'Kafka', 'Gate persistence (S3)']
  const source = [...names.map((name, i) => `participant P${i} as ${name}`), ...names.slice(1).map((_, i) => `P${i}->>P${i + 1}: step ${i} with a label long enough to wrap somewhere`)].join('\n')
  const text = `Here is the flow.\n\n\`\`\`mermaid\nsequenceDiagram\n${source}\n\`\`\`\n\nDone drawing.`
  for (const columns of [127, 165, 200]) {
    const ui = await $.ui.mount({ plugin: 'mermaid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns, rows: 60, isFullscreen: true } } as never)
    const all = await texts(ui)
    expect(all).toContain('engine: Here is the flow.')
    expect(all).toContain('engine: Done drawing.')
    await ui.unmount()
  }
})
