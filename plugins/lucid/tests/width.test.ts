import { describe, expect, test } from 'claude-code/testing'

import { cellWidth } from '../hooks/width'

describe('cellWidth', () => {
  test('counts emoji with emoji presentation as two cells', () => {
    for (const emoji of ['✅', '❌', '⭐', '🀄', '👍', '🇬🇧']) expect({ emoji, width: cellWidth(emoji) }).toEqual({ emoji, width: 2 })
  })

  test('counts a joined or modified emoji sequence as one two-cell glyph', () => {
    for (const emoji of ['👨‍👩‍👧', '👍🏽', '1️⃣', '❤️']) expect({ emoji, width: cellWidth(emoji) }).toEqual({ emoji, width: 2 })
  })

  test('keeps text-presentation symbols at one cell', () => {
    for (const symbol of ['✓', '❤', '•', '→', '━']) expect({ symbol, width: cellWidth(symbol) }).toEqual({ symbol, width: 1 })
  })

  test('counts east asian wide letters as two cells and combining marks as none', () => {
    expect(cellWidth('中文')).toBe(4)
    expect(cellWidth('한국')).toBe(4)
    expect(cellWidth('ｱ')).toBe(1)
    expect(cellWidth('Ａ')).toBe(2)
    expect(cellWidth('é')).toBe(1)
    expect(cellWidth('a​b')).toBe(2)
  })

  test('measures an empty string as nothing', () => {
    expect(cellWidth('')).toBe(0)
  })
})
