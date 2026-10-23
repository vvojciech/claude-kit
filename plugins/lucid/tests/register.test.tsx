import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, Elements, On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { dark } from '../hooks/palette'

const STOCK = 'stock row'

const REFUSED_AT_CHECK = 'refused-at-check'

const PUT_TO_ASK = 'put-to-ask'

const VERDICT: Record<string, 'ask' | 'deny'> = { [REFUSED_AT_CHECK]: 'deny', [PUT_TO_ASK]: 'ask' }

const settled = { isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: '' } }

const listing = { tool: 'Bash', input: { command: 'ls hooks' }, ...settled }

const reading = { tool: 'Read', input: { file_path: '/repo/a.ts' }, ...settled }

function stock({ Text }: Pick<Elements['terminal'], 'Text'>) {
  return <Text>{STOCK}</Text>
}

function stockBeneath(on: On, cwd: () => string = () => '/repo', agents: () => AgentInfo[] = () => []): MockClock {
  on('ui.render', { component: 'ToolUse' }, async ($, e) => stock($.ui.resolve(e)))
  on('ui.render', { component: 'ToolGroup' }, async ($, e) => stock($.ui.resolve(e)))
  on('ui.render', { component: 'ToolResult' }, async ($, e) => stock($.ui.resolve(e)))
  on('ui.render', { component: 'UserMessage' }, async ($, e) => stock($.ui.resolve(e)))
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => stock($.ui.resolve(e)))
  on('session.cwd', async () => ({ value: cwd() }))
  on('env.get', async () => ({ value: '/Users/me' }))
  on('agent.list', async () => ({ value: agents() }))
  on('ui.render', { component: 'ToolProgress' }, async ($, e) => stock($.ui.resolve(e)))
  on('tool.check', async (_$, e) => ({ decision: VERDICT[e.tool_use_id ?? ''] ?? 'allow' }))
  on('classic.PermissionDenied', async () => ({}))
  return mock.clock(on)
}

async function permitted($: Engine, call: { tool_use_id: string; tool: string; input: unknown }) {
  await $.tool.check({ tool: call.tool, input: call.input, tool_use_id: call.tool_use_id } as never)
}

function agentInfo(status: AgentInfo['status']): AgentInfo {
  return { id: 'a1', description: 'count ts files', type: 'Explore', status }
}

const backgroundAgent = {
  tool: 'Agent',
  input: { subagent_type: 'Explore', description: 'count ts files', prompt: 'p', run_in_background: true },
  output: { status: 'async_launched', agentId: 'a1', description: 'count ts files', prompt: 'p', outputFile: '/tmp/o' },
}

async function launched($: Engine, on: On, call: { tool: string; input: Record<string, unknown>; output: unknown }) {
  on('tool.call', async () => ({ result: call.output }) as never)
  await $.tool.call({ tool: call.tool, ...call.input } as never)
}

async function progressed($: Engine, tool_use_id: string) {
  await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'ToolProgress', props: { tool_use_id, kind: 'background_hint', hint: '(ctrl+b to run in background)' } })
}

async function colourOf(ui: { findAll: (query: { type: 'Text' }) => Promise<ReadonlyArray<{ text?: string; props: Record<string, unknown> }>> }, text: string): Promise<unknown> {
  const nodes = await ui.findAll({ type: 'Text' })
  return nodes.find(node => node.text === text && node.props.color !== undefined)?.props.color
}

async function toolUse($: Engine, props: Record<string, unknown>) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'ToolUse', props: { tool_use_id: 't1', ...listing, ...props } })
}

async function toolGroup($: Engine, props: Record<string, unknown>) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'ToolGroup', props: { calls: [listing, reading], isActive: false, isExpanded: false, isCallsOnly: true, ...props } })
}

describe('ToolUse', () => {
  test('draws a compact row of its own', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, {})
    expect(await ui.find({ type: 'Text', text: 'Ran' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
  })

  test('passes to stock when expanded so ctrl+o shows the output', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, { isExpanded: true, output: { stdout: 'a.ts' } })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeDefined()
  })

  test('says a failed call failed', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, { input: { command: 'cat x' }, isErrored: true, output: 'Error: Exit code 1\ncat: x: No such file' })
    expect(await ui.find({ type: 'Text', text: "Couldn't run" })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeDefined()
  })

  test('marks a refused write as refused and leaves the words to its result row', async ($, on) => {
    const clock = stockBeneath(on)
    const write = { tool_use_id: REFUSED_AT_CHECK, tool: 'Write', input: { file_path: '/repo/out/deny.md' } }
    await permitted($, write)
    await clock.settle()
    const ui = await toolUse($, { ...write, isErrored: true, isInterrupted: true, output: 'User rejected tool use' })
    expect(await ui.find({ type: 'Text', text: 'Not allowed to write' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⊘' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Wrote' })).toBeUndefined()
  })

  test('draws a call waiting at the permission dialog as wanted, never as done', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, { tool: 'Write', input: { file_path: '/repo/out/x.md' }, output: undefined })
    expect(await ui.find({ type: 'Text', text: 'Wants to write' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Wrote' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '◌' })).toBeDefined()
  })

  test('passes a running call to stock so its elapsed time and progress stay', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, { isRunning: true, output: undefined })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeDefined()
  })

  test('draws a background agent as running while its loop runs, then as done', async ($, on) => {
    let status: AgentInfo['status'] = 'running'
    stockBeneath(on, () => '/repo', () => [agentInfo(status)])
    const running = await toolUse($, backgroundAgent)
    expect(await running.find({ type: 'Text', text: 'Delegating to Explore' })).toBeDefined()
    expect(await running.find({ type: 'Text', text: /background/ })).toBeDefined()
    status = 'completed'
    const finished = await toolUse($, { tool_use_id: 't2', ...backgroundAgent })
    expect(await finished.find({ type: 'Text', text: 'Delegated to Explore' })).toBeDefined()
    expect(await finished.find({ type: 'Text', text: /background/ })).toBeUndefined()
  })

  test('redraws a background agent row when its loop finishes', async ($, on) => {
    let status: AgentInfo['status'] = 'running'
    stockBeneath(on, () => '/repo', () => [agentInfo(status)])
    on('turn.complete', async () => ({ text: 'done' }))
    const ui = await toolUse($, backgroundAgent)
    expect(await ui.find({ type: 'Text', text: 'Delegating to Explore' })).toBeDefined()
    status = 'completed'
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'x', agentId: 'a1', reason: 'answer' })
    expect(await ui.find({ type: 'Text', text: 'Delegated to Explore' })).toBeDefined()
  })

  test('draws a background agent the engine has dropped with no known end as started, not finished', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, backgroundAgent)
    expect(await ui.find({ type: 'Text', text: 'Started delegating to Explore' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Delegated to Explore' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '◐' })).toBeUndefined()
  })

  test('draws a background agent the engine dropped after it ended as done', async ($, on) => {
    const clock = stockBeneath(on)
    await taskNotification($, 'a1', 'completed')
    await clock.settle()
    const ui = await toolUse($, backgroundAgent)
    expect(await ui.find({ type: 'Text', text: 'Delegated to Explore' })).toBeDefined()
  })

  test('draws plain detail words in the palette text colour, never the terminal default', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, { tool: 'Grep', input: { pattern: 'x', path: '/repo/hooks' } })
    const words = (await ui.findAll({ type: 'Text' })).find(node => node.text === ' in ')
    expect(words?.props.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test('links the path to the file and keeps it unabbreviated outside the project', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, { tool: 'Read', input: { file_path: '/Users/someone/notes.md' } })
    const link = await ui.find({ type: 'Link' })
    expect(link?.props.href).toBe('file:///Users/someone/notes.md')
    expect(await ui.find({ type: 'Text', text: '/Users/someone/notes.md' })).toBeDefined()
  })

  test('cuts a long path in the middle so the file name stays', async ($, on) => {
    stockBeneath(on)
    const path = `/repo/${'very-long-directory/'.repeat(6)}target.ts`
    const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'ToolUse', viewport: { columns: 50, rows: 20 }, props: { tool_use_id: 't1', ...listing, tool: 'Read', input: { file_path: path } } })
    expect(await ui.find({ type: 'Text', text: /….*target\.ts$/ })).toBeDefined()
  })

  test('draws paths relative to the session directory as it is now', async ($, on) => {
    let cwd = '/repo'
    stockBeneath(on, () => cwd)
    const first = await toolUse($, { tool: 'Read', input: { file_path: '/repo/sub/a.ts' } })
    expect(await first.find({ type: 'Text', text: 'sub/a.ts' })).toBeDefined()
    cwd = '/repo/sub'
    const second = await toolUse($, { tool_use_id: 't2', tool: 'Read', input: { file_path: '/repo/sub/a.ts' } })
    expect(await second.find({ type: 'Text', text: 'a.ts' })).toBeDefined()
  })
})

describe('ToolGroup', () => {
  test('draws a settled group under a headline that says what ran, as the stock line does', async ($, on) => {
    stockBeneath(on)
    const ui = await toolGroup($, {})
    expect(await ui.find({ type: 'Text', text: 'Ran 1 command, read 1 file' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ls hooks' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
  })

  test('heads a group with a failed call with its own headline, never the stock one', async ($, on) => {
    stockBeneath(on)
    const failing = { ...reading, isErrored: true, output: 'File does not exist.' }
    const ui = await toolGroup($, { calls: [listing, failing], isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "Ran 1 command, couldn't read 1 file" })).toBeDefined()
  })

  test('marks an interrupted group as interrupted, not failed', async ($, on) => {
    stockBeneath(on)
    const cut = { ...listing, isErrored: true, isInterrupted: true, output: 'Interrupted by user' }
    const ui = await toolGroup($, { calls: [reading, cut], isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Read 1 file, stopped running 1 command' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⊘' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeUndefined()
  })

  test('names the call that failed under its own headline, in the failure colour', async ($, on) => {
    stockBeneath(on)
    const failing = { ...listing, input: { command: 'false' }, isErrored: true, output: 'Exit code 1' }
    const ui = await toolGroup($, { isCallsOnly: false, calls: [failing, reading] })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: "Read 1 file, couldn't run 1 command" })).toBeDefined()
    expect(await colourOf(ui, "Couldn't run")).toBe(dark.error)
    expect(await ui.find({ type: 'Text', text: /false/ })).toBeDefined()
  })

  test('keeps a failed headline in strong ink and the failure colour for its glyph and failed branch only', async ($, on) => {
    stockBeneath(on)
    const failing = { ...listing, input: { command: 'false' }, isErrored: true, output: 'Exit code 1' }
    const ui = await toolGroup($, { isCallsOnly: false, calls: [failing, reading] })
    expect(await colourOf(ui, "Read 1 file, couldn't run 1 command")).toBe(dark.strong)
    expect(await colourOf(ui, '✗')).toBe(dark.error)
    expect(await colourOf(ui, "Couldn't run")).toBe(dark.error)
  })

  test('draws a group of background work this process never saw end as started, never done', async ($, on) => {
    stockBeneath(on)
    const ui = await toolGroup($, { calls: [backgroundShell('u1'), reading] })
    expect(await ui.find({ type: 'Text', text: '○' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '●' })).toBeUndefined()
    expect(await colourOf(ui, '○')).toBe(dark.muted)
  })

  test('adds no mark to a stock group whose calls all went well', async ($, on) => {
    stockBeneath(on)
    const ui = await toolGroup($, { isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '⊘' })).toBeUndefined()
  })

  test('draws a one-call group of a backgrounded shell as running', async ($, on) => {
    stockBeneath(on)
    const shell = { ...listing, input: { command: 'sleep 25', run_in_background: true }, output: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'g1' } }
    await launched($, on, shell)
    const ui = await toolGroup($, { calls: [shell] })
    expect(await ui.find({ type: 'Text', text: 'Running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /background/ })).toBeDefined()
  })

  test('passes to stock when the group holds more than calls', async ($, on) => {
    stockBeneath(on)
    expect(await (await toolGroup($, { isCallsOnly: false })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolGroup($, { isCallsOnly: undefined })).find({ type: 'Text', text: STOCK })).toBeDefined()
  })

  test('passes to stock while live so the task summary and elapsed time stay', async ($, on) => {
    stockBeneath(on)
    expect(await (await toolGroup($, { isActive: true })).find({ type: 'Text', text: STOCK })).toBeDefined()
  })

  test('passes to stock when expanded', async ($, on) => {
    stockBeneath(on)
    expect(await (await toolGroup($, { isExpanded: true })).find({ type: 'Text', text: STOCK })).toBeDefined()
  })
})

function taskNotification($: Engine, id: string, status: string) {
  return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'UserMessage', props: { text: 'Background command finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { id, status } } } as never)
}

function backgroundShell(id: string) {
  return { tool: 'Bash', input: { command: 'sleep 25 && echo slept', run_in_background: true }, output: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id } }
}

describe('background tasks', () => {
  test('draws a backgrounded shell as running until its notification says it ended', async ($, on) => {
    const clock = stockBeneath(on)
    await launched($, on, backgroundShell('s1'))
    const ui = await toolUse($, backgroundShell('s1'))
    expect(await ui.find({ type: 'Text', text: 'Running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /background/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Ran' })).toBeUndefined()
    await taskNotification($, 's1', 'completed')
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: 'Ran' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /background/ })).toBeUndefined()
  })

  test('draws a backgrounded shell that failed as failed', async ($, on) => {
    const clock = stockBeneath(on)
    await taskNotification($, 's2', 'failed')
    await clock.settle()
    const ui = await toolUse($, backgroundShell('s2'))
    expect(await ui.find({ type: 'Text', text: "Couldn't run" })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗' })).toBeDefined()
  })

  test('draws a shell a stop call ended as stopped', async ($, on) => {
    const clock = stockBeneath(on)
    const ui = await toolUse($, backgroundShell('s3'))
    await toolUse($, { tool_use_id: 't9', tool: 'TaskStop', input: { task_id: 's3' }, output: { message: 'stopped', task_id: 's3', task_type: 'local_bash' } })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: 'Stopped running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⊘' })).toBeDefined()
  })

  test('never draws a background shell this process did not launch as running', async ($, on) => {
    stockBeneath(on)
    const ui = await toolUse($, backgroundShell('s5'))
    expect(await ui.find({ type: 'Text', text: 'Running' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '◐' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Started running' })).toBeDefined()
  })

  test('draws a monitor as watching while its task runs', async ($, on) => {
    stockBeneath(on)
    const monitor = { tool: 'Monitor', input: { description: 'tail the log', timeout_ms: 1000, command: 'tail -f x' }, output: { taskId: 'm1', timeoutMs: 1000 } }
    await launched($, on, monitor)
    const ui = await toolUse($, monitor)
    expect(await ui.find({ type: 'Text', text: 'Watching' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /background/ })).toBeDefined()
  })

  test('ignores a notification that names no task', async ($, on) => {
    stockBeneath(on)
    await launched($, on, backgroundShell('s4'))
    await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'UserMessage', props: { text: 'x', origin: { kind: 'task-notification' }, isExpanded: false } } as never)
    expect(await (await toolUse($, backgroundShell('s4'))).find({ type: 'Text', text: 'Running' })).toBeDefined()
  })
})

describe('stopped calls', () => {
  const cut = { isRunning: false, isErrored: true, isInterrupted: true, output: 'User rejected tool use' }

  test('calls a call stopped with Esc after its progress showed it running stopped, never denied', async ($, on) => {
    const clock = stockBeneath(on)
    await permitted($, { tool_use_id: 'esc1', ...listing })
    await progressed($, 'esc1')
    await clock.settle()
    const ui = await toolUse($, { tool_use_id: 'esc1', input: { command: 'find / -name x' }, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Stopped running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not allowed/ })).toBeUndefined()
  })

  test('keeps what it saw run in session state, which outlives a reload of its code', async ($, on) => {
    const clock = stockBeneath(on)
    const written: unknown[] = []
    on('state.set', { plugin: 'lucid', key: 'ranCalls' }, async (_$, e, next) => {
      written.push({ id: e.id, value: e.value })
      return next(e)
    })
    await permitted($, { tool_use_id: 'esc3', ...listing })
    await progressed($, 'esc3')
    await clock.settle()
    expect(written).toEqual([{ id: 'esc3', value: true }])
  })

  test('calls a stopped call stopped after a reload, from session state alone', async ($, on) => {
    stockBeneath(on)
    on('state.get', { plugin: 'lucid', key: 'ranCalls' }, async (_$, e) => ({ value: { value: e.id === 'esc4' ? true : undefined, version: 1 } }))
    const ui = await toolUse($, { tool_use_id: 'esc4', input: { command: 'find / -name x' }, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Stopped running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not allowed/ })).toBeUndefined()
  })

  test('draws a background shell launched before a reload as running, from session state alone', async ($, on) => {
    stockBeneath(on)
    on('state.get', { plugin: 'lucid', key: 'launchedTasks' }, async (_$, e) => ({ value: { value: e.id === 'r1' ? true : undefined, version: 1 } }))
    const ui = await toolUse($, backgroundShell('r1'))
    expect(await ui.find({ type: 'Text', text: 'Running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Started running' })).toBeUndefined()
  })

  test('keeps a call the auto-mode classifier refused denied', async ($, on) => {
    const clock = stockBeneath(on)
    await $.classic.PermissionDenied({ tool_name: 'Write', tool_input: { file_path: '/repo/x.md' }, tool_use_id: 'deny1', reason: 'classifier' })
    await clock.settle()
    const ui = await toolUse($, { tool_use_id: 'deny1', tool: 'Write', input: { file_path: '/repo/x.md' }, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Not allowed to write' })).toBeDefined()
  })

  test('heads a group whose running call was stopped as stopped', async ($, on) => {
    const clock = stockBeneath(on)
    const finding = { tool_use_id: 'esc2', tool: 'Bash', input: { command: 'find /' } }
    await permitted($, finding)
    await toolGroup($, { calls: [{ ...listing, tool_use_id: 'ok2' }, { ...finding, isRunning: true, isErrored: false, isInterrupted: false }], isActive: true })
    await progressed($, 'esc2')
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...listing, tool_use_id: 'ok2' }, { ...finding, ...cut }], isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: 'Ran 1 of 2 commands (1 stopped)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /denied/ })).toBeUndefined()
  })
})

describe('calls that never got past permission', () => {
  const cut = { isRunning: false, isErrored: true, isInterrupted: true, output: 'User rejected tool use' }
  const quick = { tool_use_id: 'q1', tool: 'Bash', input: { command: 'echo quick' } }

  test('calls a queued sibling cut before it was checked cancelled, though its row showed running', async ($, on) => {
    const clock = stockBeneath(on)
    await toolUse($, { ...quick, isRunning: true, output: undefined })
    await clock.settle()
    const ui = await toolUse($, { ...quick, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Cancelled running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not allowed/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Stopped/ })).toBeUndefined()
  })

  test('calls an allowed sibling queued behind a dialog cancelled, never stopped nor denied, though its row showed running', async ($, on) => {
    const clock = stockBeneath(on)
    await permitted($, quick)
    await toolUse($, { ...quick, isRunning: true, output: undefined })
    await clock.settle()
    const ui = await toolUse($, { ...quick, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Cancelled running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not allowed/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Stopped/ })).toBeUndefined()
  })

  test('heads a group whose allowed sibling was still queued at Esc as cancelled, not a stop', async ($, on) => {
    const clock = stockBeneath(on)
    await permitted($, quick)
    await toolGroup($, { calls: [{ ...quick, isRunning: true, isErrored: false, isInterrupted: false }, { ...listing, tool_use_id: 'ok4' }], isActive: true })
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...quick, ...cut }, { ...listing, tool_use_id: 'ok4' }], isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: 'Ran 1 of 2 commands (1 cancelled)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /stopped/i })).toBeUndefined()
  })

  test('mutes a denied branch the way it mutes a denied row', async ($, on) => {
    const clock = stockBeneath(on)
    const refused = { ...quick, tool_use_id: REFUSED_AT_CHECK, input: { command: 'find /' } }
    await permitted($, refused)
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...refused, ...cut }, { ...listing, tool_use_id: 'ok5' }], isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: 'Ran 1 of 2 commands (1 denied)' })).toBeDefined()
    const nodes = await ui.findAll({ type: 'Text' })
    const command = nodes.find(node => node.text === 'find ' && node.props.color !== undefined)
    expect(command?.props.color).toBe(dark.muted)
    expect(command?.props.bold).not.toBe(true)
  })

  test('calls a call put to a dialog and cut before its tool answered cancelled', async ($, on) => {
    const clock = stockBeneath(on)
    const asked = { ...quick, tool_use_id: PUT_TO_ASK }
    await permitted($, asked)
    await toolUse($, { ...asked, isRunning: true, output: undefined })
    await clock.settle()
    const ui = await toolUse($, { ...asked, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Cancelled running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Not allowed/ })).toBeUndefined()
  })

  test('calls a call denied by the permission check not allowed', async ($, on) => {
    const clock = stockBeneath(on)
    const refused = { ...quick, tool_use_id: REFUSED_AT_CHECK }
    await permitted($, refused)
    await toolUse($, { ...refused, isRunning: true, output: undefined })
    await clock.settle()
    expect(await (await toolUse($, { ...refused, ...cut })).find({ type: 'Text', text: 'Not allowed to run' })).toBeDefined()
  })

  test('calls a dialog-approved command stopped once its run-in-background hint was drawn', async ($, on) => {
    const clock = stockBeneath(on)
    const asked = { ...quick, tool_use_id: PUT_TO_ASK }
    await permitted($, asked)
    await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'ToolProgress', props: { tool_use_id: PUT_TO_ASK, kind: 'background_hint', hint: '(ctrl+b to run in background)' } })
    await clock.settle()
    expect(await (await toolUse($, { ...asked, ...cut })).find({ type: 'Text', text: 'Stopped running' })).toBeDefined()
  })

  test('labels a group whose queued sibling was cut as cancelled, not a stop', async ($, on) => {
    const clock = stockBeneath(on)
    await toolGroup($, { calls: [{ ...quick, isRunning: true, isErrored: false, isInterrupted: false }, { ...listing, tool_use_id: 'ok3' }], isActive: true })
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...quick, ...cut }, { ...listing, tool_use_id: 'ok3' }], isCallsOnly: false })
    expect(await ui.find({ type: 'Text', text: 'Ran 1 of 2 commands (1 cancelled)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /stopped/i })).toBeUndefined()
  })
})

describe('permission verdicts', () => {
  test('passes every verdict through unchanged while it watches which calls were cleared to run', async ($, on) => {
    stockBeneath(on)
    for (const [id, decision] of [['v-allow', 'allow'], [PUT_TO_ASK, 'ask'], [REFUSED_AT_CHECK, 'deny']] as const) {
      const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: id } as never)
      expect(verdict.decision).toBe(decision)
    }
  })

  test('calls an allowed call it never saw start cancelled, never denied', async ($, on) => {
    const clock = stockBeneath(on)
    await permitted($, { tool_use_id: 'never-started', ...listing })
    await clock.settle()
    const ui = await toolUse($, { tool_use_id: 'never-started', input: { command: 'ls hooks' }, isRunning: false, isErrored: true, isInterrupted: true, output: 'User rejected tool use' })
    expect(await ui.find({ type: 'Text', text: 'Cancelled running' })).toBeDefined()
  })

  test('keeps a deny verdict in session state, so the row reads denied after a reload', async ($, on) => {
    const clock = stockBeneath(on)
    const written: unknown[] = []
    on('state.set', { plugin: 'lucid', key: 'refusedCalls' }, async (_$, e, next) => {
      written.push(e.id)
      return next(e)
    })
    await permitted($, { tool_use_id: REFUSED_AT_CHECK, ...listing })
    await permitted($, { tool_use_id: PUT_TO_ASK, ...listing })
    await clock.settle()
    expect(written).toEqual([REFUSED_AT_CHECK])
  })
})

describe('calls approved through ask and stopped mid-run', () => {
  const cut = { isRunning: false, isErrored: true, isInterrupted: true, output: 'User rejected tool use' }
  const fetching = { tool_use_id: PUT_TO_ASK, tool: 'WebFetch', input: { url: 'https://httpbin.org/delay/40', prompt: 'p' } }
  const finding = { tool_use_id: 'beside-ask', tool: 'Bash', input: { command: 'find / -name x' } }

  test('never calls an ask call or its allowed sibling not allowed when both are cut with no pill', async ($, on) => {
    const clock = stockBeneath(on)
    await permitted($, fetching)
    await permitted($, finding)
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...fetching, ...cut }, { ...finding, ...cut }], isCallsOnly: true })
    expect(await ui.find({ type: 'Text', text: /denied|not allowed|Not allowed/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /[Cc]ancelled/ })).toBeDefined()
  })

  test('never calls an ask-approved fetch not allowed, even when no interrupt reached it', async ($, on) => {
    const clock = stockBeneath(on)
    await permitted($, fetching)
    await clock.settle()
    const ui = await toolUse($, { ...fetching, ...cut })
    expect(await ui.find({ type: 'Text', text: /Not allowed/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Cancelled / })).toBeDefined()
  })

  test('calls an ask-approved fetch stopped after a reload once its run was seen, from session state alone', async ($, on) => {
    stockBeneath(on)
    on('state.get', { plugin: 'lucid', key: 'ranCalls' }, async (_$, e) => ({ value: { value: e.id === PUT_TO_ASK ? true : undefined, version: 1 } }))
    expect(await (await toolUse($, { ...fetching, ...cut })).find({ type: 'Text', text: 'Stopped fetching' })).toBeDefined()
  })
})

describe('calls put to a dialog, told apart by what their tool answered', () => {
  const cut = { isRunning: false, isErrored: true, isInterrupted: true, output: 'User rejected tool use' }
  const killed = 'Error: Exit code 137\n[Request interrupted by user for tool use]'
  const declined = "Error: The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing"
  const first = { tool_use_id: PUT_TO_ASK, tool: 'Bash', input: { command: 'find / -name a' } }
  const second = { tool_use_id: 'asked-too', tool: 'Bash', input: { command: 'find / -name b' } }
  const fetching = { tool_use_id: PUT_TO_ASK, tool: 'WebFetch', input: { url: 'https://httpbin.org/delay/25', prompt: 'p' } }

  function approvedAtDialog(on: On) {
    on('classic.PermissionRequest', async () => ({ decision: { behavior: 'allow' } }) as never)
  }

  function answering(on: On, results: Record<string, string>) {
    approvedAtDialog(on)
    on('tool.call', async (_$, e) => ({ result: results[e.tool_use_id], isError: true }) as never)
  }

  async function called($: Engine, call: { tool_use_id: string; tool: string; input: Record<string, unknown> }) {
    await $.tool.call({ tool: call.tool, tool_use_id: call.tool_use_id, ...call.input } as never)
  }

  test('calls an approved command killed mid-run stopped, with no pill drawn', async ($, on) => {
    const clock = stockBeneath(on)
    answering(on, { [PUT_TO_ASK]: killed })
    await called($, first)
    await clock.settle()
    expect(await (await toolUse($, { ...first, ...cut })).find({ type: 'Text', text: 'Stopped running' })).toBeDefined()
  })

  test('counts both of an approved parallel pair stopped though they shared no pill', async ($, on) => {
    const clock = stockBeneath(on)
    answering(on, { [PUT_TO_ASK]: killed, 'asked-too': killed })
    await Promise.all([called($, first), called($, second)])
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...first, ...cut }, { ...second, ...cut }], isCallsOnly: true })
    expect(await ui.find({ type: 'Text', text: 'Stopped running 2 commands' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[Cc]ancelled/ })).toBeUndefined()
  })

  test('calls an approved fetch aborted mid-request stopped', async ($, on) => {
    const clock = stockBeneath(on)
    answering(on, { [PUT_TO_ASK]: 'Error: canceled' })
    await called($, fetching)
    await clock.settle()
    expect(await (await toolUse($, { ...fetching, ...cut })).find({ type: 'Text', text: 'Stopped fetching' })).toBeDefined()
  })

  test('calls a No at the dialog not allowed, never cancelled nor stopped', async ($, on) => {
    const clock = stockBeneath(on)
    answering(on, { [PUT_TO_ASK]: declined })
    await called($, first)
    await clock.settle()
    const ui = await toolUse($, { ...first, ...cut })
    expect(await ui.find({ type: 'Text', text: 'Not allowed to run' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Cancelled|Stopped/ })).toBeUndefined()
  })

  test('heads a pair with one approved and stopped and one declined as both, not cancelled', async ($, on) => {
    const clock = stockBeneath(on)
    answering(on, { [PUT_TO_ASK]: killed, 'asked-too': declined })
    await Promise.all([called($, first), called($, second)])
    await clock.settle()
    const ui = await toolGroup($, { calls: [{ ...first, ...cut }, { ...second, ...cut }], isCallsOnly: true })
    expect(await ui.find({ type: 'Text', text: /[Cc]ancelled/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /[Ss]topped/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /denied|[Nn]ot allowed/ })).toBeDefined()
  })

  test('keeps a call cut before it started cancelled, though its tool answered', async ($, on) => {
    const clock = stockBeneath(on)
    answering(on, { [PUT_TO_ASK]: "The user doesn't want to take this action right now. STOP what you are doing" })
    await called($, first)
    await clock.settle()
    expect(await (await toolUse($, { ...first, ...cut })).find({ type: 'Text', text: 'Cancelled running' })).toBeDefined()
  })

  test('writes nothing to session state for a call that answered without error', async ($, on) => {
    const clock = stockBeneath(on)
    const written: unknown[] = []
    on('state.set', { plugin: 'lucid' }, async (_$, e, next) => {
      written.push(e.key)
      return next(e)
    })
    approvedAtDialog(on)
    on('tool.call', async () => ({ result: { stdout: 'ok' } }) as never)
    await called($, first)
    await clock.settle()
    expect(written).toEqual([])
  })
})

describe('bookkeeping across a reload of its code', () => {
  const unloaded = "the plugin's environment is unloaded"
  const killed = 'Error: Exit code 137\n[Request interrupted by user for tool use]'
  const cut = { isRunning: false, isErrored: true, isInterrupted: true, output: 'User rejected tool use' }

  function stateGoneWhile(on: On, gone: () => boolean, key: 'ranCalls' | 'launchedTasks') {
    on('state.get', { plugin: 'lucid', key }, async (_$, e, next) => (gone() ? ({ deny: unloaded } as never) : next(e)))
    on('state.set', { plugin: 'lucid', key }, async (_$, e, next) => (gone() ? ({ deny: unloaded } as never) : next(e)))
  }

  test('hands back a stopped call\'s answer unchanged when session state is gone', async ($, on) => {
    const clock = stockBeneath(on)
    on('tool.call', async () => ({ result: killed, isError: true }) as never)
    stateGoneWhile(on, () => true, 'ranCalls')
    const answer = await $.tool.call({ tool: 'Bash', tool_use_id: 'reloaded', command: 'sleep 30' } as never)
    await clock.settle()
    expect(answer).toEqual({ result: killed, isError: true } as never)
  })

  test('hands back a background launch\'s answer unchanged when session state is gone', async ($, on) => {
    const clock = stockBeneath(on)
    const shell = backgroundShell('gone1')
    on('tool.call', async () => ({ result: shell.output }) as never)
    stateGoneWhile(on, () => true, 'launchedTasks')
    const answer = await $.tool.call({ tool: shell.tool, tool_use_id: 'reloaded-bg', ...shell.input } as never)
    await clock.settle()
    expect(answer).toEqual({ result: shell.output } as never)
  })

  test('still keeps a denial when the run marks of its batch fail mid-reload', async ($, on) => {
    const clock = stockBeneath(on)
    let gone = true
    let release = () => {}
    let siblingRunning = () => {}
    const held = new Promise<void>(resolve => (release = resolve))
    const started = new Promise<void>(resolve => (siblingRunning = resolve))
    on('tool.call', async () => {
      siblingRunning()
      await held
      return { result: "The user doesn't want to take this action right now. STOP what you are doing", isError: true } as never
    })
    stateGoneWhile(on, () => gone, 'ranCalls')
    const allowed = { tool_use_id: 'allowed-sibling', tool: 'Bash', input: { command: 'ls' } }
    const denied = { tool_use_id: REFUSED_AT_CHECK, tool: 'Bash', input: { command: 'rm -rf out' } }
    const sibling = $.tool.call({ tool: allowed.tool, tool_use_id: allowed.tool_use_id, ...allowed.input } as never)
    await started
    expect(await $.tool.call({ tool: denied.tool, tool_use_id: denied.tool_use_id, ...denied.input } as never)).toMatchObject({ isError: true } as never)
    gone = false
    release()
    await sibling
    await clock.settle()
    expect(await (await toolUse($, { ...denied, ...cut })).find({ type: 'Text', text: 'Not allowed to run' })).toBeDefined()
  })
})

describe('task notifications', () => {
  function notification($: Engine, props: Record<string, unknown>) {
    return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'UserMessage', props: { origin: { kind: 'task-notification' }, isExpanded: false, ...props } } as never)
  }

  test('draws a finished task as a lucid row with its glyph and how long it ran', async ($, on) => {
    stockBeneath(on)
    const ui = await notification($, { text: 'Agent "say hi" finished', task: { id: 'n1', status: 'completed', durationMs: 3000 } })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Agent "say hi" finished' })).toBeDefined()
    expect(await colourOf(ui, '●')).toBe(dark.done)
    expect(await ui.find({ type: 'Text', text: /3s/ })).toBeDefined()
  })

  test('marks a failed task as failed', async ($, on) => {
    stockBeneath(on)
    expect(await colourOf(await notification($, { text: 'Background command "x" failed with exit code 2', task: { id: 'n2', status: 'failed' } }), '✗')).toBe(dark.error)
  })

  test('leaves a monitor event to stock, whose row carries the event the summary lacks', async ($, on) => {
    stockBeneath(on)
    const ui = await notification($, { text: 'Monitor event: "ticks from a loop"', task: { id: 'n3' } })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '○' })).toBeUndefined()
  })

  test('draws an agent still waiting on its own background work as started, and records no end for it', async ($, on) => {
    const clock = stockBeneath(on)
    const written: unknown[] = []
    on('state.set', { plugin: 'lucid', key: 'endedTasks' }, async (_$, e, next) => {
      written.push(e.id)
      return next(e)
    })
    const ui = await notification($, { text: 'Agent "Run sleep and echo" is waiting on its own background work', task: { id: 'n6', status: 'completed', durationMs: 19000 } })
    await clock.settle()
    expect(await colourOf(ui, '●')).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '○' })).toBeDefined()
    expect(written).toEqual([])
  })

  test('passes to stock when expanded, when the text is empty, and when no task is named', async ($, on) => {
    stockBeneath(on)
    expect(await (await notification($, { text: 'x', isExpanded: true, task: { id: 'n4', status: 'completed' } })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await notification($, { text: ' ', task: { id: 'n5', status: 'completed' } })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await notification($, { text: 'x' })).find({ type: 'Text', text: STOCK })).toBeDefined()
  })
})

describe('ToolResult', () => {
  const created = { type: 'create', filePath: '/repo/out/a.md', content: 'alpha\nbeta\n', structuredPatch: [], originalFile: null }

  async function toolResult($: Engine, props: Record<string, unknown>) {
    return $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 't1', tool: 'Write', output: created, isErrored: false, ...props } })
  }

  test('says how much a new file holds without repeating the verb and path above it', async ($, on) => {
    stockBeneath(on)
    const ui = await toolResult($, {})
    expect(await ui.find({ type: 'Text', text: /2 lines/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Wrote/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'beta' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
  })

  test('says how many lines of a long new file it leaves out', async ($, on) => {
    stockBeneath(on)
    const content = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n')
    const ui = await toolResult($, { output: { ...created, content } })
    expect(await ui.find({ type: 'Text', text: /14 lines/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+4 lines/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'line 11' })).toBeUndefined()
  })

  test('draws an empty new file as empty', async ($, on) => {
    stockBeneath(on)
    expect(await (await toolResult($, { output: { ...created, content: '' } })).find({ type: 'Text', text: /0 lines/ })).toBeDefined()
  })

  test('draws an errored result as its reason in the palette error colour, the rest muted', async ($, on) => {
    stockBeneath(on)
    const ui = await toolResult($, { tool: 'Edit', isErrored: true, output: '<tool_use_error>String to replace not found in file.\nString: NOT_THERE</tool_use_error>' })
    expect(await ui.find({ type: 'Text', text: STOCK })).toBeUndefined()
    expect(await colourOf(ui, 'String to replace not found in file.')).toBe(dark.error)
    expect(await colourOf(ui, 'String: NOT_THERE')).toBe(dark.muted)
  })

  test('keeps a long error to a preview and counts the rest', async ($, on) => {
    stockBeneath(on)
    const output = ['Exit code 1', ...Array.from({ length: 14 }, (_, i) => `line ${i}`)].join('\n')
    const ui = await toolResult($, { tool: 'Bash', isErrored: true, output })
    expect(await ui.find({ type: 'Text', text: /\+5 lines/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'line 13' })).toBeUndefined()
  })

  test('passes every other result to stock', async ($, on) => {
    stockBeneath(on)
    expect(await (await toolResult($, { output: { ...created, type: 'update' } })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolResult($, { isErrored: true, output: 'User rejected write to out/a.md' })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolResult($, { isErrored: true, output: 'Interrupted by user' })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolResult($, { isErrored: true, output: { stdout: '' } })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolResult($, { isErrored: true, isExpanded: true, output: 'Exit code 1' })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolResult($, { isExpanded: true })).find({ type: 'Text', text: STOCK })).toBeDefined()
    expect(await (await toolResult($, { tool: 'Bash', output: { stdout: 'x', stderr: '', interrupted: false } })).find({ type: 'Text', text: STOCK })).toBeDefined()
  })
})

describe('AssistantMessage', () => {
  test('keeps the summary mark on a summarised block', async ($, on) => {
    stockBeneath(on)
    const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Did things', isFirstOfReply: true, isSummary: true } })
    expect(await ui.find({ type: 'Text', text: /summary/ })).toBeDefined()
  })

  test('adds no mark to verbatim text', async ($, on) => {
    stockBeneath(on)
    const ui = await $.ui.mount({ plugin: 'lucid', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Did things', isFirstOfReply: true } })
    expect(await ui.find({ type: 'Text', text: /summary/ })).toBeUndefined()
  })
})
