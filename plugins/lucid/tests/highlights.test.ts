import { describe, expect, test } from 'claude-code/testing'

import { renderMarkdown } from '../hooks/blocks'
import { dark, light } from '../hooks/palette'
import { renderPrompt } from '../hooks/prompt'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const KIT = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: [] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: [] }),
  Link: (props: Record<string, unknown>) => ({ type: 'Link', props, children: [] }),
} as never

function childrenOf(node: unknown): unknown[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [...(element.children ?? []), ...((element.props?.children as unknown[] | undefined) ?? [])].flat()
}

function plain(node: unknown): string {
  if (typeof node === 'string') return node
  return childrenOf(node).map(plain).join('')
}

function coloured(node: unknown, color: string): string[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  if (element.type === 'Text' && element.props?.color === color) return [plain(node)]
  return childrenOf(node).flatMap(child => coloured(child, color))
}

describe('highlights', () => {
  test('draws bold words in the stress tint, a soft shade of the accent, never the title sand', () => {
    for (const palette of [dark, light]) {
      const tree = renderMarkdown({ kit: KIT, palette }, 'The deploy **failed on step 3**, the rest passed.', 80)
      expect(coloured(tree, palette.stress)).toContain('failed on step 3')
      expect(coloured(tree, palette.title)).toEqual([])
    }
  })

  test('tints each alert label by kind on both grounds, and keeps every quote bar faint', () => {
    const kinds = { NOTE: 'strong', TIP: 'strong', IMPORTANT: 'stress', WARNING: 'stress', CAUTION: 'error' } as const
    for (const palette of [dark, light]) {
      for (const [kind, role] of Object.entries(kinds)) {
        const tree = renderMarkdown({ kit: KIT, palette }, `> [!${kind}]\n> Body text.`, 80)
        const label = kind[0] + kind.slice(1).toLowerCase()
        expect(coloured(tree, palette[role])).toContain(label)
        expect(coloured(tree, palette.faint).join('')).toMatch(/^[^A-Za-z]+$/)
      }
    }
  })

  test('keeps table headers in their own ink and tints bold body cells', () => {
    for (const palette of [dark, light]) {
      const tree = renderMarkdown({ kit: KIT, palette }, '| Option | Look |\n|---|---|\n| A | **Pitwall tuned** |', 80)
      const stressed = coloured(tree, palette.stress).join(' ')
      expect(stressed).toContain('Pitwall tuned')
      expect(stressed).not.toContain('Option')
      expect(stressed).not.toContain('Look')
    }
  })

  test('leaves heading colours alone when a heading holds bold words', () => {
    for (const palette of [dark, light]) {
      expect(coloured(renderMarkdown({ kit: KIT, palette }, '# Deploy **failed** now', 80), palette.stress)).toEqual([])
      expect(coloured(renderMarkdown({ kit: KIT, palette }, '### Note **this**', 80), palette.stress)).toEqual([])
    }
  })

  test('leaves plain quotes with a faint bar', () => {
    const tree = renderMarkdown({ kit: KIT, palette: dark }, '> Just a quote.', 80)
    expect(coloured(tree, dark.stress)).toEqual([])
    expect(coloured(tree, dark.faint).length).toBeGreaterThan(0)
  })
})

describe('prompt panel', () => {
  test('keeps the text on a full-width panel with the prompt bar on its right edge', () => {
    const row = renderPrompt({ kit: KIT, palette: dark }, 'ship it', 80) as unknown as Drawn
    const [panel, bar] = childrenOf(row) as Drawn[]
    expect(row.props).toMatchObject({ width: 80 })
    expect(panel?.props).toMatchObject({ flexGrow: 1, backgroundColor: dark.panel })
    expect(bar?.props).toMatchObject({ width: 1, backgroundColor: dark.prompt })
  })
})
