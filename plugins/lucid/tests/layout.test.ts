import { describe, expect, test } from 'claude-code/testing'

import { highlight } from '../hooks/highlight'
import { parseBlocks } from '../hooks/message'
import { plainText, treeSize } from '../hooks/render'
import { gridWidths, padding } from '../hooks/table'

const text = (natural: number) => ({ natural, numeric: false })

const number = (natural: number) => ({ natural, numeric: true })

describe('gridWidths', () => {
  test('keeps natural widths when they fit', () => {
    expect(gridWidths([text(5), number(3)], 20)).toEqual([5, 3])
  })

  test('shrinks the widest text column and never a number', () => {
    expect(gridWidths([text(30), number(10), text(8)], 40)).toEqual([18, 10, 8])
  })

  test('gives up when even the narrowest columns cannot fit', () => {
    expect(gridWidths([text(20), number(12), number(12)], 30)).toBeUndefined()
    expect(gridWidths(Array.from({ length: 9 }, () => text(10)), 40)).toBeUndefined()
  })

  test('treats an empty table as fitting', () => {
    expect(gridWidths([], 10)).toEqual([])
  })
})

describe('padding', () => {
  test('pads by alignment and never by a negative amount', () => {
    expect(padding(4, 'left')).toEqual([0, 4])
    expect(padding(4, 'right')).toEqual([4, 0])
    expect(padding(5, 'center')).toEqual([2, 3])
    expect(padding(-2, 'right')).toEqual([0, 0])
  })
})

describe('highlight', () => {
  test('leaves a language it does not know plain', () => {
    expect(highlight('', ['const a = "x" // y'])).toEqual([[{ text: 'const a = "x" // y', role: 'plain' }]])
    expect(highlight('text', ['', 'b'])).toEqual([[], [{ text: 'b', role: 'plain' }]])
  })

  test('ends an unclosed single-line string at the end of its line', () => {
    const [first, second] = highlight('ts', ['a = "open', 'b'])
    expect(first?.at(-1)).toEqual({ text: '"open', role: 'string' })
    expect(second).toEqual([{ text: 'b', role: 'plain' }])
  })

  test('carries a triple-quoted string across lines', () => {
    const lines = highlight('python', ['x = """one', 'two', 'three""" + y'])
    expect(lines[1]).toEqual([{ text: 'two', role: 'string' }])
    expect(lines[2]?.[0]).toEqual({ text: 'three""" ', role: 'string' })
  })

  test('skips escaped quotes inside a string', () => {
    expect(highlight('js', ['"a\\"b" + c'])[0]?.[0]).toEqual({ text: '"a\\"b" ', role: 'string' })
  })

  test('does not read a Rust lifetime as a string', () => {
    expect(highlight('rust', ["fn f<'a>(x: &'a str) {}"])[0]?.some(token => token.role === 'string')).toBe(false)
  })

  test('only bolds whole words', () => {
    expect(highlight('ruby', ['define = ifx'])[0]).toEqual([{ text: 'define = ifx', role: 'plain' }])
  })
})

describe('plainText', () => {
  test('writes every block back as markdown a paste can use', () => {
    const source = '## Head\n\n- [x] done\n- [ ] todo\n- item\n\n1. one\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1\n```\n\n---'
    expect(parseBlocks(source).map(plainText)).toEqual(['## Head', '- [x] done\n- [ ] todo\n- item', '1. one', '> quoted', 'a  b\n1  2', 'const a = 1', '---'])
  })
})

describe('treeSize', () => {
  test('counts elements and strings and the deepest level', () => {
    expect(treeSize({ type: 'Box', children: [{ type: 'Text', children: ['a', 'b'] }, 'c'] } as never)).toEqual({ nodes: 5, depth: 3 })
    expect(treeSize('a')).toEqual({ nodes: 1, depth: 1 })
  })
})
