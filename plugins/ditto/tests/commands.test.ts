import { describe, expect, test } from 'claude-code/testing'

import { BAD_REPLY, USAGE, chooseBlock, missingReply, parse } from '../hooks/commands'
import type { Choice } from '../hooks/commands'
import { replyTargets } from '../hooks/targets'
import { resolved } from './support'

const HISTORY = ['first\n```py\nold()\n```', 'second\n| a |\n|---|\n| 1 |', 'third\n```sh\nnew\n```\n\n```sh\nnewer\n```\n\n```\nplain\n```']

function pick(history: string[], args: string, partial = false): Choice {
  const request = parse(args)
  if ('error' in request) return request
  if (request.kind === 'selection') return { error: 'selection' }
  const text = history[history.length - request.reply]
  return text === undefined ? { error: missingReply(history.length) } : chooseBlock(resolved(text, partial), request)
}

describe('/ditto arguments', () => {
  test('takes the last reply by default, and md names it too', async () => {
    expect(pick(HISTORY, '')).toEqual({ text: HISTORY[2], what: 'last reply' })
    expect(pick(HISTORY, 'md')).toEqual({ text: HISTORY[2], what: 'last reply' })
  })

  test('says when the reply copied was cut short', async () => {
    expect(pick(HISTORY, '', true)).toEqual({ text: HISTORY[2], what: 'last reply (partial)' })
  })

  test('counts replies back with R', async () => {
    expect(pick(HISTORY, '3')).toEqual({ text: HISTORY[0], what: 'reply 3 back' })
    expect(pick(HISTORY, '4')).toEqual({ error: 'Only 3 replies so far' })
    expect(pick(['one'], '2')).toEqual({ error: 'Only 1 reply so far' })
  })

  test('takes a block by the name on its chip, counting from the top of the reply', async () => {
    expect(pick(HISTORY, 'sh 1')).toEqual({ text: 'new', what: 'sh block' })
    expect(pick(HISTORY, 'sh 2')).toEqual({ text: 'newer', what: 'sh block' })
    expect(pick(HISTORY, 'sh')).toEqual({ text: 'new', what: 'sh block' })
    expect(pick(HISTORY, 'code')).toEqual({ text: 'plain', what: 'code block' })
  })

  test('takes name 1 for the only block of that name, as the usage suggests', async () => {
    expect(pick(HISTORY, '2 table 1')).toEqual({ text: '| a |\n|---|\n| 1 |', what: 'table' })
    expect(pick(HISTORY, '3 py 1')).toEqual({ text: 'old()', what: 'py block' })
    expect(pick(HISTORY, 'code 1')).toEqual({ text: 'plain', what: 'code block' })
  })

  test('reads names in any case', async () => {
    expect(pick(HISTORY, 'SH 2')).toEqual({ text: 'newer', what: 'sh block' })
    expect(pick(HISTORY, '3 PY')).toEqual({ text: 'old()', what: 'py block' })
  })

  test('takes code for any code block when every block has a language', async () => {
    const reply = ['```python\nprint(1)\n```\n\n```sh\nls\n```']
    expect(pick(reply, 'code')).toEqual({ text: 'print(1)', what: 'python block' })
    expect(pick(reply, 'code 2')).toEqual({ text: 'ls', what: 'sh block' })
    expect(pick(reply, 'code 3')).toEqual({ error: 'No "code 3" in the last reply; it has md, python, sh' })
  })

  test('reaches an older reply by R before the name', async () => {
    expect(pick(HISTORY, '3 py')).toEqual({ text: 'old()', what: 'py block' })
    expect(pick(HISTORY, ' 2  table ')).toEqual({ text: '| a |\n|---|\n| 1 |', what: 'table' })
  })

  test('copies what every chip of a reply copies, by the chip name', async () => {
    const reply = '```ruby\na\n```\n\n```json\n{}\n```\n\n```ruby\nb\n```\n\n| x |\n|---|\n| 1 |\n\n```123\ndigits\n```'
    for (const chip of replyTargets(resolved(reply))) {
      const what = chip.name === 'md' ? 'last reply' : chip.what
      expect(pick([reply], `1 ${chip.name}`)).toEqual({ text: chip.text, what })
      if (!/^\d+$/.test(chip.name)) expect(pick([reply], chip.name)).toEqual({ text: chip.text, what })
    }
  })

  test('names what the reply has when the name is not there', async () => {
    expect(pick(HISTORY, 'table')).toEqual({ error: 'No "table" in the last reply; it has md, sh 1, sh 2, code' })
    expect(pick(HISTORY, '3 sh')).toEqual({ error: 'No "sh" in reply 3 back; it has md, py' })
  })

  test('explains an empty history and bad arguments', async () => {
    expect(pick([], '')).toEqual({ error: 'No reply to copy yet' })
    expect(pick(HISTORY, '0')).toEqual({ error: BAD_REPLY })
    expect(pick(HISTORY, '0 sh')).toEqual({ error: BAD_REPLY })
    expect(pick(HISTORY, '2 3')).toEqual({ error: 'No "3" in reply 2 back; it has md, table' })
    expect(pick(HISTORY, 'sh x')).toEqual({ error: USAGE })
    expect(pick(HISTORY, 'sh 1 2')).toEqual({ error: USAGE })
  })

  test('reads selection as its own request, in any case', async () => {
    expect(parse('selection')).toEqual({ kind: 'selection' })
    expect(parse(' Selection ')).toEqual({ kind: 'selection' })
    expect(parse('2 selection')).toEqual({ kind: 'block', reply: 2, name: 'selection' })
  })

  test('the usage says which way each number counts and what code and selection mean', async () => {
    expect(USAGE).toContain('1 = the last')
    expect(USAGE).toContain('count from the top of the reply')
    expect(USAGE).toContain('any code block when none lacks one')
    expect(USAGE).toContain('/ditto selection')
  })
})
