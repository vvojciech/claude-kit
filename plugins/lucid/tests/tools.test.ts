import { describe, expect, test } from 'claude-code/testing'

import { collapsePastes } from '../hooks/prompt'
import { spansWidth } from '../hooks/markdown'
import type { Span } from '../hooks/markdown'
import { TASK_STILL_RUNNING, TASK_UNTRACKED, backgroundTaskId, callEnd, createdContent, describeCall, durationText, failureOf, notificationRow, fileHref, fitMiddle, headline, plural, relativePath, stateOf, stoppedTaskId, summarise, summariseGroup, toolName, unsuccessfulLines, unsuccessfulState, verbFor } from '../hooks/tools'
import type { ToolCall, ToolLine, TrackedCall } from '../hooks/tools'

const ROOTS = { cwd: '/repo', home: '/Users/me' }

const done = { isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }

const pending = { isRunning: false, isErrored: false, isInterrupted: false }

const failed = { ...done, isErrored: true }

const cut = { ...done, isErrored: true, isInterrupted: true, output: 'User rejected tool use' }

const rejected = { ...cut, refused: true }

const launched = { ...done, output: { status: 'async_launched', agentId: 'a1', description: 'count files', prompt: 'p', outputFile: '/tmp/o' } }

function text(spans: ReadonlyArray<Span>): string {
  return spans.map(s => s.text).join('')
}

function line(l: ToolLine): string {
  return [`${l.label} ${text(l.detail)}`, l.note].filter(Boolean).join('  ')
}

function group(calls: TrackedCall[]) {
  return summariseGroup(calls, ROOTS)
}

function bash(command: string): ToolCall {
  return { tool: 'Bash', input: { command }, ...done }
}

function read(file_path: string, extra: Record<string, unknown> = {}): ToolCall {
  return { tool: 'Read', input: { file_path, ...extra }, ...done }
}

describe('summarise', () => {
  test('shows a Bash command as shell spans with a line count for scripts', async () => {
    const row = summarise('Bash', { command: 'git status\ngit diff' }, ROOTS)
    expect(row.detail.filter(s => s.kind !== 'space').map(s => s.kind)).toEqual(['command', 'subcommand', 'line'])
    expect(row.note).toBe('+1 line')
    expect(summarise('Bash', { command: 'a\nb\nc' }, ROOTS).note).toBe('+2 lines')
  })

  test('shows the first command line when a script opens with a blank line', async () => {
    const row = summarise('Bash', { command: '   \n git status' }, ROOTS)
    expect(text(row.detail)).toBe('git status')
    expect(row.note).toBeUndefined()
  })

  test('copes with missing input', async () => {
    expect(summarise('Bash', undefined, ROOTS).detail).toEqual([])
    expect(summarise('mcp__x__y', null, ROOTS).detail).toEqual([])
  })
})

describe('paths', () => {
  test('draws paths under the project relative to it', async () => {
    expect(relativePath('/repo/app/a.rb', ROOTS)).toBe('app/a.rb')
    expect(relativePath('/repo', ROOTS)).toBe('.')
    expect(relativePath('/repo', { cwd: '/repo/' })).toBe('.')
    expect(relativePath('/repo/a.ts', { cwd: '/repo/' })).toBe('a.ts')
    expect(relativePath('/repository/a.ts', ROOTS)).toBe('/repository/a.ts')
  })

  test('shortens only the session user home to a tilde', async () => {
    expect(relativePath('/Users/me/x/y.md', ROOTS)).toBe('~/x/y.md')
    expect(relativePath('/Users/someone/x/y.md', ROOTS)).toBe('/Users/someone/x/y.md')
    expect(relativePath('/home/someone/x', ROOTS)).toBe('/home/someone/x')
    expect(relativePath('/Users/me/x', { cwd: '/repo' })).toBe('/Users/me/x')
  })

  test('keeps the leading slash on a path outside the project', async () => {
    expect(text(summarise('Read', { file_path: '/other/x/index.ts' }, ROOTS).detail)).toBe('/other/x/index.ts')
  })

  test('links every file path to the file itself', async () => {
    const [path] = summarise('Write', { file_path: '/repo/out/a b.md' }, ROOTS).detail
    expect(path?.href).toBe('file:///repo/out/a%20b.md')
    expect(fileHref('rel/x.ts', ROOTS)).toBe('file:///repo/rel/x.ts')
    expect(summarise('Grep', { pattern: 'x', path: '/repo/hooks' }, ROOTS).detail.find(s => s.kind === 'path')?.href).toBe('file:///repo/hooks')
  })
})

describe('Read ranges', () => {
  function range(input: Record<string, unknown>): string {
    return text(summarise('Read', { file_path: '/repo/a.ts', ...input }, ROOTS).detail)
  }

  test('draws an offset and limit as the span of lines read', async () => {
    expect(range({ offset: 10, limit: 5 })).toBe('a.ts:10-14')
    expect(range({ limit: 50 })).toBe('a.ts:1-50')
  })

  test('draws an open-ended offset as where reading started', async () => {
    expect(range({ offset: 10 })).toBe('a.ts from line 10')
  })

  test('adds nothing for a read from the top', async () => {
    expect(range({ offset: 0 })).toBe('a.ts')
    expect(range({ offset: 1 })).toBe('a.ts')
    expect(range({})).toBe('a.ts')
  })
})

describe('search rows', () => {
  test('quotes the pattern so it cannot be read as a path', async () => {
    const detail = summarise('Grep', { pattern: 'export function', path: '/repo/hooks' }, ROOTS).detail
    expect(text(detail)).toBe('"export function" in hooks')
    expect(detail[0]?.kind).toBe('string')
    expect(detail.find(s => s.text === 'hooks')?.kind).toBe('path')
  })

  test('keeps the filters that narrow a search', async () => {
    expect(text(summarise('Grep', { pattern: 'x', glob: '*.ts', type: 'ts', '-i': true }, ROOTS).detail)).toBe('"x" glob *.ts type ts -i')
  })

  test('escapes quotes inside the pattern', async () => {
    expect(text(summarise('Grep', { pattern: 'say "hi"' }, ROOTS).detail)).toBe('"say \\"hi\\""')
  })
})

describe('edits', () => {
  test('says when an edit replaces every occurrence', async () => {
    expect(summarise('Edit', { file_path: '/repo/a.ts', replace_all: true }, ROOTS).note).toBe('all occurrences')
    expect(summarise('Edit', { file_path: '/repo/a.ts' }, ROOTS).note).toBeUndefined()
  })
})

describe('MCP and unknown tools', () => {
  test('names MCP tools by humanised server and tool with a marker between', async () => {
    expect(toolName('mcp__playwright__browser_click')).toBe('playwright › browser click')
    expect(toolName('mcp__claude_ai_Slack__slack_send_message')).toBe('Slack › send message')
    expect(toolName('mcp__plugin_ctx_context7__resolve')).toBe('context7 › resolve')
  })

  test('shows the first two scalar arguments when a tool has no description', async () => {
    const detail = summarise('mcp__playwright__browser_click', { element: 'Submit button', ref: 'e12', options: { force: true }, extra: 'z' }, ROOTS).detail
    expect(text(detail)).toBe('element: Submit button · ref: e12')
  })

  test('clips long argument values', async () => {
    const detail = summarise('mcp__x__y', { body: 'a'.repeat(100) }, ROOTS).detail
    expect(text(detail).length).toBeLessThan(50)
    expect(text(detail).endsWith('…')).toBe(true)
  })

  test('prefers a task subject over its description', async () => {
    expect(text(summarise('TaskCreate', { subject: 'Fix login', description: 'Long text about it' }, ROOTS).detail)).toBe('Fix login')
  })
})

describe('plural', () => {
  test('agrees with its count', async () => {
    expect(plural(1, 'tool')).toBe('1 tool')
    expect(plural(0, 'tool')).toBe('0 tools')
    expect(plural(2, 'line')).toBe('2 lines')
  })
})

describe('stateOf', () => {
  test('prefers interrupted over failed', async () => {
    expect(stateOf({ ...done, isErrored: true, isInterrupted: true })).toBe('interrupted')
  })

  test('tells a refusal at the dialog from an interrupt', async () => {
    expect(stateOf(rejected)).toBe('rejected')
    expect(stateOf({ ...failed, output: 'Permission to use Bash has been denied.' })).toBe('rejected')
    expect(stateOf({ ...failed, output: 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: x' })).toBe('rejected')
  })

  test('does not read a shell "Permission denied" as a refusal', async () => {
    expect(stateOf({ ...failed, output: 'Error: Exit code 1\ncat: x: Permission denied' })).toBe('failed')
  })

  test('reads running and done', async () => {
    expect(stateOf({ ...pending, isRunning: true })).toBe('running')
    expect(stateOf(done)).toBe('done')
  })

  test('never calls a call with no result and not running done', async () => {
    expect(stateOf(pending)).toBe('pending')
    expect(stateOf({ ...pending, output: undefined })).not.toBe('done')
  })

  test('keeps a background agent running until its loop ends', async () => {
    expect(stateOf(launched, 'running')).toBe('running')
    expect(stateOf(launched, 'pending')).toBe('running')
    expect(stateOf(launched, 'waiting')).toBe('running')
    expect(stateOf(launched, 'completed')).toBe('done')
    expect(stateOf(launched, 'idle')).toBe('done')
    expect(stateOf(launched, 'failed')).toBe('failed')
    expect(stateOf(launched, 'killed')).toBe('interrupted')
    expect(stateOf(launched)).toBe('done')
  })
})

describe('verbFor', () => {
  test('speaks in past tense once a call is done', async () => {
    expect(verbFor('Bash', 'done')).toBe('Ran')
    expect(verbFor('Bash', 'running')).toBe('Running')
    expect(verbFor('mcp__playwright__browser_click', 'done')).toBe('Called playwright › browser click')
  })

  test('asks rather than claims while the call waits for approval', async () => {
    expect(verbFor('Write', 'pending')).toBe('Wants to write')
    expect(verbFor('Bash', 'pending')).toBe('Wants to run')
    expect(verbFor('mcp__x__do_it', 'pending')).toBe('Wants to call x › do it')
    expect(verbFor('Unknown', 'pending')).toBe('Wants to use Unknown')
  })

  test('never uses a success verb for a call that did not succeed', async () => {
    expect(verbFor('Bash', 'failed')).toBe("Couldn't run")
    expect(verbFor('Write', 'rejected')).toBe('Not allowed to write')
    expect(verbFor('Bash', 'interrupted')).toBe('Stopped running')
  })

  test('names who an agent call delegated to', async () => {
    expect(verbFor('Agent', 'done', { subagent_type: 'Explore' })).toBe('Delegated to Explore')
    expect(verbFor('Agent', 'running', { subagent_type: 'Explore' })).toBe('Delegating to Explore')
    expect(verbFor('Agent', 'failed', {})).toBe("Couldn't delegate")
    expect(verbFor('Agent', 'done', { subagent_type: 'general-purpose' })).toBe('Delegated')
    expect(verbFor('Agent', 'rejected', { subagent_type: 'Plan' })).toBe('Not allowed to delegate to Plan')
  })
})

describe('describeCall', () => {
  test('names a failed command honestly', async () => {
    const row = describeCall({ tool: 'Bash', input: { command: 'cat missing.txt' }, ...failed, output: 'Error: Exit code 1\ncat: missing.txt: No such file' }, ROOTS)
    expect(row.name).toBe("Couldn't run")
    expect(text(row.detail)).toBe('cat missing.txt')
  })

  test('leaves the refusal to the result row under a rejected write', async () => {
    const row = describeCall({ tool: 'Write', input: { file_path: '/repo/out/deny.md' }, ...rejected }, ROOTS)
    expect(row.name).toBe('Not allowed to write')
    expect(text(row.detail)).toBe('out/deny.md')
  })

  test('draws a write waiting at the dialog as wanted, not written', async () => {
    const row = describeCall({ tool: 'Write', input: { file_path: '/repo/out/x.md' }, ...pending }, ROOTS)
    expect(row.name).toBe('Wants to write')
  })

  test('marks a background agent that is still at work', async () => {
    const call = { tool: 'Agent', input: { subagent_type: 'Explore', description: 'count ts files', run_in_background: true }, ...launched }
    const running = describeCall(call, ROOTS, 'running')
    expect(running.name).toBe('Delegating to Explore')
    expect(running.note).toBe('background')
    expect(text(running.detail)).toBe('"count ts files"')
    const finished = describeCall(call, ROOTS, 'completed')
    expect(finished.name).toBe('Delegated to Explore')
    expect(finished.note).toBeUndefined()
  })
})

describe('headline', () => {
  test('says what ran in kinds and counts, as the stock line does', async () => {
    expect(headline([read('/repo/a.ts'), read('/repo/b.ts'), bash('ls'), { tool: 'Grep', input: { pattern: 'x' }, ...done }], ROOTS)).toBe('Read 2 files, ran 1 command, searched for 1 pattern')
  })

  test('counts a file read twice once, and a command run twice twice', async () => {
    expect(headline([read('/repo/a.ts'), read('/repo/a.ts'), bash('npm test'), bash('npm test')], ROOTS)).toBe('Read 1 file, ran 2 commands')
  })

  test('names MCP calls by server and skills by verb instead of a vague tool count', async () => {
    expect(headline([bash('ls'), { tool: 'mcp__x__y', input: {}, ...done }, { tool: 'Skill', input: {}, ...done }], ROOTS)).toBe('Ran 1 command, called 1 x tool, loaded 1 skill')
  })

  test('names each known kind by its verb, and counts only tools it has no verb for', async () => {
    const task = { tool: 'TaskCreate', input: { subject: 'a' }, ...done }
    expect(headline([bash('ls'), task, { tool: 'TodoWrite', input: {}, ...done }], ROOTS)).toBe('Ran 1 command, added task, updated todos')
    expect(headline([bash('ls'), { tool: 'Mystery', input: {}, ...done }, { tool: 'Other', input: {}, ...done }], ROOTS)).toBe('Ran 1 command, used 2 tools')
    expect(headline([bash('ls'), task, { ...task, input: { subject: 'b' } }], ROOTS)).toBe('Ran 1 command, added task ×2')
    expect(headline([bash('ls'), task], ROOTS)).toBe('Ran 1 command, added task')
  })

  test('heads a group of tool searches with the tools that loaded', async () => {
    const search = (query: string, matches: string[]) => ({ tool: 'ToolSearch', input: { query }, ...done, output: { matches, query } })
    expect(headline([search('todo list', ['TaskCreate', 'TodoWrite']), search('select:TodoWrite', ['TodoWrite'])], ROOTS)).toBe('Loaded 2 tools')
    expect(headline([search('a', ['A']), { tool: 'WebSearch', input: { query: 'x' }, ...done }, { tool: 'WebSearch', input: { query: 'y' }, ...done }], ROOTS)).toBe('Loaded 1 tool, searched web for 2 queries')
  })

  test('puts running work first and merges it into its own kind', async () => {
    const shell = (command: string, taskStatus?: string) => ({ ...bash(command), output: { stdout: '', backgroundTaskId: command }, taskStatus })
    expect(headline([read('/repo/a.ts'), shell('a', TASK_STILL_RUNNING), shell('b', 'completed')], ROOTS)).toBe('Ran 1 of 2 commands (1 still running), read 1 file')
    expect(headline([read('/repo/a.ts'), shell('a', TASK_STILL_RUNNING)], ROOTS)).toBe('Running 1 command, read 1 file')
  })
})

describe('summariseGroup', () => {
  test('draws a settled group as a headline with one line per kind of target', async () => {
    const { row, state } = group([read('/repo/a/b.ts'), read('/repo/c.ts'), { tool: 'Grep', input: { pattern: 'x' }, ...done }])
    expect(row.name).toBe('Read 2 files, searched for 1 pattern')
    expect(row.lines?.map(line)).toEqual(['Read a/b.ts · c.ts', 'Searched "x"'])
    expect(state).toBe('done')
  })

  test('gives every command its own line with its own line count', async () => {
    const { row } = group([bash('echo one\necho two'), bash('git log --format="%h %s, %an"'), bash('cat x')])
    expect(row.lines?.map(line)).toEqual(['Ran echo one…  +1 line', 'Ran git log --format="%h %s, %an"', 'Ran cat x'])
  })

  test('counts repeated calls instead of hiding them', async () => {
    const { row } = group([read('/repo/a.ts'), read('/repo/a.ts'), read('/repo/a.ts'), bash('npm test'), bash('npm test')])
    expect(row.lines?.map(line)).toEqual(['Read a.ts ×3', 'Ran npm test ×2'])
  })

  test('hides no call behind a count', async () => {
    const { row } = group(['a', 'b', 'c', 'd', 'e'].map(bash))
    expect(row.lines).toHaveLength(5)
  })

  test('never rewrites paths inside shell commands', async () => {
    const { row } = group([bash('cat /repo/x/y.ts'), bash('for f in hooks/a.ts hooks/b.ts; do wc -l "$f"; done')])
    expect(row.lines?.map(line)).toEqual(['Ran cat /repo/x/y.ts', 'Ran for f in hooks/a.ts hooks/b.ts; do wc -l "$f"; done'])
  })

  test('draws paths the same way a shell line beside them would', async () => {
    const { row } = group([read('/repo/a/index.ts'), read('/repo/b/index.ts'), read('/repo/b/other.ts')])
    expect(row.lines?.map(line)).toEqual(['Read a/index.ts · b/index.ts · b/other.ts'])
  })

  test('keeps a file outside the project absolute next to one inside', async () => {
    const { row } = group([read('/other/x/index.ts'), read('/repo/x/index.ts')])
    expect(row.lines?.map(line)).toEqual(['Read /other/x/index.ts · x/index.ts'])
  })

  test('groups agent calls by who they went to', async () => {
    const agent = (type: string, description: string) => ({ tool: 'Agent', input: { subagent_type: type, description }, ...done })
    const { row } = group([agent('Explore', 'find a'), agent('Plan', 'plan b'), agent('Explore', 'find c')])
    expect(row.lines?.map(line)).toEqual(['Delegated to Explore "find a" · "find c"', 'Delegated to Plan "plan b"'])
  })

  test('draws a one-call group as the call itself', async () => {
    const { row, state } = group([bash('ls')])
    expect(row.name).toBe('Ran')
    expect(row.lines).toBeUndefined()
    expect(state).toBe('done')
  })
})

describe('fitMiddle', () => {
  const spans: Span[] = [
    { text: 'src/components/', kind: 'path' },
    { text: 'deeply/nested/file.ts', kind: 'path' },
  ]

  test('leaves spans that fit alone', async () => {
    expect(fitMiddle(spans, 100)).toEqual(spans)
  })

  test('cuts the middle so the start and the end both stay', async () => {
    const fitted = fitMiddle(spans, 15)
    expect(text(fitted)).toBe('src/com…file.ts')
    expect(spansWidth(fitted)).toBe(15)
  })

  test('counts wide characters by cells', async () => {
    const fitted = fitMiddle([{ text: '日本語のファイル名.ts', kind: 'path' }], 9)
    expect(spansWidth(fitted)).toBeLessThanOrEqual(9)
    expect(text(fitted).startsWith('日本')).toBe(true)
    expect(text(fitted).endsWith('.ts')).toBe(true)
  })

  test('draws nothing when there is no room', async () => {
    expect(fitMiddle(spans, 0)).toEqual([])
    expect(text(fitMiddle(spans, 1))).toBe('…')
  })
})

describe('collapsePastes', () => {
  test('replaces pasted blocks with a line count', async () => {
    const parts = collapsePastes('look at this\n<pasted_content id="1">a\nb\nc</pasted_content id="1">\nthanks')
    expect(parts.map(p => p.text).join('')).toBe('look at this [pasted 3 lines] thanks')
  })
})

describe('round 4 tool rows', () => {
  const backgrounded = (tool: string, output: Record<string, unknown>, input: Record<string, unknown> = {}): ToolCall => ({ tool, input, ...done, output })

  test('reads the background task id of a shell, a monitor and an agent', async () => {
    expect(backgroundTaskId('Bash', { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' })).toBe('b1')
    expect(backgroundTaskId('Bash', { stdout: 'x', stderr: '', interrupted: false })).toBeUndefined()
    expect(backgroundTaskId('Monitor', { taskId: 'm1', timeoutMs: 0 })).toBe('m1')
    expect(backgroundTaskId('Agent', launched.output)).toBe('a1')
    expect(backgroundTaskId('Read', { taskId: 'x' })).toBeUndefined()
    expect(backgroundTaskId('Bash', 'Error: x')).toBeUndefined()
  })

  test('never draws a backgrounded shell or monitor as done while its task runs', async () => {
    const shell = backgrounded('Bash', { stdout: '', backgroundTaskId: 'b1' }, { command: 'sleep 25 && echo slept', run_in_background: true })
    const running = describeCall(shell, ROOTS, TASK_STILL_RUNNING)
    expect(stateOf(shell, TASK_STILL_RUNNING)).toBe('running')
    expect(running.name).toBe('Running')
    expect(running.note).toBe('background')
    const watch = describeCall(backgrounded('Monitor', { taskId: 'm1' }, { description: 'tail the log' }), ROOTS, TASK_STILL_RUNNING)
    expect(watch.name).toBe('Watching')
    expect(watch.note).toBe('background')
  })

  test('settles a background shell by how its task ended', async () => {
    const shell = backgrounded('Bash', { stdout: '', backgroundTaskId: 'b1' }, { command: 'sleep 1' })
    expect(describeCall(shell, ROOTS, 'completed').name).toBe('Ran')
    expect(describeCall(shell, ROOTS, 'completed').note).toBeUndefined()
    expect(stateOf(shell, 'failed')).toBe('failed')
    expect(stateOf(shell, 'killed')).toBe('interrupted')
    expect(describeCall(shell, ROOTS, 'killed').name).toBe('Stopped running')
    expect(describeCall(shell, ROOTS, 'killed').note).toBeUndefined()
  })

  test('finds the task a stop call ended', async () => {
    expect(stoppedTaskId({ tool: 'TaskStop', input: { task_id: 'b1' }, output: { message: 'ok', task_id: 'b1', task_type: 'shell' } })).toBe('b1')
    expect(stoppedTaskId({ tool: 'KillShell', input: { shell_id: 'b2' }, output: 'ok' })).toBe('b2')
    expect(stoppedTaskId({ tool: 'Bash', input: { task_id: 'b1' }, output: {} })).toBeUndefined()
    expect(stoppedTaskId({ tool: 'TaskStop', input: {}, output: undefined })).toBeUndefined()
  })

  test('marks the worst outcome in a group, or none when all went well', async () => {
    expect(unsuccessfulState([done, failed, rejected])).toBe('failed')
    expect(unsuccessfulState([done, rejected, { ...done, isInterrupted: true }])).toBe('rejected')
    expect(unsuccessfulState([done, { ...done, isInterrupted: true }])).toBe('interrupted')
    expect(unsuccessfulState([done, done])).toBeUndefined()
    expect(unsuccessfulState([])).toBeUndefined()
  })

  test('draws a one-line read as that line, not a range', async () => {
    expect(text(summarise('Read', { file_path: '/repo/a.ts', offset: 1, limit: 1 }, ROOTS).detail)).toBe('a.ts:1')
    expect(text(summarise('Read', { file_path: '/repo/a.ts', offset: 7, limit: 1 }, ROOTS).detail)).toBe('a.ts:7')
    expect(text(summarise('Read', { file_path: '/repo/a.ts', limit: 0 }, ROOTS).detail)).toBe('a.ts')
  })

  test('counts one file read at two ranges as one file', async () => {
    expect(headline([read('/repo/a.ts', { offset: 1, limit: 10 }), read('/repo/a.ts', { offset: 20, limit: 5 })], ROOTS)).toBe('Read 1 file')
  })

  test('links paths holding a hash or a question mark to the file itself', async () => {
    expect(fileHref('/repo/a b#c?.ts', ROOTS)).toBe('file:///repo/a%20b%23c%3F.ts')
    expect(fileHref('/repo/x/%41.ts', ROOTS)).toBe('file:///repo/x/%2541.ts')
    expect(fileHref('/', ROOTS)).toBe('file:///')
  })

  test('keeps the whole first line of a long command so the middle cut keeps its end', async () => {
    const command = `echo ${'a'.repeat(300)} ENDWORD`
    const detail = summarise('Bash', { command }, ROOTS).detail
    expect(text(detail)).toBe(command)
    expect(text(fitMiddle(detail, 60)).endsWith('ENDWORD')).toBe(true)
  })

  test('marks a command that goes on past its first line', async () => {
    expect(text(summarise('Bash', { command: 'echo "a\nb"' }, ROOTS).detail)).toBe('echo "a…')
  })

  test('never cuts an emoji in half', async () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    const clipped = text(summarise('mcp__x__y', { body: 'a'.repeat(37) + '😀😀😀😀' }, ROOTS).detail)
    expect(lone.test(clipped)).toBe(false)
    const family = '👨‍👩‍👧'
    const fitted = text(fitMiddle([{ text: `ab${family}cd${family}ef`, kind: 'plain' }], 7))
    expect(fitted.includes('‍') ? fitted.includes(family) : true).toBe(true)
    expect(lone.test(fitted)).toBe(false)
  })

  test('names plan mode, schedules, task stops and code lookups', async () => {
    const plan = summarise('ExitPlanMode', { plan: '# Ship the fix\n\n- step' }, ROOTS)
    expect(verbFor('ExitPlanMode', 'done')).toBe('Proposed plan')
    expect(text(plan.detail)).toBe('Ship the fix')
    expect(verbFor('EnterPlanMode', 'done')).toBe('Entered plan mode')
    expect(summarise('EnterPlanMode', {}, ROOTS).detail).toEqual([])
    expect(verbFor('KillShell', 'done')).toBe('Stopped shell')
    expect(text(summarise('KillShell', { shell_id: 'b1' }, ROOTS).detail)).toBe('b1')
    expect(verbFor('TaskStop', 'done')).toBe('Stopped task')
    expect(text(summarise('TaskStop', { shell_id: 'b9' }, ROOTS).detail)).toBe('b9')
    expect(verbFor('CronCreate', 'done')).toBe('Scheduled')
    expect(text(summarise('CronCreate', { cron: '*/5 * * * *', prompt: 'check CI' }, ROOTS).detail)).toBe('*/5 * * * * check CI')
    expect(verbFor('CronDelete', 'done')).toBe('Unscheduled')
    const lsp = summarise('LSP', { operation: 'goToDefinition', filePath: '/repo/a.ts', line: 12, character: 3 }, ROOTS)
    expect(verbFor('LSP', 'done')).toBe('Looked up')
    expect(text(lsp.detail)).toBe('definition a.ts:12')
    expect(lsp.detail.find(s => s.kind === 'path')?.href).toBe('file:///repo/a.ts')
    expect(text(summarise('LSP', { operation: 'workspaceSymbol', query: 'Foo', filePath: 'a.ts', line: 1, character: 1 }, ROOTS).detail)).toBe('workspace symbols "Foo"')
  })

  test('shows the question asked and the shape of a todo list', async () => {
    const asked = summarise('AskUserQuestion', { questions: [{ question: 'Which library?', header: 'Lib', options: [], multiSelect: false }] }, ROOTS)
    expect(text(asked.detail)).toBe('Which library?')
    expect(summarise('AskUserQuestion', { questions: [] }, ROOTS).detail).toEqual([])
    const todos = summarise('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'in_progress' }] }, ROOTS)
    expect(text(todos.detail)).toBe('3 todos · 1 done')
    expect(summarise('TodoWrite', { todos: [] }, ROOTS).detail).toEqual([])
    expect(summarise('TodoWrite', {}, ROOTS).detail).toEqual([])
  })

  test('lists the tools a select query loads instead of the query syntax', async () => {
    expect(text(summarise('ToolSearch', { query: 'select:Monitor,mcp__slack__slack_post', max_results: 5 }, ROOTS).detail)).toBe('Monitor, slack › post')
    expect(text(summarise('ToolSearch', { query: 'notebook jupyter', max_results: 5 }, ROOTS).detail)).toBe('"notebook jupyter"')
    expect(summarise('ToolSearch', { query: 'select:' }, ROOTS).detail).toEqual([])
  })

  test('drops a server name the tool name repeats and humanises hyphens', async () => {
    expect(toolName('mcp__plugin_ctx_context7__query-docs')).toBe('context7 › query docs')
    expect(toolName('mcp__Amplitude__get_amplitude_context')).toBe('Amplitude › get context')
    expect(toolName('mcp__slack__slack')).toBe('slack › slack')
  })

  test('keeps the grep options that change what the result shows', async () => {
    const detail = (input: Record<string, unknown>) => text(summarise('Grep', { pattern: 'x', ...input }, ROOTS).detail)
    expect(detail({ output_mode: 'content', '-n': true, '-A': 2, multiline: true })).toBe('"x" content -n multiline -A 2')
    expect(detail({ output_mode: 'files_with_matches' })).toBe('"x"')
    expect(detail({ output_mode: 'count', context: 3, head_limit: 20 })).toBe('"x" count -C 3 first 20')
    expect(detail({ '-n': false })).toBe('"x"')
  })

  test('reads the content of a newly created file and nothing else', async () => {
    expect(createdContent('Write', { type: 'create', filePath: '/repo/a', content: 'a\nb', structuredPatch: [], originalFile: null })).toBe('a\nb')
    expect(createdContent('Write', { type: 'update', content: 'a' })).toBeUndefined()
    expect(createdContent('Write', { type: 'create', content: 'a', staged: true })).toBeUndefined()
    expect(createdContent('Edit', { type: 'create', content: 'a' })).toBeUndefined()
    expect(createdContent('Write', 'User rejected write')).toBeUndefined()
  })

  test('keeps a group with a backgrounded command running until the command ends', async () => {
    const shell = { ...bash('sleep 12 && echo slept'), output: { stdout: '', backgroundTaskId: 'b1' } }
    const running = group([{ ...shell, taskStatus: TASK_STILL_RUNNING }, read('/repo/a.ts')])
    expect(running.state).toBe('running')
    expect(running.row.name).toBe('Running 1 command, read 1 file')
    expect(running.row.lines?.map(line)).toEqual(['Running sleep 12 && echo slept  background', 'Read a.ts'])
    const finished = group([{ ...shell, taskStatus: 'completed' }, read('/repo/a.ts')])
    expect(finished.state).toBe('done')
    expect(finished.row.name).toBe('Ran 1 command, read 1 file')
    expect(finished.row.lines?.map(line)).toEqual(['Ran sleep 12 && echo slept', 'Read a.ts'])
  })

  test('does not fold a running command into a finished one with the same text', async () => {
    const shell = { ...bash('npm test'), output: { stdout: '', backgroundTaskId: 'b1' }, taskStatus: TASK_STILL_RUNNING }
    expect(group([bash('npm test'), shell]).row.lines?.map(line)).toEqual(['Ran npm test', 'Running npm test  background'])
  })

  test('drops the default agent type from delegation rows', async () => {
    const row = describeCall({ tool: 'Agent', input: { subagent_type: 'general-purpose', description: 'slow count' }, ...done }, ROOTS)
    expect(row.name).toBe('Delegated')
    expect(text(row.detail)).toBe('"slow count"')
  })
})

describe('round 5 tool rows', () => {
  const search = (query: string, matches: unknown) => ({ tool: 'ToolSearch', input: { query }, ...done, output: { matches, query, total_deferred_tools: 9 } })

  test('never says it loaded a tool the search did not match', async () => {
    const row = describeCall(search('select:TodoWrite', []), ROOTS)
    expect(stateOf(search('select:TodoWrite', []))).toBe('failed')
    expect(row.name).toBe("Couldn't load")
    expect(text(row.detail)).toBe('TodoWrite')
  })

  test('names the tools that matched, not the ones asked for', async () => {
    const row = describeCall(search('select:mcp__playwright__browser_tabs,WebFetch', ['WebFetch']), ROOTS)
    expect(row.name).toBe('Loaded')
    expect(text(row.detail)).toBe('WebFetch')
    expect(text(describeCall(search('todo list', ['TaskCreate']), ROOTS).detail)).toBe('TaskCreate')
  })

  test('falls back to the query while the search has no output or an odd one', async () => {
    expect(text(describeCall({ ...search('select:A', undefined), output: undefined, isRunning: true }, ROOTS).detail)).toBe('A')
    expect(stateOf(search('x', 'not a list'))).toBe('done')
    expect(stateOf({ ...done, output: { matches: [] } })).toBe('done')
  })

  test('tells a denied call from a stopped one in the row itself', async () => {
    const write = { tool: 'Write', input: { file_path: '/repo/x.md' } }
    expect(describeCall({ ...write, ...rejected }, ROOTS).name).toBe('Not allowed to write')
    expect(describeCall({ ...write, ...rejected }, ROOTS).note).toBeUndefined()
    expect(describeCall({ ...bash('npm test'), isInterrupted: true }, ROOTS).name).toBe('Stopped running')
    expect(describeCall({ ...bash('npm test'), isInterrupted: true }, ROOTS).note).toBeUndefined()
  })

  test('draws a background task with no known end in this process as started, not running', async () => {
    const shell = { ...bash('sleep 40'), output: { stdout: '', backgroundTaskId: 'b9' } }
    const row = describeCall(shell, ROOTS, TASK_UNTRACKED)
    expect(stateOf(shell, TASK_UNTRACKED)).toBe('started')
    expect(row.name).toBe('Started running')
    expect(row.note).toBe('background')
    const watch = { tool: 'Monitor', input: { description: 'x' }, ...done, output: { taskId: 'm9' } }
    expect(describeCall(watch, ROOTS, TASK_UNTRACKED).name).toBe('Started watching')
    expect(group([{ ...shell, taskStatus: TASK_UNTRACKED }, read('/repo/a.ts')]).state).toBe('started')
    expect(group([{ ...shell, taskStatus: TASK_UNTRACKED }]).state).toBe('started')
    expect(stateOf({ ...shell, isErrored: true }, TASK_UNTRACKED)).toBe('failed')
  })

  test('lists only the calls that went wrong, each in its own state', async () => {
    const lines = unsuccessfulLines([{ ...bash('false'), ...failed }, read('/repo/a.ts'), { ...bash('npm test'), isInterrupted: true }], ROOTS)
    expect(lines.map(l => [l.label, l.state])).toEqual([["Couldn't run", 'failed'], ['Stopped running', 'interrupted']])
    expect(unsuccessfulLines([read('/repo/a.ts')], ROOTS)).toEqual([])
    expect(unsuccessfulLines([], ROOTS)).toEqual([])
  })

  test('counts a background shell its notification failed as unsuccessful', async () => {
    const shell = { ...bash('sleep 1'), output: { stdout: '', backgroundTaskId: 'b8' }, taskStatus: 'failed' }
    expect(unsuccessfulState([shell])).toBe('failed')
  })

  test('pluralises nouns ending in a hiss or a consonant y', async () => {
    expect(plural(2, 'web search')).toBe('2 web searches')
    expect(plural(2, 'query')).toBe('2 queries')
    expect(plural(2, 'day')).toBe('2 days')
    expect(plural(1, 'web search')).toBe('1 web search')
  })
})

describe('round 6 tool rows', () => {
  const search = (query: string, matches: unknown) => ({ tool: 'ToolSearch', input: { query }, ...done, output: { matches, query } })

  test('never draws a group holding a search that matched nothing as a success', async () => {
    const calls = [search('select:A,B', ['A', 'B']), search('select:Nope', []), search('select:Gone', [])]
    const { row, state } = group(calls)
    expect(state).toBe('failed')
    expect(row.name).toBe('Loaded 2 of 4 tools (2 failed)')
    expect(row.lines?.map(l => l.state)).toEqual(['done', 'failed'])
  })

  test('says a group whose calls all failed failed, without a success verb', async () => {
    expect(headline([{ ...read('/repo/a.ts'), ...failed }, { ...read('/repo/b.ts'), ...failed }], ROOTS)).toBe("Couldn't read 2 files")
    expect(headline([bash('ls'), { ...bash('false'), ...failed }], ROOTS)).toBe('Ran 1 of 2 commands (1 failed)')
  })

  test('keeps whole tool names and counts the ones it leaves out', async () => {
    const names = ['mcp__Amplitude__get_agent_analytics_info', 'mcp__Amplitude__get_tracking_plan_sources', 'CronList', 'TaskStop', 'mcp__plugin_context7_context7__complete_authentication', 'WebFetch', 'ReadMcpResourceDirTool']
    const detail = describeCall(search('amplitude analytics', names), ROOTS).detail
    expect(text(detail)).toBe('Amplitude › get agent analytics info +6')
    expect(text(describeCall(search('x', ['CronList', 'TaskStop', 'WebFetch', 'mcp__Amplitude__get_tracking_plan_sources', 'LSP']), ROOTS).detail)).toBe('CronList, TaskStop, WebFetch +2')
    expect(text(describeCall(search('x', ['A_very_long_tool_name_that_alone_is_wider_than_the_budget_for_names']), ROOTS).detail)).toBe('A_very_long_tool_name_that_alone_is_wider_than_the_budget_for_names')
    expect(describeCall(search('x', []), ROOTS).detail.map(s => s.text)).toEqual(['"x"'])
  })

  test('shows only the selected names a select query loaded', async () => {
    expect(text(describeCall(search('select:WebFetch', ['WebFetch', 'WebSearch']), ROOTS).detail)).toBe('WebFetch')
    expect(text(describeCall(search('select:', ['WebFetch']), ROOTS).detail)).toBe('WebFetch')
  })

  test('matches select names whatever their case, and keeps the loaded names when none match', async () => {
    expect(text(describeCall(search('select:webfetch', ['WebFetch']), ROOTS).detail)).toBe('WebFetch')
    expect(text(describeCall(search('select:Other', ['WebFetch']), ROOTS).detail)).toBe('WebFetch')
  })

  test('heads background work with no known end as started, not as finished', async () => {
    const shell = (id: string, taskStatus?: string) => ({ ...bash(`sleep ${id}`), output: { stdout: '', backgroundTaskId: id }, taskStatus })
    expect(headline([shell('1', TASK_UNTRACKED), shell('2', TASK_UNTRACKED)], ROOTS)).toBe('Started 2 commands')
    expect(headline([shell('1', 'completed'), shell('2', TASK_UNTRACKED)], ROOTS)).toBe('Ran 1 command, started 1 command')
    const agent = { tool: 'Agent', input: { subagent_type: 'Explore', description: 'count' }, ...launched }
    expect(describeCall(agent, ROOTS, TASK_UNTRACKED).name).toBe('Started delegating to Explore')
    expect(describeCall(agent, ROOTS, TASK_UNTRACKED).note).toBe('background')
  })

  test('uses one verb per tool kind, MCP and monitors included', async () => {
    const watch = (id: string) => ({ tool: 'Monitor', input: { description: id, command: `tail ${id}` }, ...done, output: { taskId: id }, taskStatus: 'completed' })
    expect(headline([watch('a'), watch('b')], ROOTS)).toBe('Watched 2 streams')
    expect(headline([{ ...watch('a'), taskStatus: TASK_UNTRACKED }, bash('ls')], ROOTS)).toBe('Started watching 1 stream, ran 1 command')
    expect(headline([{ tool: 'WebSearch', input: { query: 'x' }, ...done }], ROOTS)).toBe('Searched web for 1 query')
    expect(describeCall({ tool: 'mcp__playwright__browser_tabs', input: { action: 'list' }, ...done }, ROOTS).name).toBe('Called playwright › browser tabs')
    expect(describeCall({ tool: 'Agent', input: { description: 'say hi' }, ...done }, ROOTS).detail.map(s => s.text)).toEqual(['"say hi"'])
    expect(describeCall({ tool: 'Agent', input: {}, ...done }, ROOTS).detail).toEqual([])
  })
})

describe('round 7 tool rows', () => {
  const search = (query: string, matches: string[]) => ({ tool: 'ToolSearch', input: { query }, ...done, output: { matches, query } })

  test('names a denied or stopped call by what happened, not as failed', async () => {
    const write = { tool: 'Write', input: { file_path: '/repo/x.md' }, ...rejected }
    expect(headline([write, read('/repo/a.ts')], ROOTS)).toBe('Read 1 file, not allowed to write 1 file')
    expect(headline([read('/repo/a.ts'), { ...read('/repo/b.ts'), ...rejected }], ROOTS)).toBe('Read 1 of 2 files (1 denied)')
    expect(headline([bash('ls'), { ...bash('npm test'), isInterrupted: true }], ROOTS)).toBe('Ran 1 of 2 commands (1 stopped)')
    expect(headline([bash('ls'), { ...bash('false'), ...failed }, { ...bash('npm test'), isInterrupted: true }], ROOTS)).toBe('Ran 1 of 3 commands (1 failed, 1 stopped)')
    expect(headline([{ ...bash('false'), ...failed }, { ...bash('npm test'), isInterrupted: true }], ROOTS)).toBe("Couldn't run 1 command, stopped running 1 command")
  })

  test('puts what went well before kinds where nothing did', async () => {
    expect(headline([{ ...bash('false'), ...failed }, read('/repo/a.ts')], ROOTS)).toBe("Read 1 file, couldn't run 1 command")
    const grep = { tool: 'Grep', input: { pattern: 'x' }, ...failed }
    const glob = { tool: 'Glob', input: { pattern: '*.ts' }, ...failed }
    expect(headline([read('/repo/a.ts'), grep, glob], ROOTS)).toBe("Read 1 file, couldn't search for 1 pattern, couldn't list 1 pattern")
    expect(headline([grep, { ...glob, ...rejected }], ROOTS)).toBe("Couldn't search for 1 pattern, not allowed to list 1 pattern")
  })

  test('watches the command a monitor runs, not the prose describing it', async () => {
    const monitor = (input: Record<string, unknown>) => text(summarise('Monitor', input, ROOTS).detail)
    expect(monitor({ description: 'Watch log', command: 'tail -f log' })).toBe('tail -f log')
    expect(monitor({ description: 'Ticks from a loop' })).toBe('ticks from a loop')
    expect(monitor({ description: 'API errors' })).toBe('API errors')
    expect(monitor({ ws: { url: 'wss://x' } })).toBe('wss://x')
    expect(monitor({})).toBe('')
  })

  test('lists loaded tool names with one separator', async () => {
    const row = summariseGroup([search('select:A,B', ['A', 'B']), search('select:C', ['C'])], ROOTS).row
    expect(text(row.lines?.[0]?.detail ?? [])).toBe('A, B, C')
  })

  test('reads the reason an errored call gives, and leaves denials and interrupts alone', async () => {
    expect(failureOf('<tool_use_error>String to replace not found in file.\nString: X</tool_use_error>')).toEqual(['String to replace not found in file.', 'String: X'])
    expect(failureOf('Error: Exit code 1\ncat: x: No such file')).toEqual(['Exit code 1', 'cat: x: No such file'])
    expect(failureOf('User rejected tool use')).toBeUndefined()
    expect(failureOf('Interrupted by user')).toBeUndefined()
    expect(failureOf('')).toBeUndefined()
    expect(failureOf('   \n ')).toBeUndefined()
    expect(failureOf({ stdout: '' })).toBeUndefined()
    expect(failureOf(undefined)).toBeUndefined()
  })
})

describe('round 8 group headline counts', () => {
  const shell = (id: string, taskStatus: string) => ({ ...bash(`job ${id}`), output: { stdout: '', backgroundTaskId: id }, taskStatus })

  test('counts every call of a kind in the total, and the asides as parts of it', async () => {
    const calls = [bash('echo fg'), shell('a', TASK_STILL_RUNNING), shell('b', TASK_STILL_RUNNING), { ...bash('x'), ...failed }, { ...bash('y'), ...failed }, { ...bash('z'), ...failed }]
    expect(headline(calls, ROOTS)).toBe('Ran 1 of 6 commands (2 still running, 3 failed)')
  })

  test('does not say ran for work still running beside a failure', async () => {
    expect(headline([shell('a', TASK_STILL_RUNNING), { ...bash('x'), ...failed }], ROOTS)).toBe("Running 1 command, couldn't run 1 command")
  })

  test('counts a file a retry read as one file read, never as two files', async () => {
    expect(headline([read('/repo/a.ts'), { ...read('/repo/a.ts'), ...failed }, read('/repo/a.ts')], ROOTS)).toBe('Read 1 file')
    expect(headline([read('/repo/a.ts'), { ...read('/repo/b.ts'), ...failed }, { ...read('/repo/b.ts'), ...failed }], ROOTS)).toBe('Read 1 of 2 files (1 failed)')
  })

  test('names web search failures by their queries, and counts a kind with no noun by repeats, never as calls', async () => {
    const web = (query: string) => ({ tool: 'WebSearch', input: { query }, ...done })
    expect(headline([web('a'), { ...web('b'), ...failed }], ROOTS)).toBe('Searched web for 1 of 2 queries (1 failed)')
    expect(headline([read('/repo/a.ts'), { ...web('b'), ...failed }, { ...web('c'), ...failed }], ROOTS)).toBe("Read 1 file, couldn't search web for 2 queries")
    const task = (subject: string) => ({ tool: 'TaskCreate', input: { subject }, ...done })
    expect(headline([task('a'), { ...task('b'), ...failed }], ROOTS)).toBe('Added task ×2 (1 failed)')
  })

  test('keeps the plain total when nothing went wrong', async () => {
    expect(headline([bash('a'), bash('b')], ROOTS)).toBe('Ran 2 commands')
  })
})

describe('round 9 tool rows', () => {
  test('calls a rejection of a call that already ran stopped, and one that never ran denied', async () => {
    const write = { tool: 'Write', input: { file_path: '/repo/x.md' }, ...rejected }
    expect(stateOf({ ...rejected, hasRun: true })).toBe('interrupted')
    expect(stateOf({ ...rejected, hasRun: false })).toBe('rejected')
    expect(stateOf(rejected)).toBe('rejected')
    expect(describeCall({ ...bash('find /'), ...rejected, hasRun: true }, ROOTS).name).toBe('Stopped running')
    expect(headline([bash('echo now'), { ...bash('find /'), ...rejected, hasRun: true }], ROOTS)).toBe('Ran 1 of 2 commands (1 stopped)')
    expect(headline([read('/repo/a.ts'), write], ROOTS)).toBe('Read 1 file, not allowed to write 1 file')
  })

  test('calls a cut call with no sign it ran or was refused cancelled, never not allowed', async () => {
    expect(stateOf(cut)).toBe('cancelled')
    expect(stateOf({ ...cut, hasRun: false, refused: false })).toBe('cancelled')
    expect(describeCall({ tool: 'WebFetch', input: { url: 'https://httpbin.org/delay/40' }, ...cut }, ROOTS).name).toMatch(/^Cancelled /)
    expect(describeCall({ ...bash('echo quick'), ...cut }, ROOTS).name).toBe('Cancelled running')
  })

  test('trusts the run signal over a refusal mark, and the denial text over a missing mark', async () => {
    expect(stateOf({ ...cut, hasRun: true, refused: true })).toBe('interrupted')
    expect(stateOf({ ...cut, output: 'Permission to use Bash has been denied.' })).toBe('rejected')
  })

  test('counts cancelled calls apart from denied and stopped ones in a headline', async () => {
    expect(headline([bash('echo now'), { ...bash('echo quick'), ...cut }], ROOTS)).toBe('Ran 1 of 2 commands (1 cancelled)')
    expect(headline([{ ...bash('a'), ...cut }, { ...bash('b'), ...rejected }, { ...bash('c'), ...cut, hasRun: true }], ROOTS)).toBe('Not allowed to run 1 command, stopped running 1 command, cancelled running 1 command')
    expect(failureOf('User rejected tool use')).toBeUndefined()
  })

  test('keeps a failure that is not a rejection failed even after the call ran', async () => {
    expect(stateOf({ ...failed, output: 'Exit code 1', hasRun: true })).toBe('failed')
  })

  test('heads every kind with its own verb and one count shape whatever the outcome', async () => {
    const shell = (id: string, taskStatus: string) => ({ ...bash(`job ${id}`), output: { stdout: '', backgroundTaskId: id }, taskStatus })
    expect(headline([shell('a', TASK_UNTRACKED), { ...bash('x'), ...failed }], ROOTS)).toBe("Couldn't run 1 command, started 1 command")
    expect(headline([shell('a', TASK_STILL_RUNNING)], ROOTS)).toBe('Running 1 command')
    expect(headline([], ROOTS)).toBe('')
  })

  test('counts a tool search that loaded nothing as one failed target beside the tools that loaded', async () => {
    const search = (query: string, matches: string[]) => ({ tool: 'ToolSearch', input: { query }, ...done, output: { matches, query } })
    expect(headline([search('select:A', ['A']), search('select:A', [])], ROOTS)).toBe('Loaded 1 tool')
    expect(headline([search('select:Nope', [])], ROOTS)).toBe("Couldn't load 1 tool")
  })

  test('drops a leading watch verb from a monitor description so the row does not say it twice', async () => {
    expect(text(summarise('Monitor', { description: 'watch log' }, ROOTS).detail)).toBe('log')
    expect(text(summarise('Monitor', { description: 'Watching the deploy' }, ROOTS).detail)).toBe('the deploy')
    expect(text(summarise('Monitor', { description: 'watch' }, ROOTS).detail)).toBe('watch')
    expect(text(summarise('Monitor', { description: 'watchdog restarts' }, ROOTS).detail)).toBe('watchdog restarts')
  })

  test('shows the first line of a plan without its heading marks', async () => {
    expect(text(summarise('ExitPlanMode', { plan: '\n## Ship it\nbody' }, ROOTS).detail)).toBe('Ship it')
    expect(summarise('ExitPlanMode', { plan: '   ' }, ROOTS).detail).toEqual([])
  })

  test('draws a task notification as a row whose glyph says how the task ended', async () => {
    expect(notificationRow('Agent "say hi" finished', { status: 'completed', durationMs: 3200 })).toEqual({ row: { name: 'Agent "say hi" finished', detail: [], note: '3s' }, state: 'done' })
    expect(notificationRow('Background command "x" failed with exit code 2', { status: 'failed' })?.state).toBe('failed')
    expect(notificationRow('Background command "x" was stopped', { status: 'killed' })?.state).toBe('interrupted')
    expect(notificationRow('Monitor event: "ticks"', {})).toBeUndefined()
    expect(notificationRow('Monitor event: "ticks"', { status: 'progress' })).toBeUndefined()
    expect(notificationRow('  \n', { status: 'completed' })).toBeUndefined()
  })

  test('draws an agent that completed with its own background work still running as started, never done', () => {
    const interim = 'Agent "Run sleep and echo" is waiting on its own background work'
    expect(notificationRow(interim, { status: 'completed', durationMs: 19000 })).toEqual({ row: { name: interim, detail: [], note: '19s' }, state: 'started' })
    expect(notificationRow(`${interim}\nmore`, { status: 'failed' })?.state).toBe('failed')
    expect(notificationRow('Agent "waiting room" finished', { status: 'completed' })?.state).toBe('done')
    expect(notificationRow('Agent "x" finished\nis waiting on its own background work', { status: 'completed' })?.state).toBe('done')
  })

  test('says how long a task ran in the units the stock row uses', async () => {
    expect(durationText(undefined)).toBeUndefined()
    expect(durationText(-1)).toBeUndefined()
    expect(durationText(Number.NaN)).toBeUndefined()
    expect(durationText(0)).toBe('0s')
    expect(durationText(59_400)).toBe('59s')
    expect(durationText(122_000)).toBe('2m 2s')
    expect(durationText(120_000)).toBe('2m')
    expect(durationText(3_600_000)).toBe('1h')
    expect(durationText(3_780_000)).toBe('1h 3m')
  })
})

describe('round 10 tool rows', () => {
  const grep = (pattern: string, outcome = done) => ({ tool: 'Grep', input: { pattern, path: '/repo/hooks' }, ...outcome })
  const glob = (pattern: string, outcome = done) => ({ tool: 'Glob', input: { pattern, path: '/repo' }, ...outcome })
  const shell = (id: string, taskStatus?: string) => ({ ...bash(`sleep ${id}`), output: { stdout: '', backgroundTaskId: id }, taskStatus })
  const watch = (taskStatus: string) => ({ tool: 'Monitor', input: { command: 'tail log' }, ...done, output: { taskId: 'm1' }, taskStatus })

  test('counts searches by pattern, not by the directory they ran in', async () => {
    expect(headline([grep('foo'), grep('bar')], ROOTS)).toBe('Searched for 2 patterns')
    expect(headline([grep('foo'), grep('bar', failed)], ROOTS)).toBe('Searched for 1 of 2 patterns (1 failed)')
    expect(headline([glob('*.ts'), glob('*.md', rejected)], ROOTS)).toBe('Listed 1 of 2 patterns (1 denied)')
    expect(headline([grep('foo'), grep('foo')], ROOTS)).toBe('Searched for 1 pattern')
  })

  test('gives a group whose failed call was retried the glyph its headline earns', async () => {
    const { row, state } = group([read('/repo/a.ts'), { ...read('/repo/a.ts'), ...failed }, read('/repo/a.ts')])
    expect(row.name).toBe('Read 1 file')
    expect(state).toBe('done')
    expect(row.lines?.map(line)).toContain("Couldn't read a.ts")
  })

  test('keeps the failed glyph while any target never succeeded', async () => {
    const { row, state } = group([read('/repo/a.ts'), { ...read('/repo/b.ts'), ...failed }])
    expect(row.name).toBe('Read 1 of 2 files (1 failed)')
    expect(state).toBe('failed')
  })

  test('says a kind is still at work when nothing of it has finished yet', async () => {
    expect(headline([watch(TASK_STILL_RUNNING), bash('ls')], ROOTS)).toBe('Watching 1 stream, ran 1 command')
    expect(headline([shell('a', TASK_STILL_RUNNING), shell('b', 'completed')], ROOTS)).toBe('Ran 1 of 2 commands (1 still running)')
    expect(headline([shell('a', TASK_STILL_RUNNING), shell('b', 'failed')], ROOTS)).toBe("Running 1 command, couldn't run 1 command")
  })

  test('quotes free-text targets the way search patterns are quoted', async () => {
    expect(text(describeCall({ tool: 'WebSearch', input: { query: 'bun test' }, ...failed }, ROOTS).detail)).toBe('"bun test"')
    expect(text(describeCall({ tool: 'WebSearch', input: {}, ...done }, ROOTS).detail)).toBe('')
    expect(text(describeCall({ tool: 'Agent', input: { prompt: 'reply hi' }, ...done }, ROOTS).detail)).toBe('reply hi')
    const { row } = group([{ tool: 'WebSearch', input: { query: 'a' }, ...failed }, { tool: 'WebSearch', input: { query: 'b' }, ...failed }])
    expect(row.lines?.map(line)).toEqual(["Couldn't search web \"a\" · \"b\""])
  })
})

describe('round 11 tool headlines', () => {
  const todos = { tool: 'TodoWrite', input: { todos: [] }, ...failed }

  test('never says none of one: a kind with one target and no success takes the single-call phrase', async () => {
    expect(headline([{ ...bash('false'), ...failed }], ROOTS)).not.toMatch(/\b0 of\b/)
    expect(headline([{ ...bash('x'), ...failed }, read('/repo/a.ts')], ROOTS)).toBe("Read 1 file, couldn't run 1 command")
    expect(headline([{ ...bash('x'), isInterrupted: true }, read('/repo/a.ts')], ROOTS)).toBe('Read 1 file, stopped running 1 command')
    expect(headline([{ tool: 'Write', input: { file_path: '/repo/x.md' }, ...rejected }, read('/repo/a.ts')], ROOTS)).toBe('Read 1 file, not allowed to write 1 file')
  })

  test('counts a verb-only kind by repeats and never falls back to calls', async () => {
    expect(headline([todos, todos, read('/repo/a.ts')], ROOTS)).toBe("Read 1 file, couldn't update todos ×2")
    expect(headline([todos, read('/repo/a.ts')], ROOTS)).toBe("Read 1 file, couldn't update todos")
    expect(headline([{ ...todos, ...done }, todos], ROOTS)).toBe('Updated todos ×2 (1 failed)')
    expect(headline([{ ...todos, ...done }, todos], ROOTS)).not.toMatch(/calls?\b/)
  })

  test('names a monitor and a command with different nouns in one headline', async () => {
    const watch = { tool: 'Monitor', input: { description: 'a', command: 'tail a' }, ...done, output: { taskId: 'm' }, taskStatus: TASK_UNTRACKED }
    expect(headline([watch, bash('ls')], ROOTS)).toBe('Started watching 1 stream, ran 1 command')
  })

  test('puts a repeat count straight after the label when the target has no detail', async () => {
    const { row } = summariseGroup([todos, todos, read('/repo/a.ts')], ROOTS)
    const failedLine = row.lines?.find(entry => entry.state === 'failed')
    expect(text(failedLine?.detail ?? [])).toBe('×2')
    expect(row.lines?.map(line)).toContain("Couldn't update todos ×2")
    expect(row.lines?.map(line).join('\n')).not.toMatch(/ {2}/)
  })

  test('puts each partial count on its own clause and leaves asides to the branches once three kinds share it', async () => {
    const calls = [read('/repo/a.ts'), { ...read('/repo/b.ts'), ...failed }, bash('ls'), bash('pwd'), { ...bash('false'), ...failed }, { tool: 'Grep', input: { pattern: 'x' }, ...failed }]
    expect(headline(calls, ROOTS)).toBe("Read 1 of 2 files, ran 2 of 3 commands, couldn't search for 1 pattern")
  })
})

describe('round 12 tool headlines', () => {
  test('gives a denial beside a partial kind one aside, never two', async () => {
    const calls = [bash('ls'), { ...bash('false'), ...failed }, { ...read('/repo/a.ts'), ...rejected }]
    expect(headline(calls, ROOTS)).toBe('Ran 1 of 2 commands (1 failed), not allowed to read 1 file')
    expect(headline(calls, ROOTS)).not.toMatch(/\).*\(/)
  })

  test('counts an all-failed kind once, in its own words, beside a partial kind', async () => {
    const calls = [read('/repo/a.ts'), { ...read('/repo/b.ts'), ...failed }, { ...bash('false'), ...failed }, { ...bash('nope'), ...failed }]
    expect(headline(calls, ROOTS)).toBe("Read 1 of 2 files (1 failed), couldn't run 2 commands")
  })

  test('never pins a failure on a kind that went well', async () => {
    const load = { tool: 'ToolSearch', input: { query: 'select:Monitor' }, ...done, output: { matches: ['Monitor'] } }
    expect(headline([read('/repo/a.ts'), { ...read('/repo/b.ts'), ...failed }, load], ROOTS)).toBe('Read 1 of 2 files (1 failed), loaded 1 tool')
  })

  test('splits failed from denied in a kind where nothing went well', async () => {
    const calls = [{ ...bash('false'), ...failed }, { ...bash('rm x'), ...rejected }, read('/repo/a.ts')]
    expect(headline(calls, ROOTS)).toBe("Read 1 file, couldn't run 1 command, not allowed to run 1 command")
  })

  test('lists the branches in the order the headline names their kinds', async () => {
    const calls = [{ tool: 'Grep', input: { pattern: 'x' }, ...failed }, { tool: 'Grep', input: { pattern: 'y' }, ...failed }, bash('ls'), { ...bash('false'), ...failed }]
    const { row } = summariseGroup(calls, ROOTS)
    expect(row.name).toBe("Ran 1 of 2 commands (1 failed), couldn't search for 2 patterns")
    expect(row.lines?.map(entry => entry.label)).toEqual(['Ran', "Couldn't run", "Couldn't search"])
  })

  test('says what a denied call was not allowed to do, in English', async () => {
    expect(verbFor('Bash', 'rejected')).toBe('Not allowed to run')
    expect(verbFor('Read', 'rejected')).toBe('Not allowed to read')
  })
})

describe('round 13 tool rows', () => {
  test('names no directory for a search the model pointed at the session directory', async () => {
    expect(text(summarise('Glob', { pattern: 'hooks/*.zz', path: '/repo' }, ROOTS).detail)).toBe('"hooks/*.zz"')
    expect(text(summarise('Glob', { pattern: 'hooks/*.zz', path: '/repo/' }, ROOTS).detail)).toBe('"hooks/*.zz"')
    expect(text(summarise('Grep', { pattern: 'x', path: '/repo/hooks' }, ROOTS).detail)).toBe('"x" in hooks')
    expect(text(summarise('Glob', { pattern: '*.ts', path: '/elsewhere' }, ROOTS).detail)).toBe('"*.ts" in /elsewhere')
  })

  test('keeps a mixed-failure headline of four kinds to its counts so it fits the row', async () => {
    const calls = [read('/repo/a.ts'), { ...read('/repo/b.ts'), ...failed }, bash('ls'), bash('pwd'), { ...bash('exit 3'), ...failed }, { tool: 'Grep', input: { pattern: 'zz', path: '/repo/hooks' }, ...failed }, { tool: 'Glob', input: { pattern: 'hooks/*.zz', path: '/repo' }, ...failed }]
    const title = headline(calls, ROOTS)
    expect(title).toBe("Read 1 of 2 files, ran 2 of 3 commands, couldn't search for 1 pattern, couldn't list 1 pattern")
    expect(title.length).toBeLessThan(100)
  })

  test('keeps the asides while two kinds share the headline', async () => {
    const calls = [bash('ls'), { ...bash('false'), ...failed }, read('/repo/a.ts')]
    expect(headline(calls, ROOTS)).toBe('Ran 1 of 2 commands (1 failed), read 1 file')
  })
})

describe('round 14 tool search verbs', () => {
  const search = (query: string, matches: unknown) => ({ tool: 'ToolSearch', input: { query }, ...done, output: { matches, query } })

  test('names one loaded tool without a plural noun, whatever the outcome', async () => {
    expect(describeCall(search('select:Monitor', ['Monitor']), ROOTS).name).toBe('Loaded')
    expect(describeCall(search('select:TodoWrite', []), ROOTS).name).toBe("Couldn't load")
    expect(describeCall({ ...search('select:Monitor', undefined), output: undefined, isRunning: true }, ROOTS).name).toBe('Loading')
  })

  test('keeps the plural for two or more tools and for a keyword search with nothing named', async () => {
    expect(describeCall(search('select:Monitor,Read', ['Monitor', 'Read']), ROOTS).name).toBe('Loaded tools')
    expect(describeCall(search('select:A,B', []), ROOTS).name).toBe("Couldn't load tools")
    expect(describeCall({ ...search('notebook jupyter', undefined), output: undefined, isRunning: true }, ROOTS).name).toBe('Loading tools')
  })

  test('counts the tools a search loaded, not the ones its query asked for', async () => {
    expect(describeCall(search('select:Monitor,Read', ['Monitor']), ROOTS).name).toBe('Loaded')
    expect(describeCall(search('slack', ['mcp__slack__post', 'mcp__slack__read']), ROOTS).name).toBe('Loaded tools')
  })

  test('heads a branch of several one-tool searches in the plural', async () => {
    const row = summariseGroup([search('select:C', ['C']), search('select:D', ['D'])], ROOTS).row
    expect(row.lines?.[0]?.label).toBe('Loaded tools')
    expect(text(row.lines?.[0]?.detail ?? [])).toBe('C, D')
  })
})

describe('how a call ended, from what its tool answered', () => {
  const failed = (result: unknown) => ({ result, isError: true })

  test('counts a command killed mid-run as run', () => {
    expect(callEnd(failed('Error: Exit code 137\n[Request interrupted by user for tool use]'))).toBe('ran')
  })

  test('counts a fetch aborted mid-request as run', () => {
    expect(callEnd(failed('Error: canceled'))).toBe('ran')
  })

  test('counts a No at the permission dialog as declined', () => {
    expect(callEnd(failed("Error: The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing"))).toBe('declined')
    expect(callEnd(failed('User rejected tool use'))).toBe('declined')
    expect(callEnd(failed('Permission to use Bash has been denied.'))).toBe('declined')
  })

  test('leaves a call cut before it started undecided', () => {
    expect(callEnd(failed("The user doesn't want to take this action right now. STOP what you are doing"))).toBeUndefined()
    expect(callEnd(failed('Interrupted by user'))).toBeUndefined()
    expect(callEnd(failed('Cancelled: parallel tool call Bash(ls) errored'))).toBeUndefined()
  })

  test('leaves a call that answered without error undecided', () => {
    expect(callEnd({ result: 'Error: canceled' })).toBeUndefined()
    expect(callEnd({ result: { stdout: '' }, isError: false })).toBeUndefined()
  })

  test('counts an error with no text, or a structured one, as run', () => {
    expect(callEnd({ isError: true })).toBe('ran')
    expect(callEnd(failed({ stderr: 'boom' }))).toBe('ran')
  })
})
