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

  test('keeps markup-looking text inside code, where it is drawn as written', async () => {
    const source = 'Typed:\n\n```ts\nconst xs: Array<string> = [];\n```\n\nOr inline `Map<K, V>` here.'
    expect(sourceBehind(source, 'const xs: Array<string> = [];')).toEqual({ text: 'const xs: Array<string> = [];' })
    expect(sourceBehind(source, 'Or inline Map<K, V> here.')).toEqual({ text: 'Or inline `Map<K, V>` here.' })
  })

  test('copies an autolink and a link whose target holds parentheses whole, as the parser reads them', async () => {
    expect(sourceBehind('See <https://example.com/docs> here.', 'https://example.com/docs')).toEqual({ text: '<https://example.com/docs>' })
    expect(sourceBehind('See [docs](https://example.com/a_(b)) now.', 'docs')).toEqual({ text: '[docs](https://example.com/a_(b))' })
  })

  test('maps text inside quotes and list items, whose lines the parser reads without their markers', async () => {
    expect(sourceBehind('> one **two**\n> three four', 'two three')).toEqual({ text: '> one **two**\n> three four' })
    expect(sourceBehind('- first\n  then **x y** here', 'x y')).toEqual({ text: '**x y**' })
  })

  test('maps letters past the basic plane to the right place in the source', async () => {
    expect(sourceBehind('𐐀 abc def', 'abc')).toEqual({ text: 'abc' })
    expect(sourceBehind('𐐀 **abc** def', 'abc def')).toEqual({ text: '**abc** def' })
  })

  test('gives a table back as markdown rows from its padded drawing', async () => {
    const drawn = 'file  purpose\n────  ────────\na.ts  parses x | y'
    expect(sourceBehind(SOURCE, drawn)).toEqual({ text: '| file | purpose |\n|---|---|\n| a.ts | parses x \\| y |' })
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

  test('finds a selection over an entity the renderer decodes, and keeps any other entity as the letters it draws', async () => {
    expect(sourceBehind('Use caf&#233; here.', 'café')).toEqual({ text: 'caf&#233;' })
    expect(sourceBehind('Use caf&#233; here.', 'Use café here.')).toEqual({ text: 'Use caf&#233; here.' })
    expect(sourceBehind('Fish &amp; chips', 'Fish & chips')).toEqual({ text: 'Fish &amp; chips' })
    expect(sourceBehind('Use caf&eacute; here.', 'caf&eacute;')).toEqual({ text: 'caf&eacute;' })
  })

  test('finds a selection over a reference-style link, and copies the link as written', async () => {
    const source = 'See [the docs][doc] now.\n\n[doc]: https://example.com'
    expect(sourceBehind(source, 'See the docs now.')).toEqual({ text: 'See [the docs][doc] now.' })
  })

  test('copies only the selected word from a fenced code line, not prose markup around it', async () => {
    expect(sourceBehind('Code:\n\n```js\nconsole.log("**bold**");\n```', 'bold')).toEqual({ text: 'bold' })
  })

  test('counts overlapping places too, so a selection two spans could hold is never copied from the first', async () => {
    expect(sourceBehind('a**ba**ba', 'aba')).toEqual({ places: 2 })
  })

  test('anchors on one section at a time when its first and last lines repeat, rather than spanning both', async () => {
    const two = 'Start\n\n| a |\n\nEnd\n\nStart\n\n| b |\n\nEnd'
    const same = 'Start\n\n| a |\n\nEnd\n\nStart\n\n| a |\n\nEnd'
    expect(sourceBehind(two, 'Start\nsomething drawn differently\nEnd')).toEqual({ places: 2 })
    expect(sourceBehind(same, 'Start\nsomething drawn differently\nEnd')).toEqual({ text: 'Start\n\n| a |\n\nEnd' })
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
