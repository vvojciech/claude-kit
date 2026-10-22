import { describe, expect, test } from 'claude-code/testing'

import { decodeEntities } from '../hooks/entities'
import { tagOf } from '../hooks/html'
import { inlineSpans, isPath, isProsePath, shellSpans } from '../hooks/markdown'
import { blocksOf, parseBlocks } from '../hooks/message'
import type { Block, Span } from '../hooks/markdown'

function text(spans: Span[]): string {
  return spans.map(s => s.text).join('')
}

function kinds(blocks: Block[]): string[] {
  return blocks.map(b => b.kind)
}

function only<K extends Block['kind']>(blocks: Block[] | undefined, kind: K): Extract<Block, { kind: K }> {
  const found = blocks?.find(b => b.kind === kind)
  if (!found) throw new Error(`no ${kind} in ${JSON.stringify(blocks)}`)
  return found as Extract<Block, { kind: K }>
}

function streamed(text: string): Block[] {
  return parseBlocks(text, { streaming: true })
}

function elapsed(run: () => unknown): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

describe('parseBlocks', () => {
  test('splits headings, lists, tables and fences', async () => {
    const blocks = parseBlocks(['# Title', '', '- one', '  - two', '- [x] done', '', '| a | b |', '|---|--:|', '| x | 1 |', '', '```ruby', 'puts 1', '```'].join('\n'))
    expect(kinds(blocks)).toEqual(['heading', 'list', 'table', 'code'])
  })

  test('starts a new list when the marker type changes after a blank line', async () => {
    const blocks = parseBlocks('- a\n- b\n\n1. one\n   1. nested\n\n2. two\n\n- [ ] task')
    expect(blocks.map(b => (b.kind === 'list' ? b.items.length : 0))).toEqual([2, 2, 1])
    const ordered = blocks[1] as Extract<Block, { kind: 'list' }>
    expect(only(ordered.items[0]?.blocks, 'list').items.length).toBe(1)
  })

  test('keeps an unclosed fence as code while streaming', async () => {
    const blocks = parseBlocks('text\n\n```ts\nconst a = 1')
    expect(blocks.at(-1)).toEqual({ kind: 'code', language: 'ts', source: 'const a = 1' })
  })

  test('does not split a table cell on a pipe inside code', async () => {
    const table = only(parseBlocks('| cmd | why |\n|---|---|\n| `a | b` | pipe |'), 'table')
    expect(table.rows.map(row => row.map(text))).toEqual([['a | b', 'pipe']])
    expect(table.rows[0]?.[0]?.[0]?.kind).toBe('code')
  })

  test('keeps the rest of the message after a table with code pipes', async () => {
    const blocks = parseBlocks('| a | b |\n|---|---|\n| `x | y` | z |\n\n# After')
    expect(kinds(blocks)).toEqual(['table', 'heading'])
  })
})

describe('code fences', () => {
  test('keeps a fenced block inside a list item as code', async () => {
    const list = only(parseBlocks('1. Run:\n   ```bash\n   npm i\n   ```\n2. Then test'), 'list')
    expect(kinds(list.items[0]?.blocks ?? [])).toEqual(['paragraph', 'code'])
    expect(only(list.items[0]?.blocks, 'code')).toEqual({ kind: 'code', language: 'bash', source: 'npm i' })
    expect(list.items.length).toBe(2)
  })

  test('does not open a fence on a line with inline triple backticks', async () => {
    const blocks = parseBlocks('Para\n```js const x``` is inline\nmore text\n\n# Next heading')
    expect(kinds(blocks)).toEqual(['paragraph', 'heading'])
  })

  test('does not close a fence on a line that carries an info string', async () => {
    expect(parseBlocks('```\ncode\n```js\nstill code\n```')).toEqual([{ kind: 'code', language: '', source: 'code\n```js\nstill code' }])
  })

  test('strips the opening indent from fence lines', async () => {
    expect(parseBlocks('  ```\n  indented fence\n    deeper\n  ```')).toEqual([{ kind: 'code', language: '', source: 'indented fence\n  deeper' }])
  })

  test('takes the language from the first word of the info string', async () => {
    expect(only(parseBlocks('```TypeScript title="a.ts"\nx\n```'), 'code').language).toBe('typescript')
  })

  test('reads four-space indented lines as code', async () => {
    expect(parseBlocks('Intro\n\n    indented code line one\n      indented deeper')[1]).toEqual({ kind: 'code', language: '', source: 'indented code line one\n  indented deeper' })
  })

  test('keeps a fence open mid-stream until it closes', async () => {
    const partial = parseBlocks('Before\n\n```py\ndef f():\n    return 1\n')
    expect(kinds(partial)).toEqual(['paragraph', 'code'])
    expect(kinds(parseBlocks('Before\n\n```py\ndef f():\n    return 1\n```\n\nAfter'))).toEqual(['paragraph', 'code', 'paragraph'])
  })
})

describe('lists', () => {
  test('keeps a second paragraph inside its item', async () => {
    const blocks = parseBlocks('1. one\n2. two\n\n   Second paragraph of step two.\n3. three')
    const list = only(blocks, 'list')
    expect(blocks.length).toBe(1)
    expect(list.items.map(item => kinds(item.blocks))).toEqual([['paragraph'], ['paragraph', 'paragraph'], ['paragraph']])
  })

  test('joins a lazy continuation line to its item', async () => {
    const list = only(parseBlocks('- item\nlazy continuation line\n- next'), 'list')
    expect(list.items.length).toBe(2)
    expect(text(only(list.items[0]?.blocks, 'paragraph').spans)).toBe('item\nlazy continuation line')
  })

  test('keeps the parenthesis delimiter of an ordered list', async () => {
    expect(only(parseBlocks('1) a\n2) b'), 'list').items.map(i => i.number)).toEqual(['1)', '2)'])
  })

  test('numbers an ordered list from its start, not the literal markers', async () => {
    expect(only(parseBlocks('1. a\n1. b\n1. c'), 'list').items.map(i => i.number)).toEqual(['1.', '2.', '3.'])
    expect(only(parseBlocks('7. g\n8. h\n1. i'), 'list').items.map(i => i.number)).toEqual(['7.', '8.', '9.'])
  })

  test('does not let a year interrupt a paragraph as a list', async () => {
    expect(kinds(parseBlocks('It was\n2024. was good'))).toEqual(['paragraph'])
  })

  test('nests four-space children one level at a time', async () => {
    const outer = only(parseBlocks('- top\n    - child\n        - grandchild'), 'list')
    const child = only(outer.items[0]?.blocks, 'list')
    const grandchild = only(child.items[0]?.blocks, 'list')
    expect(text(only(grandchild.items[0]?.blocks, 'paragraph').spans)).toBe('grandchild')
  })

  test('marks tasks in any list, including an empty one', async () => {
    expect(only(parseBlocks('- [x] done\n- [ ] todo\n1. [ ] numbered'), 'list').items.map(i => i.marker)).toEqual(['done', 'todo'])
    expect(only(parseBlocks('1. [x] shipped'), 'list').items[0]?.marker).toBe('done')
  })
})

describe('quotes', () => {
  test('parses lists, code and headings inside a quote', async () => {
    const quote = only(parseBlocks('> # Title\n> - list in quote\n>\n> ```\n> code\n> ```'), 'quote')
    expect(kinds(quote.blocks)).toEqual(['heading', 'list', 'code'])
  })

  test('nests a quote inside a quote with its full content', async () => {
    const outer = only(parseBlocks('> outer\n> > inner **bold**\n> > - item'), 'quote')
    const inner = only(outer.blocks, 'quote')
    expect(kinds(inner.blocks)).toEqual(['paragraph', 'list'])
    expect(only(inner.blocks, 'paragraph').spans.find(s => s.bold)?.text).toBe('bold')
  })

  test('keeps a lazy continuation line inside the quote', async () => {
    const blocks = parseBlocks('> quoted\nlazy line')
    expect(kinds(blocks)).toEqual(['quote'])
  })

  test('reads a GitHub alert as a labelled quote', async () => {
    const quote = only(parseBlocks('> [!WARNING]\n> **Mind** the gap'), 'quote')
    expect(quote.alert).toBe('warning')
    expect(text(only(quote.blocks, 'paragraph').spans)).toBe('Mind the gap')
  })

  test('leaves an ordinary bracketed quote alone', async () => {
    const quote = only(parseBlocks('> [!NOTE] inline is not an alert'), 'quote')
    expect(quote.alert).toBeUndefined()
  })
})

describe('headings', () => {
  test('reads setext headings', async () => {
    expect(parseBlocks('Setext title\n============\n\nAnother\n---\n')).toEqual([
      { kind: 'heading', level: 1, spans: [{ text: 'Setext title', kind: 'plain' }] },
      { kind: 'heading', level: 2, spans: [{ text: 'Another', kind: 'plain' }] },
    ])
  })

  test('keeps a hash that is part of the title', async () => {
    expect(text(only(parseBlocks('## Using C#'), 'heading').spans)).toBe('Using C#')
    expect(text(only(parseBlocks('## Closed ##'), 'heading').spans)).toBe('Closed')
  })
})

describe('tables', () => {
  test('drops cells beyond the header and pads short rows', async () => {
    const table = only(parseBlocks('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 | 4 |\n| x |'), 'table')
    expect(table.rows.map(r => r.map(text))).toEqual([['1', '2', '3'], ['x', '', '']])
  })

  test('needs as many delimiter cells as header cells', async () => {
    expect(kinds(parseBlocks('| a | b |\n|---|\n| 1 | 2 |'))).not.toContain('table')
  })

  test('keeps declared left alignment apart from no alignment', async () => {
    expect(only(parseBlocks('| a | b | c | d |\n|:--|---|--:|:-:|\n| 1 | 2 | 3 | 4 |'), 'table').align).toEqual(['left', undefined, 'right', 'center'])
  })

  test('ends at a blank line', async () => {
    expect(kinds(parseBlocks('| a |\n|---|\n| 1 |\n\nprose | with pipe'))).toEqual(['table', 'paragraph'])
  })
})

describe('table cell breaks', () => {
  test('trims breaks at the start and end of a cell but keeps inner ones', async () => {
    const table = only(parseBlocks('| a | b |\n|---|---|\n| <br>ok<br> | x<br>y |'), 'table')
    expect(table.rows[0]?.map(text)).toEqual(['ok', 'x\ny'])
  })

  test('leaves a cell holding only a break empty', async () => {
    const table = only(parseBlocks('| a |\n|---|\n| <br> |'), 'table')
    expect(table.rows[0]?.map(text)).toEqual([''])
  })
})

describe('html-looking text', () => {
  test('keeps generics, comparisons and key names verbatim', async () => {
    for (const prose of ['The hook returns Promise<void> and takes Map<string, User>.', 'Only when a<b and c>d holds.', 'Press <Enter> to continue.', 'Use <T,> in a .tsx file']) {
      expect(text(inlineSpans(prose))).toBe(prose)
    }
  })

  test('keeps a component tag on its own line', async () => {
    const blocks = parseBlocks('Render it:\n\n<Button variant="primary" />\n\n<Modal>\n  <Header title="x" />\n</Modal>')
    expect(blocks.map(b => (b.kind === 'paragraph' ? text(b.spans) : b.kind))).toEqual(['Render it:', '<Button variant="primary" />', '<Modal>\n<Header title="x" />\n</Modal>'])
  })

  test('drops paired html tags but keeps their text', async () => {
    expect(text(inlineSpans('<span class="x">hi</span> <a href="https://x.io">there</a> <b>bold</b>'))).toBe('hi there bold')
    expect(text(inlineSpans('a<b and c>d'))).toBe('a<b and c>d')
  })

  test('shows script and style markup instead of running their bodies together', async () => {
    expect(parseBlocks('<script>alert(1)</script>')).toEqual([{ kind: 'paragraph', spans: [{ text: '<script>alert(1)</script>', kind: 'plain' }] }])
  })
})

describe('html and footnotes', () => {
  test('drops comments and tags but keeps their text', async () => {
    const blocks = parseBlocks('<details>\n<summary>More</summary>\n\nbody\n</details>\n\n<!-- a comment -->')
    expect(blocks.map(b => (b.kind === 'paragraph' ? text(b.spans) : b.kind))).toEqual(['▸ More', 'body'])
    expect(text(inlineSpans('press <kbd>Ctrl</kbd> <!-- hidden -->now'))).toBe('press Ctrl now')
  })

  test('keeps text from adjacent block tags apart', async () => {
    const blocks = parseBlocks('<details><summary>More</summary>hidden</details>')
    expect(blocks.map(b => (b.kind === 'paragraph' ? text(b.spans) : b.kind))).toEqual(['▸ More\nhidden'])
  })

  test('turns br into a line break', async () => {
    expect(text(inlineSpans('a<br>b<br/>c'))).toBe('a\nb\nc')
  })

  test('shows footnote references and definitions without their syntax', async () => {
    const blocks = parseBlocks('Claim[^1]\n\n[^1]: The source')
    expect(blocks.map(b => (b.kind === 'paragraph' ? b.spans.map(s => `${s.kind}:${s.text}`) : []))).toEqual([
      ['plain:Claim', 'footnote:[1]'],
      ['footnote:[1] ', 'plain:The source'],
    ])
  })

  test('leaves a footnote definition where it was written', async () => {
    const blocks = parseBlocks('[^n]: Early note\n\nBody cites[^n]')
    expect(blocks.map(b => (b.kind === 'paragraph' ? text(b.spans) : b.kind))).toEqual(['[n] Early note', 'Body cites[n]'])
  })
})

describe('footnote definitions', () => {
  function rows(markdown: string): string[][] {
    return parseBlocks(markdown).map(b => (b.kind === 'paragraph' ? b.spans.map(s => `${s.kind}:${s.text}`) : [b.kind]))
  }

  test('keeps a footnote whose body is a single url instead of turning it into a link definition', async () => {
    expect(rows('[^1]\n\n[^1]: https://example.com')).toEqual([['footnote:[1]'], ['footnote:[1] ', 'url:https://example.com']])
  })

  test('keeps a one-word footnote body on its own row', async () => {
    expect(rows('Ref[^a].\n\n[^a]: x')).toEqual([['plain:Ref', 'footnote:[a]', 'plain:.'], ['footnote:[a] ', 'plain:x']])
  })

  test('marks a reference written after its one-word definition as a footnote', async () => {
    expect(rows('[^a]: x\n\nLater[^a]')).toEqual([['footnote:[a] ', 'plain:x'], ['plain:Later', 'footnote:[a]']])
  })

  test('draws each consecutive definition on its own row', async () => {
    expect(rows('See [^1].\n\n[^1]: First footnote.\n[^note]: Second one.\n[^3]: https://x.io')).toEqual([
      ['plain:See ', 'footnote:[1]', 'plain:.'],
      ['footnote:[1] ', 'plain:First footnote.'],
      ['footnote:[note] ', 'plain:Second one.'],
      ['footnote:[3] ', 'url:https://x.io'],
    ])
  })

  test('keeps an indented second paragraph inside its footnote instead of drawing code', async () => {
    expect(rows('Ref[^long]\n\n[^long]: First paragraph\n    continues here.\n\n    Second paragraph of the note.')).toEqual([
      ['plain:Ref', 'footnote:[long]'],
      ['footnote:[long] ', 'plain:First paragraph\ncontinues here.'],
      ['plain:Second paragraph of the note.'],
    ])
  })

  test('reads a fenced block indented under a footnote as code in its language', async () => {
    expect(parseBlocks('[^f]: Lead\n\n    ```js\n    x()\n    ```\n').at(-1)).toEqual({ kind: 'code', language: 'js', source: 'x()', hang: 4 })
  })

  test('ends a footnote at the first paragraph that is not indented', async () => {
    expect(rows('[^f]: Lead\n\nNot indented.\n\n    real code')).toEqual([['footnote:[f] ', 'plain:Lead'], ['plain:Not indented.'], ['code']])
  })

  test('leaves a reference with no definition as the literal text', async () => {
    expect(rows('see [^9] undefined')).toEqual([['plain:see [^9] undefined']])
    expect(rows('Cite[^A]\n\n[^a]: matched case-insensitively')[0]).toEqual(['plain:Cite', 'footnote:[A]'])
  })

  test('still resolves ordinary link reference definitions', async () => {
    const [link] = parseBlocks('[go][ref]\n\n[ref]: https://a.b').filter(b => b.kind === 'paragraph')
    expect(link?.kind === 'paragraph' ? link.spans : []).toEqual([{ text: 'go', kind: 'url', href: 'https://a.b' }])
  })
})

describe('link schemes', () => {
  test('shows a javascript link as its label without a hyperlink', async () => {
    expect(inlineSpans('[x](javascript:alert(1))')).toEqual([{ text: 'x', kind: 'plain' }])
    expect(inlineSpans('<a href="javascript:alert(1)">y</a>')).toEqual([{ text: 'y', kind: 'plain' }])
  })

  test('keeps http, https, mailto and file links openable', async () => {
    for (const href of ['http://a.io', 'https://a.io', 'mailto:me@a.io', 'file:///tmp/a.txt']) {
      expect(inlineSpans(`[go](${href})`).every(s => s.href === href)).toBe(true)
    }
  })

  test('drops the href of an image with an unopenable scheme', async () => {
    expect(inlineSpans('![pic](data:image/png;base64,AAAA)')).toEqual([{ text: '[image: pic]', kind: 'image' }])
  })
})

describe('inlineSpans', () => {
  test('colours commands, paths and line numbers', async () => {
    const spans = inlineSpans('Run `git push --force` then open app/models/rfq.rb:42')
    const kinds = spans.filter(s => s.kind !== 'space').map(s => `${s.kind}:${s.text}`)
    expect(kinds).toEqual(['plain:Run ', 'command:git', 'subcommand:push', 'flag:--force', 'plain: then open ', 'path:app/models/rfq.rb', 'line::42'])
  })

  test('leaves prose with slashes alone', async () => {
    expect(isPath('and/or')).toBe(false)
    expect(isPath('README.md')).toBe(true)
    expect(isPath('~/.claude/settings.json')).toBe(true)
  })

  test('nests bold and code', async () => {
    const spans = inlineSpans('**use `foo` now**')
    expect(spans.every(s => s.bold)).toBe(true)
    expect(spans.find(s => s.text === 'foo')?.kind).toBe('code')
  })

  test('lets a code span bind tighter than emphasis', async () => {
    const spans = inlineSpans('*foo `*` bar* and ``a `tick` b``')
    expect(spans.find(s => s.kind === 'code' && s.text === '*')?.italic).toBe(true)
    expect(spans.find(s => s.kind === 'code' && s.text === 'a `tick` b')).toBeDefined()
  })

  test('nests the same delimiter inside itself', async () => {
    const spans = inlineSpans('*outer **inner** outer*')
    expect(text(spans)).toBe('outer inner outer')
    expect(spans.find(s => s.text === 'inner')).toMatchObject({ bold: true, italic: true })
  })

  test('strikes through with one or two tildes', async () => {
    expect(inlineSpans('~one~ ~~two~~').filter(s => s.strike).map(s => s.text)).toEqual(['one', 'two'])
  })

  test('decodes every named HTML entity and leaves unknown names alone', async () => {
    expect(text(inlineSpans('&hearts; &lambda; &rarr; &NotNestedLessLess; &check;'))).toBe('♥ λ → ⪡̸ ✓')
    expect(text(inlineSpans('&constructor; &toString; &hasOwnProperty;'))).toBe('&constructor; &toString; &hasOwnProperty;')
  })

  test('decodes named and numeric entities in prose but not in code', async () => {
    expect(text(inlineSpans('&amp; &lt;tag&gt; &copy; caf&eacute; &#169; &#x1F600; &bogus;'))).toBe('& <tag> © café © 😀 &bogus;')
    expect(decodeEntities('&#0;')).toBe('�')
    expect(inlineSpans('`&amp;`')[0]?.text).toBe('&amp;')
  })

  test('treats a backslash or two trailing spaces before a newline as a break', async () => {
    expect(parseBlocks('line\\\nnext  \nthird')).toEqual([{ kind: 'paragraph', spans: [{ text: 'line\nnext\nthird', kind: 'plain' }] }])
  })
})

describe('code spans stay verbatim', () => {
  test('does not read prose in backticks as a shell command', async () => {
    for (const prose of ['make sure', 'open issues', 'find the bug', 'git status']) expect(inlineSpans(`\`${prose}\``)).toEqual([{ text: prose, kind: 'code' }])
  })

  test('does not shell-colour a span holding backticks', async () => {
    expect(inlineSpans('`` code with `tick` ``')).toEqual([{ text: 'code with `tick`', kind: 'code' }])
  })

  test('still colours a real command line', async () => {
    expect(inlineSpans('`bundle exec rspec spec/a_spec.rb`').map(s => s.kind)).toContain('path')
    expect(inlineSpans('`cat a.txt | grep x`').map(s => s.kind)).toContain('operator')
  })
})

describe('prose paths', () => {
  test('does not colour dotted names or slash-separated words', async () => {
    for (const prose of ['Node.js', 'Next.js', 'read/write/execute', 'input/output/error', 'Rails.env', 'and/or', '/cd']) {
      expect(inlineSpans(`use ${prose} here`).some(s => s.kind === 'path')).toBe(false)
    }
  })

  test('colours rooted paths and relative files with an extension', async () => {
    for (const path of ['~/.claude/settings.json', './bin/dev', '../x', '/usr/local/bin', 'app/models/rfq.rb']) expect(isProsePath(path)).toBe(true)
    expect(inlineSpans('see ~/.claude/settings.json, then').find(s => s.kind === 'path')?.text).toBe('~/.claude/settings.json')
  })
})

describe('links', () => {
  test('keeps the href of a markdown link', async () => {
    expect(inlineSpans('[pr](https://x.io/1)')[0]).toMatchObject({ kind: 'url', text: 'pr', href: 'https://x.io/1' })
  })

  test('formats link text', async () => {
    const spans = inlineSpans('[**bold link**](https://x.io) [`code link`](https://y.io)')
    expect(spans.find(s => s.text === 'bold link')).toMatchObject({ bold: true, href: 'https://x.io' })
    expect(spans.find(s => s.text === 'code link')).toMatchObject({ kind: 'code', href: 'https://y.io' })
  })

  test('accepts titles and balanced parentheses', async () => {
    expect(inlineSpans('[titled](https://x.io "Title")')).toEqual([{ text: 'titled', kind: 'url', href: 'https://x.io' }])
    expect(inlineSpans('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))')[0]?.href).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
    expect(inlineSpans('see https://x.io/a_(b)')[1]).toMatchObject({ text: 'https://x.io/a_(b)', href: 'https://x.io/a_(b)' })
  })

  test('links angle, www and email autolinks', async () => {
    const hrefs = inlineSpans('<https://x.io> www.y.io a@b.io').filter(s => s.href).map(s => `${s.text}=${s.href}`)
    expect(hrefs).toEqual(['https://x.io=https://x.io', 'www.y.io=http://www.y.io', 'a@b.io=mailto:a@b.io'])
  })

  test('resolves reference links and hides their definitions', async () => {
    const blocks = parseBlocks('[ref link][r1] and [collapsed][]\n\n[r1]: https://x.io "T"\n[collapsed]: https://y.io')
    expect(blocks.length).toBe(1)
    expect(only(blocks, 'paragraph').spans.filter(s => s.href).map(s => s.href)).toEqual(['https://x.io', 'https://y.io'])
  })

  test('shows an image as its alt text, linked only when absolute', async () => {
    expect(inlineSpans('![diagram](arch.png)')).toEqual([{ text: '[image: diagram]', kind: 'image' }])
    expect(inlineSpans('![](https://x.io/a.png)')).toEqual([{ text: '[image]', kind: 'image', href: 'https://x.io/a.png' }])
  })

  test('shows a relative destination as a path after its text, without link styling', async () => {
    expect(inlineSpans('[docs](./README.md)')).toEqual([{ text: 'docs ', kind: 'plain' }, { text: './README.md', kind: 'path' }])
  })

  test('keeps the line anchor of a relative file link', async () => {
    const spans = inlineSpans('See [user.rb:42](app/models/user.rb#L42).')
    expect(spans.map(s => `${s.kind}:${s.text}`)).toEqual(['plain:See user.rb:42 ', 'path:app/models/user.rb', 'line:#L42', 'plain:.'])
    expect(spans.some(s => s.href !== undefined || s.kind === 'url')).toBe(false)
  })

  test('shows a relative destination once when it is also the text', async () => {
    expect(inlineSpans('[docs/setup.md](docs/setup.md)')).toEqual([{ text: 'docs/setup.md', kind: 'path' }])
    expect(inlineSpans('[](docs/setup.md)')).toEqual([{ text: 'docs/setup.md', kind: 'path' }])
  })

  test('keeps only the text of an in-page anchor', async () => {
    expect(inlineSpans('[Install](#install)')).toEqual([{ text: 'Install', kind: 'plain' }])
  })

  test('keeps a relative reference link destination', async () => {
    const spans = only(parseBlocks('[the guide][g]\n\n[g]: docs/guide.md'), 'paragraph').spans
    expect(spans.map(s => `${s.kind}:${s.text}`)).toEqual(['plain:the guide ', 'path:docs/guide.md'])
  })
})

describe('shellSpans', () => {
  test('starts a new command after a pipe', async () => {
    const kinds = shellSpans('cat a.txt | grep -n "x"').filter(s => s.kind !== 'space').map(s => s.kind)
    expect(kinds).toEqual(['command', 'path', 'operator', 'command', 'flag', 'string'])
  })

  test('marks subcommands only for commands that have them', async () => {
    expect(shellSpans('echo hello').map(s => s.kind)).toEqual(['command', 'space', 'word'])
    expect(shellSpans('git status').map(s => s.kind)).toEqual(['command', 'space', 'subcommand'])
  })

  test('reads heredoc and herestring operators whole', async () => {
    expect(shellSpans('cat <<EOF').filter(s => s.kind === 'operator').map(s => s.text)).toEqual(['<<'])
    expect(shellSpans('grep x <<< "$y"').filter(s => s.kind === 'operator').map(s => s.text)).toEqual(['<<<'])
  })

  test('keeps every character of the source, parentheses included', async () => {
    const corpus = ['(cd x && make)', 'echo $((1+2))', 'foo() { bar; }', 'diff <(ls a) <(ls b)', 'find . \\( -name a \\)', 'echo "unclosed', "x='(y)'", 'a&&(b||c)', '$(( ))', '\\(']
    for (const source of corpus) expect(text(shellSpans(source))).toBe(source)
  })

  test('starts a command inside a subshell', async () => {
    expect(shellSpans('(cd x && make)').filter(s => s.kind !== 'space').map(s => `${s.kind}:${s.text}`)).toEqual(['operator:(', 'command:cd', 'word:x', 'operator:&&', 'command:make', 'operator:)'])
  })

  test('keeps an assignment prefix in front of the command', async () => {
    expect(shellSpans('FOO=1 make build').filter(s => s.kind !== 'space').map(s => s.kind)).toEqual(['variable', 'command', 'subcommand'])
  })
})

describe('performance', () => {
  test('tokenises a long command line in linear time', async () => {
    expect(elapsed(() => shellSpans('echo a '.repeat(32000)))).toBeLessThan(500)
  })

  test('parses unclosed delimiters without quadratic blow-up', async () => {
    for (const run of ['**a ', '__a ', '*a _b ', '~~a ']) expect(elapsed(() => parseBlocks(run.repeat(16000)))).toBeLessThan(1000)
    expect(elapsed(() => parseBlocks(('**a '.repeat(50) + '\n').repeat(200)))).toBeLessThan(1000)
  })

  test('still emphasises after a stray delimiter early in a long paragraph', async () => {
    const spans = parseBlocks('2 * 3 is six. ' + 'word '.repeat(2000) + '**late bold**')
    expect(only(spans, 'paragraph').spans.find(s => s.bold)?.text).toBe('late bold')
  })

  test('caps nesting instead of overflowing the stack', async () => {
    expect(elapsed(() => parseBlocks('>'.repeat(20000) + ' x'))).toBeLessThan(500)
    expect(elapsed(() => parseBlocks('*'.repeat(20000) + 'a' + '*'.repeat(20000)))).toBeLessThan(500)
  })

  test('parses a deeply nested list quickly and keeps its deepest text', async () => {
    const deep = Array.from({ length: 500 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n')
    expect(elapsed(() => parseBlocks(deep))).toBeLessThan(400)
    expect(JSON.stringify(parseBlocks(deep))).toContain('level 499')
  })

  test('keeps a quote nested past the cap as verbatim text', async () => {
    const blocks = parseBlocks('>'.repeat(40) + ' deep text')
    expect(JSON.stringify(blocks)).toContain('deep text')
  })

  test('renders a paragraph longer than the inline limit as plain text quickly', async () => {
    for (const run of ['_a_', '*a*']) {
      const source = run.repeat(20000)
      let blocks: Block[] = []
      expect(elapsed(() => (blocks = parseBlocks(source)))).toBeLessThan(500)
      expect(text(only(blocks, 'paragraph').spans)).toBe(source)
    }
  })

  test('reuses the parse of text it has already seen', async () => {
    const source = 'cached **text** ' + Math.random()
    expect(parseBlocks(source)).toBe(parseBlocks(source))
  })
})

describe('streaming', () => {
  test('never loses earlier blocks as a message grows', async () => {
    const message = '# Plan\n\n1. Install:\n   ```bash\n   npm i\n   ```\n2. Test\n\n> [!NOTE]\n> Done.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
    for (let end = 1; end <= message.length; end++) {
      const blocks = streamed(message.slice(0, end))
      if (end > 7) expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    }
    expect(kinds(parseBlocks(message))).toEqual(['heading', 'list', 'quote', 'table'])
  })

  test('never shows a heading or table the finished text does not have', async () => {
    const message = 'Intro para\n- one\n- two\n\nTotals:\n\n- [x] done\n\nA line\n| grep x\n\nEnd = 3\n:done'
    const final = parseBlocks(message)
    expect(kinds(final)).not.toContain('heading')
    expect(kinds(final)).not.toContain('table')
    for (let end = 1; end <= message.length; end++) {
      const seen = kinds(streamed(message.slice(0, end)))
      expect({ end, heading: seen.includes('heading'), table: seen.includes('table') }).toEqual({ end, heading: false, table: false })
    }
  })

  test('holds a table header row until its delimiter row starts, then draws it as a table', async () => {
    const message = 'Summary\n| col a | col b |\n|---|--:|\n| 1 | 2 |'
    const delimiter = message.indexOf('|---') + 2
    for (let end = message.indexOf('|'); end <= message.length; end++) {
      const kindsNow = end < delimiter ? ['paragraph'] : ['paragraph', 'table']
      expect({ end, kinds: kinds(streamed(message.slice(0, end))) }).toEqual({ end, kinds: kindsNow })
    }
  })

  test('does not drop a body row or a finished rule at the end of a message', async () => {
    expect(only(parseBlocks('| a |\n|---|\n| 1 |\n| 2 |'), 'table').rows.length).toBe(2)
    expect(kinds(parseBlocks('para\n\n---'))).toEqual(['paragraph', 'rule'])
  })

  test('keeps the text of a heading whose underline is still arriving', async () => {
    expect(streamed('Title\n===')).toEqual([{ kind: 'paragraph', spans: [{ text: 'Title', kind: 'plain' }] }])
    expect(only(streamed('Title\n===\n'), 'heading').level).toBe(1)
  })
})

describe('front matter', () => {
  test('shows leading YAML front matter as a yaml block', async () => {
    expect(parseBlocks('---\ntitle: x\ntags:\n  - a\n---\n# Body')).toEqual([
      { kind: 'code', language: 'yaml', source: 'title: x\ntags:\n  - a' },
      { kind: 'heading', level: 1, spans: [{ text: 'Body', kind: 'plain' }] },
    ])
  })

  test('leaves a rule followed by prose alone', async () => {
    expect(kinds(parseBlocks('---\nSome prose here.\n---'))).not.toContain('code')
    expect(kinds(parseBlocks('---\nNote: open\nplain sentence\n---\n'))).not.toContain('code')
  })
})

describe('inline markers', () => {
  test('treats a backslash as an escape, not text', async () => {
    const spans = inlineSpans('\\*not italic\\* and \\`not code\\`')
    expect(spans).toEqual([{ text: '*not italic* and `not code`', kind: 'plain' }])
  })

  test('draws triple asterisks as bold italic', async () => {
    expect(inlineSpans('***both***')).toEqual([{ text: 'both', kind: 'plain', bold: true, italic: true }])
  })
})

describe('paragraph continuation lines', () => {
  test('drops the leading indent of a soft-wrapped line', async () => {
    expect(inlineSpans('a\n    b continued')).toEqual([{ text: 'a\nb continued', kind: 'plain' }])
    expect(inlineSpans('a\n\t b')).toEqual([{ text: 'a\nb', kind: 'plain' }])
  })

  test('drops the indent after a hard break too', async () => {
    expect(text(inlineSpans('a  \n    b'))).toBe('a\nb')
    expect(text(inlineSpans('a\\\n   b'))).toBe('a\nb')
  })

  test('keeps indentation inside code spans and leading spaces of the first line', async () => {
    expect(inlineSpans('`a\n  b`')).toEqual([{ text: 'a   b', kind: 'code' }])
    expect(text(parseOne('   lead'))).toBe('lead')
  })
})

describe('inline tag pairing', () => {
  test('stays linear on thousands of unclosed tags', async () => {
    const started = performance.now()
    const spans = inlineSpans('<b>x '.repeat(4000))
    expect(performance.now() - started).toBeLessThan(250)
    expect(text(spans)).toBe('<b>x '.repeat(4000))
  })

  test('pairs nested same-name tags innermost first and leaves a stray opener verbatim', async () => {
    expect(inlineSpans('<b>a <b>b</b></b>')).toEqual([{ text: 'a b', kind: 'plain', bold: true }])
    expect(inlineSpans('<b>open <i>it</i></b> <b>stray')).toEqual([
      { text: 'open ', kind: 'plain', bold: true },
      { text: 'it', kind: 'plain', bold: true, italic: true },
      { text: ' <b>stray', kind: 'plain' },
    ])
  })
})

function parseOne(markdown: string): Span[] {
  const [first] = parseBlocks(markdown)
  return first?.kind === 'paragraph' ? first.spans : []
}

describe('html tags whatever their case', () => {
  test('styles uppercase and mixed-case tags like lowercase ones, and leaves components literal', async () => {
    expect(inlineSpans('<B>LOUD</B> and <Em>mixed</Em> and <Strong>x</Strong>').map(s => [s.text, s.bold ?? false, s.italic ?? false])).toEqual([['LOUD', true, false], [' and ', false, false], ['mixed', false, true], [' and ', false, false], ['x', true, false]])
    expect(inlineSpans('<Button>Save</Button>').map(s => s.text).join('')).toBe('<Button>Save</Button>')
    expect(inlineSpans('<KBD>Ctrl</KBD>')[0]).toMatchObject({ text: 'Ctrl', kind: 'code' })
  })

  test('keeps a component tag written in PascalCase verbatim', async () => {
    expect(text(inlineSpans('<Header>x</Header>'))).toBe('<Header>x</Header>')
    expect(text(inlineSpans('<Details>x</Details> <Code>y</Code>'))).toBe('<Details>x</Details> <Code>y</Code>')
  })

  test('underlines inserted text so a deletion and its replacement read apart', async () => {
    const spans = inlineSpans('<del>v1</del><ins>v2</ins> and <u>this</u>')
    expect(spans.map(s => [s.text, s.strike ?? false, s.underline ?? false])).toEqual([['v1', true, false], ['v2', false, true], [' and ', false, false], ['this', false, true]])
  })

  test('draws a details summary as a marked bold line', async () => {
    const [summary, body] = parseBlocks('<details>\n<summary>Why it <i>failed</i></summary>\n\nbody\n</details>')
    expect(summary?.kind === 'paragraph' ? summary.spans.map(s => [s.text, s.bold ?? false, s.italic ?? false]) : []).toEqual([['▸ ', false, false], ['Why it ', true, false], ['failed', true, true]])
    expect(body?.kind === 'paragraph' ? text(body.spans) : '').toBe('body')
  })

  test('leaves an unclosed summary as plain text', async () => {
    expect(parseBlocks('<details>\n<summary>Why').map(b => (b.kind === 'paragraph' ? text(b.spans) : b.kind))).toEqual(['Why'])
  })
})

describe('footnote continuations', () => {
  test('hangs a footnote continuation under the text after its label', async () => {
    const blocks = parseBlocks('[^long]: First paragraph.\n\n    Second paragraph.\n\n    - point\n\nAfter.')
    expect(blocks.map(b => [b.kind, b.hang])).toEqual([['paragraph', undefined], ['paragraph', 7], ['list', 7], ['paragraph', undefined]])
  })

  test('hangs by the width of a wide label', async () => {
    expect(parseBlocks('[^注]: a\n\n    b').at(-1)?.hang).toBe(5)
  })

  test('hangs nothing for a footnote with no continuation', async () => {
    expect(parseBlocks('[^n]: only').map(b => b.hang)).toEqual([undefined])
  })
})

describe('tags with bare attributes', () => {
  test('reads a comparison with bare words as prose, not a tag', async () => {
    for (const markup of ['<a and j>', '<b and c>', '<i and y>', '<s and t>', '<b x>']) expect({ markup, tag: tagOf(markup) }).toEqual({ markup, tag: undefined })
  })

  test('keeps real boolean attributes and valued attributes', async () => {
    expect(tagOf('<details open>')?.attributes).toEqual({ open: '' })
    expect(tagOf('<a href="x" download>')?.attributes).toEqual({ href: 'x', download: '' })
    expect(tagOf('<span class=x>')?.role).toBe('text')
  })

  test('renders a comparison before a later closer as written', async () => {
    expect(text(inlineSpans('while i<a and j>0 the </a> closes'))).toBe('while i<a and j>0 the </a> closes')
    expect(inlineSpans('if a<b and c>d then x</b> y').some(span => span.bold)).toBe(false)
  })
})
