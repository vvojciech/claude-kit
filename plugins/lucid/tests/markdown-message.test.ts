import { describe, expect, test } from 'claude-code/testing'

import { ReplyStream } from '../hooks/live'
import { inlineSpans } from '../hooks/markdown'
import type { Block, Span } from '../hooks/markdown'
import { blocksOf, parseAfresh, parseBlocks } from '../hooks/message'

function text(spans: Span[]): string {
  return spans.map(s => s.text).join('')
}

function kinds(blocks: Block[]): string[] {
  return blocks.map(b => b.kind)
}

function streamed(markdown: string): Block[] {
  return parseBlocks(markdown, { streaming: true })
}

function only<K extends Block['kind']>(blocks: Block[] | undefined, kind: K): Extract<Block, { kind: K }> {
  const found = blocks?.find(b => b.kind === kind)
  if (!found) throw new Error(`no ${kind} in ${JSON.stringify(blocks)}`)
  return found as Extract<Block, { kind: K }>
}

const ATTEMPTS = 3

function elapsed(run: () => unknown): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

function bestRatio(measure: (attempt: number) => number): number {
  return Math.min(...Array.from({ length: ATTEMPTS }, (_, attempt) => measure(attempt)))
}

const CORPUS = [
  '# Plan\n\n1. Install:\n   ```bash\n   npm i\n   ```\n2. Test\n\n> [!NOTE]\n> Done.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  'Intro para\n- one\n- two\n\nTotals:\n\n- [x] done\n\nA line\n| grep x\n\nEnd = 3\n:done',
  'Summary\n\n| Name | Value |\n|------|------:|\n| a | 1 |\n| b | 2 |\n\nDone.',
  'Para one\n\n---\n\nPara two\n\n***\n\nnext\n\nSetext\n======\n\nAnother\n---\n',
  'x\n\n<details>\n<summary>S</summary>\n\nbody\n\n</details>\n\n<pre>\n  keep   *this*\n</pre>\n\nPrice <del>£100</del> now',
  'List:\n- a\n  - b\n    ```js\n    x\n    ```\n\n- loose item\n\n  continued\n\nPara text\n\n    indented code\n',
  '---\ntitle: deploy notes\nowner: platform\n---\n\nRun this first:\n\n```sh\nbundle exec rspec\n```\n\nname | kind\n-----|-----\n',
  '> quote\nlazy\n\n> [!WARNING]\n> careful\n\nClaim[^1]\n\n[^1]: The source\n',
  'See [the docs][docs] and `a | b`.\n\n[docs]: https://example.com\n\nEnd.',
]

describe('finished messages keep every line', () => {
  test('draws a closing setext heading, rule and table delimiter as written', async () => {
    expect(only(parseBlocks('Closing Title\n============='), 'heading').level).toBe(1)
    expect(kinds(parseBlocks('Para\n---'))).toEqual(['heading'])
    expect(kinds(parseBlocks('Para\n\n---'))).toEqual(['paragraph', 'rule'])
    expect(only(parseBlocks('Done.\n-'), 'heading').level).toBe(2)
    expect(text(only(parseBlocks('Name: x\n|'), 'paragraph').spans)).toBe('Name: x\n|')
    expect(only(parseBlocks('name | kind\n-----|-----'), 'table').header.map(text)).toEqual(['name', 'kind'])
  })

  test('draws a header row with no delimiter as the paragraph it is', async () => {
    expect(kinds(parseBlocks('Summary\n| a | b |'))).toEqual(['paragraph'])
  })

  test('holds the same trailing markup back while the reply is still arriving', async () => {
    expect(kinds(streamed('Closing Title\n============='))).toEqual(['paragraph'])
    expect(kinds(streamed('Summary\n| a | b |'))).toEqual(['paragraph', 'table'])
    expect(kinds(streamed('Done.\n-'))).toEqual(['paragraph'])
  })

  test('shows no empty heading, bullet or raw alert marker for a line still being typed', async () => {
    for (const [prefix, settled] of [
      ['Intro\n\n#', ['paragraph']],
      ['Intro\n\n##', ['paragraph']],
      ['Intro\n\n*', ['paragraph']],
      ['Intro\n\n**', ['paragraph']],
      ['Intro\n\n2.', ['paragraph']],
      ['> [!WARN', []],
      ['> [', []],
    ] as const) expect({ prefix, kinds: kinds(streamed(prefix)) }).toEqual({ prefix, kinds: [...settled] })
    expect(text(only(streamed('> [!WARNING]\n> x'), 'quote').blocks.flatMap(b => (b.kind === 'paragraph' ? b.spans : [])))).toBe('x')
    expect(only(streamed('# Done'), 'heading').level).toBe(1)
  })
})

describe('incremental parsing', () => {
  test('gives every prefix of a streamed reply the blocks a fresh parse gives', async () => {
    for (const message of CORPUS) {
      for (let end = 1; end <= message.length; end++) {
        const prefix = message.slice(0, end)
        for (const streaming of [true, false]) {
          const fresh = parseAfresh(prefix, { streaming })
          expect({ prefix, streaming, blocks: parseBlocks(prefix, { streaming }) }).toEqual({ prefix, streaming, blocks: fresh.blocks })
          expect({ prefix, streaming, outline: blocksOf(prefix, { streaming }) }).toEqual({ prefix, streaming, outline: fresh.outline })
        }
      }
    }
  })

  test('keeps the settled blocks of a growing reply as the same objects', async () => {
    const head = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with **bold**.`).join('\n\n')
    const before = parseBlocks(`${head}\n\nTail`)
    const after = parseBlocks(`${head}\n\nTail grows`)
    expect(after.slice(0, -1).every((block, i) => block === before[i])).toBe(true)
  })

  test('parses each token of a 100KB reply in a small share of a full parse', async () => {
    const ratio = bestRatio(attempt => {
      const prose = Array.from({ length: 900 }, (_, i) => `Line ${i}: see \`app/x_${i}.rb:${i}\`, **bold** and https://x.io/${attempt}/${i}.`).join('\n\n')
      const full = elapsed(() => parseAfresh(prose))
      parseBlocks(prose, { streaming: true })
      let streaming = 0
      for (let token = 0; token < 20; token++) streaming += elapsed(() => parseBlocks(`${prose} more${'x'.repeat(token)}`, { streaming: true }))
      return streaming / 20 / full
    })
    expect(ratio).toBeLessThan(1 / 10)
  })

  test('re-lexes only the growing tail block, however long the settled reply is', async () => {
    const settled = Array.from({ length: 900 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    const short = '```ts\nconst a = 1\n'
    const run = (head: string, attempt: number) => {
      const tail = `${short}${attempt}`
      parseBlocks(`${head}\n\n${tail}`, { streaming: true })
      return elapsed(() => {
        for (let token = 0; token < 50; token++) parseBlocks(`${head}\n\n${tail}${'b'.repeat(token)}`, { streaming: true })
      })
    }
    const excess = bestRatio(attempt => run(settled, attempt) - (run('Intro.', attempt) * 10 + 20))
    expect(excess).toBeLessThan(0)
  })

  test('forgets the oldest streamed prefixes once their text passes the byte budget', async () => {
    const body = 'x'.repeat(100_000)
    const prefix = (token: number) => `\`\`\`ts\n${body}${'y'.repeat(token)}`
    const first = parseBlocks(prefix(0), { streaming: true })
    let last = first
    for (let token = 1; token < 400; token++) last = parseBlocks(prefix(token), { streaming: true })
    expect(parseBlocks(prefix(399), { streaming: true })).toBe(last)
    expect(parseBlocks(prefix(0), { streaming: true })).not.toBe(first)
  })

  test('lets a reference definition written later resolve an earlier link', async () => {
    const blocks = parseBlocks('See [the docs][docs].\n\n[docs]: https://example.com')
    expect(only(blocks, 'paragraph').spans.find(s => s.href === 'https://example.com')).toBeDefined()
  })
})

describe('html in replies', () => {
  test('strikes deleted text instead of showing it as current', async () => {
    const spans = inlineSpans('Price <del>£100</del> £80, was <s>£120</s>.')
    expect(spans.filter(s => s.strike).map(s => s.text)).toEqual(['£100', '£120'])
    expect(text(spans)).toBe('Price £100 £80, was £120.')
  })

  test('keeps the address of an html link', async () => {
    const spans = inlineSpans('See <a href="https://example.com/docs">the setup docs</a> for details.')
    expect(spans.find(s => s.text === 'the setup docs')).toMatchObject({ kind: 'url', href: 'https://example.com/docs' })
    expect(text(inlineSpans('<a href="app/x.rb">x</a>'))).toBe('x app/x.rb')
    expect(text(inlineSpans('<a name="top">Top</a>'))).toBe('Top')
  })

  test('keeps a tag that has no closing partner, so generics survive', async () => {
    expect(text(inlineSpans('fn f<a>(x: u8) returns Vec<b> or Option<i>.'))).toBe('fn f<a>(x: u8) returns Vec<b> or Option<i>.')
    expect(text(inlineSpans('stray </b> close'))).toBe('stray </b> close')
    expect(text(inlineSpans('<constructor>x</constructor> <toString>y</toString>'))).toBe('<constructor>x</constructor> <toString>y</toString>')
    expect(text(inlineSpans('<Button>Save</Button>'))).toBe('<Button>Save</Button>')
  })

  test('styles bold, italic and code tags like their markdown', async () => {
    const spans = inlineSpans('<b>bold</b> <strong>strong</strong> <i>it</i> <em>em</em> <code>a | b</code> <kbd>Ctrl</kbd>')
    expect(spans.filter(s => s.bold).map(s => s.text)).toEqual(['bold', 'strong'])
    expect(spans.filter(s => s.italic).map(s => s.text)).toEqual(['it', 'em'])
    expect(spans.filter(s => s.kind === 'code').map(s => s.text)).toEqual(['a | b', 'Ctrl'])
  })

  test('keeps nested tags of one name paired', async () => {
    expect(inlineSpans('<b>out <b>in</b> out</b> after').filter(s => s.bold).map(s => s.text)).toEqual(['out in out'])
  })

  test('writes superscripts and subscripts so the number is still read as one', async () => {
    expect(text(inlineSpans('x<sup>2</sup> and H<sub>2</sub>O, e<sup>iπ</sup>'))).toBe('x² and H₂O, e^(iπ)')
  })

  test('draws a pre block as code with its spacing and asterisks kept', async () => {
    expect(parseBlocks('<pre>\n  indented   *ptr* stays\n    deeper\n</pre>')).toEqual([{ kind: 'code', language: '', source: '  indented   *ptr* stays\n    deeper' }])
    expect(only(parseBlocks('<pre lang="ruby"><code>x &lt; 1</code></pre>'), 'code')).toEqual({ kind: 'code', language: 'ruby', source: 'x < 1' })
    expect(only(parseBlocks('<pre><code class="language-ts">let a</code></pre>'), 'code').language).toBe('ts')
  })

  test('keeps an image tag as its alt text', async () => {
    expect(inlineSpans('<img src="https://x.io/a.png" alt="chart">')).toEqual([{ text: '[image: chart]', kind: 'image', href: 'https://x.io/a.png' }])
  })
})

describe('front matter', () => {
  test('leaves a status line between two rules as prose', async () => {
    expect(kinds(parseBlocks('---\nStatus: all green, 3 passed\n---\n\nDetails below.'))).toEqual(['rule', 'heading', 'paragraph'])
    expect(kinds(parseBlocks('---\nnote: this is all done now.\n---\n'))).not.toContain('code')
  })

  test('still reads lowercase yaml keys as front matter', async () => {
    expect(kinds(parseBlocks('---\ntitle: deploy notes\nowner: platform\n---\n\nBody'))).toEqual(['code', 'paragraph'])
  })

  test('needs a closing fence', async () => {
    expect(kinds(parseBlocks('---\ntitle: x\n'))).not.toContain('code')
  })
})

describe('blocksOf', () => {
  test('lists drawn blocks in order with the raw markdown of each', async () => {
    const message = '# Title\n\nSome **text**.\n\n```Ruby extra\nputs 1\n```\n\n| a | b |\n|---|---|\n| `x \\| y` | 2 |\n'
    expect(blocksOf(message)).toEqual([
      { kind: 'heading', source: '# Title', depth: 0, start: 0, end: 7 },
      { kind: 'paragraph', source: 'Some **text**.', depth: 0, start: 9, end: 23 },
      { kind: 'code', source: '```Ruby extra\nputs 1\n```', depth: 0, start: 25, end: 49, lang: 'ruby', text: 'puts 1' },
      { kind: 'table', source: '| a | b |\n|---|---|\n| `x \\| y` | 2 |\n', depth: 0, start: 51, end: message.length },
    ])
  })

  test('cuts top-level sources from the message in order', async () => {
    for (const message of CORPUS) {
      let from = 0
      for (const entry of blocksOf(message).filter(e => e.depth === 0)) {
        const at = message.indexOf(entry.source, from)
        expect({ entry: entry.source, found: at >= from }).toEqual({ entry: entry.source, found: true })
        from = at + entry.source.length
      }
    }
  })

  test('lists blocks inside quotes and lists one level deeper', async () => {
    const outline = blocksOf('> ```sh\n> ls\n> ```\n\n- item\n\n  | a |\n  |---|\n  | 1 |\n')
    expect(outline.map(e => `${e.depth}:${e.kind}`)).toEqual(['0:quote', '1:code', '0:list', '1:paragraph', '1:table'])
    expect(outline[1]).toMatchObject({ lang: 'sh', text: 'ls' })
  })

  test('gives front matter, pre blocks and over-deep nesting as the code blocks lucid draws', async () => {
    expect(blocksOf('---\ntitle: x\n---\nBody')[0]).toEqual({ kind: 'code', source: '---\ntitle: x\n---\n', depth: 0, start: 0, end: 17, lang: 'yaml', text: 'title: x' })
    expect(blocksOf('<pre>a\n b</pre>')).toEqual([{ kind: 'code', source: '<pre>a\n b</pre>', depth: 0, start: 0, end: 15, lang: '', text: 'a\n b' }])
    const deep = blocksOf('>'.repeat(40) + ' deep')
    expect(deep.at(-1)).toMatchObject({ kind: 'code', lang: '' })
    expect(blocksOf('<!-- note -->')).toEqual([])
  })

  test('omits what the screen holds back while streaming, and nothing once finished', async () => {
    expect(blocksOf('Columns:\n\nname | kind\n-----|-----', { streaming: true }).map(e => e.kind)).toEqual(['paragraph', 'paragraph'])
    expect(blocksOf('Columns:\n\nname | kind\n-----|-----').map(e => e.kind)).toEqual(['paragraph', 'table'])
  })

  test('gives a provisional streaming table the text that really arrived', async () => {
    expect(blocksOf('Summary\n\n| a | b |', { streaming: true }).at(-1)).toEqual({ kind: 'table', source: '| a | b |', depth: 0, start: 9, end: 18 })
  })

  test('gives an alert body without the alert marker lucid hides', async () => {
    expect(blocksOf('> [!NOTE]\n> body')).toEqual([
      { kind: 'quote', source: '> [!NOTE]\n> body', depth: 0, start: 0, end: 16 },
      { kind: 'paragraph', source: 'body', depth: 1, start: 12, end: 16 },
    ])
  })

  test('lists each consecutive footnote definition as its own paragraph', async () => {
    const message = '[^1]: one\n[^2]: https://x.io\n'
    expect(blocksOf(message).map(e => e.source)).toEqual(['[^1]: one\n', '[^2]: https://x.io\n'])
    expect(blocksOf(message).map(e => e.source).join('')).toBe(message)
  })

  test('lists the indented paragraphs of a footnote after its lead, without the indent', async () => {
    expect(blocksOf('[^n]: Lead\n\n    More.\n').map(e => `${e.depth}:${e.kind}:${e.source}`)).toEqual(['0:paragraph:[^n]: Lead', '1:paragraph:More.\n'])
  })

  test('locates every block in the text as given, nested and CRLF ones included', async () => {
    const message = '# T\r\n\r\n- item one\r\n  - child **x**\r\n\r\n> quoted\r\n> more\r\n'
    const located = blocksOf(message).map(e => [e.depth, e.kind, message.slice(e.start, e.end)])
    expect(located).toEqual([
      [0, 'heading', '# T'],
      [0, 'list', '- item one\r\n  - child **x**'],
      [1, 'paragraph', 'item one'],
      [1, 'list', '- child **x**'],
      [2, 'paragraph', 'child **x**'],
      [0, 'quote', '> quoted\r\n> more\r\n'],
      [1, 'paragraph', 'quoted\r\n> more'],
    ])
  })

  test('locates each streamed prefix in its own text', async () => {
    for (const message of CORPUS) {
      for (let end = 1; end <= message.length; end += 7) {
        const prefix = message.slice(0, end)
        for (const entry of blocksOf(prefix, { streaming: true }).filter(e => e.depth === 0)) expect({ prefix, at: prefix.slice(entry.start, entry.end) }).toEqual({ prefix, at: entry.source })
      }
    }
  })

  test('locates a nested block at its own content, never on a container marker with the same text', async () => {
    for (const [message, expected] of [
      ['1. 1\n2. 2\n', [[0, 0, 10], [1, 3, 4], [1, 8, 9]]],
      ['- 1. 1\n', [[0, 0, 7], [1, 2, 6], [2, 5, 6]]],
      ['1) 1)\n', [[0, 0, 6], [1, 3, 5]]],
      ['- - x\n', [[0, 0, 6], [1, 2, 5], [2, 4, 5]]],
    ] as const) expect({ message, at: blocksOf(message).map(e => [e.depth, e.start, e.end]) }).toEqual({ message, at: expected.map(entry => [...entry]) })
  })

  test('draws nothing for an empty message', async () => {
    expect(blocksOf('')).toEqual([])
    expect(blocksOf('\n\n  \n')).toEqual([])
  })
})

describe('ReplyStream', () => {
  test('treats a reply drawn outside a live turn as finished', async () => {
    const replies = new ReplyStream()
    expect(replies.isStreaming('old')).toBe(false)
    replies.turnStarted()
    expect(replies.isStreaming('old')).toBe(false)
  })

  test('streams a new reply until it is stored or the turn ends', async () => {
    const replies = new ReplyStream()
    replies.turnStarted()
    expect(replies.isStreaming('a')).toBe(true)
    expect(replies.isStreaming('b')).toBe(true)
    replies.stored('a')
    expect(replies.isStreaming('a')).toBe(false)
    expect(replies.isStreaming('b')).toBe(true)
    replies.turnEnded()
    expect(replies.isStreaming('b')).toBe(false)
    replies.turnStarted()
    expect(replies.isStreaming('b')).toBe(false)
  })
})

function shownSyntax(blocks: Block[]): string {
  return blocks
    .map(block => {
      if (block.kind === 'paragraph' || block.kind === 'heading') return text(block.spans)
      if (block.kind === 'code') return `code:${block.language}`
      if (block.kind === 'list') return block.items.map(item => `${item.marker}(${shownSyntax(item.blocks)})`).join(' ')
      if (block.kind === 'quote') return `quote${block.alert ? `:${block.alert}` : ''}(${shownSyntax(block.blocks)})`
      return block.kind
    })
    .join(' | ')
}

const SWEPT = [
  'Some **bold* and **bold** done',
  'x __bold_ y __bold__ and _it_',
  'a ~~strike~ b ~~strike~~',
  'Some **bold\ncontinues here** ok',
  `see \`${'tok '.repeat(30)}\` done`,
  'Intro\n\n```ruby\nputs 1\n```\n\nafter',
  'Intro\n\n~~~ruby\nputs 1\n~~~\n\nafter',
  'x < y and <!-- c --> and <a href="u">l</a> end',
  '| a | b |\n|---|---|\n| 1 | **2** |\n',
  '- [ ] task\n- [x] done\n',
  '[x]: https://x.y\n\nsee [ref][x] now\n',
  'an image ![alt](http://i.png) inline',
  '- item **one\n  two** three\n- next',
  '> [!NOTE]\n> a `b` **c**\n',
  '1. one\n2. two\n10. ten\n',
]

function isInOrder(shown: string, final: string): boolean {
  let at = 0
  for (const char of shown) {
    at = final.indexOf(char, at) + 1
    if (at === 0) return false
  }
  return true
}

describe('streaming shows no syntax still being typed', () => {
  test('holds back a fence until its info string is finished', async () => {
    for (const prefix of ['Intro\n\n```s', 'Intro\n\n~~~rub', 'Intro\n\n```', '- step\n\n  ```js']) expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown: prefix.startsWith('-') ? 'bullet(step)' : 'Intro' })
    expect(shownSyntax(streamed('Intro\n\n```sh\n'))).toBe('Intro | code:sh')
  })

  test('holds back a bare quote marker, a task box and a footnote label until they mean something', async () => {
    for (const prefix of ['Intro\n\n>', 'Intro\n\n> ', 'Intro\n\n> >', 'Intro\n\n- [', 'Intro\n\n- [x', 'Intro\n\n- [ ]', 'Intro\n\n[^1', 'Intro\n\n[^1]:']) expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown: 'Intro' })
    expect(shownSyntax(streamed('Intro\n\n> [!WARNING]\n> x'))).toBe('Intro | quote:warning(x)')
    expect(shownSyntax(streamed('Intro\n\n- [ ] x'))).toBe('Intro | todo(x)')
  })

  test('holds back a half-typed closing fence, a table row before its second pipe and a lone bullet dash', async () => {
    for (const prefix of ['Intro\n\n```ruby\nputs 1\n`', 'Intro\n\n```ruby\nputs 1\n``', 'Intro\n\n~~~ruby\nputs 1\n~~']) expect({ prefix, code: only(streamed(prefix), 'code').source }).toEqual({ prefix, code: 'puts 1' })
    for (const prefix of ['Intro\n\n|', 'Intro\n\n| a', 'Intro\n\n| a ']) expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown: 'Intro' })
    expect(shownSyntax(streamed('-'))).toBe('')
    expect(shownSyntax(streamed('- '))).toBe('')
  })

  test('holds back an opener inside the last table row until it closes', async () => {
    const table = only(streamed('| a | b |\n|---|---|\n| 1 | **2'), 'table')
    expect(table.rows.map(row => row.map(text))).toEqual([['1', '']])
  })

  test('never shows a frame whose text the finished reply does not contain in order', async () => {
    for (const message of SWEPT) {
      const final = shownSyntax(parseBlocks(message)).replace(/\s+/g, '')
      for (let end = 1; end <= message.length; end++) {
        const prefix = message.slice(0, end)
        expect({ prefix, inOrder: isInOrder(shownSyntax(streamed(prefix)).replace(/\s+/g, ''), final) }).toEqual({ prefix, inOrder: true })
      }
    }
  })

  test('never glues the next list number onto the item before it', async () => {
    expect(shownSyntax(streamed('1. one\n2'))).toBe('number(one)')
    expect(shownSyntax(streamed('1. one\n2.'))).toBe('number(one)')
    expect(shownSyntax(streamed('1. one\n2. two'))).toBe('number(one) number(two)')
  })

  test('holds back an inline opener until its closer arrives', async () => {
    for (const [prefix, shown] of [
      ['Some **bol', 'Some'],
      ['Some *it', 'Some'],
      ['a ~~gone', 'a'],
      ['run `npm', 'run'],
      ['see [docs', 'see'],
      ['see [docs]', 'see'],
      ['see [docs](https://e.c', 'see'],
      ['see ![logo](a.png', 'see'],
      ['x <b>bo', 'x'],
      ['x <b', 'x'],
      ['x </b', 'x'],
      ['x <a href="https://e', 'x'],
      ['- see **bol', 'bullet(see)'],
      ['> see **bol', 'quote(see)'],
      ['## Title **bo', 'Title'],
      ['Done **bold** and `x` then **mo', 'Done bold and x then'],
      ['Some **bold*', 'Some'],
      ['x __bold_', 'x'],
      ['a ~~strike~', 'a'],
      ['Some **bold\ncontinues here', 'Some'],
      ['- item **one\n  two', 'bullet(item)'],
      [`see \`${'tok '.repeat(30)}`, 'see'],
      [`a **${'word '.repeat(30)}`, 'a'],
      ['x <', 'x'],
      ['x <!', 'x'],
      ['x <!-', 'x'],
      ['x <!-- note', 'x'],
      ['a <a h', 'a'],
      ['a <a ', 'a'],
      ['a <a href="u" t', 'a'],
      ['see [ref][', 'see'],
      ['see [ref][x', 'see'],
      ['an image !', 'an image'],
    ] as const) expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown })
    expect(shownSyntax(streamed('<details>\n<sum'))).toBe('')
    expect(shownSyntax(streamed('see [docs](https://e.com)'))).toBe('see docs')
  })

  test('shows finished inline text whole, closed or never meant to close', async () => {
    for (const [prefix, shown] of [
      ['Some **bold** done', 'Some bold done'],
      ['5 * 3 = 15', '5 * 3 = 15'],
      ['snake_case_name here', 'snake_case_name here'],
      ['open ~/x/y.rb now', 'open ~/x/y.rb now'],
      ['if a<b then c', 'if a<b then c'],
      ['Vec<i32> works', 'Vec<i32> works'],
      ['use a <Button> here', 'use a <Button> here'],
      ['line one [x\nline two', 'line one [x\nline two'],
      [`odd [ ${'word '.repeat(20)}end`, `odd [ ${'word '.repeat(20)}end`],
      ['Some **bold* text', 'Some *bold text'],
      ['line one *x\n\nline two', 'line one *x | line two'],
      ['I have <a few apples', 'I have <a few apples'],
    ] as const) expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown })
  })

  test('holds nothing back once the reply is finished', async () => {
    for (const message of ['Great!', 'Some **bol', 'see [docs](https://e.c', 'x <b>bo', 'Intro\n\n```s', '1. one\n2', 'Intro\n\n>']) expect(parseBlocks(message)).toEqual(parseAfresh(message).blocks)
    expect(shownSyntax(parseBlocks('Some **bol'))).toBe('Some **bol')
    expect(shownSyntax(parseBlocks('x <b>bo'))).toBe('x <b>bo')
  })
})
