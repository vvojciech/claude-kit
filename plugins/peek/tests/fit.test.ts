import { describe, expect, test } from 'claude-code/testing'

import { atLeast, mayDraw } from '../hooks/capability'
import { fitCells } from '../hooks/fit'

describe('thumbnail cells', () => {
  test('keeps the aspect ratio at two rows of pixels per column', () => {
    expect(fitCells({ width: 1600, height: 800 }, 8, 48)).toEqual({ columns: 32, rows: 8 })
    expect(fitCells({ width: 800, height: 1600 }, 8, 48)).toEqual({ columns: 8, rows: 8 })
  })

  test('caps the width and shrinks the rows to match', () => {
    expect(fitCells({ width: 4000, height: 500 }, 8, 48)).toEqual({ columns: 48, rows: 3 })
  })

  test('draws a tiny image no taller than its pixels need', () => {
    expect(fitCells({ width: 40, height: 20 }, 8, 48)).toEqual({ columns: 8, rows: 2 })
  })
})

describe('where pictures can draw', () => {
  test('compares versions', () => {
    expect(atLeast('2.1.309', '2.1.305')).toBe(true)
    expect(atLeast('2.1.305', '2.1.305')).toBe(true)
    expect(atLeast('2.1.304', '2.1.305')).toBe(false)
    expect(atLeast('2.2.0-dev.1', '2.1.305')).toBe(true)
  })

  test('iTerm2 from 2.1.305, kitty and Ghostty, never in tmux or screen', () => {
    expect(mayDraw({ program: 'iTerm.app', version: '2.1.309' })).toBe(true)
    expect(mayDraw({ program: 'iTerm.app', version: '2.1.304' })).toBe(false)
    expect(mayDraw({ program: 'ghostty', version: '2.1.200' })).toBe(true)
    expect(mayDraw({ term: 'xterm-kitty', version: '2.1.200' })).toBe(true)
    expect(mayDraw({ program: 'iTerm.app', tmux: '/tmp/x', version: '2.1.309' })).toBe(false)
    expect(mayDraw({ program: 'Apple_Terminal', version: '2.1.309' })).toBe(false)
    expect(mayDraw({ program: 'Apple_Terminal', forced: '1', version: '2.1.309' })).toBe(true)
  })
})
