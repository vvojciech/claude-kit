import { expect, test } from 'claude-code/testing'

import { segmentsOf } from '../hooks/segments'

const typeOf = (source: string) =>
  source.trim().startsWith('sequenceDiagram') ? 'sequence' : /^(flowchart|graph)\b/.test(source.trim()) ? 'flow' : (source.trim().split(/\s+/)[0] ?? '')

const kinds = (markdown: string) => segmentsOf(markdown, typeOf).map(s => s.kind)

const drawn = (markdown: string) => segmentsOf(markdown, typeOf).flatMap(part => (part.kind === 'sequence' || part.kind === 'flow' ? [part.source] : []))

const prose = (markdown: string) => segmentsOf(markdown, typeOf).flatMap(part => (part.kind === 'text' ? [part.text] : []))

const FENCE = '```mermaid\nsequenceDiagram\nA->>B: x\n```'

test('splits text around a sequence fence and trims the blank lines it leaves', () => {
  expect(segmentsOf(`Before.\n\n${FENCE}\n\nAfter.`, typeOf)).toEqual([
    { kind: 'text', text: 'Before.' },
    { kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: FENCE },
    { kind: 'text', text: 'After.' },
  ])
})

test('keeps two diagrams in order with nothing between them', () => {
  expect(kinds(`${FENCE}\n${FENCE}`)).toEqual(['sequence', 'sequence'])
})

test('splits a flowchart out as its own part', () => {
  expect(segmentsOf('```mermaid\nflowchart LR\nA-->B\n```\nTail.', typeOf)).toEqual([
    { kind: 'flow', source: 'flowchart LR\nA-->B', fence: '```mermaid\nflowchart LR\nA-->B\n```' },
    { kind: 'text', text: 'Tail.' },
  ])
})

test('keeps another kind of diagram as source, marked after it', () => {
  expect(segmentsOf('```mermaid\npie\n"a": 1\n```\nTail.', typeOf)).toEqual([
    { kind: 'text', text: '```mermaid\npie\n"a": 1\n```' },
    { kind: 'other', type: 'pie' },
    { kind: 'text', text: 'Tail.' },
  ])
})

test('leaves an unclosed fence as text', () => {
  expect(segmentsOf('Hi\n```mermaid\nsequenceDiagram\nA->>B: x', typeOf)).toEqual([{ kind: 'text', text: 'Hi\n```mermaid\nsequenceDiagram\nA->>B: x' }])
  expect(kinds('```mermaid\nsequenceDiagram\nA->>B: x\n\n\n')).toEqual(['text'])
})

test('takes tilde fences', () => {
  expect(segmentsOf('~~~mermaid\nsequenceDiagram\nA->>B: x\n~~~', typeOf)).toEqual([{ kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: '~~~mermaid\nsequenceDiagram\nA->>B: x\n~~~' }])
})

test('keeps a mermaid fence inside an outer fence literal', () => {
  const nested = `\`\`\`\`markdown\n${FENCE}\n\`\`\`\``
  expect(segmentsOf(nested, typeOf)).toEqual([{ kind: 'text', text: nested }])
})

test('finds a fence indented under a list item', () => {
  const listed = '- item\n\n    ```mermaid\n    sequenceDiagram\n    A->>B: x\n    ```'
  expect(segmentsOf(listed, typeOf)).toEqual([
    { kind: 'text', text: '- item' },
    { kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: '  ```mermaid\n  sequenceDiagram\n  A->>B: x\n  ```' },
  ])
})

test('ignores a four-space indented fence outside a list', () => {
  expect(drawn('text\n\n    ```mermaid\n    sequenceDiagram\n    ```')).toEqual([])
})

test('closes on a longer fence of the same character, not a shorter one or the other character', () => {
  expect(kinds('```mermaid\nsequenceDiagram\nA->>B: x\n`````')).toEqual(['sequence'])
  expect(drawn('````mermaid\nsequenceDiagram\n```\n~~~~')).toEqual([])
})

test('takes only the exact mermaid info string', () => {
  expect(kinds('```mermaid-example\nsequenceDiagram\nA->>B: x\n```')).toEqual(['text'])
  expect(kinds('```mermaid {theme: dark}\nsequenceDiagram\nA->>B: x\n```')).toEqual(['sequence'])
})

test('normalises CRLF line endings', () => {
  expect(drawn('```mermaid\r\nsequenceDiagram\r\nA->>B: x\r\n```\r\n')).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('draws a fence inside a blockquote in place, the quote marks stripped', () => {
  expect(segmentsOf(`> Flow:\n>\n> ${FENCE.replaceAll('\n', '\n> ')}\n> After.`, typeOf)).toEqual([
    { kind: 'text', text: '> Flow:\n>' },
    { kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: FENCE },
    { kind: 'text', text: '> After.' },
  ])
})

test('leaving the blockquote or list item closes its fence, so the diagram draws', () => {
  expect(kinds('> ```mermaid\n> sequenceDiagram\n> A->>B: x\nafter')).toEqual(['sequence', 'text'])
  expect(prose('- step\n\n  ```mermaid\n  sequenceDiagram\n  A->>B: x\n```\nafter')).toEqual(['- step', '```\nafter'])
})

test('a blockquoted fence still streaming stays text when the chunk ends in a newline', () => {
  expect(drawn('> ```mermaid\n> sequenceDiagram\n> A->>B: x\n')).toEqual([])
  expect(drawn('> ```mermaid\n> sequenceDiagram\n> A->>B: x\n\nafter')).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('finds fences in lists and blockquotes nested either way', () => {
  for (const markdown of [
    '- > ```mermaid\n  > sequenceDiagram\n  > A->>B: x\n  > ```\n- next',
    '> 1. ```mermaid\n>    sequenceDiagram\n>    A->>B: x\n>    ```\n> after',
  ]) {
    expect(drawn(markdown)).toEqual(['sequenceDiagram\nA->>B: x'])
    expect(kinds(markdown)).toEqual(['sequence', 'text'])
  }
  expect(prose('> - item\n>\n>   ```mermaid\n>   sequenceDiagram\n>   A->>B: x\n>   ```\n> after')).toEqual(['> - item\n>', '> after'])
})

test('a fence opened on its list marker drops the marker from the source it falls back to', () => {
  for (const [marker, pad] of [['*', '  '], ['1.', '   ']] as const) {
    const markdown = `${marker} \`\`\`mermaid\n${pad}sequenceDiagram\n${pad}A->>B: x\n${pad}\`\`\``
    expect(segmentsOf(markdown, typeOf)).toEqual([{ kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: FENCE }])
  }
})

test('leaves a fence inside HTML as raw HTML, up to where CommonMark ends the HTML block', () => {
  for (const html of [`<!--\n${FENCE}\n-->`, `<div>\n${FENCE}\n</div>`, `<pre>\n\n${FENCE}\n\n</pre>`, `<![CDATA[\n${FENCE}\n]]>`, `<widget>\n${FENCE}`, `> <!--\n> ${FENCE.replaceAll('\n', '\n> ')}\n> -->`]) {
    expect(drawn(`${html}\n\nafter`)).toEqual([])
  }
  for (const html of ['<!-- hidden -->', '<details>\n', '<pre>x</pre>', '> <!--']) expect(drawn(`${html}\n${FENCE}`)).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('hands every piece of prose the first definition of each label in the reply, in reply order', () => {
  const reply = `See [a][ref] and [b].\n\n[ref]: https://first.example\n\n${FENCE}\n\n[ref]: https://second.example\n[B]:\n  /b "the \\"b\\""`
  const defined = '[ref]: <https://first.example>\n[b]: </b> "the \\"b\\""'
  expect(prose(reply)).toEqual([`${defined}\n\nSee [a][ref] and [b].\n\n[ref]: https://first.example`, `${defined}\n\n[ref]: https://second.example\n[B]:\n  /b "the \\"b\\""`])
})

test('takes link definitions from prose only, not from code or HTML', () => {
  const reply = `See [ref].\n\n- \`\`\`text\n  [ref]: https://wrong.example\n  \`\`\`\n\n<!--\n[ref]: https://html.example\n-->\n\n${FENCE}\n\n[ref]: https://right.example`
  expect(prose(reply)[0]?.startsWith('[ref]: <https://right.example>\n\n')).toBe(true)
})
