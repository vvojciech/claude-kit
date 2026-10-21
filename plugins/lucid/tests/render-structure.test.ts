import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { dark, groundOf, light, paletteFor } from '../hooks/palette'
import { treeSize } from '../hooks/blocks'
import { flagValues } from '../hooks/runs'
import { shellSpans } from '../hooks/markdown'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function useTheme(on: On, theme: string, colorFgBg?: string) {
  on('config.list', async () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { kind: 'engine' }, isLocked: false }] }) as never)
  on('env.get', async (_, e) => ({ value: (e as { name?: string }).name === 'COLORFGBG' ? colorFgBg : undefined }) as never)
}

async function draw($: Engine, on: On, text: string, columns = 100) {
  useTheme(on, 'dark')
  const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: { columns, rows: 50 } } as never)
  return ui.drawn()
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

function texts(tree: unknown, predicate: (text: string) => boolean): { element: Drawn; ancestors: Drawn[] }[] {
  const found: { element: Drawn; ancestors: Drawn[] }[] = []
  const walk = (node: unknown, ancestors: Drawn[]) => {
    if (node === null || typeof node !== 'object') return
    const element = node as Drawn
    if (element.type === 'Text' && predicate(textOf(element))) found.push({ element, ancestors })
    for (const child of childrenOf(element)) walk(child, [...ancestors, element])
  }
  walk(tree, [])
  return found.filter(match => !found.some(other => other.ancestors.includes(match.element)))
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

function nestedList(depth: number, prefix = ''): string {
  return Array.from({ length: depth }, (_, i) => `${prefix}${'  '.repeat(i)}- depth ${i}`).join('\n')
}

describe('theme ground', () => {
  test('reads the terminal ground for a theme name that says neither dark nor light', () => {
    expect([groundOf('github', 'light'), groundOf('custom', 'light'), groundOf('custom', 'dark'), groundOf('custom', undefined)]).toEqual(['light', 'light', 'dark', 'dark'])
  })

  test('trusts a theme name over the terminal ground when the name says which', () => {
    expect([groundOf('dark-ansi', 'light'), groundOf('light-ansi', 'dark'), groundOf('my-dark', 'light')]).toEqual(['dark', 'light', 'dark'])
  })

  test('draws a custom theme in the light palette on a light terminal', async ($, on) => {
    useTheme(on, 'custom', '0;15')
    const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text: '`code`', isFirstOfReply: true }, viewport: { columns: 80, rows: 20 } } as never)
    expect(texts(await ui.drawn(), text => text === 'code')[0]?.element.props?.backgroundColor).toBe(light.chip)
    expect(paletteFor('custom', 'light')).toBe(light)
  })

  test('steps the light code chip far enough off the ground to read as a fill', () => {
    for (const ground of ['#f5f4f0', '#ffffff']) expect(contrast(light.chip, ground)).toBeGreaterThanOrEqual(1.18)
  })
})

describe('shell flags', () => {
  test('draws a flag and the value it binds with = in one tone', async ($, on) => {
    const tree = await draw($, on, "`grep -rn --include='*' 'palette'`")
    const flag = texts(tree, text => text.includes("--include='*'"))
    expect(flag).toHaveLength(1)
    expect(flag[0]?.element.props?.color).toBe(dark.muted)
  })

  test('leaves a value after a space and an empty spans list alone', () => {
    expect(flagValues(shellSpans("grep --x= 'y'")).map(span => span.kind)).toEqual(shellSpans("grep --x= 'y'").map(span => span.kind))
    expect(flagValues([])).toEqual([])
  })
})

describe('thematic break', () => {
  test('draws a break in a glyph that neither a table rule nor a heading uses', async ($, on) => {
    const tree = await draw($, on, '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\nafter')
    const rules = texts(tree, text => /^[─╌ ]+$/.test(text)).map(match => textOf(match.element))
    expect(rules).toEqual(['─  ─', '╌'.repeat(40)])
  })
})

describe('table rule', () => {
  test('sizes the rule under each header to the header, aligned with it', async ($, on) => {
    const tree = await draw($, on, '| name | n |\n|---|--:|\n| a very long cell value | 1 |')
    expect(texts(tree, text => /^[─ ]+$/.test(text)).map(match => textOf(match.element))).toEqual([`────${' '.repeat(20)}─`])
  })
})

describe('lists', () => {
  test('draws a code block inside a list item at the list edge, so a paste keeps its indent', async ($, on) => {
    const tree = await draw($, on, '1. Run this:\n\n   ```python\n   def g(y):\n       return y * 2\n   ```\n2. Then this.')
    const source = texts(tree, text => text.startsWith('def g(y):'))
    expect(source).toHaveLength(1)
    for (const ancestor of source[0]?.ancestors ?? []) {
      for (const prop of ['paddingLeft', 'marginLeft', 'paddingX']) expect(ancestor.props?.[prop] ?? 0).toBe(0)
      expect(ancestor.props?.flexDirection).not.toBe('row')
    }
    expect(texts(tree, text => text === 'Then this.')).toHaveLength(1)
  })

  for (const depth of [2, 3]) {
    test(`draws a code block ${depth} list levels deep at the left edge, so a paste keeps its own indent`, async ($, on) => {
      const lead = (level: number) => '  '.repeat(level)
      const items = Array.from({ length: depth }, (_, level) => `${lead(level)}- level ${level}`).join('\n')
      const fence = lead(depth)
      const tree = await draw($, on, `${items}\n\n${fence}\`\`\`python\n${fence}if x:\n${fence}    print(x)\n${fence}\`\`\``)
      const source = texts(tree, text => text.startsWith('if x:'))
      expect(source).toHaveLength(1)
      const offset = (source[0]?.ancestors ?? []).reduce((sum, a) => sum + Number(a.props?.paddingLeft ?? 0) + Number(a.props?.marginLeft ?? 0), 0)
      expect(offset).toBe(0)
      expect(textOf(source[0]?.element)).toBe('if x:\n    print(x)')
    })
  }

  test('keeps the marker of an item that opens with a code block', async ($, on) => {
    const tree = await draw($, on, '- ```sh\n  ls\n  ```')
    expect(texts(tree, text => text === '-')).toHaveLength(1)
    expect(texts(tree, text => text === 'ls')).toHaveLength(1)
  })

  for (const [depth, prefix] of [[8, ''], [12, ''], [20, ''], [7, '> '], [12, '> ']] as const) {
    test(`styles the first levels of a ${depth}-level list${prefix ? ' in a quote' : ''} and keeps every level`, async ($, on) => {
      const tree = await draw($, on, nestedList(depth, prefix), 120)
      const styled = Math.min(depth, prefix ? 7 : 8)
      for (let level = 0; level < styled; level++) expect(texts(tree, text => text === `depth ${level}`)).toHaveLength(1)
      expect(texts(tree, text => text.includes(`depth ${depth - 1}`))).toHaveLength(1)
      expect(texts(tree, text => text.startsWith('- depth 0') || text.startsWith('> - depth 0'))).toEqual([])
      expect(treeSize(tree as never).depth).toBeLessThanOrEqual(32)
    })
  }

  test('gives code and prose in a list the full width on a wide terminal', async ($, on) => {
    const long = 'x'.repeat(180)
    const tree = await draw($, on, `- ${'word '.repeat(50).trim()}\n\n  \`\`\`\n  ${long}\n  \`\`\``, 200)
    const widths = (text: string) => (texts(tree, t => t.startsWith(text))[0]?.ancestors ?? []).map(a => a.props?.width).filter((w): w is number => typeof w === 'number')
    expect(Math.min(...widths(long))).toBeGreaterThanOrEqual(200)
    expect(Math.min(...widths('word'))).toBeGreaterThanOrEqual(198)
  })
})
