import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { gridWidths } from '../hooks/table'

async function draw($: Engine, text: string) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })
}

async function drawAt($: Engine, text: string, columns: number) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns, rows: 50 } } as never)
}

const OUTCOMES = '| Scheme | Trade | PL | EL | PI | Outcome |\n|---|---|---|---|---|---|\n| AXA | Electrician | 2m | 10m | 250k | referred |\n| Hiscox | Plumber | 5m | 10m | 1m | quoted |'

describe('AssistantMessage blocks', () => {
  test('draws a fence inside a list item as code under the item, its language label on its own row', async $ => {
    const ui = await draw($, '1. Add it:\n   ```ts\n   const a = 1\n   ```\n2. Ship')
    expect((await ui.findAll({ type: 'Text', text: /const a = 1/ })).map(c => c.text)).toEqual(['const a = 1'])
    expect((await ui.findAll({ type: 'Text', text: /```/ })).map(c => c.text)).toEqual([])
    expect((await ui.findAll({ type: 'Text', text: 'ts' })).map(c => c.text)).toEqual(['ts'])
    expect(await ui.find({ type: 'Text', text: '2.' })).toBeDefined()
  })

  test('numbers from the list start', async $ => {
    const ui = await draw($, '7. seven\n7. eight')
    expect(await ui.find({ type: 'Text', text: '7.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '8.' })).toBeDefined()
  })

  test('marks every nesting level with a markdown dash, indented under its parent', async $ => {
    const ui = await draw($, '- top\n    - child\n        - grandchild')
    expect((await ui.findAll({ type: 'Text', text: '-' })).length).toBeGreaterThanOrEqual(3)
    expect(await ui.find({ type: 'Text', text: /[•‣–]/ })).toBeUndefined()
    expect(JSON.stringify(await ui.drawn())).toContain('"width":98')
  })

  test('labels a GitHub alert instead of printing its marker', async $ => {
    const ui = await draw($, '> [!WARNING]\n> Mind the gap')
    expect(await ui.find({ type: 'Text', text: 'Warning' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\[!WARNING\]/ })).toBeUndefined()
  })

  test('draws blocks inside a quote behind the quote bar', async $ => {
    const ui = await draw($, '> - item in quote\n>\n> ```\n> quoted code\n> ```')
    expect(await ui.find({ type: 'Text', text: /^- item/ })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text', text: /quoted code/ })).map(c => c.text)).toEqual(['quoted code'])
    expect(await ui.find({ type: 'Text', text: /^▎(\n▎)*$/ })).toBeDefined()
  })

  test('hyperlinks formatted link text and shows images as alt text', async $ => {
    const ui = await draw($, '[**bold link**](https://x.io) ![diagram](arch.png)')
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://x.io')
    expect((await ui.findAll({ type: 'Link' })).length).toBe(1)
    expect(await ui.find({ type: 'Text', text: '[image: diagram]' })).toBeDefined()
  })

  test('draws html-looking prose verbatim', async $ => {
    const ui = await draw($, 'The hook returns Promise<void>; press <Enter>.\n\n<Button variant="primary" />')
    expect(await ui.find({ type: 'Text', text: /Promise<void>; press <Enter>\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /<Button variant="primary" \/>/ })).toBeDefined()
  })

  test('shows a relative link target as a path, not a dead hyperlink', async $ => {
    const ui = await draw($, 'See [the guide](docs/setup.md).')
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'docs/setup.md' })).toBeDefined()
  })

  test('left-aligns a numeric column declared left', async $ => {
    const ui = await draw($, '| Num | Name |\n|:--|:--|\n| 1 | a |\n| 200 | b |')
    expect(await ui.find({ type: 'Text', text: /^1 +a$/ })).toBeDefined()
    const auto = await draw($, '| Num | Name |\n|---|---|\n| 1 | a |\n| 200 | b |')
    expect(await auto.find({ type: 'Text', text: /^ +1 +a$/ })).toBeDefined()
  })

  test('draws a setext heading as a heading, not a literal underline', async $ => {
    const ui = await draw($, 'Title\n=====\n\nbody')
    expect(await ui.find({ type: 'Text', text: '=====' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Title', bold: true, underline: true } as never)).toBeDefined()
  })

  test('gives a hyperlink its text directly, so every wrapped row stays clickable', async $ => {
    const ui = await draw($, 'See [**bold link**](https://x.io) and https://github.com/example/app/pull/1234 now')
    const links = await ui.findAll({ type: 'Link' })
    expect(links.map(link => link.children)).toEqual([['bold link'], ['https://github.com/example/app/pull/1234']])
  })

  test('draws html deletions struck through and html links as links', async $ => {
    const ui = await draw($, 'Price <del>£100</del> £80. See <a href="https://example.com/docs">the setup docs</a>.')
    expect((await ui.find({ type: 'Text', text: /^£100$/ }))?.props.strikethrough).toBe(true)
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://example.com/docs')
  })

  test('keeps a closing setext heading on a finished reply', async $ => {
    const ui = await draw($, 'Body text.\n\nClosing Title\n=============')
    expect(await ui.find({ type: 'Text', text: 'Closing Title', bold: true } as never)).toBeDefined()
  })

  test('stacks a table whose words cannot fit whole rather than splitting them', async $ => {
    const ui = await drawAt($, OUTCOMES, 38)
    expect(await ui.find({ type: 'Text', text: /Outcome: / })).toBeDefined()
  })

  test('keeps the table grid when every word fits', async $ => {
    const ui = await drawAt($, OUTCOMES, 80)
    expect(await ui.find({ type: 'Text', text: /Outcome: / })).toBeUndefined()
  })
})

describe('table column widths', () => {
  test('never narrows a text column below its longest word', async () => {
    expect(gridWidths([{ natural: 30, numeric: false, word: 8 }, { natural: 20, numeric: false, word: 11 }], 25)).toEqual([11, 12])
    expect(gridWidths([{ natural: 30, numeric: false, word: 8 }, { natural: 20, numeric: false, word: 11 }], 20)).toBeUndefined()
  })

  test('lets a word longer than the cap break so long urls still fit a grid', async () => {
    expect(gridWidths([{ natural: 60, numeric: false, word: 60 }, { natural: 4, numeric: true }], 30)).toEqual([24, 4])
  })

  test('treats a column with no word width as before', async () => {
    expect(gridWidths([{ natural: 30, numeric: false }, { natural: 3, numeric: true }], 12)).toEqual([7, 3])
  })
})

