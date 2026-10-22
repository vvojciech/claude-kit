import { describe, expect, test } from 'claude-code/testing'

import type { Block, Span } from '../hooks/markdown'
import { parseBlocks } from '../hooks/message'

const TAIL = ' and then the sentence keeps going with ordinary words for quite a long while, until it finally stops at this point of the reply.'

const PROSE = [
  'Costs ~5 minutes and ~10 seconds of time to run.',
  'Approx ~1 s, ~2 s, ~3 s, ~4 s, ~5 s, ~6 s, ~7 s, ~8 s and ~9 s then done.',
  `The _id field is indexed${TAIL}`,
  `Works on *nix and macOS${TAIL}`,
  `Call _private_method later${TAIL}`,
  `Use **kwargs in python${TAIL}`,
  `Run \`npm test and nothing closes it${TAIL}`,
  `Some <b>bold that never closes${TAIL}`,
  'Use `` ` `` to show a backtick and `x` too.',
  'Use ``a ` b`` and ``` `` ``` inline.',
  'Done **bold** and `x` then *it* and ~~gone~~ and <b>tag</b> end.',
  'Compute 2*3*4 and a*b then x * y in text.',
  'Read [the docs](https://e.com/wiki/Foo_(bar)_baz) then [x](y).',
  'See [the reference documentation for hooks which is long](https://e.com/a_b?c=d#e) then more.',
  `See [draft notes that never close${TAIL}`,
  'Edit ~/.claude/a_b.md and ./node_modules/_x/y and src/**/*.ts now.',
  'Mail <a_b@x.com> or <https://e.com/a_(b)~c*d> please.',
  'Loop while i<a and j>0 holds.',
  'then a<b and c>d and 1 <2 ok.',
  'Copy $HOME/*_backup and price $5*2 and 3 * 4 = 12.',
  'AT&T and R&D and &amp; and &copy; done.',
  'Use params[:user][:name] in the controller and matrix[i][j] or a[0][1] too.',
  'Array syntax arr[^1] here and [the docs][d] too.',
  'Note: *this only matters when the cache is cold and the network is slow* so relax.',
]

const BLOCKS = [
  'Intro\n\n```ts\nconst a = 1\n```\n\nAfter.',
  '- item **one** and `two`\n- next _it_ here\n\n> quoted **bold** text\n',
  '| _id | *.ts | name |\n|---|---|---|\n| 1 | a_b | ~5 |\n| *nix | `p|q` | _x |\n\nDone.',
  'Title\n=====\n\nSub\n---\n\nBody **text**.',
  '1. one\n2. two\n\n---\n\n- [ ] todo\n- [x] done',
  '[g]: https://e.com/g\n\nPer [the guide][g] it works.\n',
  'Text\n\n<pre lang="rb">\nputs 1\n</pre>\n\nEnd.',
  '> [!WARNING]\n> careful with i<a and j>0\n\nOk.',
]

const PIPE_PROSE = ['|x| + |y| >= |x + y|\nholds always.', '| a | b |\nnot a table row', 'Intro\n\n| a | b |\n| c | d |\nmore']

const COMPARISONS = ['Loop while i<a and j>0 holds.', 'then a<b and c>d and 1 <2 ok.', '- if i<a and j>0 stop', '| x | i<a and j>0 |\n|---|---|\n| a<b and c>d | y |', 'while i<a and j>0 the </a> closes', 'if a<b and c>d then x</b> y', 'when <i and y> holds </i> done', 'if <s and t> then </s> end', '| x | i<a and j>0 </a> |\n|---|---|\n| a<b and c>d </b> | y |']

function isStyled(span: Span): boolean {
  return span.bold === true || span.italic === true || span.strike === true || span.underline === true || span.kind === 'code'
}

function styleOf(span: Span): string {
  return [span.kind, span.bold && 'b', span.italic && 'i', span.strike && 's', span.underline && 'u', span.href && 'h'].filter(Boolean).join('')
}

function cellsOf(spans: Span[]): string[] {
  return spans.flatMap(span => [...span.text].filter(char => /\S/.test(char)).map(char => `${char}${styleOf(span)}`))
}

function leaves(blocks: Block[]): Block[] {
  return blocks.flatMap(block => {
    if (block.kind === 'list') return block.items.flatMap(item => leaves(item.blocks))
    if (block.kind === 'quote') return leaves(block.blocks)
    return [block]
  })
}

function spansOf(block: Block): Span[] {
  if (block.kind === 'paragraph' || block.kind === 'heading') return block.spans
  if (block.kind === 'table') return [block.header, ...block.rows].flat(2)
  if (block.kind === 'code') return [{ text: block.source, kind: 'code' }]
  return [{ text: block.kind, kind: 'plain' }]
}

function leafCells(block: Block): string[] {
  return cellsOf(spansOf(block))
}

function cells(blocks: Block[]): string[] {
  return leaves(blocks).flatMap(leafCells)
}

function shownText(blocks: Block[]): string {
  return leaves(blocks)
    .flatMap(spansOf)
    .map(span => span.text)
    .join('')
    .replace(/\s/g, '')
}

function prefixesOf(message: string): string[] {
  return Array.from({ length: message.length + 1 }, (_, index) => message.slice(0, index))
}

function streamed(prefix: string): Block[] {
  return parseBlocks(prefix, { streaming: true })
}

function lastTwoLinesLength(prefix: string): number {
  return prefix.split('\n').slice(-2).join('').replace(/[^\p{L}\p{N}]/gu, '').length
}

function wordsOf(blocks: Block[]): number {
  return shownText(blocks).replace(/[^\p{L}\p{N}]/gu, '').length
}

function countOf(char: string, text: string): number {
  return text.split(char).length - 1
}

function tableRows(blocks: Block[]): string[][] {
  const table = blocks.find(block => block.kind === 'table')
  if (table?.kind !== 'table') return []
  return [table.header, ...table.rows].map(row => row.map(cell => cell.map(span => span.text).join('')))
}

describe('streaming a reply token by token', () => {
  test('draws every prose frame exactly as the same text draws finished, with no inline lag', async () => {
    for (const message of PROSE) for (const prefix of prefixesOf(message)) expect({ prefix, frame: cells(streamed(prefix)) }).toEqual({ prefix, frame: cells(parseBlocks(prefix)) })
  })

  test('shows an unclosed inline opener as written until its closer arrives, then restyles the span', async () => {
    expect(shownText(streamed('Some **bol'))).toBe('Some**bol')
    expect(shownText(streamed('run `npm'))).toBe('run`npm')
    expect(shownText(streamed('a <b>x'))).toBe('a<b>x')
    expect(streamed('Some **bold**')[0]).toMatchObject({ spans: [{ text: 'Some ' }, { text: 'bold', bold: true }] })
    expect(streamed('run `npm`')[0]).toMatchObject({ spans: [{ text: 'run ' }, { text: 'npm', kind: 'code' }] })
  })

  test('holds back no more than the line being typed and the line it may turn into a block', async () => {
    for (const message of BLOCKS) {
      for (const prefix of prefixesOf(message)) {
        const held = wordsOf(parseBlocks(prefix)) - wordsOf(streamed(prefix))
        expect({ prefix, bounded: held <= lastTwoLinesLength(prefix) }).toEqual({ prefix, bounded: true })
      }
    }
  })

  test('draws every block a frame has already finished exactly as the finished reply draws it', async () => {
    for (const message of [...BLOCKS, ...PROSE]) {
      const final = leaves(parseBlocks(message)).map(leafCells)
      for (const prefix of prefixesOf(message)) {
        const settled = leaves(streamed(prefix)).slice(0, -1).map(leafCells)
        expect({ prefix, settled }).toEqual({ prefix, settled: final.slice(0, settled.length) })
      }
    }
  })

  test('never draws the wrong block type for a fence, table or setext heading still being typed', async () => {
    expect(streamed('Intro\n\n```s').map(block => block.kind)).toEqual(['paragraph'])
    expect(streamed('| a | b |\n|--').map(block => block.kind)).toEqual(['table'])
    expect(shownText(streamed('Title\n--'))).toBe('Title')
    expect(streamed('Title\n---\n').map(block => block.kind)).toEqual(['heading'])
  })

  test('never draws a pipe row as a table before a delimiter row starts under it', async () => {
    for (const message of PIPE_PROSE) {
      expect({ message, kinds: leaves(parseBlocks(message)).map(block => block.kind) }).toEqual({ message, kinds: leaves(parseBlocks(message)).map(() => 'paragraph') })
      for (const prefix of prefixesOf(message)) expect({ prefix, table: leaves(streamed(prefix)).some(block => block.kind === 'table') }).toEqual({ prefix, table: false })
    }
  })

  test('keeps underscores and stars in table cells inside their own cell on every frame', async () => {
    const message = '| _id | *.ts | name |\n|---|---|---|\n| 1 | a_b | ~5 |\n| *nix | x | _y |'
    const final = [
      ['_id', '*.ts', 'name'],
      ['1', 'a_b', '~5'],
      ['*nix', 'x', '_y'],
    ]
    expect(tableRows(parseBlocks(message))).toEqual(final)
    for (const prefix of prefixesOf(message)) {
      const rows = tableRows(streamed(prefix))
      const grown = rows.every((row, at) => row.length <= 3 && row.every((cell, column) => (final[at]?.[column] ?? '').startsWith(cell)))
      expect({ prefix, rows, grown }).toEqual({ prefix, rows, grown: true })
    }
  })

  test('never treats a comparison that looks like a tag as markup, streaming or finished', async () => {
    for (const message of COMPARISONS) {
      const literal = message.replace(/^- /, '').replace(/\|[-|]*\|\n|[|\s]/g, '')
      expect({ message, shown: shownText(parseBlocks(message)) }).toEqual({ message, shown: literal })
      for (const prefix of prefixesOf(message)) expect({ prefix, styled: leaves(streamed(prefix)).flatMap(spansOf).some(isStyled) }).toEqual({ prefix, styled: false })
    }
  })

  test('never shows a delimiter after a glob followed by a later star that the same text finished does not show', async () => {
    const message = 'Copy $HOME/*_backup and price $5*2 and 3 * 4 = 12.'
    expect(countOf('_', shownText(parseBlocks(message)))).toBe(1)
    for (const prefix of prefixesOf(message)) expect({ prefix, underscores: countOf('_', shownText(streamed(prefix))) }).toEqual({ prefix, underscores: countOf('_', shownText(parseBlocks(prefix))) })
  })

  test('treats an empty prefix and a lone line-start marker as nothing yet', async () => {
    for (const prefix of ['', '*', '`', '~', '-', '|']) expect({ prefix, shown: shownText(streamed(prefix)) }).toEqual({ prefix, shown: '' })
  })
})
