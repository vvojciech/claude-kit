import { describe, expect, test } from 'claude-code/testing'

import { OTHER_TOOL_GLYPH, toolGlyph, toolGlyphs } from '../hooks/glyphs'
import { clockTime, lapTime } from '../hooks/laps'
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

describe('lap line text', () => {
  test('writes a lap time the way the engine does', () => {
    expect([0, 3_400, 59_000, 64_000, 3_600_000 + 120_000].map(lapTime)).toEqual(['0s', '3s', '59s', '1m 4s', '1h 2m'])
  })

  test('writes the clock time as two-digit hours and minutes', () => {
    expect(clockTime(new Date(2026, 10, 5, 9, 5).getTime())).toBe('09:05')
  })
})
