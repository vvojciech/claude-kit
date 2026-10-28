import { expect, test } from 'claude-code/testing'

import { fencesOf, segmentsOf } from '../hooks/segments'

const typeOf = (source: string) =>
  source.trim().startsWith('sequenceDiagram') ? 'sequence' : /^(flowchart|graph)\b/.test(source.trim()) ? 'flow' : (source.trim().split(/\s+/)[0] ?? '')

test('splits text around a sequence fence and trims the blank lines it leaves', () => {
  expect(segmentsOf('Before.\n\n```mermaid\nsequenceDiagram\nA->>B: x\n```\n\nAfter.', typeOf)).toEqual([
    { kind: 'text', text: 'Before.' },
    { kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: '```mermaid\nsequenceDiagram\nA->>B: x\n```' },
    { kind: 'text', text: 'After.' },
  ])
})

test('keeps two diagrams in order with nothing between them', () => {
  const two = '```mermaid\nsequenceDiagram\nA->>B: 1\n```\n```mermaid\nsequenceDiagram\nB->>A: 2\n```'
  expect(segmentsOf(two, typeOf).map(s => s.kind)).toEqual(['sequence', 'sequence'])
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
})

test('takes tilde fences', () => {
  expect(segmentsOf('~~~mermaid\nsequenceDiagram\nA->>B: x\n~~~', typeOf)).toEqual([{ kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: '~~~mermaid\nsequenceDiagram\nA->>B: x\n~~~' }])
})

const kinds = (markdown: string) => segmentsOf(markdown, typeOf).map(s => s.kind)

test('keeps a mermaid fence inside an outer fence literal', () => {
  const nested = '````markdown\n```mermaid\nsequenceDiagram\nA->>B: x\n```\n````'
  expect(segmentsOf(nested, typeOf)).toEqual([{ kind: 'text', text: nested }])
})

test('finds a fence indented under a list item and strips the indent', () => {
  const listed = '- item\n\n    ```mermaid\n    sequenceDiagram\n    A->>B: x\n    ```'
  expect(fencesOf(listed).map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
  const parts = segmentsOf(listed, typeOf)
  expect(parts[1]).toEqual({ kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: '```mermaid\nsequenceDiagram\nA->>B: x\n```' })
})

test('ignores a four-space indented fence outside a list', () => {
  expect(fencesOf('text\n\n    ```mermaid\n    sequenceDiagram\n    ```')).toEqual([])
})

test('closes on a longer fence of the same character', () => {
  expect(kinds('```mermaid\nsequenceDiagram\nA->>B: x\n`````')).toEqual(['sequence'])
})

test('does not close on a shorter fence or the other character', () => {
  expect(fencesOf('````mermaid\nsequenceDiagram\n```\n~~~~')).toEqual([])
})

test('takes only the exact mermaid info string', () => {
  expect(kinds('```mermaid-example\nsequenceDiagram\nA->>B: x\n```')).toEqual(['text'])
  expect(kinds('```mermaid {theme: dark}\nsequenceDiagram\nA->>B: x\n```')).toEqual(['sequence'])
})

test('normalises CRLF line endings', () => {
  expect(fencesOf('```mermaid\r\nsequenceDiagram\r\nA->>B: x\r\n```\r\n')[0]?.source).toBe('sequenceDiagram\nA->>B: x')
})

test('draws a fence inside a blockquote in place, the quote marks stripped from the source', () => {
  const quoted = '> Flow:\n>\n> ```mermaid\n> sequenceDiagram\n> A->>B: x\n> ```\n> After.'
  expect(segmentsOf(quoted, typeOf)).toEqual([
    { kind: 'text', text: '> Flow:\n>' },
    { kind: 'sequence', source: 'sequenceDiagram\nA->>B: x', fence: '> ```mermaid\n> sequenceDiagram\n> A->>B: x\n> ```' },
    { kind: 'text', text: '> After.' },
  ])
})

test('leaving the blockquote closes its fence, so the diagram draws', () => {
  const markdown = '> ```mermaid\n> sequenceDiagram\n> A->>B: x\nafter'
  expect(fencesOf(markdown).map(fence => fence.source)).toEqual(['sequenceDiagram\nA->>B: x'])
  expect(segmentsOf(markdown, typeOf).map(part => part.kind)).toEqual(['sequence', 'text'])
})

test('finds a fence in a blockquote inside a list item', () => {
  const markdown = '- > ```mermaid\n  > sequenceDiagram\n  > A->>B: x\n  > ```\n- next'
  expect(fencesOf(markdown).map(fence => fence.source)).toEqual(['sequenceDiagram\nA->>B: x'])
  expect(kinds(markdown)).toEqual(['sequence', 'text'])
})

test('ignores a fence inside an HTML comment', () => {
  expect(kinds('<!--\n```mermaid\nsequenceDiagram\nA->>B: x\n```\n-->\nafter')).toEqual(['text'])
  expect(kinds('<!-- hidden -->\n```mermaid\nsequenceDiagram\nA->>B: x\n```')).toEqual(['text', 'sequence'])
})

test('a list item fence ends with its item, so a fence at column 0 opens a new one', () => {
  const markdown = '- step\n\n  ```mermaid\n  sequenceDiagram\n  A->>B: x\n```\nafter'
  expect(fencesOf(markdown).map(fence => fence.source)).toEqual(['sequenceDiagram\nA->>B: x'])
  expect(segmentsOf(markdown, typeOf).filter(part => part.kind === 'text').map(part => (part.kind === 'text' ? part.text : ''))).toEqual([
    '- step',
    '```\nafter',
  ])
})

test('finds a fence opened on the same line as its list marker', () => {
  for (const [marker, pad] of [['*', '  '], ['-', '  '], ['1.', '   ']] as const) {
    const markdown = `${marker} \`\`\`mermaid\n${pad}sequenceDiagram\n${pad}A->>B: x\n${pad}\`\`\`\nafter`
    expect(fencesOf(markdown).map(fence => fence.source)).toEqual(['sequenceDiagram\nA->>B: x'])
    expect(kinds(markdown)).toEqual(['sequence', 'text'])
  }
})

test('finds a fence in a list inside a blockquote', () => {
  expect(fencesOf('> 1. ```mermaid\n>    sequenceDiagram\n>    A->>B: x\n>    ```\n> after').map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('leaves a fence inside an HTML block as raw HTML until a blank line ends the block', () => {
  expect(fencesOf('<div>\n```mermaid\nsequenceDiagram\nA->>B: x\n```\n</div>')).toEqual([])
  expect(fencesOf('<details>\n\n```mermaid\nsequenceDiagram\nA->>B: x\n```\n\n</details>').map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('ignores a fence inside an HTML comment that sits in a blockquote or a list item', () => {
  expect(kinds('> <!--\n> ```mermaid\n> sequenceDiagram\n> A->>B: x\n> ```\n> -->\nafter')).toEqual(['text'])
  expect(kinds('- <!--\n  ```mermaid\n  sequenceDiagram\n  A->>B: x\n  ```\n  -->\nafter')).toEqual(['text'])
})

test('leaves a mermaid example inside <pre>, <script>, <style> or <textarea> as raw HTML, blank lines and all', () => {
  for (const tag of ['pre', 'script', 'style', 'textarea', 'PRE']) {
    expect(fencesOf(`<${tag}>\n\n\`\`\`mermaid\nsequenceDiagram\nA->>B: x\n\`\`\`\n\n</${tag}>`)).toEqual([])
  }
  expect(fencesOf('<pre>x</pre>\n```mermaid\nsequenceDiagram\nA->>B: x\n```').map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('a quoted blank line ends a quoted HTML block, so a fence after it draws', () => {
  expect(fencesOf('> <details>\n>\n> ```mermaid\n> sequenceDiagram\n> A->>B: x\n> ```\n>\n> </details>').map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
})

test('finds a fence that opens on a later line of a list item inside a blockquote', () => {
  expect(fencesOf('> - item\n>\n>   ```mermaid\n>   sequenceDiagram\n>   A->>B: x\n>   ```\n> after').map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
  expect(fencesOf('> - item\n>\n>     ```mermaid\n>     sequenceDiagram\n>     A->>B: x\n>     ```\n> after').map(f => f.source)).toEqual(['sequenceDiagram\nA->>B: x'])
})
