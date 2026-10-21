import { describe, expect, test } from 'claude-code/testing'

import { behindAny, sourceBehind } from '../hooks/selection'

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
  test('gives back the whole markdown line, markers and all, when the selection covers its text', async () => {
    expect(sourceBehind(SOURCE, 'Here is the plan, with bold and inline code.')).toEqual({ text: 'Here is the plan, with **bold** and `inline code`.' })
    expect(sourceBehind(SOURCE, 'Copy test')).toEqual({ text: '## Copy test' })
  })

  test('gives back only the selected span of a line, its inline markup balanced', async () => {
    expect(sourceBehind(SOURCE, 'with bold and inline code')).toEqual({ text: 'with **bold** and `inline code`' })
    expect(sourceBehind(SOURCE, 'plan')).toEqual({ text: 'plan' })
    expect(sourceBehind(SOURCE, 'bold')).toEqual({ text: '**bold**' })
    expect(sourceBehind(SOURCE, 'the docs')).toEqual({ text: '[the docs](https://example.com/docs)' })
    expect(sourceBehind(SOURCE, 'docs')).toEqual({ text: '[the docs](https://example.com/docs)' })
    expect(sourceBehind(SOURCE, 'parses x | y')).toEqual({ text: 'parses x \\| y' })
    expect(sourceBehind(SOURCE, 'inline code.')).toEqual({ text: '`inline code`.' })
  })

  test('takes whole lines for a selection that starts and ends mid-line', async () => {
    expect(sourceBehind(SOURCE, 'ne task\nsee the do')).toEqual({ text: '- [x] done task\n- see [the docs](https://example.com/docs) &amp; notes' })
  })

  test('sees past what the renderer hides: link targets and entities', async () => {
    expect(sourceBehind(SOURCE, 'see the docs & notes')).toEqual({ text: '- see [the docs](https://example.com/docs) &amp; notes' })
  })

  test('maps code lines to their source, with the fence when the label row is selected', async () => {
    expect(sourceBehind(SOURCE, 'def f(x):\n    return x + 1')).toEqual({ text: 'def f(x):\n    return x + 1' })
    expect(sourceBehind(SOURCE, '```python\ndef f(x):')).toEqual({ text: '```python\ndef f(x):' })
  })

  test('gives a table back as markdown rows from its padded drawing', async () => {
    expect(sourceBehind(SOURCE, 'file  purpose\n────  ────────\na.ts  parses x | y')).toEqual({ text: '| file | purpose |\n|---|---|\n| a.ts | parses x \\| y |' })
  })

  test('anchors a selection on its first and last lines when the rows between were drawn differently', async () => {
    const source = `Start of the long paragraph here\n\n${'| h |\n|---|\n| cell |\n'}\nend of the selection tail text here`
    expect(sourceBehind(source, 'Start of the long paragraph here\nh: cell (stacked)\nend of the selection tail text here')).toEqual({ text: source })
  })

  test('finds nothing for text that is not in the source', async () => {
    expect(sourceBehind(SOURCE, 'something else entirely')).toBeUndefined()
  })

  test('matches a selection with no letters literally', async () => {
    expect(sourceBehind('a\n---\nb', '---')).toEqual({ text: '---' })
    expect(sourceBehind('a', '   ')).toBeUndefined()
  })

  test('refuses a selection that two sources give back differently, rather than copying the first', async () => {
    expect(behindAny(['nothing', 'the **answer** here', 'the answer again'], 'answer')).toEqual({ places: 2 })
    expect(behindAny(['nothing', 'the **answer** here', 'old: the **answer** here'], 'answer')).toEqual({ text: '**answer**' })
    expect(behindAny(['nothing', 'the **answer** here'], 'answer')).toEqual({ text: '**answer**' })
    expect(behindAny([], 'x')).toBeUndefined()
  })

  test('says how many places hold a selection that repeats on other lines, rather than copying the first', async () => {
    const source = 'Run tests first.\nThen run **tests** again with `-v`.'
    expect(sourceBehind(source, 'tests')).toEqual({ places: 2 })
    expect(sourceBehind(source, 'e')).toEqual({ places: 2 })
    expect(sourceBehind(source, 'tests again')).toEqual({ text: '**tests** again' })
  })

  test('counts a word repeated within one line as two places, since only one of them was selected', async () => {
    expect(sourceBehind('a **b** then b', 'b')).toEqual({ places: 2 })
    expect(sourceBehind('a **b** then **b**', 'b')).toEqual({ text: '**b**' })
  })

  test('counts places for a repeated selection with no letters, unless every place gives the same markdown', async () => {
    expect(sourceBehind('-> a\nb ->', '->')).toEqual({ places: 2 })
    expect(sourceBehind('a\n---\nb\n---', '---')).toEqual({ text: '---' })
  })
})
