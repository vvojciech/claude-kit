import { describe, expect, test } from 'claude-code/testing'

import { OTHER_TOOL_GLYPH, toolGlyph, toolGlyphs } from '../hooks/glyphs'
import { cellWidth } from '../hooks/width'

describe('tool kind glyphs', () => {
  test('names each kind of tool with its own mark', () => {
    const tools = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebFetch', 'Agent', 'Skill', 'TodoWrite', 'mcp__github__get_issue']
    expect(tools.map(toolGlyph)).toEqual(['$', '≡', '✎', '✎', '⌕', '⌕', '↗', '◈', '✦', '☐', '⬡'])
  })

  test('gives a tool it does not know the neutral dot, and no mark when the tool is unknown', () => {
    expect([toolGlyph('Monitor'), toolGlyph(undefined)]).toEqual([OTHER_TOOL_GLYPH, undefined])
  })

  test('keeps every mark one cell wide and distinct, so the slot never shifts a row', () => {
    for (const glyph of toolGlyphs()) expect({ glyph, cells: cellWidth(glyph) }).toEqual({ glyph, cells: 1 })
    expect(new Set(toolGlyphs()).size).toBe(toolGlyphs().length)
  })
})
