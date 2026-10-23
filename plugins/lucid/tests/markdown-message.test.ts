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

function expectAsFinished(prefix: string): void {
  expect({ prefix, frame: streamed(prefix) }).toEqual({ prefix, frame: parseBlocks(prefix) })
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
    expect(kinds(streamed('Summary\n| a | b |'))).toEqual(['paragraph'])
    expect(kinds(streamed('Summary\n| a | b |\n|-'))).toEqual(['paragraph', 'table'])
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

  test('keeps a block tag named in prose as written, and still drops one that pairs', async () => {
    for (const prose of ['Wrap it in <p> tags and use <div> for layout.', 'A <table> has <tr> rows.', 'Close with </div> at the end.', 'The <summary> element sits in <details>.', 'Rule off with <hr> here.'])
      expect(text(parseBlocks(prose).flatMap(block => (block.kind === 'paragraph' ? block.spans : [])))).toBe(prose)
    expect(text(inlineSpans('a <span>b</span> <div>c</div> d'))).toBe('a b c d')
    expect(text(inlineSpans('soft<wbr>break'))).toBe('softbreak')
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
    expect(inlineSpans('<img src="https://x.io/a.png" alt="chart">')).toEqual([{ text: '[image: chart]', kind: 'image', href: 'https://x.io/a.png', src: 'https://x.io/a.png' }])
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
      { kind: 'table', source: '| a | b |\n|---|---|\n| `x \\| y` | 2 |', depth: 0, start: 51, end: message.length - 1 },
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
    expect(blocksOf('---\ntitle: x\n---\nBody')[0]).toEqual({ kind: 'code', source: '---\ntitle: x\n---', depth: 0, start: 0, end: 16, lang: 'yaml', text: 'title: x' })
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
    expect(blocksOf('Summary\n\n| a | b |\n|-', { streaming: true }).at(-1)).toEqual({ kind: 'table', source: '| a | b |', depth: 0, start: 9, end: 18 })
  })

  test('gives an alert body without the alert marker lucid hides', async () => {
    expect(blocksOf('> [!NOTE]\n> body')).toEqual([
      { kind: 'quote', source: '> [!NOTE]\n> body', depth: 0, start: 0, end: 16 },
      { kind: 'paragraph', source: 'body', depth: 1, start: 12, end: 16 },
    ])
  })

  test('lists each consecutive footnote definition as its own paragraph', async () => {
    const message = '[^1]: one\n[^2]: https://x.io\n'
    expect(blocksOf(message).map(e => e.source)).toEqual(['[^1]: one', '[^2]: https://x.io'])
    expect(blocksOf(message).map(e => `${e.source}\n`).join('')).toBe(message)
  })

  test('lists the indented paragraphs of a footnote after its lead, without the indent', async () => {
    expect(blocksOf('[^n]: Lead\n\n    More.\n').map(e => `${e.depth}:${e.kind}:${e.source}`)).toEqual(['0:paragraph:[^n]: Lead', '1:paragraph:More.'])
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
      [0, 'quote', '> quoted\r\n> more'],
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
      ['1. 1\n2. 2\n', [[0, 0, 9], [1, 3, 4], [1, 8, 9]]],
      ['- 1. 1\n', [[0, 0, 6], [1, 2, 6], [2, 5, 6]]],
      ['1) 1)\n', [[0, 0, 5], [1, 3, 5]]],
      ['- - x\n', [[0, 0, 5], [1, 2, 5], [2, 4, 5]]],
    ] as const) expect({ message, at: blocksOf(message).map(e => [e.depth, e.start, e.end]) }).toEqual({ message, at: expected.map(entry => [...entry]) })
  })

  test('reads a first-line heading after a byte order mark and locates it past the mark', async () => {
    const message = '\uFEFF# bom\n\ntext'
    expect(kinds(parseBlocks(message))).toEqual(['heading', 'paragraph'])
    expect(blocksOf(message).map(e => message.slice(e.start, e.end))).toEqual(['# bom', 'text'])
    expect(blocksOf('\uFEFF# a\r\n\r\nb').map(e => [e.start, e.end])).toEqual([[1, 4], [8, 9]])
  })

  test('gives every source without a trailing newline, whatever its kind', async () => {
    const message = '- a\n- b\n\n> q\n\n```sh\nls\n```\n\n| a |\n|---|\n| 1 |\n\n[^1]: one\n\n    Two.\n'
    expect(blocksOf(message).filter(e => e.source.endsWith('\n')).map(e => e.source)).toEqual([])
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

function codeSources(blocks: Block[]): string[] {
  return blocks.flatMap(block => {
    if (block.kind === 'code') return [block.source]
    if (block.kind === 'quote') return codeSources(block.blocks)
    if (block.kind === 'list') return block.items.flatMap(item => codeSources(item.blocks))
    return []
  })
}

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
  `see \`${'tok '.repeat(15)}\` done`,
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

  test('shows an unclosed opener in the last table row as written, inside its own cell, until it closes', async () => {
    expect(only(streamed('| a | b |\n|---|---|\n| 1 | **2'), 'table').rows.map(row => row.map(text))).toEqual([['1', '**2']])
    expect(only(streamed('| a | b |\n|---|---|\n| _id | x'), 'table').rows.map(row => row.map(text))).toEqual([['_id', 'x']])
    const closed = only(streamed('| a | b |\n|---|---|\n| 1 | **2**'), 'table')
    expect(closed.rows[0]?.[1]?.[0]).toMatchObject({ text: '2', bold: true })
  })

  test('never shows a frame whose text the same prefix finished, or the finished reply, does not contain in order', async () => {
    for (const message of SWEPT) {
      const final = shownSyntax(parseBlocks(message)).replace(/\s+/g, '')
      for (let end = 1; end <= message.length; end++) {
        const prefix = message.slice(0, end)
        const finished = shownSyntax(parseBlocks(prefix)).replace(/\s+/g, '')
        expect({ prefix, inOrder: isInOrder(shownSyntax(streamed(prefix)).replace(/\s+/g, ''), finished) || isInOrder(shownSyntax(streamed(prefix)).replace(/\s+/g, ''), final) }).toEqual({ prefix, inOrder: true })
      }
    }
  })

  test('never glues the next list number onto the item before it', async () => {
    expect(shownSyntax(streamed('1. one\n2'))).toBe('number(one)')
    expect(shownSyntax(streamed('1. one\n2.'))).toBe('number(one)')
    expect(shownSyntax(streamed('1. one\n2. two'))).toBe('number(one) number(two)')
  })

  test('holds back only a line-start marker that could still become a block', async () => {
    for (const [prefix, shown] of [
      ['* *', ''],
      ['- 1.', ''],
      ['Intro\n\n>', 'Intro'],
      ['Intro\n\n- ', 'Intro'],
    ] as const) expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown })
  })

  test('shows an unfinished link, tag, entity or inline marker exactly as the same text finished', async () => {
    for (const prefix of ['Some **', 'Some *', 'a ~~', 'run `', 'run ``', 'x <b>', 'see [docs', 'see [docs]', 'see [docs](https://e.c', 'see ![logo](a.png', 'x <b', 'x </b', 'x <a href="https://e', '- see **', 'x <', 'x <!', 'x <!-- note', 'a <a h', 'see [ref][x', 'an image !']) expectAsFinished(prefix)
    expect(shownSyntax(streamed('see [docs](https://e.com)'))).toBe('see docs')
  })

  test('shows an unclosed opener as written while its closer streams, then restyles the span', async () => {
    for (const prefix of ['Some **bol', 'Some *it', 'a ~~gone', 'run `npm', 'x <b>bo', '## Title **bo', 'Done **bold** and `x` then **mo', 'Some **bold*', 'a **bold *it', '- item **one\n  two', '> see **bol']) expectAsFinished(prefix)
    expect(shownSyntax(streamed('Some **bol'))).toBe('Some **bol')
    for (const [prefix, style] of [
      ['Some **bold**', 'bold'],
      ['Some *it*', 'italic'],
      ['a ~~gone~~', 'strike'],
      ['x <u>un</u>', 'underline'],
    ] as const) expect({ prefix, styled: only(streamed(prefix), 'paragraph').spans.at(-1)?.[style] }).toEqual({ prefix, styled: true })
  })

  test('shows an opener that never closes as written once the reply is finished', async () => {
    for (const message of ['Some **bol', 'run `npm', 'x <b>bo', 'a ~~gone']) expect(shownSyntax(parseBlocks(message))).toBe(message)
  })

  test('shows a both-flanking star, a lone tilde or a lone backtick as written on every frame', async () => {
    for (const head of ['3*4 = 12', '~5 minutes', 'a*b']) {
      const message = `${head} and then the sentence keeps going with ordinary words for a long while`
      expect(shownSyntax(streamed(message))).toBe(message)
    }
    expect(shownSyntax(streamed('2*3*4'))).toBe(shownSyntax(parseBlocks('2*3*4')))
    expect(shownSyntax(streamed('Press the ` key\nthen go on'))).toBe('Press the ` key\nthen go on')
  })

  test('never lags a single-line paragraph behind an inline opener that never closes', async () => {
    const tail = ' and then the sentence keeps going with ordinary words for quite a long while, until it finally stops here.'
    for (const head of ['Use <b>bold', 'Use <u>under', 'Use <ins>v2', 'Use <em>x', 'Use <span>x', 'Use <kbd>Ctrl', 'Use <a href="x">link', 'Type `foo', 'The `x key', 'Type ``code', 'f(*args, **kwargs)', 'Call __dunder', 'Was ~~old', 'About ~5 minutes', '3*4 = 12']) {
      const message = `${head}${tail}`
      for (let end = head.indexOf(' ') + 1; end <= message.length; end++) {
        const prefix = message.slice(0, end)
        expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown: shownSyntax(parseBlocks(prefix)) })
      }
    }
  })

  test('outlines a block with an unclosed opener by the text that really arrived', async () => {
    for (const prefix of ['Some **bol', 'x\n\nrun `npm', '- item <b>bo']) {
      const entries = blocksOf(prefix, { streaming: true })
      for (const entry of entries) expect({ prefix, at: prefix.slice(entry.start, entry.end), source: entry.source.includes('**bol**') || entry.source.endsWith('`') || entry.source.endsWith('</b>') }).toEqual({ prefix, at: entry.source, source: false })
    }
  })

  test('shows a footnote reference as written until its definition arrives', async () => {
    const reply = 'Claim[^1] and more[^note].\n\n[^1]: First.\n[^note]: Second.'
    const head = reply.slice(0, reply.indexOf('\n'))
    expect(shownSyntax(streamed(head))).toBe(head)
    expect(only(streamed(head), 'paragraph').spans.some(span => span.kind === 'footnote')).toBe(false)
    expect(only(streamed(`${head}\n\n[^1]: First.\n`), 'paragraph').spans.filter(span => span.kind === 'footnote').map(span => span.text)).toEqual(['[1]'])
    expect(only(parseBlocks(reply), 'paragraph').spans.filter(span => span.kind === 'footnote').map(span => span.text)).toEqual(['[1]', '[note]'])
    expect(shownSyntax(parseBlocks('Claim[^1] with no definition'))).toBe('Claim[^1] with no definition')
  })

  test('shows a full reference link as written until its definition arrives', async () => {
    const head = 'See [the docs][d] and [Other][ X  Y ] here'
    expect(shownSyntax(streamed(head))).toBe(head)
    const spans = only(streamed(`${head}\n\n[d]: https://e.com/d\n`), 'paragraph').spans
    expect(spans.find(span => span.text === 'the docs')?.href).toBe('https://e.com/d')
    expect(shownSyntax(parseBlocks(head))).toBe(head)
    expect(shownSyntax(streamed('a [x] b [] c'))).toBe('a [x] b [] c')
    expect(shownSyntax(streamed('See [the docs][d] now.\n\n[d]:'))).toBe('See [the docs][d] now.')
    for (const end of ['h', 'https:', 'https://e.co']) {
      const prefix = `See [the docs][d] now.\n\n[d]: ${end}`
      expect({ end, shown: streamed(prefix) }).toEqual({ end, shown: parseBlocks(prefix) })
    }
  })

  test('shows bracketed indexes and nested params as written on every frame', async () => {
    for (const message of ['Use params[:user][:name] in the controller', 'Index matrix[i][j] and more', 'Read a[0][1] and b[x][y].', 'Array syntax arr[^1] here.']) {
      for (let end = 1; end <= message.length; end++) {
        const prefix = message.slice(0, end)
        expect({ prefix, shown: shownSyntax(streamed(prefix)) }).toEqual({ prefix, shown: prefix })
      }
    }
  })

  test('keeps a finished reply apart from the streamed frames it grew from', async () => {
    const head = 'Claim[^1] and [the docs][d] here.'
    streamed(head)
    expect(parseBlocks(head)).toEqual(parseAfresh(head).blocks)
  })

  test('closes the gap an inline comment leaves between two words', async () => {
    for (const [source, shown] of [
      ['a <!-- hidden --> b', 'a b'],
      ['a<!-- hidden --> b', 'a b'],
      ['a <!-- hidden -->b', 'a b'],
      ['<!-- hidden --> lead', ' lead'],
    ] as const) expect({ source, shown: text(inlineSpans(source)) }).toEqual({ source, shown })
  })

  test('shows an unfinished link destination as written until it closes', async () => {
    for (const prefix of [`See [x](https://e.com/${'a'.repeat(120)} and more`, `See [x](https://e.com/${'a'.repeat(120)}`]) expectAsFinished(prefix)
    expect(shownSyntax(streamed(`See [x](https://e.com/${'a'.repeat(120)})`))).toBe('See x')
  })

  test('holds a pre closing tag back like a closing fence, and shows a partial autolink as written', async () => {
    for (const close of ['<', '</', '</pr', '</pre']) expect({ close, code: only(streamed(`Text\n\n<pre lang="rb">\nputs 1\n${close}`), 'code').source }).toEqual({ close, code: 'puts 1' })
    for (const prefix of ['Go <https://e.com/x', 'Go <h', 'Mail <me@exampl', 'Go <https://e.com/x and on']) expectAsFinished(prefix)
    expect(shownSyntax(streamed('Go <https://e.com/x> now'))).toBe('Go https://e.com/x now')
  })

  test('holds a closing fence still streaming inside a quote', async () => {
    for (const prefix of ['> ```sh\n> ls\n> `', '> ```sh\n> ls\n> ``', '> - s\n>   ```sh\n>   ls\n>   `', '> > ~~~sh\n> > ls\n> > ~']) expect({ prefix, code: codeSources(streamed(prefix)) }).toEqual({ prefix, code: ['ls'] })
    expect(codeSources(streamed('> ```sh\n> ls\n> ```'))).toEqual(['ls'])
  })

  test('shows a self-closing tag as written until its bracket arrives', async () => {
    for (const prefix of ['x <br/', 'x <br /', 'See <img src="a"/', 'x <hr/', 'a/b <c/d']) expectAsFinished(prefix)
    expect(only(streamed('x <br/> y'), 'paragraph').spans.map(span => span.text).join('')).toBe('x\ny')
  })

  test('shows a trailing partial entity as written until it completes', async () => {
    for (const prefix of ['AT&amp', 'x &lt', 'x &#16', 'x &', '<pre><code>x &l']) expectAsFinished(prefix)
    for (const done of ['AT&T rocks', 'R&D team', 'a && b', 'x &amp; y']) expect(shownSyntax(streamed(done))).toBe(shownSyntax(parseBlocks(done)))
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
  test('streams a URL, autolink or path holding _ * ~ without cutting it at the delimiter', async () => {
    for (const [message, final] of [
      ['see https://e.com/a_(b) and the sentence goes on for a while', 'see https://e.com/a_(b) and the sentence goes on for a while'],
      ['see https://e.com/~user and the sentence goes on for a while', 'see https://e.com/~user and the sentence goes on for a while'],
      ['See https://en.wikipedia.org/wiki/Foo_(bar) for the background on it', 'See https://en.wikipedia.org/wiki/Foo_(bar) for the background on it'],
      ['open <https://e.com/x*y> and the sentence goes on for a while', 'open https://e.com/x*y and the sentence goes on for a while'],
      ['open <https://example.com/a_(b)> and the sentence goes on', 'open https://example.com/a_(b) and the sentence goes on'],
      ['path src/_build/x and the sentence goes on for a while', 'path src/_build/x and the sentence goes on for a while'],
      ['glob **/*.ts and the sentence goes on for a while', 'glob **/*.ts and the sentence goes on for a while'],
      ['see www.e.com/a_b and the sentence goes on for a while', 'see www.e.com/a_b and the sentence goes on for a while'],
    ] as const) {
      const angles = message.length - final.length
      for (let end = message.indexOf(' ', message.indexOf('/')) + 1; end <= message.length; end++) {
        const shown = shownSyntax(streamed(message.slice(0, end)))
        expect({ message, end, prefix: final.startsWith(shown), lag: end - angles - shown.length <= 2 }).toEqual({ message, end, prefix: true, lag: true })
      }
    }
  })

  test('streams emphasis after a slash or around a path exactly as the same text finished', async () => {
    for (const message of ['Pick **Note**/**Warning** to go on', 'say yes/_no_ then', 'Edit _src/main.rs_ now', 'Edit __lib/a.ts__ now', 'see (_src/a.rs_) now', 'ratio 1/*x* now', 'path src/_build/x and on']) {
      for (let end = 1; end <= message.length; end++) expectAsFinished(message.slice(0, end))
    }
  })

  test('styles emphasis that closes after a slash once the closer arrives', async () => {
    expect(only(streamed('say yes/_no_'), 'paragraph').spans.at(-1)).toMatchObject({ text: 'no', italic: true })
    expect(only(streamed('Pick **Note**/**Warning**'), 'paragraph').spans.at(-1)).toMatchObject({ text: 'Warning', bold: true })
  })

  test('streams an angle autolink exactly as the same text finished, with no lag', async () => {
    const message = 'Read <https://example.com/very/long/path/that/goes/on/x_y> now'
    for (let end = 1; end <= message.length; end++) expectAsFinished(message.slice(0, end))
    expect(shownSyntax(parseBlocks(message))).toBe('Read https://example.com/very/long/path/that/goes/on/x_y now')
  })

  test('drops the brackets of an angle email link once it closes', async () => {
    const message = 'Mail <first.last@example.co.uk> now'
    for (let end = 1; end <= message.length; end++) expectAsFinished(message.slice(0, end))
    expect(shownSyntax(streamed(message))).toBe('Mail first.last@example.co.uk now')
  })

  test('ends a bare link before an unbalanced closing parenthesis', async () => {
    expect(only(streamed('see (https://e.com/a_b) now'), 'paragraph').spans.find(span => span.href !== undefined)?.href).toBe('https://e.com/a_b')
    expect(shownSyntax(streamed('see (_src/a.rs_)'))).toBe('see (src/a.rs)')
  })

  test('still opens emphasis right after a URL', async () => {
    expect(only(streamed('see https://e.com/a and *then*'), 'paragraph').spans.at(-1)).toMatchObject({ text: 'then', italic: true })
    expect(shownSyntax(streamed('see *https://e.com/a_b*'))).toBe('see https://e.com/a_b')
    expect(shownSyntax(streamed('see [https://e.com/a_b](https://e.com/a_b) and *then*'))).toBe('see https://e.com/a_b and then')
  })

  test('lags a lone backtick or literal tag followed by a space by no more than a literal opener is held', async () => {
    for (const message of ['Type ` to start the inline editor and keep typing until the line ends, which is long', 'Use the <b> tag sparingly in prose, it rarely survives a terminal render anyway']) {
      for (let end = 1; end <= message.length; end++) {
        const prefix = message.slice(0, end)
        const lag = prefix.length - shownSyntax(streamed(prefix)).length
        expect({ prefix, short: lag <= 1 }).toEqual({ prefix, short: true })
      }
    }
  })

  test('shows a trailing backslash as written until the next line makes it a hard break', async () => {
    for (const prefix of ['line one\\', 'line one\\\n']) expectAsFinished(prefix)
    expect(shownSyntax(streamed('line one\\\nline two'))).toBe('line one\nline two')
  })

  test('balances parentheses in a link destination', async () => {
    const message = 'See [docs](https://e.com/a_(b)) and more words follow'
    for (let end = 1; end <= message.length; end++) expectAsFinished(message.slice(0, end))
    expect(only(streamed(message), 'paragraph').spans.find(span => span.href !== undefined)?.href).toBe('https://e.com/a_(b)')
  })

  test('drops the spaces around a break tag', async () => {
    for (const source of ['and <br> for', 'and<br/>  for', 'and <br />for']) expect({ source, shown: text(inlineSpans(source)) }).toEqual({ source, shown: 'and\nfor' })
  })
})
