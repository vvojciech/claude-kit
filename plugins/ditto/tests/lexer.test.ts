import { describe, expect, test } from 'claude-code/testing'

import { blocksOf, cacheChars } from '../hooks/lexer'
import type { Block } from '../hooks/model'

const code = (text: string) => blocksOf(text).flatMap(b => (b.kind === 'code' ? [{ language: b.lang, source: b.text }] : []))
const tables = (text: string) => blocksOf(text).flatMap(b => (b.kind === 'table' ? [b.source.trimEnd()] : []))
const copyable = (text: string) => blocksOf(text).filter((b: Block) => b.kind === 'code' || b.kind === 'table')
const kinds = (text: string) => copyable(text).map((b: Block) => b.kind)

describe('code blocks', () => {
  test('returns each fenced block without its fences', async () => {
    const text = 'Intro\n\n```bash\ngit status\ngit log\n```\n\nThen\n\n```\nplain\n```'
    expect(code(text)).toEqual([
      { language: 'bash', source: 'git status\ngit log' },
      { language: '', source: 'plain' },
    ])
  })

  test('keeps a shorter inner fence inside a longer outer one', async () => {
    const text = '````markdown\n# Title\n\n```ruby\nputs 1\n```\n````'
    expect(code(text)).toEqual([{ language: 'markdown', source: '# Title\n\n```ruby\nputs 1\n```' }])
  })

  test('reads tilde fences and leaves backticks inside them alone', async () => {
    expect(code('~~~python\nprint("```")\n~~~')).toEqual([{ language: 'python', source: 'print("```")' }])
  })

  test('does not close a backtick fence with tildes', async () => {
    expect(code('```\na\n~~~\nb\n```')).toEqual([{ language: '', source: 'a\n~~~\nb' }])
  })

  test('normalises CRLF line endings', async () => {
    expect(code('```js\r\nconst a = 1\r\nconst b = 2\r\n```\r\n')).toEqual([{ language: 'js', source: 'const a = 1\nconst b = 2' }])
  })

  test('strips a list item indent from the block body', async () => {
    expect(code('1. Run:\n   ```sh\n   make\n     indented\n   ```')).toEqual([{ language: 'sh', source: 'make\n  indented' }])
  })

  test('runs an unclosed fence to the end', async () => {
    expect(code('```\nhalf')).toEqual([{ language: '', source: 'half' }])
  })

  test('ignores an inline triple backtick span', async () => {
    expect(code('use ```x``` inline')).toEqual([])
  })

  test('takes the first word of the info string, lower-cased', async () => {
    expect(code('```Ruby title="x.rb"\nputs 1\n```')).toEqual([{ language: 'ruby', source: 'puts 1' }])
  })

  test('finds a block inside a quote and inside an alert', async () => {
    expect(code('> ```sh\n> make\n> ```')).toEqual([{ language: 'sh', source: 'make' }])
    expect(code('> [!TIP]\n> Run:\n>\n> ```sh\n> make test\n> ```')).toEqual([{ language: 'sh', source: 'make test' }])
  })

  test('finds an indented code block', async () => {
    expect(code('Run this:\n\n    pg_dump db > out.sql\n    gzip out.sql')).toEqual([{ language: '', source: 'pg_dump db > out.sql\ngzip out.sql' }])
  })

  test('reads a fence indented four spaces as indented code, fence lines included', async () => {
    expect(code('Text\n\n    ```js\n    const x = 1\n    ```')).toEqual([{ language: '', source: '```js\nconst x = 1\n```' }])
  })

  test('does not close a fence on a marker indented four spaces', async () => {
    expect(code('```\na\n    ```\nb\n```')).toEqual([{ language: '', source: 'a\n    ```\nb' }])
  })

  test('sees no block inside an HTML comment', async () => {
    expect(copyable('<!--\n```\nhidden\n```\n-->\ntext')).toEqual([])
  })

  test('keeps blocks in the order they are drawn, across lists and quotes', async () => {
    const text = '```sh\nnpm i\n```\n\n- step\n\n  ```sql\n  select 1\n  ```\n\n> | a |\n> |---|\n> | 1 |\n\n    indented'
    expect(kinds(text)).toEqual(['code', 'code', 'table', 'code'])
  })
})

describe('tables', () => {
  test('returns a table as markdown, trailing space trimmed', async () => {
    const text = 'Before\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |  \n\nAfter | not a table'
    expect(tables(text)).toEqual(['| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |'])
  })

  test('skips tables inside code fences', async () => {
    expect(tables('```\n| a | b |\n|---|---|\n```')).toEqual([])
  })

  test('reads a table with CRLF and no outer pipes', async () => {
    expect(tables('a | b\r\n--- | ---\r\n1 | 2\r\n')).toEqual(['a | b\n--- | ---\n1 | 2'])
  })

  test('does not take a sentence above a rule for a table', async () => {
    expect(tables('this | that\n---\nmore')).toEqual([])
  })

  test('finds a table inside a quote', async () => {
    expect(tables('> | a | b |\n> |---|---|\n> | 1 | 2 |')).toEqual(['| a | b |\n|---|---|\n| 1 | 2 |'])
  })

  test('does not take a header whose delimiter row has another column count', async () => {
    expect(tables('| a | b |\n|---|')).toEqual([])
  })

  test('keeps a table whose cells hold code with a pipe, as drawn', async () => {
    expect(tables('| cmd | use |\n|---|---|\n| `a | b` | pipe |')).toEqual(['| cmd | use |\n|---|---|\n| `a | b` | pipe |'])
  })

  test('sees no table inside an HTML comment', async () => {
    expect(tables('<!--\n| a | b |\n|---|---|\n| 1 | 2 |\n-->')).toEqual([])
  })
})

describe('the block model', () => {
  test('lists every block in drawn order, containers before what they hold', async () => {
    const text = '# Title\n\n> quoted\n>\n> ```sh\n> make\n> ```\n\n- one\n- two\n\n---'
    expect(blocksOf(text).map(b => `${b.depth}:${b.kind}`)).toEqual(['0:heading', '0:quote', '1:paragraph', '1:code', '0:list', '1:paragraph', '1:paragraph', '0:rule'])
  })

  test('gives each top-level block its exact source, in order', async () => {
    const text = 'Intro\n\n```sh\nls\n```\n\n| a |\n|---|\n| 1 |'
    const sources = blocksOf(text).filter(b => b.depth === 0).map(b => b.source)
    let at = 0
    for (const source of sources) {
      const found = text.indexOf(source.trimEnd(), at)
      expect(found).toBeGreaterThanOrEqual(at)
      at = found + source.trimEnd().length
    }
  })

  test('draws front matter as a yaml block, as lucid does', async () => {
    expect(code('---\ntitle: x\ntags: [a]\n---\n# Body')).toEqual([{ language: 'yaml', source: 'title: x\ntags: [a]' }])
  })

  test('keeps a header-only table, since a finished reply loses nothing', async () => {
    expect(tables('name | kind\n-----|-----')).toEqual(['name | kind\n-----|-----'])
  })

  test('takes an html pre block for code and draws nothing for a comment', async () => {
    expect(code('<pre lang="py">\nx = 1\n</pre>')).toEqual([{ language: 'py', source: 'x = 1' }])
    expect(blocksOf('<!-- note -->')).toEqual([])
  })
})

describe('limits', () => {
  test('caps nesting: deep quotes end in one verbatim block instead of overflowing the stack', async () => {
    const started = Date.now()
    const blocks = blocksOf(`${'>'.repeat(20000)} x`)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(blocks.filter(b => b.kind === 'quote').length).toBeLessThanOrEqual(24)
    expect(blocks.at(-1)?.kind).toBe('code')
  })

  test('caps nesting in deep lists', async () => {
    const text = Array.from({ length: 2000 }, (_, i) => `${'  '.repeat(i)}- item ${i}`).join('\n')
    const started = Date.now()
    const blocks = blocksOf(text)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(Math.max(...blocks.map(b => b.depth))).toBeLessThanOrEqual(24)
  })

  test('a fence past the cap is copied as the verbatim source lucid draws, not the inner fence', async () => {
    const text = `${'> '.repeat(30)}\`\`\`sh\n${'> '.repeat(30)}make\n${'> '.repeat(30)}\`\`\``
    const inner = code(text)
    expect(inner).toHaveLength(1)
    expect(inner[0]?.language).toBe('')
    expect(inner[0]?.source).toContain('```sh')
  })

  test('bounds the cache by size, not entries', async () => {
    for (let i = 0; i < 200; i++) blocksOf(`${'x'.repeat(40_000)} ${i}`)
    expect(cacheChars()).toBeLessThanOrEqual(4_000_000 + 40_010)
  })

  test('answers the same blocks from the cache', async () => {
    const text = '```sh\nls\n```'
    expect(blocksOf(text)).toBe(blocksOf(text))
  })
})
