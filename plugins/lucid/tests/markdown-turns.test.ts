import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HEADER_ONLY_TABLE = 'Columns:\n\nname | kind\n-----|-----'

function answerTurns(on: On): void {
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
}

async function startTurn($: Engine, turnId: string): Promise<void> {
  await $.turn.start({ text: 'go', turnId })
}

async function endTurn($: Engine, turnId: string): Promise<void> {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
}

async function drawsTable($: Engine, requestId: string): Promise<boolean> {
  const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', requestId, props: { text: HEADER_ONLY_TABLE, isFirstOfReply: true } } as never)
  const header = await ui.find({ type: 'Text', text: /^name +kind$/ })
  await ui.unmount()
  return header !== undefined
}

describe('streaming holdback follows the turn', () => {
  test('draws every line of a reply shown outside a live turn', async ($, on) => {
    answerTurns(on)
    expect(await drawsTable($, 'resumed')).toBe(true)
  })

  test('holds back a trailing delimiter only while its reply is arriving', async ($, on) => {
    answerTurns(on)
    await startTurn($, 't1')
    expect(await drawsTable($, 'live')).toBe(false)
    await endTurn($, 't1')
    expect(await drawsTable($, 'live')).toBe(true)
  })

  test('never holds back a reply that finished before the turn began', async ($, on) => {
    answerTurns(on)
    expect(await drawsTable($, 'earlier')).toBe(true)
    await startTurn($, 't1')
    expect(await drawsTable($, 'earlier')).toBe(true)
  })
})
