import { describe, expect, test } from 'claude-code/testing'

import { backgroundReports, handbackReport, handbackStub, stripAnsi, toolTarget } from '../hooks/tools'
import { confirmation, lineCount } from '../hooks/notices'

const copied = (tool: string, input: unknown, output?: unknown) => toolTarget({ tool, input, output })

describe('toolTarget', () => {
  test('Edit copies the whole file after the edit, every match under replace_all', async () => {
    expect(copied('Edit', { old_string: 'a', new_string: 'b' }, { originalFile: 'a a', oldString: 'a', newString: 'b', replaceAll: false })?.text).toBe('b a')
    expect(copied('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, { originalFile: 'a a', oldString: 'a', newString: 'b', replaceAll: true })?.text).toBe('b b')
    expect(copied('Edit', { old_string: 'x', new_string: '$& $1' }, { originalFile: 'x', oldString: 'x', newString: '$& $1' })?.text).toBe('$& $1')
  })

  test('Edit falls back to new_string when the original file is missing or no longer holds old_string', async () => {
    expect(copied('Edit', { old_string: 'a', new_string: 'fresh' }, { originalFile: null })?.text).toBe('fresh')
    expect(copied('Edit', { old_string: 'gone', new_string: 'fresh' }, { originalFile: 'other' })?.text).toBe('fresh')
    expect(copied('Edit', { old_string: 'a' }, undefined)).toBeUndefined()
  })

  test('Read copies the text it read and nothing for an image', async () => {
    expect(copied('Read', { file_path: '/a' }, { type: 'text', file: { filePath: '/a', content: '{"a":1}' } })?.text).toBe('{"a":1}')
    expect(copied('Read', { file_path: '/a.png' }, { type: 'image', file: { base64: 'AAAA' } })).toBeUndefined()
    expect(copied('Read', { file_path: '/a' }, undefined)).toBeUndefined()
  })

  test('the plan comes from the input, or the output when the input has none', async () => {
    expect(copied('ExitPlanMode', { plan: '# P' })?.kind).toBe('plan')
    expect(copied('ExitPlanMode', {}, { plan: '# Q' })?.text).toBe('# Q')
    expect(copied('ExitPlanMode', { plan: '  ' }, { plan: null })).toBeUndefined()
  })

  test('outputs: Bash stdout then stderr, Grep content or file names, WebFetch result, Agent report, MCP text blocks', async () => {
    expect(copied('Bash', {}, { stdout: 'out', stderr: 'err' })?.text).toBe('out\nerr')
    expect(copied('Grep', {}, { content: 'a:1' })?.text).toBe('a:1')
    expect(copied('Grep', {}, { filenames: ['a.rb', 'b.rb'] })?.text).toBe('a.rb\nb.rb')
    expect(copied('WebFetch', {}, { result: '# Page' })?.text).toBe('# Page')
    expect(copied('Agent', {}, { content: [{ type: 'text', text: 'found it' }] })?.text).toBe('found it')
    expect(copied('Agent', {}, { handbackReport: { text: 'report' }, content: [] })?.text).toBe('report')
    expect(copied('mcp__jira__get', {}, [{ type: 'text', text: 'HR-1' }, { type: 'image' }])?.text).toBe('HR-1')
    expect(copied('mcp__jira__get', {}, { content: [{ type: 'text', text: 'HR-2' }] })?.text).toBe('HR-2')
    expect(copied('mcp__x__y', {}, 'plain')?.text).toBe('plain')
  })

  test('tools it does not know, and empty outputs, give no target', async () => {
    expect(copied('TodoWrite', { todos: [] }, { stdout: 'x' })).toBeUndefined()
    expect(copied('Bash', {}, { stdout: '\u001b[0m', stderr: '' })).toBeUndefined()
    expect(copied('Bash', {}, null)).toBeUndefined()
  })

  test('an Agent output that only says its report was delivered as a message gives no target, so no chip copies the stub', async () => {
    const stub = 'This agent\'s report was delivered to you as a message from "a8f" (its SubagentHandback call). Read it there; it is not repeated here.\n'
    expect(copied('Agent', {}, { content: [{ type: 'text', text: stub }] })).toBeUndefined()
    expect(copied('Agent', {}, stub)).toBeUndefined()
    expect(handbackStub(stub)).toEqual({ agentId: 'a8f' })
    expect(handbackStub('Found 3 callers.')).toBeUndefined()
  })
})

describe('handbackReport', () => {
  test('reads the message of the last SubagentHandback call in an agent transcript', async () => {
    const handback = (message: unknown) => ({ role: 'assistant' as const, text: '', toolUses: [{ tool_use_id: 'h', tool: 'SubagentHandback', input: { message } }] })
    expect(handbackReport([handback('first'), handback('final')])).toBe('final')
    expect(handbackReport([handback('  ')])).toBeUndefined()
    expect(handbackReport([{ role: 'assistant', text: 'no handback', toolUses: [] }])).toBeUndefined()
  })
})

describe('stripAnsi', () => {
  test('drops colour, cursor and OSC 8 link codes and keeps the text', async () => {
    expect(stripAnsi('\u001b[1;31mred\u001b[0m \u001b[2Kline')).toBe('red line')
    expect(stripAnsi('\u001b]8;;https://x.io\u0007link\u001b]8;;\u0007')).toBe('link')
    expect(stripAnsi('plain')).toBe('plain')
  })
})

describe('backgroundReports', () => {
  test('reads each task notification result by task id, and skips empty or unfinished ones', async () => {
    const user = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
    const reports = backgroundReports([
      user('<task-notification><task-id>a</task-id><result>one</result></task-notification> <task-notification><task-id>b</task-id><result> </result></task-notification>'),
      user('<task-notification><task-id>c</task-id><status>running</status></task-notification>'),
      { role: 'assistant', text: '<task-notification><task-id>d</task-id><result>quoted</result></task-notification>', toolUses: [] },
    ])
    expect([...reports]).toEqual([['a', 'one']])
  })
})

describe('lineCount', () => {
  test('does not count the newline that ends the text as one more line', async () => {
    expect(lineCount('a\nb\nc\n')).toBe(3)
    expect(lineCount('a\nb\nc')).toBe(3)
    expect(lineCount('\n')).toBe(1)
    expect(lineCount('a\n\n')).toBe(2)
    expect(lineCount('')).toBe(0)
  })

  test('counts a file read with its closing newline as the lines it holds in the copy confirmation', async () => {
    expect(confirmation({ ok: true, via: 'pbcopy' }, 'file', 'line 1\nline 2\n')).toBe('Copied file (2 lines, pbcopy)')
    expect(confirmation({ ok: true, via: 'pbcopy' }, 'file', 'one\n')).toBe('Copied file (1 line, pbcopy)')
  })
})
