import { describe, expect, test } from 'claude-code/testing'

import { renderMarkdown } from '../hooks/blocks'
import { leadHeaderOf } from '../hooks/lead'
import type { LeadSection } from '../hooks/lead'
import { parseBlocks } from '../hooks/message'
import { dark, light } from '../hooks/palette'
import type { Palette } from '../hooks/palette'
import { spansText } from '../hooks/runs'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const KIT = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: [] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: [] }),
  Link: (props: Record<string, unknown>) => ({ type: 'Link', props, children: [] }),
} as never

const ANSWER = 'The timeout comes from the proxy cap, not the retry rules.'

const DECIDE = '**Decide:** 1. Raise the proxy cap 2. Leave it and retry'

const UNSURE = '**Unsure:** the cap likely changed last week (inferred), Staging is unaffected (not checked)'

const FULL = `${ANSWER}\n${DECIDE}\n${UNSURE}\n\nDetail follows here.`

function childrenOf(node: unknown): unknown[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [...(element.children ?? []), ...((element.props?.children as unknown[] | undefined) ?? [])].flat()
}

function plain(node: unknown): string {
  if (typeof node === 'string') return node
  return childrenOf(node).map(plain).join('')
}

function elements(node: unknown, keep: (element: Drawn) => boolean): Drawn[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [...(keep(element) ? [element] : []), ...childrenOf(node).flatMap(child => elements(child, keep))]
}

function texts(node: unknown, text: string): Drawn[] {
  return elements(node, element => element.type === 'Text' && plain(element) === text)
}

function paints(node: unknown, colour: string): Drawn[] {
  return elements(node, element => ['color', 'backgroundColor', 'borderColor'].some(prop => element.props?.[prop] === colour))
}

function drawn(markdown: string, palette: Palette = dark, streaming = false, endsTurn = false): unknown {
  return renderMarkdown({ kit: KIT, palette }, markdown, 80, streaming, undefined, endsTurn)
}

function sectionText(part: LeadSection | undefined): string | undefined {
  return part && [spansText(part.lead), ...part.items.map(item => `${item.marker} ${spansText(item.spans)}`)].join(' | ')
}

function header(markdown: string) {
  const found = leadHeaderOf(parseBlocks(markdown))
  return found === undefined ? undefined : { answer: spansText(found.answer), decide: sectionText(found.decide), unsure: sectionText(found.unsure), size: found.size }
}

function bars(node: unknown, colour: string): Drawn[] {
  return elements(node, element => element.type === 'Box' && element.props?.backgroundColor === colour && element.props?.width === 1)
}

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `w${i}`).join(' ')
}

const LISTED = `${ANSWER}\n**Decide:**\n1. Raise the proxy cap\n2. Leave it and retry\n**Unsure:**\n- the cap changed (inferred)\n- Staging is fine (not checked)\n\nDetail follows here.`

describe('Lead header detection', () => {
  test('finds an answer, Decide and Unsure line', () => {
    expect(header(FULL)).toEqual({ answer: ANSWER, decide: 'Decide: | 1. Raise the proxy cap | 2. Leave it and retry', unsure: 'Unsure: the cap likely changed last week (inferred), Staging is unaffected (not checked)', size: 1 })
  })

  test('finds an answer with Decide only, and an answer with Unsure only', () => {
    expect(header(`${ANSWER}\n${DECIDE}\n\nDetail.`)).toEqual({ answer: ANSWER, decide: 'Decide: | 1. Raise the proxy cap | 2. Leave it and retry', unsure: undefined, size: 1 })
    expect(header(`${ANSWER}\n${UNSURE}`)?.unsure?.startsWith('Unsure: the cap')).toBe(true)
    expect(header(`${ANSWER}\n${UNSURE}`)?.decide).toBeUndefined()
  })

  test('takes a label on its own line with the list under it, lazy label lines included', () => {
    expect(header(LISTED)).toEqual({
      answer: ANSWER,
      decide: 'Decide: | 1. Raise the proxy cap | 2. Leave it and retry',
      unsure: 'Unsure: | - the cap changed (inferred) | - Staging is fine (not checked)',
      size: 3,
    })
    expect(header(`${ANSWER}\n**Decide:**\n1. One\n2. Two\n\n**Unsure:** maybe (inferred)\n\nDetail.`)?.size).toBe(3)
  })

  test('joins a hard-wrapped label line to the label above it', () => {
    expect(header(`${ANSWER}\n**Decide:** raise the cap\nfor every scheme\n**Unsure:** y (inferred)\nstill unsure`)).toMatchObject({ decide: 'Decide: raise the cap for every scheme', unsure: 'Unsure: y (inferred) still unsure' })
  })

  test('leaves the detail list alone after a header line that ends its thought', () => {
    expect(header(`${ANSWER}\n${UNSURE}\n\n- detail one\n- detail two`)?.size).toBe(1)
    expect(header(`${ANSWER}\n**Decide:** pick one:\n1. A\n2. B`)?.size).toBe(2)
  })

  test('leaves a reply with no header alone', () => {
    expect(header(`${ANSWER}\n\nDetail.`)).toBeUndefined()
    expect(header('One line\nand a soft break.')).toBeUndefined()
  })

  test('needs a label on line 2, labels in order, once each', () => {
    expect(header(`${ANSWER}\n${UNSURE}\n${DECIDE}`)).toBeUndefined()
    expect(header(`${ANSWER}\n${DECIDE}\n${DECIDE}`)).toBeUndefined()
    expect(header(`${DECIDE}\n${UNSURE}`)).toBeUndefined()
  })

  test('needs the bold label, exactly', () => {
    expect(header(`${ANSWER}\nDecide: pick one`)).toBeUndefined()
    expect(header(`${ANSWER}\n**Decide: pick one**`)).toBeUndefined()
    expect(header(`${ANSWER}\n*Decide:* pick one`)).toBeUndefined()
  })

  test('only reads the first block of a reply', () => {
    expect(header(`# Title\n\n${ANSWER}\n${DECIDE}`)).toBeUndefined()
    expect(bars(drawn(`Intro.\n\n${ANSWER}\n${DECIDE}`, dark, false, true), dark.muted)).toEqual([])
    expect(bars(drawn(`- ${ANSWER}\n  ${DECIDE}`), dark.muted)).toEqual([])
  })
})

describe('Lead header with blank lines between its lines', () => {
  test('takes Decide only, Unsure only, and both', () => {
    expect(header(`${ANSWER}\n\n${DECIDE}\n\nDetail.`)).toMatchObject({ answer: ANSWER, decide: 'Decide: | 1. Raise the proxy cap | 2. Leave it and retry', size: 2 })
    expect(header(`${ANSWER}\n\n${UNSURE}\n\nDetail.`)).toMatchObject({ answer: ANSWER, size: 2 })
    expect(header(`${ANSWER}\n\n${UNSURE}`)?.decide).toBeUndefined()
    expect(header(`${ANSWER}\n\n${DECIDE}\n\n${UNSURE}\n\nDetail.`)).toMatchObject({ decide: 'Decide: | 1. Raise the proxy cap | 2. Leave it and retry', unsure: 'Unsure: the cap likely changed last week (inferred), Staging is unaffected (not checked)', size: 3 })
    expect(header(`${ANSWER}\n\n**Decide:**\n\n1. One\n2. Two\n\n${UNSURE}`)).toMatchObject({ decide: 'Decide: | 1. One | 2. Two', size: 4 })
  })

  test('draws the loose form like the tight one', () => {
    const tree = drawn(`${ANSWER}\n\n${DECIDE}\n\n${UNSURE}\n\nShall I open the PR?`, dark, false, true)
    expect(bars(tree, dark.muted)).toHaveLength(1)
    expect(paints(tree, dark.accent)).toHaveLength(1)
    expect(texts(tree, ANSWER)[0]?.props?.color).toBe(dark.strong)
  })

  test('needs the label paragraphs right after the answer, in order', () => {
    expect(header(`${ANSWER}\n\nSome other paragraph.\n\n${DECIDE}`)).toBeUndefined()
    expect(header(`${ANSWER}\n\n- a list\n\n${DECIDE}`)).toBeUndefined()
    expect(header(`# Title\n\n${DECIDE}`)).toBeUndefined()
    expect(header(`${ANSWER}\n\n${UNSURE}\n\n${DECIDE}`)?.size).toBe(2)
    expect(header(`${ANSWER}\n\nDecide: plain`)).toBeUndefined()
  })

  test('keeps the answer barred, with no stray markers, while a loose label streams', () => {
    for (const text of [`${ANSWER}\n\n**Deci`, `${ANSWER}\n\n**Decide:**`, `${ANSWER}\n\n**Decide:** Rai`, `${ANSWER}\n\n${DECIDE}\n\n**Uns`, `${ANSWER}\n\n${DECIDE}\n\n**Unsure:** may`]) {
      const tree = drawn(text, dark, true)
      expect({ text, bars: bars(tree, dark.muted).length, stars: plain(tree).includes('*') }).toEqual({ text, bars: 1, stars: false })
    }
  })
})

describe('Lead header edges', () => {
  test('joins a hard-wrapped answer into one answer line', () => {
    expect(header(`The timeout comes from the proxy cap,\nnot the retry rules.\n**Decide:** raise it?`)).toMatchObject({ answer: 'The timeout comes from the proxy cap, not the retry rules.', decide: 'Decide: raise it?' })
    expect(header(`${ANSWER}\nMore answer.\n${DECIDE}`)?.answer).toBe(`${ANSWER} More answer.`)
  })

  test('ends Decide at a finished sentence, leaving the next line as detail', () => {
    const text = `${ANSWER}\n**Decide:** approve the cap?\nThe cap is 2m today.`
    expect(header(text)?.decide).toBe('Decide: approve the cap?')
    const tree = drawn(text, dark, false, true)
    const [bar] = bars(tree, dark.accent)
    const barredRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
    expect(plain(barredRow)).not.toContain('The cap is 2m today.')
    expect(plain(tree)).toContain('The cap is 2m today.')
  })

  test('keeps the closing ask bar when Decide has nothing under it', () => {
    expect(paints(drawn(`${ANSWER}\n**Decide:**\n\nShall I open the PR?`, dark, false, true), dark.accent)).toHaveLength(1)
  })

  test('takes a Decide list with nested items whole, inside the bar', () => {
    const text = `${ANSWER}\n**Decide:**\n1. Approve A?\n   - because x\n2. Approve B?\n\nDetail.\n\nShall I go?`
    expect(header(text)?.size).toBe(2)
    const tree = drawn(text, dark, false, true)
    expect(paints(tree, dark.accent)).toHaveLength(1)
    const [bar] = bars(tree, dark.accent)
    const barredRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
    for (const part of ['Approve A?', 'because x', 'Approve B?']) expect(plain(barredRow)).toContain(part)
    expect(plain(barredRow)).not.toContain('Detail.')
  })

  test('sets the answer apart: bold strong text, and a row between its bar and the Decide bar', () => {
    const tree = drawn(FULL, dark, false, true)
    expect(texts(tree, ANSWER)[0]?.props).toMatchObject({ color: dark.strong, bold: true })
    const [bar] = bars(tree, dark.accent)
    const decideRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
    expect(decideRow?.props?.marginTop).toBe(1)
  })
})

describe('Lead header numbered items', () => {
  const QNUM = `${ANSWER}\n**Decide:** 1. Approve the release note?\n2. Pitch merging to the team? Needs a code change.\n\nDetail.`

  test('keeps numbered lines under a label as its items, whatever they end with', () => {
    expect(header(QNUM)).toMatchObject({ decide: 'Decide: | 1. Approve the release note? | 2. Pitch merging to the team? Needs a code change.', size: 1 })
    expect(leadHeaderOf(parseBlocks(QNUM))?.rest).toBeUndefined()
    expect(header(`${ANSWER}\n**Decide:** 1. Install Lead as your output style.\n2. Then build the header.`)?.decide).toBe('Decide: | 1. Install Lead as your output style. | 2. Then build the header.')
    expect(header(`${ANSWER}\n**Unsure:** 1. X is likely stale (inferred).\n2. Y is unconfirmed (not checked).\n\nDetail.`)).toMatchObject({ unsure: 'Unsure: | 1. X is likely stale (inferred). | 2. Y is unconfirmed (not checked).', size: 1 })
    expect(header(`${ANSWER}\n\n**Decide:** 1. Approve?\n2. Pitch? Needs work.\n\nDetail.`)).toMatchObject({ decide: 'Decide: | 1. Approve? | 2. Pitch? Needs work.', size: 2 })
  })

  test('splits inline numbered items onto their own rows', () => {
    expect(header(`${ANSWER}\n**Decide:** 1. Raise the cap to 5m for every trade 2. Keep the cap`)?.decide).toBe('Decide: | 1. Raise the cap to 5m for every trade | 2. Keep the cap')
    expect(header(`${ANSWER}\n**Decide:** raise it to 5. Then refer`)?.decide).toBe('Decide: raise it to 5. Then refer')
    const tree = drawn(`${ANSWER}\n**Decide:** 1. Raise the cap 2. Keep the cap`, dark, false, true)
    const [bar] = bars(tree, dark.accent)
    const barredRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
    expect(texts(barredRow, 'Raise the cap')).toHaveLength(1)
    expect(texts(barredRow, 'Keep the cap')).toHaveLength(1)
  })

  test('takes the bare label with a numbered list under it, the shape the style asks for', () => {
    const text = `${ANSWER}\n**Decide:**\n1. Approve the text?\n2. Pitch it? Needs work.\n**Unsure:**\n1. X is stale (inferred).\n\nDetail.`
    expect(header(text)).toMatchObject({ decide: 'Decide: | 1. Approve the text? | 2. Pitch it? Needs work.', unsure: 'Unsure: | 1. X is stale (inferred).', size: 2 })
    const tree = drawn(text, dark, false, true)
    expect(paints(tree, dark.accent)).toHaveLength(1)
    expect(texts(tree, '(inferred)')[0]?.props).toMatchObject({ italic: true, color: dark.muted })
  })

  test('streams numbered items without dropping the header or showing markers early', () => {
    for (const text of [`${ANSWER}\n**Decide:** 1. Approve?\n2`, `${ANSWER}\n**Decide:** 1. Approve?\n2.`, `${ANSWER}\n**Decide:** 1. Approve?\n2. Pi`, `${ANSWER}\n**Decide:**\n1. Approve?\n2. Pi`]) {
      const tree = drawn(text, dark, true)
      expect({ text, answer: bars(tree, dark.muted).length, decide: bars(tree, dark.faint).length }).toEqual({ text, answer: 1, decide: 1 })
    }
  })

  test('draws tags in a nested Unsure list italic and muted', () => {
    const tree = drawn(`${ANSWER}\n**Unsure:**\n1. X likely stale (inferred)\n   - sub claim likely (not checked)\n2. Y (inferred)\n\nDetail.`)
    for (const tag of ['(inferred)', '(not checked)']) expect(texts(tree, tag)[0]?.props).toMatchObject({ italic: true })
    expect(elements(tree, element => element.type === 'Text' && plain(element).includes('sub claim')).some(element => element.props?.color === dark.muted)).toBe(true)
  })
})

describe('Lead header and a numbered detail list after it', () => {
  const DETAIL = '\n\n1. Changed config/a.yml\n2. Changed spec/b.rb'

  for (const [name, head] of [
    ['tight Decide', 'Fixed the cap; 12 specs green.\n**Decide:**\n1. Merge web#1?\n2. Deploy today?'],
    ['loose Decide', 'Fixed the cap; 12 specs green.\n\n**Decide:**\n1. Merge web#1?\n2. Deploy today?'],
    ['tight Unsure', 'Fixed the cap; 12 specs green.\n**Unsure:**\n1. Merge web#1?\n2. Deploy today?'],
    ['loose Unsure', 'Fixed the cap; 12 specs green.\n\n**Unsure:**\n1. Merge web#1?\n2. Deploy today?'],
  ] as const) {
    test(`stops the ${name} items at the blank line and draws the rest as detail`, () => {
      const found = header(`${head}${DETAIL}`)
      const items = found?.decide ?? found?.unsure
      expect(items).toBe(`${name.endsWith('Decide') ? 'Decide' : 'Unsure'}: | 1. Merge web#1? | 2. Deploy today?`)
      const tree = drawn(`${head}${DETAIL}`, dark, false, true)
      expect(plain(tree)).toContain('Changed config/a.yml')
      expect(plain(tree)).toContain('1.Changed config/a.yml')
      if (name.endsWith('Decide')) {
        const [bar] = bars(tree, dark.accent)
        const barredRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
        expect(plain(barredRow)).not.toContain('Changed')
      }
    })
  }
})

describe('Lead header with a loose numbered Decide list', () => {
  const LOOSE = `${ANSWER}\n**Decide:**\n1. Raise cap? Needs ops.\n\n2. Keep cap?\n\n**Unsure:** the cap moved (inferred)\n\nDetail.`

  test('keeps a 1., 2. run whole across a blank line, and finds Unsure after it', () => {
    expect(header(LOOSE)).toMatchObject({ decide: 'Decide: | 1. Raise cap? Needs ops. | 2. Keep cap?', unsure: 'Unsure: the cap moved (inferred)' })
    const tree = drawn(LOOSE, dark, false, true)
    const [bar] = bars(tree, dark.accent)
    const barredRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
    for (const part of ['Raise cap? Needs ops.', 'Keep cap?']) expect(plain(barredRow)).toContain(part)
  })

  test('draws nested Decide items written tight without gap rows, when a detail list splits off', () => {
    const found = leadHeaderOf(parseBlocks(`${ANSWER}\n**Decide:**\n1. A? Cost.\n   - sub x\n2. B?\n\n1. Changed a\n2. Changed b`))
    const [list] = found?.decide?.blocks ?? []
    expect(list?.kind === 'list' && list.loose).toBe(false)
    expect(found?.rest?.kind === 'list' && found.rest.loose).toBe(false)
  })

  test('draws a split-off detail list with the numbers as written', () => {
    const tree = drawn(`${ANSWER}\n**Decide:**\n1. Merge?\n2. Deploy?\n\n3. Changed config/a.yml\n\n1. Changed spec/b.rb`, dark, false, true)
    expect(header(`${ANSWER}\n**Decide:**\n1. Merge?\n2. Deploy?\n\n3. Changed config/a.yml\n\n1. Changed spec/b.rb`)?.decide).toBe('Decide: | 1. Merge? | 2. Deploy? | 3. Changed config/a.yml')
    expect(plain(tree)).toContain('1.Changed spec/b.rb')
  })
})

describe('Lead header while streaming', () => {
  test('keeps the header drawn, with no stray markers, while a label is still arriving', () => {
    for (const before of [`${ANSWER}\n${DECIDE}`, ANSWER]) {
      for (const partial of ['*', '**', '**Uns', '**Unsure', '**Unsure:', '**Unsure:*', '**Deci']) {
        const tree = drawn(`${before}\n${partial}`, dark, true)
        const heldByHoldback = before === ANSWER && /^\*+$/.test(partial)
        expect({ partial, bars: bars(tree, dark.muted).length, shown: plain(tree).includes('*') }).toEqual({ partial, bars: heldByHoldback ? 0 : 1, shown: false })
      }
    }
  })

  test('keeps the answer in the same column as the label completes', () => {
    for (const text of [`${ANSWER}\n**Deci`, `${ANSWER}\n**Decide:**`, `${ANSWER}\n**Decide:** Rai`]) expect(bars(drawn(text, dark, true), dark.muted)).toHaveLength(1)
  })

  test('draws a closed partial label as text once more blocks follow', () => {
    expect(plain(drawn(`${ANSWER}\n**Uns\n\nNext.`, dark, true))).toContain('**Uns')
  })

  test('holds back a label arriving inside a header list', () => {
    const tree = drawn(`${ANSWER}\n**Decide:**\n1. One\n2. Two\n**Uns`, dark, true)
    expect(plain(tree)).not.toContain('Uns')
    expect(plain(tree)).toContain('2.Two')
  })
})

describe('Lead header drawing', () => {
  for (const palette of [dark, light]) {
    const name = palette === dark ? 'dark' : 'light'

    test(`bars every answer row in neutral grey and draws the answer strong on ${name}`, () => {
      const tree = drawn(FULL, palette)
      expect(bars(tree, palette.muted)).toHaveLength(1)
      expect(texts(tree, ANSWER)[0]?.props?.color).toBe(palette.strong)
      expect(plain(tree)).not.toContain('▎')
    })

    test(`bars Decide in the ask orange with a strong label once the turn ends on ${name}`, () => {
      const tree = drawn(FULL, palette, false, true)
      expect(bars(tree, palette.accent)).toHaveLength(1)
      expect(paints(tree, palette.accent)).toHaveLength(1)
      expect(elements(tree, element => element.type === 'Text' && element.props?.bold === true && plain(element) === 'Decide:')[0]?.props).toMatchObject({ color: palette.strong })
    })

    test(`bars Decide faint, not orange, mid-turn and while streaming on ${name}`, () => {
      for (const streaming of [true, false]) {
        const tree = drawn(FULL, palette, streaming, false)
        expect(paints(tree, palette.accent)).toEqual([])
        expect(bars(tree, palette.faint)).toHaveLength(1)
      }
    })

    test(`draws Unsure muted, with its tags italic and off chips, on ${name}`, () => {
      const tree = drawn(FULL, palette)
      expect(texts(tree, 'Unsure:')[0]?.props).toMatchObject({ color: palette.muted, bold: true })
      for (const tag of ['(inferred)', '(not checked)']) {
        expect(texts(tree, tag)[0]?.props).toMatchObject({ color: palette.muted, italic: true })
        expect(texts(tree, tag)[0]?.props?.backgroundColor).toBeUndefined()
      }
      const line = elements(tree, element => element.type === 'Text' && plain(element).startsWith('Unsure:'))
      expect(line[0]?.props?.color).toBe(palette.muted)
    })
  }

  test('bars the Decide list items with the label, and tags in Unsure items', () => {
    const tree = drawn(LISTED, dark, false, true)
    const [bar] = bars(tree, dark.accent)
    expect(bars(tree, dark.accent)).toHaveLength(1)
    const barredRow = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
    expect(plain(barredRow)).toContain('1.Raise the proxy cap')
    expect(plain(barredRow)).toContain('2.Leave it and retry')
    expect(texts(tree, '(inferred)')[0]?.props).toMatchObject({ italic: true })
    expect(plain(tree)).toContain('Detail follows here.')
  })

  test('never bars a label with nothing under it', () => {
    const tree = drawn(`${ANSWER}\n**Decide:**\n\nDetail.`, dark, false, true)
    expect(bars(tree, dark.accent)).toEqual([])
    expect(plain(tree)).toContain('Decide:')
  })

  for (const palette of [dark, light]) {
    test(`keeps the orange Decide bar the header's only warm colour on ${palette === dark ? 'dark' : 'light'}`, () => {
      const text = `${ANSWER} **Bold answer**\n**Decide:**\n1. Approve **this**?\n2. Keep \`it\`?\n**Unsure:** a **bold** guess (inferred)`
      const tree = drawn(text, palette, false, true)
      const warm = [palette.title, palette.stress, palette.accent]
      const painted = elements(tree, element => ['color', 'backgroundColor'].some(prop => warm.includes(element.props?.[prop] as string)))
      expect(painted).toEqual(bars(tree, palette.accent))
      expect(painted).toHaveLength(1)
    })
  }

  test('lays the header out for a narrow terminal: bars stretch with wrapped rows, items hang under their indent', () => {
    const tree = renderMarkdown({ kit: KIT, palette: dark }, `${words(12)}\n**Decide:**\n1. ${words(15)}?\n2. Keep it?`, 40, false, undefined, true)
    for (const bar of [...bars(tree, dark.muted), ...bars(tree, dark.accent)]) {
      expect(bar.props).toMatchObject({ width: 1, flexShrink: 0 })
      expect(bar.props?.height).toBeUndefined()
      const row = elements(tree, element => element.type === 'Box' && childrenOf(element).includes(bar)).at(0)
      expect(row?.props).toMatchObject({ flexDirection: 'row' })
      expect(row?.props?.alignItems).toBeUndefined()
    }
    const marker = elements(tree, element => element.type === 'Box' && element.props?.width === 3 && plain(element) === '1.').at(0)
    expect(marker?.props?.flexShrink).toBe(0)
    const item = elements(tree, element => element.type === 'Box' && element.props?.flexDirection === 'row' && childrenOf(element).includes(marker)).at(0)
    expect(childrenOf(item).at(-1)).toMatchObject({ props: { flexGrow: 1 } })
  })

  test('keeps every source character of the header, in order', () => {
    const shown = plain(drawn(FULL))
    for (const line of [ANSWER, 'Decide:', '1.', 'Raise the proxy cap', '2.', 'Leave it and retry', 'Unsure: the cap likely changed last week (inferred), Staging is unaffected (not checked)']) expect(shown).toContain(line)
    expect(shown.indexOf('Decide:')).toBeLessThan(shown.indexOf('Unsure:'))
    expect(shown).toContain('Detail follows here.')
  })

  test('marks an answer line over 30 words, and only then', () => {
    expect(plain(drawn(`${words(31)}\n${DECIDE}`))).toContain('· 31 words')
    expect(plain(drawn(`${words(30)}\n${DECIDE}`))).not.toContain('words')
    expect(texts(drawn(`${words(31)}\n${DECIDE}`), ' · 31 words')[0]?.props?.color).toBe(dark.muted)
  })

  test('draws one orange per reply: the Decide bar replaces the closing ask bar', () => {
    const tree = drawn(`${ANSWER}\n**Decide:** approve the cap\n\nShall I open the PR?`, dark, false, true)
    expect(paints(tree, dark.accent)).toHaveLength(1)
    expect(paints(drawn(`${ANSWER}\n${UNSURE}`), dark.accent)).toEqual([])
    expect(paints(drawn(`${ANSWER}\n${UNSURE}\n\nCan you check?`, dark, false, true), dark.accent)).toHaveLength(1)
    expect(paints(drawn(`${ANSWER}\n${UNSURE}\n\nCan you check?`, dark, false, false), dark.accent)).toHaveLength(1)
  })
})
