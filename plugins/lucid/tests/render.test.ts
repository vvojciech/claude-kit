import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { parseBlocks } from '../hooks/message'
import { dark, darkDaltonized, groundOfTerminal, light, lightDaltonized, paletteFor } from '../hooks/palette'
import type { Palette } from '../hooks/palette'
import { drawnBlock, quoteBarRows, renderMarkdown, treeSize } from '../hooks/blocks'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

type Pair = { fg: string; bg?: string; text: string }

const DARK_BACKGROUNDS = ['#000000', '#141311', '#0e0d0c', '#181926', '#1e1e1e', '#24273a', '#282c34', '#2e3440']

const LIGHT_BACKGROUNDS = ['#ffffff', '#f5f4f0', '#fafafa', '#eff1f5', '#fdf6e3']

const TUNED = [
  { name: 'dark', palette: dark, backgrounds: DARK_BACKGROUNDS },
  { name: 'light', palette: light, backgrounds: LIGHT_BACKGROUNDS },
  { name: 'dark-daltonized', palette: darkDaltonized, backgrounds: DARK_BACKGROUNDS },
  { name: 'light-daltonized', palette: lightDaltonized, backgrounds: LIGHT_BACKGROUNDS },
] as const


const NON_TEXT_ROLES: (keyof Palette)[] = ['faint', 'accent', 'panel', 'chip']

const PANEL_ROLES: (keyof Palette)[] = ['text', 'strong', 'muted']

const NON_TEXT = /^[━─┄╌▎\n\s]+$/

const GUTTER_GLYPHS = /[●•‣◦✓○]/

function useTheme(on: On, theme: () => string, colorFgBg?: string) {
  on('config.list', async () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme(), provider: { kind: 'engine' }, isLocked: false }] }) as never)
  on('env.get', async (_, e) => ({ value: (e as { name?: string }).name === 'COLORFGBG' ? colorFgBg : undefined }) as never)
}

async function draw($: Engine, text: string, columns = 100) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns, rows: 50 } } as never)
}

async function drawDark($: Engine, on: On, text: string, columns = 100) {
  useTheme(on, () => 'dark')
  return (await draw($, text, columns)).drawn()
}

async function prompt($: Engine, text: string, columns = 80) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'UserMessage', props: { text, origin: { kind: 'composer' } }, viewport: { columns, rows: 40 } } as never)
}

function childrenOf(node: unknown): unknown[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [...(element.children ?? []), ...((element.props?.children as unknown[] | undefined) ?? [])]
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  return childrenOf(node).map(textOf).join('')
}

function walk(node: unknown, visit: (element: Drawn, ancestors: Drawn[]) => void, ancestors: Drawn[] = []): void {
  if (node === null || typeof node !== 'object') return
  const element = node as Drawn
  visit(element, ancestors)
  for (const child of childrenOf(element)) walk(child, visit, [...ancestors, element])
}

function pairs(tree: unknown): Pair[] {
  const found: Pair[] = []
  walk(tree, (element, ancestors) => {
    const fg = element.props?.color
    if (typeof fg !== 'string') return
    const bg = [element, ...ancestors.slice().reverse()].map(a => a.props?.backgroundColor).find(c => typeof c === 'string') as string | undefined
    found.push({ fg: fg.toLowerCase(), bg: bg?.toLowerCase(), text: textOf(element) })
  })
  return found
}

function paints(tree: unknown): string[] {
  const found: string[] = []
  walk(tree, element => {
    for (const prop of ['color', 'backgroundColor', 'borderColor']) {
      const value = element.props?.[prop]
      if (typeof value === 'string') found.push(value)
    }
  })
  return found
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

function findText(tree: unknown, predicate: (text: string, element: Drawn) => boolean): { element: Drawn; ancestors: Drawn[] } | undefined {
  const matches: { element: Drawn; ancestors: Drawn[] }[] = []
  walk(tree, (element, ancestors) => {
    if (element.type === 'Text' && predicate(textOf(element), element)) matches.push({ element, ancestors })
  })
  return matches.find(match => !matches.some(other => other.ancestors.includes(match.element)))
}

function allTexts(tree: unknown, predicate: (text: string) => boolean): Drawn[] {
  const found: { element: Drawn; ancestors: Drawn[] }[] = []
  walk(tree, (element, ancestors) => {
    if (element.type === 'Text' && predicate(textOf(element))) found.push({ element, ancestors })
  })
  return found.filter(match => !found.some(other => other.ancestors.includes(match.element))).map(match => match.element)
}

function topLevelBlocks(tree: unknown): Drawn[] {
  return childrenOf(tree) as Drawn[]
}

function quoteBars(tree: unknown): Drawn[] {
  const bars: Drawn[] = []
  walk(tree, element => {
    if (element.type === 'Box' && element.props?.position === 'absolute' && element.props?.bottom === 0) bars.push(element)
  })
  return bars
}

function barredBy(found: { ancestors: Drawn[] } | undefined): Drawn[] {
  const isBar = (node: unknown) => (node as Drawn).type === 'Box' && (node as Drawn).props?.position === 'absolute' && (node as Drawn).props?.bottom === 0
  return (found?.ancestors ?? []).flatMap(ancestor => childrenOf(ancestor).filter(isBar) as Drawn[])
}

function barColumns(found: { ancestors: Drawn[] } | undefined): number[] {
  const ancestors = found?.ancestors ?? []
  const isBar = (node: unknown) => (node as Drawn).type === 'Box' && (node as Drawn).props?.position === 'absolute' && (node as Drawn).props?.bottom === 0
  return ancestors.flatMap((parent, depth) => {
    const above = ancestors.slice(0, depth).reduce((cells, a) => cells + Number(a.props?.paddingLeft ?? 0) + Number(a.props?.marginLeft ?? 0), 0)
    const edge = above + Number(parent.props?.marginLeft ?? 0)
    return (childrenOf(parent).filter(isBar) as Drawn[]).filter(bar => textOf(bar).includes('▎')).map(bar => edge + Number(bar.props?.left ?? 0))
  })
}

function wrappedSource(tree: unknown, marker: string): { head: string; rest: string; headBox: Record<string, unknown> | undefined } {
  const rest = findText(tree, text => text.includes(marker) && !text.includes('\n'))
  const line = rest?.ancestors.at(-1)
  const headBox = childrenOf(line).find(child => (child as Drawn).props?.position === 'absolute' && (child as Drawn).props?.top === 0) as Drawn | undefined
  return { head: textOf(headBox), rest: textOf(rest?.element), headBox: headBox?.props }
}

function shiftOf(found: { ancestors: Drawn[] } | undefined): number {
  return (found?.ancestors ?? []).reduce((cells, a) => cells + Number(a.props?.paddingLeft ?? 0) + Number(a.props?.marginLeft ?? 0), 0)
}

const SAMPLE = [
  '# One', '## Two', '### Three', '#### Four', '**Bold line**',
  '[pr](https://x.io/1) and \\*literal\\* and `code` and gh pr create --draft',
  '> outer', '> > inner', '> [!NOTE]\n> noted',
  '| a | b | c |', '|:--|:-:|--:|', '| x | y | 1 |',
  '```diff', '-old', '+new', '```',
  '```diff\n@@ -1,1 +1,1 @@\n-a\n+b\n+c\n```',
  '```bash', '$ git status --short | grep x', '```',
  '```ts\n// note\nconst a = "s" // tail\n```',
  '- [x] done', '- [ ] todo', '- plain', '1. one', '---',
].join('\n\n')

describe('AssistantMessage headings', () => {
  test('draws headings as rendered text with no markdown marker, so a selection pastes as prose', async ($, on) => {
    const tree = await drawDark($, on, '# One\n\n## Two\n\n### Three\n\n#### Four\n\n**Bold line**')
    for (const title of ['One', 'Two', 'Three', 'Four']) expect(findText(tree, text => text === title)).toBeDefined()
    expect(findText(tree, text => text.startsWith('#'))).toBeUndefined()
  })

  test('rules only an h1, faint and sized to its title, so h1 and h2 differ by shape and not just by ink', async ($, on) => {
    const tree = await drawDark($, on, `# One\n\n## Second\n\n### Three\n\n#### Four\n\n# ${'word '.repeat(30).trim()}`, 40)
    const rules = allTexts(tree, text => /[─┄╌━]/.test(text))
    expect(rules.map(textOf)).toEqual(['━━━', '━'.repeat(40)])
    for (const rule of rules) expect(rule.props?.color).toBe(dark.faint)
  })

  test('rules an h1 that is the first block, inside a list, and one with no text', async ($, on) => {
    useTheme(on, () => 'dark')
    for (const [text, rule] of [['# Title\n\nbody', '━━━━━'], ['- item\n\n  # Title', '━━━━━'], ['# `a`', '━']] as const) {
      const tree = await (await draw($, text)).drawn()
      expect(allTexts(tree, t => t.startsWith('━')).map(textOf)).toEqual([rule])
    }
  })

  test('sets h1 as bold underlined ink with no fill, so it never reads as an inline code chip', async ($, on) => {
    const tree = await drawDark($, on, '# One\n\n## Two')
    const props = (title: string) => findText(tree, text => text === title)?.element.props ?? {}
    expect(props('One')).toMatchObject({ bold: true, underline: true, color: dark.strong })
    expect(props('One').backgroundColor).toBeUndefined()
    expect(props('Two').backgroundColor).toBeUndefined()
  })

  test('underlines an h2 so it outranks a bold paragraph on its own row, as the first block and inside a list', async ($, on) => {
    useTheme(on, () => 'dark')
    for (const text of ['## Findings\n\n**Summary**', '- item\n\n  ## Findings\n\n  **Summary**']) {
      const tree = await (await draw($, text)).drawn()
      expect(findText(tree, t => t === 'Findings')?.element.props).toMatchObject({ bold: true, underline: true })
      const bold = findText(tree, t => t === 'Summary')
      expect(bold?.element.props?.bold).toBe(true)
      expect(bold?.element.props?.underline).toBeUndefined()
    }
  })

  test('keeps h1 in stronger ink than h2, so the two underlined levels stay apart', async ($, on) => {
    const tree = await drawDark($, on, '# One\n\n## Two')
    expect(findText(tree, t => t === 'One')?.element.props?.color).toBe(dark.strong)
    expect(findText(tree, t => t === 'Two')?.element.props?.color).toBe(dark.text)
  })

  test('opens an h2 that follows prose with the section gap a bold paragraph never gets', async ($, on) => {
    const blocks = topLevelBlocks(await drawDark($, on, 'intro\n\n## Two\n\nbody\n\n**Bold**\n\n### Three\n\n#### Four'))
    expect(blocks.map(b => b.props?.marginTop)).toEqual([0, 2, 1, 1, 1, 1])
  })

  test('opens an h2 under an h1 with the section gap too, so it still outranks the bold paragraph that follows', async ($, on) => {
    const blocks = topLevelBlocks(await drawDark($, on, '# One\n\n## Two\n\n**Bold**'))
    expect(blocks.map(b => b.props?.marginTop)).toEqual([0, 2, 1])
  })

  test('opens an h1 or h2 that follows other blocks with a wider gap than any other block', async ($, on) => {
    const blocks = topLevelBlocks(await drawDark($, on, 'intro\n\n# One\n\n## Two\n\nbody\n\n### Three'))
    expect(blocks.map(b => b.props?.marginTop)).toEqual([0, 2, 2, 1, 1])
  })

  test('keeps italics inline only: no heading level is italic', async ($, on) => {
    const tree = await drawDark($, on, '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five')
    for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) expect(findText(tree, text => text === title)?.element.props?.italic).toBeUndefined()
  })

  test('gives every heading a look no inline span has, and keeps underline for links', async ($, on) => {
    const tree = await drawDark($, on, '# One\n\n## Two\n\n### Three\n\n#### Four\n\n**bold** *italic* `code` [link](https://x.io) plain')
    const look = (title: string) => {
      const props = findText(tree, text => text === title)?.element.props ?? {}
      return JSON.stringify({ bold: props.bold === true, italic: props.italic === true, underline: props.underline === true, color: props.color ?? dark.text, background: props.backgroundColor ?? '' })
    }
    const headings = ['One', 'Two', 'Three', 'Four'].map(look)
    const plain = JSON.stringify({ bold: false, italic: false, underline: false, color: dark.text, background: '' })
    const spans = [plain, ...['bold', 'italic', 'code', 'link'].map(look)]
    expect(new Set(headings).size).toBe(4)
    for (const heading of headings) expect(spans).not.toContain(heading)
    for (const title of ['Three', 'Four']) expect(findText(tree, text => text === title)?.element.props?.underline).toBeUndefined()
    expect(findText(tree, text => text === 'link')?.element.props?.bold).toBeUndefined()
  })

  test('puts a blank line under every heading, so a pasted heading stays its own paragraph', async ($, on) => {
    const blocks = topLevelBlocks(await drawDark($, on, '# One\n\n## Two\n\nbody\n\nnext'))
    expect(blocks.map(b => b.props?.marginTop)).toEqual([0, 2, 1, 1])
  })
})

describe('AssistantMessage copy', () => {
  test('draws prose flush left with no reply bullet, so a selection pastes like stock', async ($, on) => {
    const tree = await drawDark($, on, 'First line of the reply.\n\nSecond paragraph.')
    expect(allTexts(tree, text => GUTTER_GLYPHS.test(text))).toEqual([])
    const first = findText(tree, text => text === 'First line of the reply.')
    for (const ancestor of first?.ancestors ?? []) {
      expect(ancestor.props?.flexDirection).not.toBe('row')
      for (const prop of ['paddingLeft', 'paddingX', 'marginLeft']) expect(ancestor.props?.[prop]).toBeUndefined()
    }
  })

  test('draws list and task markers as the markdown they came from', async ($, on) => {
    const tree = await drawDark($, on, '- [x] shipped\n- [ ] open\n- plain\n  - nested')
    expect(allTexts(tree, text => GUTTER_GLYPHS.test(text))).toEqual([])
    expect(allTexts(tree, text => text === '- [x]')).toHaveLength(1)
    expect(allTexts(tree, text => text === '- [ ]')).toHaveLength(1)
    expect(allTexts(tree, text => text === '-')).toHaveLength(2)
    expect(findText(tree, text => text === '[x]')?.element.props?.color).toBe(dark.done)
  })

  test('greys a done task without the faint attribute', async ($, on) => {
    const tree = await drawDark($, on, '- [x] shipped it')
    expect(findText(tree, text => text === 'shipped it')?.element.props?.color).toBe(dark.muted)
    walk(tree, element => expect(element.props?.dimColor).toBeUndefined())
  })

  test('keeps a list usable at three columns', async ($, on) => {
    const tree = await drawDark($, on, '- a\n- b\n\n1. one', 3)
    walk(tree, element => {
      if (typeof element.props?.width === 'number') expect(element.props.width).toBeGreaterThanOrEqual(1)
    })
    expect(findText(tree, text => text === 'b')).toBeDefined()
  })
})

describe('AssistantMessage inline', () => {
  test('draws links as hyperlinks in ink with an underline, and escapes as text', async ($, on) => {
    useTheme(on, () => 'dark')
    const ui = await draw($, SAMPLE)
    const link = await ui.find({ type: 'Link' })
    expect(link?.props.href).toBe('https://x.io/1')
    expect(findText(await ui.drawn(), text => text === 'pr')?.element.props).toMatchObject({ color: dark.strong, underline: true })
    expect(await ui.find({ type: 'Text', text: /\*literal\*/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\\/ })).toBeUndefined()
  })

  test('sets inline code on a panel chip, which a selection does not copy', async ($, on) => {
    const tree = await drawDark($, on, 'run `make test` then `bin/x --fast` now')
    expect(findText(tree, text => text === 'make test')?.element.props).toMatchObject({ backgroundColor: dark.panel })
    for (const part of ['bin/x', ' ', '--fast']) expect(findText(tree, text => text === part)?.element.props?.backgroundColor).toBe(dark.panel)
    expect(findText(tree, text => text.startsWith(' then'))?.element).toBeUndefined()
  })

  test('merges neighbouring words of one style into one run', async ($, on) => {
    const tree = await drawDark($, on, 'plain words here and **bold one two** end')
    const paragraph = findText(tree, text => text.startsWith('plain'))
    expect(childrenOf(paragraph?.element)).toHaveLength(3)
  })
})

describe('AssistantMessage code', () => {
  test('never hands code to the host highlighter', async $ => {
    expect(await (await draw($, SAMPLE)).findAll({ type: 'Code' })).toHaveLength(0)
  })

  test('marks keywords by weight and comments muted italic, and leaves strings plain', async ($, on) => {
    const tree = await drawDark($, on, '```ts\n// note\nconst a = "s"\n```')
    const keyword = findText(tree, (text, e) => text.startsWith('const') && e.props?.bold === true)?.element
    expect(keyword?.props?.color).toBeUndefined()
    const comment = findText(tree, text => text.startsWith('// note'))?.element
    expect([comment?.props?.color, comment?.props?.italic]).toEqual([dark.muted, true])
    expect(findText(tree, text => text.includes('"s"'))?.element.props?.color).toBe(dark.text)
  })

  test('keeps a comment marker inside a string out of comment colour', async ($, on) => {
    const tree = await drawDark($, on, '```py\nurl = "http://x#y"  # real\n```')
    expect(findText(tree, text => text.includes('"http://x#y"'))?.element.props?.italic).toBeUndefined()
    expect(findText(tree, text => text.startsWith('# real'))?.element.props?.italic).toBe(true)
  })

  test('carries a block comment across lines', async ($, on) => {
    const tree = await drawDark($, on, '```js\n/* one\ntwo */ x\n```')
    expect(findText(tree, text => text.startsWith('/* one\ntwo */'))?.element.props?.italic).toBe(true)
  })

  test('draws the source flush left in the same column as prose, so a selection pastes the source', async ($, on) => {
    const source = 'def refer?(limit, requested)\n  return false if limit.nil?\nend'
    const tree = await drawDark($, on, `Intro\n\n\`\`\`ruby\n${source}\n\`\`\``)
    const body = findText(tree, text => text === source)
    expect(body).toBeDefined()
    for (const ancestor of body?.ancestors ?? []) {
      expect(ancestor.props?.flexDirection).not.toBe('row')
      for (const prop of ['paddingX', 'paddingLeft', 'marginLeft', 'backgroundColor', 'borderStyle', 'width']) expect(ancestor.props?.[prop]).toBeUndefined()
    }
  })

  test('labels a code block with its language in muted text, invents no label for an unlabelled one, and draws no markdown fence', async ($, on) => {
    const tree = await drawDark($, on, 'Before.\n\n```\nplain one-liner\n```\n\n```ruby\na\nb\n```')
    expect(allTexts(tree, text => text.includes('```'))).toEqual([])
    expect(findText(tree, text => text === 'ruby')?.element.props?.color).toBe(dark.muted)
    expect(findText(tree, text => text === 'code')).toBeUndefined()
    expect(findText(tree, text => text === 'plain one-liner')).toBeDefined()
    expect(findText(tree, text => text === 'a\nb')).toBeDefined()
  })

  test('draws a block that holds a fence with its inner fence as written', async ($, on) => {
    const tree = await drawDark($, on, '````md\n```js\nx\n```\n````')
    expect(findText(tree, text => text === 'md')).toBeDefined()
    expect(findText(tree, text => text === '```js\nx\n```')).toBeDefined()
  })

  test('draws a one-line shell command exactly as written', async ($, on) => {
    const tree = await drawDark($, on, '```bash\n$ git checkout -b fix && gh pr create --draft\n```')
    expect(findText(tree, text => text === '$ git checkout -b fix && gh pr create --draft')).toBeDefined()
    expect(findText(tree, text => text.includes('>_') || text.includes('· '))).toBeUndefined()
  })

  test('leaves the rest of a long line whole for the terminal to soft-wrap, so a selection pastes the exact source', async ($, on) => {
    const line = '  requested > limit && "over" && some_really_long_identifier_name_here && another'
    const tree = await drawDark($, on, '```ruby\n' + line + '\nend\n```', 40)
    const wrapped = wrappedSource(tree, 'requested')
    expect(wrapped.head + wrapped.rest).toBe(line)
    expect(wrapped.head).toBe('  ')
    expect(allTexts(tree, text => text === 'end')).toHaveLength(1)
  })

  test('marks every continuation row of a wrapped code line in a faint gutter beside the text, outside the soft-wrapped source', async ($, on) => {
    const line = 'def premium_for(quote) = quote.covers.sum { |cover| cover.net_premium * cover.loading_factor }'
    const tree = await drawDark($, on, '```ruby\nshort\n' + line + '\n\nend\n```', 40)
    const marks = findText(tree, text => /^(↪\n)*↪$/.test(text))
    expect(marks?.element.props?.color).toBe(dark.faint)
    expect(marks?.ancestors.at(-1)?.props).toMatchObject({ position: 'absolute', left: 0, top: 1, bottom: 0, width: 1, overflow: 'hidden' })
    expect(marks?.ancestors.at(-2)?.props).toMatchObject({ width: 40, paddingLeft: 2 })
    expect(textOf(marks?.element).split('\n').length).toBeGreaterThanOrEqual(Math.ceil((line.length - 2) / 38) - 1)
    const wrapped = wrappedSource(tree, 'premium_for')
    expect(wrapped.head + wrapped.rest).toBe(line)
    expect(wrapped.headBox).toMatchObject({ position: 'absolute', left: 0, top: 0, width: 2, height: 1 })
    expect(allTexts(tree, text => text.includes('↩'))).toEqual([])
    expect(allTexts(tree, text => text.includes('short') || text === ' ' || text === '\nend').map(textOf)).toEqual(['short', '\nend'])
  })

  test('keeps the source tones on the first two cells it lifts into the gutter', async ($, on) => {
    const tree = await drawDark($, on, '```ts\n// ' + 'note '.repeat(12) + '\n```', 40)
    const head = findText(tree, text => text === '//')
    expect(head?.ancestors.some(a => a.props?.position === 'absolute' && a.props?.width === 2)).toBe(true)
    expect(head?.element.props).toMatchObject({ color: dark.muted, italic: true })
  })

  test('draws a wrapped line that opens with a tab or a wide glyph whole, with no gutter', async ($, on) => {
    useTheme(on, () => 'dark')
    for (const line of ['\tgo build ./... && echo ok && echo more words here', '漢字 ' + 'word '.repeat(12)]) {
      const tree = await (await draw($, '```\n' + line + '\n```', 40)).drawn()
      expect(allTexts(tree, text => text.includes('↪'))).toEqual([])
      expect(allTexts(tree, text => text.includes('word') || text.includes('go build')).map(textOf)).toEqual([line])
    }
  })

  test('marks no row of a code line that fits the width exactly', async ($, on) => {
    const fits = await drawDark($, on, '```\n' + 'x'.repeat(40) + '\n```', 40)
    expect(allTexts(fits, text => text.includes('↩'))).toEqual([])
  })

  test('marks no row in a block too narrow to spare a column for the mark', async ($, on) => {
    const narrow = await drawDark($, on, '```\nabcdef ghijkl\n```', 2)
    expect(allTexts(narrow, text => text.includes('↩'))).toEqual([])
  })

  test('counts a tab as a tab stop when deciding that a code line wraps', async ($, on) => {
    const tree = await drawDark($, on, '```make\nbuild:\nab\t\t\t\tgo build ./... && echo ok\n```', 40)
    expect(allTexts(tree, text => text.includes('↪')).length).toBe(1)
  })

  test('adds no row break to a line with no spaces wider than the terminal', async ($, on) => {
    const tree = await drawDark($, on, '```\n' + 'x'.repeat(50) + '\n```', 20)
    const wrapped = wrappedSource(tree, 'xxx')
    expect(wrapped.head + wrapped.rest).toBe('x'.repeat(50))
  })
})

describe('AssistantMessage diffs', () => {
  test('colours a diff with no hunk header line by line', async ($, on) => {
    const tree = await drawDark($, on, '```diff\n-old\n+new\n```')
    expect(findText(tree, text => text.startsWith('-old'))?.element.props?.color).toBe(dark.removed)
    expect(findText(tree, text => text.startsWith('+new'))?.element.props?.color).toBe(dark.added)
  })

  test('colours every line of a hunk whose header miscounts its lines', async ($, on) => {
    useTheme(on, () => 'dark')
    const ui = await draw($, '```diff\n--- a/x.rb\n+++ b/x.rb\n@@ -1,1 +1,1 @@\n-a\n+b\n+c\n```')
    const tree = await ui.drawn()
    expect(await ui.findAll({ type: 'Code' })).toHaveLength(0)
    expect(findText(tree, text => text === 'diff')).toBeDefined()
    expect(findText(tree, text => text.startsWith('-a'))?.element.props?.color).toBe(dark.removed)
    expect(findText(tree, text => text.startsWith('+b\n+c'))?.element.props?.color).toBe(dark.added)
    expect(findText(tree, text => text.startsWith('@@'))?.element.props?.color).toBe(dark.muted)
  })
})

describe('AssistantMessage quotes', () => {
  test('nests one bar per level instead of showing a literal marker', async ($, on) => {
    const tree = await drawDark($, on, '> outer\n>\n> > inner')
    expect(findText(tree, text => text.includes('inner'))?.element).toBeDefined()
    expect(allTexts(tree, text => text.includes('>'))).toEqual([])
    expect(quoteBars(tree)).toHaveLength(2)
  })

  test('runs the bar down every wrapped row of a long quote', async ($, on) => {
    const long = 'This is a long blockquote line that should wrap at narrow widths, and every wrapped row of it ought to keep the quote bar.'
    const tree = await drawDark($, on, `> ${long}`, 40)
    const [bar] = quoteBars(tree)
    expect(bar?.props).toMatchObject({ left: 0, top: 0, bottom: 0, width: 1, overflow: 'hidden' })
    const rows = textOf(bar).split('\n')
    expect(rows.length).toBeGreaterThanOrEqual(Math.ceil(long.length / 38))
    expect(new Set(rows)).toEqual(new Set(['▎']))
    expect(findText(tree, text => text === '▎' || text.startsWith('▎\n'))?.element.props?.color).toBe(dark.faint)
  })

  test('runs the bar past a stacked table inside the quote, and counts the rows of quoted code', async ($, on) => {
    const rows = Array.from({ length: 6 }, (_, i) => `> | name ${i} long words here | value ${i} more words | note ${i} |`).join('\n')
    const table = `> | name | value | note |\n> |---|---|---|\n${rows}`
    const code = '> ```ts\n' + Array.from({ length: 40 }, (_, i) => `> const line${i} = ${i}`).join('\n') + '\n> ```'
    const stackedLines = 6 * 3 + 5
    const [tableQuote] = parseBlocks(table)
    const [codeQuote] = parseBlocks(code)
    expect(tableQuote?.kind).toBe('quote')
    expect(quoteBarRows(tableQuote as never, 24)).toBeGreaterThanOrEqual(stackedLines)
    expect(quoteBarRows(codeQuote as never, 24)).toBeGreaterThanOrEqual(41)
    const [bar] = quoteBars(await drawDark($, on, table, 24))
    expect(textOf(bar).split('\n').length).toBeGreaterThanOrEqual(stackedLines)
  })

  test('draws code in a quote with no bar beside it, so its lines paste as written', async ($, on) => {
    const tree = await drawDark($, on, '> before\n>\n> ```sh\n> echo quoted\n> ```\n>\n> after', 40)
    const bars = quoteBars(tree).map(bar => textOf(bar).split('\n').length)
    expect(bars).toEqual([1, 1, 1, 1])
    expect(barredBy(findText(tree, text => text === 'echo quoted'))).toEqual([])
    const source = findText(tree, text => text === 'echo quoted')
    for (const ancestor of source?.ancestors ?? []) expect(ancestor.props?.paddingLeft ?? 0).toBe(0)
  })

  test('pulls code in a quote in a list back to the first column', async ($, on) => {
    const tree = await drawDark($, on, '- item\n\n  > ```py\n  > def f():\n  >     return 1\n  > ```', 40)
    const source = findText(tree, text => text.startsWith('def f'))
    const shift = (source?.ancestors ?? []).reduce((cells, a) => cells + Number(a.props?.paddingLeft ?? 0) + Number(a.props?.marginLeft ?? 0), 0)
    expect(textOf(source?.element)).toBe('def f():\n    return 1')
    expect(shift).toBe(0)
  })

  test('keeps code in a list in a quote whole, at the first column, with no quote bar painted over it', async ($, on) => {
    useTheme(on, () => 'dark')
    for (const columns of [40, 110]) {
      const tree = await (await draw($, '> - item in quote\n>\n>   ```sh\n>   echo in quote list\n>   ```\n>\n> after', columns)).drawn()
      const source = findText(tree, text => text.includes('cho in quote list'))
      expect(textOf(source?.element)).toBe('echo in quote list')
      expect(shiftOf(source)).toBe(0)
      expect(barredBy(source)).toEqual([])
      expect(findText(tree, text => text === 'item in quote')).toBeDefined()
      expect(findText(tree, text => text === 'after')).toBeDefined()
    }
  })

  test('keeps the quote bar at the first column on every prose row of a quote whose list holds code', async ($, on) => {
    useTheme(on, () => 'dark')
    for (const columns of [40, 110]) {
      const text = '> Quote intro line.\n>\n> - item in quote\n>\n>   ```sh\n>   echo in quote list\n>   ```\n>\n> - second quoted item'
      const tree = await (await draw($, text, columns)).drawn()
      for (const prose of ['Quote intro line.', 'item in quote', 'second quoted item']) {
        const columnsOfBars = barColumns(findText(tree, t => t === prose))
        expect(columnsOfBars).toEqual([0])
      }
      expect(barredBy(findText(tree, t => t.includes('cho in quote list')))).toEqual([])
    }
  })

  test('runs the quote bar through the blank rows between the children of a quote whose list holds code', async ($, on) => {
    useTheme(on, () => 'dark')
    for (const columns of [40, 110]) {
      const tree = await (await draw($, '> Quote intro line.\n>\n> - item in quote\n>\n>   ```sh\n>   echo in quote list\n>   ```\n>\n> - second quoted item', columns)).drawn()
      const gapBars: number[] = []
      walk(tree, (element, ancestors) => {
        const [gap, bar] = ancestors.slice(-2)
        if (element.type !== 'Text' || textOf(element) !== '▎' || gap?.props?.height === undefined) return
        gapBars.push(shiftOf({ ancestors: ancestors.slice(0, -1) }) + Number(bar?.props?.left ?? 0))
      })
      expect(gapBars).toEqual([0, 0, 0])
      expect(barredBy(findText(tree, t => t.includes('cho in quote list')))).toEqual([])
    }
  })

  test('leaves the gaps of an unquoted list holding code bare', async ($, on) => {
    const tree = await drawDark($, on, '- item\n\n  ```sh\n  echo x\n  ```\n\n- next', 40)
    expect(allTexts(tree, t => t.includes('▎'))).toEqual([])
  })

  test('keeps both bars on prose of a nested quote whose outer quote holds code', async ($, on) => {
    const tree = await drawDark($, on, '> - item\n>\n>   > nested words\n>\n>   ```sh\n>   echo x\n>   ```', 40)
    expect(barColumns(findText(tree, t => t === 'nested words')).sort((a, b) => a - b)).toEqual([0, 4])
    expect(barredBy(findText(tree, t => t === 'echo x'))).toEqual([])
  })

  test('keeps code in a quote in a list in a quote whole at the first column', async ($, on) => {
    const tree = await drawDark($, on, '> - item\n>\n>   > ```py\n>   > x = 1\n>   > ```', 40)
    const source = findText(tree, text => text === 'x = 1')
    expect(shiftOf(source)).toBe(0)
    expect(barredBy(source)).toEqual([])
  })

  test('ties code pulled out of a quote back to it with a faint bar on the language row only', async ($, on) => {
    const tree = await drawDark($, on, '> before\n>\n> ```sh\n> echo quoted\n> ```', 40)
    const cue = findText(tree, text => text === '▎')
    expect(cue?.element.props?.color).toBe(dark.faint)
    expect(cue?.ancestors.at(-1)?.props).toMatchObject({ position: 'absolute', left: 0, top: 0 })
    expect(cue?.ancestors.at(-2)?.props?.paddingLeft).toBe(2)
    expect(findText(tree, text => text === 'sh')?.element.props?.color).toBe(dark.muted)
    expect(textOf(findText(tree, text => text.startsWith('echo') && text.endsWith('quoted'))?.element)).toBe('echo quoted')
  })

  test('indents the language label of list code to the item, as padding rather than text', async ($, on) => {
    const tree = await drawDark($, on, '- item\n\n  ```sh\n  echo listed\n  ```', 40)
    const labelled = findText(tree, text => text === 'sh')
    expect(labelled?.ancestors.at(-1)?.props?.paddingLeft).toBe(2)
    expect(allTexts(tree, text => text.trim() === '' && text.length > 0 && text !== ' ')).toEqual([])
  })

  test('counts nothing for an empty quote but its alert label', () => {
    expect(quoteBarRows({ kind: 'quote', blocks: [] }, 40)).toBe(0)
    expect(quoteBarRows({ kind: 'quote', alert: 'note', blocks: [] }, 1)).toBe(1)
  })

  test('draws quoted text quieter than prose', async ($, on) => {
    const tree = await drawDark($, on, '> cited words')
    expect(findText(tree, text => text === 'cited words')?.element.props?.color).toBe(dark.muted)
  })
})

describe('AssistantMessage tables', () => {
  const wide = [
    '| Scheme | Trade | PL cap | EL cap | PI cap | Requested | Outcome | Reason | Notes |',
    '|---|---|--:|--:|--:|--:|---|---|---|',
    '| AXA | Electricians - commercial | 2,000,000 | 10,000,000 | 250,000 | 5,000,000 | referred | MSI cap | YAML |',
    '| Hiscox | Plumbers | 5,000,000 | 10,000,000 | 500,000 | 5,000,000 | quoted | none | ok |',
  ].join('\n')

  test('stacks each row as header: value lines when the columns cannot fit', async $ => {
    const tree = await (await draw($, wide, 40)).drawn()
    for (const header of ['Scheme', 'Trade', 'PL cap', 'Requested', 'Outcome', 'Reason', 'Notes']) {
      expect(pairs(tree).filter(p => p.text === `${header}: `)).toHaveLength(2)
    }
    for (const value of ['2,000,000', '10,000,000', '250,000', 'referred', 'MSI cap', 'YAML']) expect(findText(tree, text => text.endsWith(value))).toBeDefined()
  })

  test('keeps the grid and every numeric cell whole when the table fits', async $ => {
    const tree = await (await draw($, wide, 140)).drawn()
    expect(findText(tree, text => text.includes('Scheme') && text.includes('Notes'))).toBeDefined()
    expect(findText(tree, text => /2,000,000\s+10,000,000\s+250,000\s+5,000,000/.test(text))).toBeDefined()
  })

  test('shrinks text columns before numbers', async $ => {
    const tree = await (await draw($, wide, 100)).drawn()
    walk(tree, element => {
      if (element.type !== 'Box' || typeof element.props?.width !== 'number') return
      const text = textOf(element)
      if (/^[\d,]+$/.test(text)) expect(element.props.width).toBeGreaterThanOrEqual(text.length)
    })
    for (const number of ['2,000,000', '10,000,000', '250,000']) expect(findText(tree, text => text.includes(number))).toBeDefined()
  })

  test('measures emoji as two cells so a cell of them stays on one line', async $ => {
    const tree = await (await draw($, '| Owner | Status |\n|---|---|\n| 👨‍👩‍👧 team | ✅✅✅ |\n| solo | ⭐⭐ |')).drawn()
    expect(findText(tree, text => text === '👨‍👩‍👧 team  ✅✅✅')).toBeDefined()
    expect(findText(tree, text => text === 'solo     ⭐⭐')).toBeDefined()
  })
})

describe('AssistantMessage size', () => {
  const nodesOf = async (ui: Awaited<ReturnType<typeof draw>>) => treeSize((await ui.drawn()) as never)

  test('draws a 2,000-line shell block within the engine node and depth limits', async $ => {
    const lines = Array.from({ length: 2000 }, (_, i) => `ls -la out/${i} | grep "x"`)
    const ui = await draw($, '```bash\n' + lines.join('\n') + '\n```')
    const size = await nodesOf(ui)
    expect(size.nodes).toBeLessThan(20000)
    expect(size.depth).toBeLessThanOrEqual(32)
    expect(findText(await ui.drawn(), text => text.includes('out/1999 |'))).toBeDefined()
  })

  test('draws a 2,000-row table within the node limit and keeps every row', async $ => {
    const rows = Array.from({ length: 2000 }, (_, i) => `| row ${i} | ${i * 7} | **x** | \`y\` | z |`)
    const ui = await draw($, '| a | b | c | d | e |\n|---|--:|---|---|---|\n' + rows.join('\n'))
    expect((await nodesOf(ui)).nodes).toBeLessThan(20000)
    expect(findText(await ui.drawn(), text => text.includes('row 1999'))).toBeDefined()
  })

  test('falls back to plain text for a block past the budget and keeps the blocks before it styled', async ($, on) => {
    useTheme(on, () => 'dark')
    const rows = Array.from({ length: 4000 }, (_, i) => `| **r ${i}** | \`c\` |`)
    const ui = await draw($, 'intro `styled`\n\n| a | b |\n|---|---|\n' + rows.join('\n'))
    const tree = await ui.drawn()
    expect((await nodesOf(ui)).nodes).toBeLessThan(20000)
    expect(findText(tree, text => text === 'styled')?.element.props?.backgroundColor).toBe(dark.panel)
    expect(findText(tree, text => text.startsWith('a  b\nr 0  c') && text.endsWith('r 3999  c'))).toBeDefined()
  })

  test('counts its own row boxes, so thousands of short blocks stay under the engine limit', async $ => {
    for (const text of [Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n\n'), Array.from({ length: 2500 }, (_, i) => `## H${i}\n\ntext ${i}`).join('\n\n')]) {
      const ui = await draw($, text)
      const size = await nodesOf(ui)
      expect(size.nodes).toBeLessThan(20000)
      expect(findText(await ui.drawn(), t => t.includes('line 4999') || t.includes('text 2499'))).toBeDefined()
    }
  })

  test('draws 150KB of linked prose within the node limit', async $ => {
    const paragraph = Array.from({ length: 40 }, (_, i) => `see [link ${i}](https://x.io/${i}) and \`code ${i}\` then **bold** text`).join(' ')
    const text = Array.from({ length: 60 }, () => paragraph).join('\n\n')
    expect(text.length).toBeGreaterThan(100000)
    const ui = await draw($, text)
    expect((await nodesOf(ui)).nodes).toBeLessThan(20000)
  })

  test('keeps items past the nesting limit styled, each with its own muted marker and hanging indent', async ($, on) => {
    const nested = Array.from({ length: 12 }, (_, i) => `${'  '.repeat(i)}- level ${i} text that wraps at narrow widths`).join('\n')
    const tree = await drawDark($, on, nested, 40)
    for (const i of [8, 9, 10, 11]) {
      const item = findText(tree, text => text === `level ${i} text that wraps at narrow widths`)
      expect(item?.element.props?.color).toBe(dark.text)
      const body = item?.ancestors.findLast(a => typeof a.props?.paddingLeft === 'number' && a.props.paddingLeft > 0)
      expect(body?.props?.paddingLeft).toBe(2)
    }
    expect(allTexts(tree, text => /^- level/.test(text))).toEqual([])
    expect(allTexts(tree, text => text === '-').length).toBe(12)
  })

  test('draws a deeply nested list within the depth limit', async $ => {
    const nested = Array.from({ length: 12 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n')
    const ui = await draw($, nested)
    expect((await nodesOf(ui)).depth).toBeLessThanOrEqual(32)
    expect(findText(await ui.drawn(), text => text.includes('level 11'))).toBeDefined()
  })
})

describe('AssistantMessage streaming', () => {
  const rich = 'Edit `app/models/policy.rb:10`, run `bundle exec rspec spec/x_spec.rb`, see **this** and *that* at https://x.io/a. '

  test('reuses every settled block when the reply grows by a token', () => {
    const blocks = parseBlocks(Array.from({ length: 50 }, (_, i) => `${rich} ${i}`).join('\n\n'))
    const grown = parseBlocks(Array.from({ length: 50 }, (_, i) => `${rich} ${i}`).join('\n\n') + ' more')
    const before = blocks.map(b => drawnBlock({ kit: KIT, palette: dark }, b, 100).node)
    const after = grown.map(b => drawnBlock({ kit: KIT, palette: dark }, b, 100).node)
    expect(after.slice(0, -1).every((node, i) => node === before[i])).toBe(true)
    expect(after.at(-1)).not.toBe(before.at(-1))
    expect(drawnBlock({ kit: KIT, palette: light }, blocks[0] as never, 100).node).not.toBe(before[0])
    expect(drawnBlock({ kit: KIT, palette: dark }, blocks[0] as never, 60).node).not.toBe(before[0])
  })

  test('redraws a 100KB reply that grew by one token in a fraction of a full draw', () => {
    const text = Array.from({ length: 850 }, (_, i) => `${rich} ${i}`).join('\n\n')
    const time = (body: string) => {
      parseBlocks(body)
      const started = performance.now()
      renderMarkdown({ kit: KIT, palette: dark }, body, 100)
      return performance.now() - started
    }
    const full = time(text)
    const grown = Math.min(time(`${text} x`), time(`${text} x y`))
    expect(grown).toBeLessThan(full / 2)
  })
})

const KIT = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: [] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: [] }),
  Link: (props: Record<string, unknown>) => ({ type: 'Link', props, children: [] }),
} as never

describe('UserMessage', () => {
  test('marks the turn with the accent bar on a panel as wide as the terminal', async ($, on) => {
    useTheme(on, () => 'dark')
    const tree = await (await prompt($, 'ship it', 200)).drawn()
    const row = tree as Drawn
    expect(row.props?.width).toBe(200)
    expect(pairs(tree).some(p => p.bg === dark.panel)).toBe(true)
    expect(paints(tree)).toContain(dark.accent)
  })

  test('keeps the first line of a paste-only prompt so the request stays readable', async $ => {
    const body = '\n\n  Reply with exactly the markdown between the BEGIN and END lines as your whole answer, verbatim\nsecond'
    const tree = await (await prompt($, `<pasted_content id="1">${body}</pasted_content id="1">`)).drawn()
    const text = textOf(tree)
    expect(text.startsWith('[pasted 2 lines] Reply with exactly the markdown')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toContain('second')
  })

  test('clips the paste preview to one row of a narrow panel', async $ => {
    const tree = await (await prompt($, `<pasted_content id="1">${'word '.repeat(30)}</pasted_content id="1">`, 40)).drawn()
    expect(textOf(tree).length).toBeLessThanOrEqual(40 - 3)
    expect(textOf(tree).endsWith('…')).toBe(true)
  })

  test('shows only the count when the paste sits inside typed text', async $ => {
    const tree = await (await prompt($, 'look <pasted_content id="1">a\nb</pasted_content id="1"> thanks')).drawn()
    expect(textOf(tree)).toBe('look [pasted 2 lines] thanks')
  })
})

describe('theme', () => {
  for (const theme of TUNED) {
    test(`draws only ${theme.name} palette colours`, async ($, on) => {
      useTheme(on, () => theme.name)
      const allowed = new Set(Object.values(theme.palette).map(c => c.toLowerCase()))
      const used = paints(await (await draw($, SAMPLE)).drawn()).map(c => c.toLowerCase())
      expect(used).toContain(theme.palette.removed.toLowerCase())
      expect(used.filter(c => !allowed.has(c))).toEqual([])
    })

    test(`keeps every ${theme.name} pair drawn at AA, and rules and bars at 3:1`, async ($, on) => {
      useTheme(on, () => theme.name)
      const message = await (await draw($, SAMPLE)).drawn()
      const typed = await (await prompt($, 'hi <pasted_content id="1">a\nb</pasted_content id="1">')).drawn()
      const found = [...pairs(message), ...pairs(typed)]
      expect(found.some(p => p.bg === theme.palette.panel.toLowerCase())).toBe(true)
      for (const pair of found) {
        const floor = NON_TEXT.test(pair.text) ? 3 : 4.5
        const backgrounds = pair.bg ? [pair.bg] : theme.backgrounds
        for (const background of backgrounds) expect({ ...pair, background, ratio: contrast(pair.fg, background) >= floor }).toEqual({ ...pair, background, ratio: true })
      }
    })
  }

  for (const [name, palette] of [['dark-ansi', dark], ['light-ansi', light], ['solarized-custom', dark], ['solarized-light', light], ['dark-daltonized-ansi', darkDaltonized]] as const) {
    test(`draws ${name} in the Pitwall ${palette === light ? 'light' : 'dark'} hex palette`, async ($, on) => {
      useTheme(on, () => name)
      const message = paints(await (await draw($, SAMPLE)).drawn())
      const typed = paints(await (await prompt($, 'hi')).drawn())
      expect(message).toContain(palette.removed)
      expect(typed).toContain(palette.accent)
      expect([...message, ...typed].filter(c => !c.startsWith('#'))).toEqual([])
    })
  }

  for (const [colorFgBg, palette] of [['0;15', light], ['15;0', dark], ['0;7', light], [undefined, dark], ['', dark], ['garbage', dark]] as const) {
    test(`resolves auto to the ${palette === light ? 'light' : 'dark'} palette when COLORFGBG is ${JSON.stringify(colorFgBg)}`, async ($, on) => {
      useTheme(on, () => 'auto', colorFgBg)
      const tree = await (await draw($, '`code`')).drawn()
      expect(findText(tree, text => text === 'code')?.element.props?.backgroundColor).toBe(palette.chip)
    })
  }

  test('draws the dark palette when the theme cannot be read', async $ => {
    const tree = await (await draw($, '`code`')).drawn()
    expect(findText(tree, text => text === 'code')?.element.props?.backgroundColor).toBe(dark.chip)
  })

  test('swaps green for blue under a daltonized theme, so added and removed stay apart', async ($, on) => {
    useTheme(on, () => 'light-daltonized')
    const tree = await (await draw($, '```diff\n-old\n+new\n```')).drawn()
    expect(findText(tree, text => text.startsWith('+new'))?.element.props?.color).toBe(light.progress)
    expect(findText(tree, text => text.startsWith('-old'))?.element.props?.color).toBe(light.removed)
  })

  test('redraws in the new palette when the theme changes', async ($, on) => {
    let theme = 'dark'
    useTheme(on, () => theme)
    on('config.set', async ($, e) => ({ value: e.value }))
    const ui = await draw($, '`code`')
    theme = 'light'
    await $.config.set({ key: 'theme', value: 'light' } as never)
    expect(findText(await ui.drawn(), text => text === 'code')?.element.props?.backgroundColor).toBe(light.chip)
  })
})

describe('palette', () => {
  for (const theme of TUNED) {
    test(`keeps every ${theme.name} text role at AA on each background, and the roles drawn on the panel on it too`, () => {
      const roles = (Object.keys(theme.palette) as (keyof Palette)[]).filter(role => !NON_TEXT_ROLES.includes(role))
      for (const role of roles) {
        const backgrounds = PANEL_ROLES.includes(role) ? [...theme.backgrounds, theme.palette.panel, theme.palette.chip] : theme.backgrounds
        for (const background of backgrounds) expect({ role, background, ratio: contrast(theme.palette[role], background) >= 4.5 }).toEqual({ role, background, ratio: true })
      }
      for (const role of ['faint', 'accent'] as const) {
        for (const background of theme.backgrounds) expect({ role, background, ratio: contrast(theme.palette[role], background) >= 3 }).toEqual({ role, background, ratio: true })
      }
      expect(contrast(theme.palette.accent, theme.palette.panel)).toBeGreaterThanOrEqual(3)
    })
  }

  for (const palette of [dark, light]) {
    test(`separates ${palette.text} theme added from removed by lightness as well as hue`, () => {
      expect(contrast(palette.added, palette.removed)).toBeGreaterThanOrEqual(1.2)
    })
  }

  test('separates daltonized added from removed on the blue and red axis colour-blind readers keep', () => {
    for (const palette of [darkDaltonized, lightDaltonized]) expect([palette.added, palette.removed]).toEqual([palette.progress, palette.error])
  })

  test('never resolves the accent to the failure red, for any theme name', () => {
    for (const theme of ['dark', 'light', 'dark-ansi', 'light-ansi', 'auto', 'dark-daltonized', 'light-daltonized', 'custom', undefined, 42]) {
      const palette = paletteFor(theme)
      expect({ theme, same: palette.accent === palette.error || palette.accent === palette.removed }).toEqual({ theme, same: false })
    }
  })

  test('keeps daltonized done apart from the running blue', () => {
    for (const palette of [darkDaltonized, lightDaltonized]) expect(palette.done).not.toBe(palette.progress)
  })

  test('reads only a numeric background index from COLORFGBG', () => {
    expect([groundOfTerminal('0;15'), groundOfTerminal('15;default;0'), groundOfTerminal(undefined), groundOfTerminal(''), groundOfTerminal('x')]).toEqual(['light', 'dark', undefined, undefined, undefined])
  })

  test('keeps the accent to the Pitwall orange and green, red and blue to their status', () => {
    expect([dark.accent, light.accent]).toEqual(['#d4734f', '#c96442'])
    expect(new Set([dark.done, dark.error, dark.progress]).size).toBe(3)
    expect(new Set([light.done, light.error, light.progress]).size).toBe(3)
  })
})
