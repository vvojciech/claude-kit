import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const UNFINISHED_ITEM = 'Steps:\n\n1. first\n2.'

function hostBeneath(on: On) {
  on('turn.start', () => ({ turnId: 't' }) as never)
}

async function reply($: Engine, requestId: string) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text: UNFINISHED_ITEM, isFirstOfReply: true }, requestId })
}

async function stored($: Engine, uuid: string) {
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: UNFINISHED_ITEM }] }, door: 'response', origin: { kind: 'model', model: 'm' }, uuid })
}

describe('a reply stored mid-turn', () => {
  test('holds its unfinished last line back while it streams', async ($, on) => {
    hostBeneath(on)
    await $.turn.start({ text: 'go', turnId: 't' } as never)
    const ui = await reply($, 'streaming-reply')
    expect(await ui.find({ type: 'Text', text: '2.' })).toBeUndefined()
  })

  test('draws every line once session.append stores the row whose uuid is its requestId', async ($, on) => {
    hostBeneath(on)
    await $.turn.start({ text: 'go', turnId: 't' } as never)
    await (await reply($, 'stored-reply')).unmount()
    await stored($, 'stored-reply')
    const ui = await reply($, 'stored-reply')
    expect(await ui.find({ type: 'Text', text: '2.' })).toBeDefined()
  })

  test('keeps streaming a reply when a different row is stored', async ($, on) => {
    hostBeneath(on)
    await $.turn.start({ text: 'go', turnId: 't' } as never)
    await (await reply($, 'other-reply')).unmount()
    await stored($, 'some-other-row')
    const ui = await reply($, 'other-reply')
    expect(await ui.find({ type: 'Text', text: '2.' })).toBeUndefined()
  })
})
