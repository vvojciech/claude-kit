import { describe, expect, test } from 'claude-code/testing'

import { BAD_REPLY, SELECTION_HAS_NO_REPLY, USAGE, badToolCount, callNameAlone, chooseBlock, chooseGroupCall, chooseNamedCall, noGroupCall, missingReply, numberFirst, parse } from '../hooks/commands'
import type { Choice } from '../hooks/commands'
import { replyTargets, target } from '../hooks/targets'
import { OUTPUT_TOOLS } from '../hooks/tools'
import { resolved } from './support'

const HISTORY = ['first\n```py\nold()\n```', 'second\n| a |\n|---|\n| 1 |', 'third\n```sh\nnew\n```\n\n```sh\nnewer\n```\n\n```\nplain\n```']

function pick(history: string[], args: string, partial = false): Choice {
  const request = parse(args)
  if ('error' in request) return request
  if (request.kind !== 'block') return { error: request.kind }
  const text = history[history.length - request.reply]
  return text === undefined ? { error: missingReply(history.length) } : chooseBlock(resolved(text, partial), request)
}

describe('/copy-that arguments', () => {
  test('takes the last reply by default, and reply names it too', async () => {
    expect(pick(HISTORY, '')).toEqual({ text: HISTORY[2], what: 'last reply' })
    expect(pick(HISTORY, 'reply')).toEqual({ text: HISTORY[2], what: 'last reply' })
  })

  test('md names a markdown block by the label lucid draws on it, not the whole reply', async () => {
    const history = ['Notes:\n\n```md\n# Title\n```\n\n```markdown\n- item\n```']
    expect(pick(history, 'md')).toEqual({ text: '# Title', what: 'md block' })
    expect(pick(history, 'markdown')).toEqual({ text: '- item', what: 'markdown block' })
    expect(replyTargets(resolved(history[0] ?? '')).map(t => t.label)).toEqual(['⧉ reply', '⧉ md', '⧉ markdown'])
  })

  test('renames a block whose language clashes with a command word, so the command stays reachable', async () => {
    const history = ['```reply\nr\n```\n\n```file\nf\n```']
    expect(replyTargets(resolved(history[0] ?? '')).map(t => t.name)).toEqual(['reply', 'reply-code', 'file-code'])
    expect(pick(history, 'reply-code')).toEqual({ text: 'r', what: 'reply-code block' })
  })

  test('reads help in its usual spellings, and file, plan and output as tool requests', async () => {
    for (const word of ['help', '-h', '--help', '?', 'HELP']) expect(parse(word)).toEqual({ kind: 'help' })
    expect(parse('file')).toEqual({ kind: 'tool', tool: 'file', back: 1 })
    expect(parse('file 3')).toEqual({ kind: 'tool', tool: 'file', back: 3 })
    expect(parse('plan')).toEqual({ kind: 'tool', tool: 'plan', back: 1 })
    expect(parse('output 2')).toEqual({ kind: 'tool', tool: 'output', back: 2 })
    expect(parse('output 0')).toEqual({ error: badToolCount('output') })
    expect(parse('file x')).toEqual({ error: USAGE })
    expect(parse('file 1 2')).toEqual({ error: USAGE })
  })

  test('says when the reply copied was cut short', async () => {
    expect(pick(HISTORY, '', true)).toEqual({ text: HISTORY[2], what: 'last reply (partial)' })
  })

  test('copies a code block in a table language by its own name, not the real table', async () => {
    const history = ['```table\nt\n```\n\n| x |\n|---|\n| 1 |']
    expect(pick(history, 'table-code')).toEqual({ text: 't', what: 'table-code block' })
    expect(pick(history, 'table')).toEqual({ text: '| x |\n|---|\n| 1 |', what: 'table' })
  })

  test('says the reply number goes first when it follows reply, and that selection takes none', async () => {
    expect(parse('reply 2')).toEqual({ error: 'The reply number goes first: /copy-that 2 reply' })
    expect(parse('selection 2')).toEqual({ error: numberFirst('2', 'selection') })
    expect(parse('2 reply')).toEqual({ kind: 'block', reply: 2, name: 'reply' })
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
    expect(pick(reply, 'code 3')).toEqual({ error: 'No "code 3" in the last reply; it has reply, python, sh' })
  })

  test('reaches an older reply by R before the name', async () => {
    expect(pick(HISTORY, '3 py')).toEqual({ text: 'old()', what: 'py block' })
    expect(pick(HISTORY, ' 2  table ')).toEqual({ text: '| a |\n|---|\n| 1 |', what: 'table' })
  })

  test('copies what every chip of a reply copies, by the chip name', async () => {
    const reply = '```ruby\na\n```\n\n```json\n{}\n```\n\n```ruby\nb\n```\n\n| x |\n|---|\n| 1 |\n\n```123\ndigits\n```'
    for (const chip of replyTargets(resolved(reply))) {
      const what = chip.name === 'reply' ? 'last reply' : chip.what
      expect(pick([reply], `1 ${chip.name}`)).toEqual({ text: chip.text, what })
      if (!/^\d+$/.test(chip.name)) expect(pick([reply], chip.name)).toEqual({ text: chip.text, what })
    }
  })

  test('names what the reply has when the name is not there', async () => {
    expect(pick(HISTORY, 'table')).toEqual({ error: 'No "table" in the last reply; it has reply, sh 1, sh 2, code' })
    expect(pick(HISTORY, '3 sh')).toEqual({ error: 'No "sh" in reply 3 back; it has reply, py' })
  })

  test('explains an empty history and bad arguments', async () => {
    expect(pick([], '')).toEqual({ error: 'No reply to copy yet' })
    expect(pick(HISTORY, '0')).toEqual({ error: BAD_REPLY })
    expect(pick(HISTORY, '0 sh')).toEqual({ error: BAD_REPLY })
    expect(pick(HISTORY, '2 3')).toEqual({ error: 'No "3" in reply 2 back; it has reply, table' })
    expect(pick(HISTORY, 'sh x')).toEqual({ error: USAGE })
    expect(pick(HISTORY, 'sh 1 2')).toEqual({ error: USAGE })
  })

  test('reads selection as its own request, in any case', async () => {
    expect(parse('selection')).toEqual({ kind: 'selection' })
    expect(parse(' Selection ')).toEqual({ kind: 'selection' })
    expect(parse('2 selection')).toEqual({ error: SELECTION_HAS_NO_REPLY })
  })

  test('the usage says which way each number counts and what code and selection mean', async () => {
    expect(USAGE).toContain('1 = the last')
    expect(USAGE).toContain('count from the top of the reply')
    expect(USAGE).toContain('any code block when none lacks one')
    expect(USAGE).toContain('/copy-that selection')
    expect(USAGE).toContain('/copy-that 1 123')
  })
})

describe('tool counts', () => {
  test('N of 0 gets one line on how N counts, as /copy-that 0 does, not the whole usage', async () => {
    expect(parse('output 0')).toEqual({ error: badToolCount('output') })
    expect(parse('file 00')).toEqual({ error: badToolCount('file') })
    expect(parse('output x')).toEqual({ error: USAGE })
    expect(parse('output 2')).toEqual({ kind: 'tool', tool: 'output', back: 2 })
  })

  test('the help names every tool /copy-that output counts, as it once left out Glob', () => {
    const named = [...OUTPUT_TOOLS].filter(tool => tool !== 'Task')
    expect(named.filter(tool => !USAGE.includes(tool))).toEqual([])
  })
})

describe('group chip names', () => {
  test('a group call chip such as ⧉ bash #2 is never read as the second bash block, which /copy-that bash 2 still means', async () => {
    expect(parse('bash #2')).toEqual({ kind: 'call', name: 'bash #2' })
    expect(parse('1 notes.md #3')).toEqual({ error: callNameAlone('1 notes.md #3') })
    expect(callNameAlone('1 notes.md #3')).toBe('A call name takes nothing else: /copy-that notes.md #3')
    expect(parse('#2')).toEqual({ error: callNameAlone('#2') })
    expect(parse('bash #2 #3')).toEqual({ error: callNameAlone('bash #2 #3') })
    expect(USAGE).not.toMatch(/only a click|cannot point/)
    expect(parse('bash 2')).toEqual({ kind: 'block', reply: 1, name: 'bash 2' })
    expect(parse('#')).toEqual({ kind: 'block', reply: 1, name: '#' })
  })

  test('a numbered call name copies it from the latest group that has it, as the stock toast lists, and says so when none does', async () => {
    const call = (name: string, text: string, callId?: string) => ({ ...target('output', name, text, 'bash output'), ...(callId ? { callId } : {}) })
    const calls = [call('bash #2', 'later', 't4'), call('bash #2', 'early', 't2'), call('bash #1', 'one', 't1')]
    expect(chooseGroupCall(calls, ['t1', 't2', 't3', 't4'], 'bash #2')).toEqual({ text: 'later', what: 'bash output #2' })
    expect(chooseGroupCall(calls, ['t4', 't2'], 'bash #2')).toEqual({ text: 'early', what: 'bash output #2' })
    expect(chooseGroupCall([call('bash #2', 'gone')], [], 'bash #2')).toEqual({ text: 'gone', what: 'bash output #2' })
    expect(chooseGroupCall(calls, ['t1'], 'bash #3')).toEqual({ error: noGroupCall('bash #3') })
    expect(chooseGroupCall([], [], 'bash #2')).toEqual({ error: noGroupCall('bash #2') })
    expect(noGroupCall('bash #3')).not.toMatch(/⧉|click|widen/i)
    const file = { ...target('file', 'README.md #2', 'doc', 'file README.md'), callId: 't9' }
    expect(chooseGroupCall([file], ['t9'], 'readme.md #2')).toEqual({ text: 'doc', what: 'file README.md #2' })
  })

  test('a file chip name picks the last file of that name, in any case, and nothing when none was touched', async () => {
    const file = (name: string, text: string) => target('file', 'file', text, `file ${name}`)
    const files = [file('palette.ts', 'old'), file('notes.md', 'notes'), file('Palette.ts', 'new')]
    expect(chooseNamedCall(files, 'palette.ts')).toEqual({ text: 'new', what: 'last file Palette.ts' })
    expect(chooseNamedCall(files, 'theme.ts')).toBeUndefined()
    expect(chooseNamedCall([], 'notes.md')).toBeUndefined()
    expect(chooseNamedCall(files, 'file')).toBeUndefined()
  })

  test('a tool chip name picks the last output of that tool, and says why when its report cannot be read', async () => {
    const output = (tool: string, text: string) => target('output', 'output', text, `${tool} output`)
    const calls = [output('bash', 'one'), output('grep', 'hits'), output('bash', 'two')]
    expect(chooseNamedCall(calls, 'bash')).toEqual({ text: 'two', what: 'last bash output' })
    expect(chooseNamedCall(calls, 'grep')).toEqual({ text: 'hits', what: 'last grep output' })
    expect(chooseNamedCall(calls, 'tool')).toBeUndefined()
    expect(chooseNamedCall(calls, 'output')).toBeUndefined()
    const lost = { ...output('agent', ''), unavailable: 'gone' }
    expect(chooseNamedCall([lost], 'agent')).toEqual({ error: 'Cannot copy the last agent output: gone' })
  })
})
