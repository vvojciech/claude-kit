import { describe, expect, test } from 'claude-code/testing'

import { fitRow, replyTargets, rowWidth } from '../hooks/targets'
import { cellWidth } from '../hooks/width'
import { resolved, resolvedReply } from './support'

const labels = (text: string) => replyTargets(resolved(text)).map(t => t.label)

describe('replyTargets', () => {
  test('offers reply on any reply with text, a one-line answer included', async () => {
    expect(labels('Done.')).toEqual(['⧉ reply'])
    expect(labels('feature/r4-copy')).toEqual(['⧉ reply'])
  })

  test('offers nothing for a reply with no text', async () => {
    expect(labels('   ')).toEqual([])
  })

  test('names a code block by its language', async () => {
    const targets = replyTargets(resolved('```sh\nls\n```'))
    expect(targets.map(t => t.label)).toEqual(['⧉ reply', '⧉ sh'])
    expect(targets[1]?.text).toBe('ls')
    expect(targets[1]?.what).toBe('sh block')
  })

  test('calls a block with no language code, and a table table', async () => {
    expect(labels('```\na\n```\n\n| x |\n|---|\n| 1 |')).toEqual(['⧉ reply', '⧉ code', '⧉ table'])
  })

  test('numbers blocks only where names clash, from the top', async () => {
    const text = '```ruby\na\n```\n\n```json\n{}\n```\n\n```ruby\nb\n```\n\n| x |\n|---|\n| 1 |\n\n| y |\n|---|\n| 2 |'
    const targets = replyTargets(resolved(text))
    expect(targets.map(t => t.label)).toEqual(['⧉ reply', '⧉ ruby 1', '⧉ json', '⧉ ruby 2', '⧉ table 1', '⧉ table 2'])
    expect(targets.map(t => t.text).slice(1, 4)).toEqual(['a', '{}', 'b'])
  })

  test('names an md block md, the label lucid draws, now that the whole reply is ⧉ reply', async () => {
    const targets = replyTargets(resolved('```md\n# x\n```'))
    expect(targets.map(t => t.label)).toEqual(['⧉ reply', '⧉ md'])
    expect(targets[1]?.what).toBe('md block')
  })

  test('names a code block whose language is table, code or selection apart from the real table, either order', async () => {
    expect(labels('```table\nt\n```\n\n| x |\n|---|\n| 1 |')).toEqual(['⧉ reply', '⧉ table-code', '⧉ table'])
    expect(labels('| x |\n|---|\n| 1 |\n\n```table\nt\n```')).toEqual(['⧉ reply', '⧉ table', '⧉ table-code'])
    expect(labels('```code\na\n```\n\n```\nb\n```')).toEqual(['⧉ reply', '⧉ code-code', '⧉ code'])
    expect(labels('```selection\na\n```')).toEqual(['⧉ reply', '⧉ selection-code'])
  })

  test('skips empty code blocks but keeps counting them, so numbers match the screen', async () => {
    expect(labels('a\nb\n```\n\n```')).toEqual(['⧉ reply'])
    expect(labels('```\n```\n\n```\nb\n```\n\n```\nc\n```')).toEqual(['⧉ reply', '⧉ code 2', '⧉ code 3'])
  })

  test('offers a block lucid draws inside a quote or as indented code', async () => {
    expect(labels('> ```sh\n> make\n> ```\n\nThen:\n\n    gzip out.sql')).toEqual(['⧉ reply', '⧉ sh', '⧉ code'])
  })

  test('copies the reply text verbatim', async () => {
    const text = '# Title\n\n- **one**\n- two'
    expect(replyTargets(resolved(text))[0]?.text).toBe(text)
  })

  test('lexes each written block on its own, as lucid draws it', async () => {
    const reply = resolvedReply(['- install the gem', '    bundle add foo'])
    expect(reply.blocks.filter(b => b.kind === 'code').map(b => b.text)).toEqual(['bundle add foo'])
    expect(replyTargets(reply).map(t => t.label)).toEqual(['⧉ reply', '⧉ code'])
  })

  test('names a partial reply as such', async () => {
    expect(replyTargets(resolved('half a reply', true))[0]?.what).toBe('partial reply as markdown')
  })
})

describe('fitRow', () => {
  const targets = replyTargets(resolved('```\na\n```\n\n```\nb\n```\n\n```\nc\n```'))

  test('keeps everything when there is room', async () => {
    expect(fitRow(targets, 200)).toEqual({ shown: targets, hidden: [] })
  })

  test('hands back the targets it drops and leaves room to say how many', async () => {
    const row = fitRow(targets, 24)
    expect(row.shown.map(t => t.label)).toEqual(['⧉ reply', '⧉ code 1'])
    expect(row.hidden.map(t => t.name)).toEqual(['code 2', 'code 3'])
    expect(rowWidth([...row.shown.map(t => t.label), `+${row.hidden.length}`])).toBeLessThanOrEqual(24)
  })

  test('keeps reply first and drops all when even that and +N do not fit', async () => {
    expect(fitRow(targets, 11).shown.map(t => t.label)).toEqual(['⧉ reply'])
    expect(fitRow(targets, 3)).toEqual({ shown: [], hidden: targets })
  })

  test('measures labels in terminal cells, so a wide language name cannot overrun', async () => {
    const wide = replyTargets(resolved('```日本語コード\nx\n```'))
    expect(rowWidth(wide.map(t => t.label))).toBe(7 + 2 + 2 + 12)
    expect(fitRow(wide, 22).shown.map(t => t.label)).toEqual(['⧉ reply'])
  })
})

describe('cellWidth', () => {
  test('counts wide, combining and emoji graphemes as the terminal draws them', async () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('日本')).toBe(4)
    expect(cellWidth('é')).toBe(1)
    expect(cellWidth('👍🏽')).toBe(2)
    expect(cellWidth('⧉')).toBe(1)
  })
})
