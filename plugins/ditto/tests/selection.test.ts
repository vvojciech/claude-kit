import { describe, expect, test } from 'claude-code/testing'

import { firstSourceBehind, sourceBehind } from '../hooks/selection'

const SOURCE = [
  '## Copy test',
  'Here is the plan, with **bold** and `inline code`.',
  '',
  '- [x] done task',
  '- see [the docs](https://example.com/docs) &amp; notes',
  '',
  '```python',
  'def f(x):',
  '    return x + 1',
  '```',
  '',
  '| file | purpose |',
  '|---|---|',
  '| a.ts | parses x \\| y |',
].join('\n')

describe('sourceBehind', () => {
  test('gives back the markdown lines behind rendered text, markers and all', async () => {
    expect(sourceBehind(SOURCE, 'with bold and inline code')).toBe('Here is the plan, with **bold** and `inline code`.')
    expect(sourceBehind(SOURCE, 'Copy test')).toBe('## Copy test')
  })

  test('takes whole lines for a selection that starts and ends mid-line', async () => {
    expect(sourceBehind(SOURCE, 'ne task\nsee the do')).toBe('- [x] done task\n- see [the docs](https://example.com/docs) &amp; notes')
  })

  test('sees past what the renderer hides: link targets and entities', async () => {
    expect(sourceBehind(SOURCE, 'see the docs & notes')).toBe('- see [the docs](https://example.com/docs) &amp; notes')
  })

  test('maps code lines to their source, with the fence when the label row is selected', async () => {
    expect(sourceBehind(SOURCE, 'def f(x):\n    return x + 1')).toBe('def f(x):\n    return x + 1')
    expect(sourceBehind(SOURCE, '```python\ndef f(x):')).toBe('```python\ndef f(x):')
  })

  test('gives a table back as markdown rows from its padded drawing', async () => {
    expect(sourceBehind(SOURCE, 'file  purpose\n────  ────────\na.ts  parses x | y')).toBe('| file | purpose |\n|---|---|\n| a.ts | parses x \\| y |')
  })

  test('anchors a selection on its first and last lines when the rows between were drawn differently', async () => {
    const source = `Start of the long paragraph here\n\n${'| h |\n|---|\n| cell |\n'}\nend of the selection tail text here`
    expect(sourceBehind(source, 'Start of the long paragraph here\nh: cell (stacked)\nend of the selection tail text here')).toBe(source)
  })

  test('finds nothing for text that is not in the source', async () => {
    expect(sourceBehind(SOURCE, 'something else entirely')).toBeUndefined()
  })

  test('matches a selection with no letters literally', async () => {
    expect(sourceBehind('a\n---\nb', '---')).toBe('---')
    expect(sourceBehind('a', '   ')).toBeUndefined()
  })

  test('searches sources in order and takes the first that holds it', async () => {
    expect(firstSourceBehind(['nothing', 'the **answer** here', 'the answer again'], 'answer')).toBe('the **answer** here')
    expect(firstSourceBehind([], 'x')).toBeUndefined()
  })
})
