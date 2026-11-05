import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { asksOf } from '../hooks/asks'
import { renderMarkdown } from '../hooks/blocks'
import type { Block } from '../hooks/markdown'
import { parseBlocks } from '../hooks/message'
import { dark, darkDaltonized, light, lightDaltonized } from '../hooks/palette'
import { renderPrompt } from '../hooks/prompt'
import { spansText } from '../hooks/runs'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const DOCKER = "Docker Desktop requires sign-in before I can run specs since LocalStack is a hard dependency in rails_helper, so I'll write the code now and run tests once that's resolved."

const KIT = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: [] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: [] }),
  Link: (props: Record<string, unknown>) => ({ type: 'Link', props, children: [] }),
} as never

function textOf(b: Block): string {
  if (b.kind === 'paragraph') return spansText(b.spans)
  return b.kind
}

function asked(markdown: string, endsTurn = false): string[] {
  const blocks = parseBlocks(markdown)
  const asks = asksOf(blocks, endsTurn)
  return blocks.filter(b => asks.has(b)).map(textOf)
}

function childrenOf(node: unknown): unknown[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [...(element.children ?? []), ...((element.props?.children as unknown[] | undefined) ?? [])].flat()
}

function plain(node: unknown): string {
  if (typeof node === 'string') return node
  return childrenOf(node).map(plain).join('')
}

function askBars(node: unknown): Drawn[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  const own = element.type === 'Box' && element.props?.backgroundColor === dark.accent ? [element] : []
  return [...own, ...childrenOf(node).flatMap(askBars)]
}

function barredTexts(node: unknown): string[] {
  if (node === null || typeof node !== 'object') return []
  const children = childrenOf(node)
  if (children.some(child => askBars(child).length > 0 && (child as Drawn).props?.width === 1)) return [plain(node)]
  return children.flatMap(barredTexts)
}

describe('asks found by phrase, anywhere in a turn', () => {
  test('finds a blocker the user has to clear before work can go on', () => {
    expect(asked(`Reading the spec helper first.\n\n${DOCKER}`)).toEqual([DOCKER])
  })

  test('finds instructions, requests and waits addressed to the user', () => {
    const asks = [
      "You'll need to run docker login before CI can pull the image.",
      'Can you restart the dev server?',
      'Let me know which branch to use.',
      'Waiting on you to approve the migration.',
      "Once you've signed in to Okta I can query the logs.",
      'Please confirm the card number.',
      'This needs your approval before it ships.',
      'I need you to grant the scope.',
    ]
    expect(asked(asks.join('\n\n'))).toEqual(asks)
  })

  test('leaves narration, conditionals and quoted or coded phrases alone', () => {
    const narration = [
      'Reading the spec helper to see what it loads.',
      'If you need to rotate the key, the script handles it.',
      'When you call `refresh`, the cache resets.',
      'The trigger list covers "let me know" and "can you".',
      'The fixture runs `let me know` through the parser.',
      'That log line will tell me whether the job retried.',
      'Is this the cause? No, the timestamps rule it out.',
    ]
    expect(asked(narration.join('\n\n'))).toEqual([])
  })

  test('leaves phrases inside lists, quotes and code to their own block', () => {
    expect(asked('- let me know\n\n> can you\n\n```\nyou need to\n```')).toEqual([])
  })
})

describe('asks found by a question, only at the end of a turn', () => {
  const reply = 'Specs pass.\n\nWhy does the bar sit outside? So a selection pastes whole.\n\nShall I open the PR?'

  test('marks the closing question of a reply that ends the turn', () => {
    expect(asked(reply, true)).toEqual(['Shall I open the PR?'])
  })

  test('leaves the same question alone mid-turn, where the model carries on', () => {
    expect(asked(reply, false)).toEqual([])
  })

  test('leaves a rhetorical question answered in its own paragraph', () => {
    expect(asked('Why did it fail? The cap is two million.', true)).toEqual([])
  })

  test('marks a closing paragraph that asks the user before a trailing note', () => {
    const closing = 'What do you want to do? If the detector exists, the path helps. ASKDONE'
    expect(asked(`Done.\n\n${closing}`, true)).toEqual([closing])
  })

  test('marks every question of a run that closes the reply, past a list of options', () => {
    expect(asked('Two ways.\n\nWhich do you prefer?\n\n- Keep the YAML\n- Move it to ENV', true)).toEqual(['Which do you prefer?'])
  })

  test('marks a closing list made only of questions', () => {
    expect(asked('Before I start:\n\n- Which branch?\n- Should I squash?', true)).toEqual(['list'])
  })

  test('stops at a heading, so an earlier section keeps its questions plain', () => {
    expect(asked('Is it cached?\n\n## Result\n\nShall I go on?', true)).toEqual(['Shall I go on?'])
  })
})

describe('ask bar', () => {
  test('draws an accent bar beside an asking paragraph only, and keeps its words whole', () => {
    const tree = renderMarkdown({ kit: KIT, palette: dark }, `Reading first.\n\n${DOCKER}`, 80)
    expect(barredTexts(tree)).toEqual([DOCKER])
    const [bar] = askBars(tree)
    expect(bar?.props).toMatchObject({ width: 1, flexShrink: 0 })
  })

  test('draws the ask bar in a different colour from the bar on your prompt, so the two never look alike', () => {
    for (const palette of [dark, light, darkDaltonized, lightDaltonized]) {
      const bars = (node: unknown): string[] => {
        const element = node as Drawn
        const own = element?.type === 'Box' && element.props?.width === 1 && typeof element.props.backgroundColor === 'string' ? [element.props.backgroundColor] : []
        return [...own, ...childrenOf(node).flatMap(bars)]
      }
      const [ask] = bars(renderMarkdown({ kit: KIT, palette }, DOCKER, 80))
      const [prompt] = bars(renderPrompt({ kit: KIT, palette }, 'ship it', 80))
      expect([ask, prompt]).toEqual([palette.accent, palette.prompt])
    }
  })

  test('draws no bar on a reply with no ask', () => {
    expect(askBars(renderMarkdown({ kit: KIT, palette: dark }, 'All specs pass.\n\nShall I go on?', 80))).toEqual([])
  })

  test('narrows the asking paragraph by the bar and its gap, so it wraps inside the column', () => {
    const tree = renderMarkdown({ kit: KIT, palette: dark }, DOCKER, 40)
    const row = childrenOf(tree)[0] as Drawn
    expect(row.props?.width).toBe(40)
    expect(askBars(tree)).toHaveLength(1)
  })
})

function answerTurns(on: On): void {
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('config.list', async () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', provider: { kind: 'engine' }, isLocked: false }] }) as never)
}

async function stored($: Engine, uuid: string, content: { type: string; [field: string]: unknown }[]): Promise<void> {
  await $.session.append({ door: 'response', uuid, origin: { kind: 'model', model: 'm' }, message: { type: 'assistant', role: 'assistant', content } } as never)
}

async function turn($: Engine, rows: [string, { type: string; [field: string]: unknown }[]][], reason: 'answer' | 'aborted' = 'answer'): Promise<void> {
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (const [uuid, content] of rows) await stored($, uuid, content)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't1', reason })
}

async function barsOn($: Engine, requestId: string, text: string): Promise<number> {
  const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true }, viewport: { columns: 80, rows: 20 } } as never)
  const bars = askBars(await ui.drawn()).length
  await ui.unmount()
  return bars
}

const QUESTION = 'Done.\n\nShall I open the PR?'

describe('which reply ends the turn', () => {
  test('marks the closing question of the reply the turn ended on', async ($, on) => {
    answerTurns(on)
    await turn($, [['r1', [{ type: 'text', text: QUESTION }]]])
    expect(await barsOn($, 'r1', QUESTION)).toBe(1)
  })

  test('leaves a question before a tool call plain', async ($, on) => {
    answerTurns(on)
    await turn($, [
      ['r1', [{ type: 'text', text: QUESTION }]],
      ['r2', [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }]],
      ['r3', [{ type: 'text', text: 'All green.' }]],
    ])
    expect(await barsOn($, 'r1', QUESTION)).toBe(0)
  })

  test('leaves the last reply of an interrupted turn plain', async ($, on) => {
    answerTurns(on)
    await turn($, [['r1', [{ type: 'text', text: QUESTION }]]], 'aborted')
    expect(await barsOn($, 'r1', QUESTION)).toBe(0)
  })

  test('still marks a phrased ask in a reply that did not end the turn', async ($, on) => {
    answerTurns(on)
    await turn($, [['r1', [{ type: 'text', text: DOCKER }]], ['r2', [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }]]])
    expect(await barsOn($, 'r1', DOCKER)).toBe(1)
  })
})
