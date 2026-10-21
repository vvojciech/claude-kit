import { inlineSpans, shellSpans, spansWidth } from './markdown'
import type { Span } from './markdown'
import { cellWidth, firstLine, sliceCells } from './width'

export type ToolState = 'pending' | 'running' | 'started' | 'done' | 'failed' | 'rejected' | 'interrupted'

export type ToolLine = { label: string; detail: Span[]; note?: string; state?: ToolState }

export type ToolRow = { name: string; detail: Span[]; note?: string; lines?: ToolLine[] }

export type ToolCall = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean; output?: unknown }

export type TrackedCall = ToolCall & { taskStatus?: string }

export type Roots = { cwd: string; home?: string }

type Outcome = Pick<ToolCall, 'isRunning' | 'isErrored' | 'isInterrupted' | 'output'> & { tool?: string }

type Verb = { done: string; running: string; base: string; gerund: string }

type Tally = { verb: string; noun: string; count: (calls: ReadonlyArray<ToolCall>, roots: Roots) => number; started?: string }

type Detail = (input: Record<string, unknown>, roots: Roots, output?: unknown) => Span[]

const MAX_DETAIL = 160

const MAX_ARG = 40

const MAX_ARGS = 2

const MAX_TOOL_NAMES = 60

const ELLIPSIS = '…'

const SEPARATOR = ' · '

const NAME_SEPARATOR = ', '

const ERROR_TAG = /<\/?tool_use_error>/g

const ERROR_PREFIX = /^Error:\s*/

const REJECTION = /^(Error: )?(User rejected\b|Permission\b.*\b(was|has been) denied\b)/

const INTERRUPTION = /^(Error: )?Interrupted\b/

const TASK_AT_WORK = new Set(['pending', 'running', 'waiting'])

const TASK_END: Record<string, ToolState> = { failed: 'failed', killed: 'interrupted' }

export const TASK_STILL_RUNNING = 'running'

export const TASK_UNTRACKED = 'untracked'

const BACKGROUND_NOTE = 'background'

const DEFAULT_AGENT = 'general-purpose'

const DEFAULT_GREP_MODE = 'files_with_matches'

const TEXT_KEYS = ['subject', 'description', 'query', 'skill', 'prompt']

const SCALARS = new Set(['string', 'number', 'boolean'])

const UNSUCCESSFUL: ReadonlyArray<ToolState> = ['failed', 'rejected', 'interrupted']

const UNSUCCESSFUL_WORD: Partial<Record<ToolState, string>> = { failed: 'failed', rejected: 'denied', interrupted: 'stopped' }

const LSP_TARGET: Record<string, string> = {
  goToDefinition: 'definition',
  findReferences: 'references',
  hover: 'hover info',
  documentSymbol: 'symbols',
  workspaceSymbol: 'workspace symbols',
  goToImplementation: 'implementation',
  prepareCallHierarchy: 'call hierarchy',
  incomingCalls: 'incoming calls',
  outgoingCalls: 'outgoing calls',
}

function pluralWord(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies'
  return /(s|sh|ch|x)$/.test(word) ? word + 'es' : word + 's'
}

export function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : pluralWord(word)}`
}

function isUnder(path: string, root: string): boolean {
  return root !== '' && (path === root || path.startsWith(root + '/'))
}

function trimSlash(path: string | undefined): string {
  return (path ?? '').replace(/\/+$/, '')
}

export function relativePath(path: string, roots: Roots): string {
  const cwd = trimSlash(roots.cwd)
  const home = trimSlash(roots.home)
  if (isUnder(path, cwd)) return path === cwd ? '.' : path.slice(cwd.length + 1)
  if (isUnder(path, home)) return '~' + path.slice(home.length)
  return path
}

export function fileHref(path: string, roots: Roots): string {
  const absolute = path.startsWith('/') ? path : `${trimSlash(roots.cwd)}/${path}`
  return 'file://' + absolute.split('/').map(encodeURIComponent).join('/')
}

function clip(text: string, max = MAX_DETAIL): string {
  const line = firstLine(text)
  if (cellWidth(line) <= max) return line
  return sliceCells(line, max - 1, false) + ELLIPSIS
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function num(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function inputOf(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
}

function listOf(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.map(inputOf) : []
}

function filePath(input: Record<string, unknown>): string | undefined {
  return str(input, 'file_path') ?? str(input, 'notebook_path') ?? str(input, 'path') ?? str(input, 'filePath')
}

function humanise(name: string): string {
  return name.replace(/[_-]+/g, ' ').trim()
}

function withoutServer(tool: string, server: string): string {
  const words = humanise(tool).split(/\s+/)
  const rest = words.filter(word => word.toLowerCase() !== server.toLowerCase())
  return (rest.length > 0 ? rest : words).join(' ')
}

export function toolName(tool: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!mcp) return tool
  const server = humanise((mcp[1] ?? '').replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/, ''))
  return `${server} › ${withoutServer(mcp[2] ?? '', server)}`
}

function commandNote(command: string): string | undefined {
  const extra = command.trim().split('\n').length - 1
  return extra > 0 ? `+${plural(extra, 'line')}` : undefined
}

function pathSpan(path: string, roots: Roots): Span {
  return { text: relativePath(path, roots), kind: 'path', href: fileHref(path, roots) }
}

function muted(text: string): Span {
  return { text, kind: 'line' }
}

function plain(text: string): Span {
  return { text, kind: 'plain' }
}

function quoted(text: string): Span {
  return { text: JSON.stringify(text), kind: 'string' }
}

function lineRange(input: Record<string, unknown>): Span[] {
  const offset = num(input, 'offset')
  const limit = num(input, 'limit')
  const start = offset !== undefined && offset > 1 ? offset : 1
  if (limit === 1) return [muted(`:${start}`)]
  if (limit !== undefined && limit > 1) return [muted(`:${start}-${start + limit - 1}`)]
  return start > 1 ? [muted(` from line ${start}`)] : []
}

function grepFlag(input: Record<string, unknown>, flag: string): string | undefined {
  if (input[flag] === true) return flag
  const count = num(input, flag)
  return count === undefined ? undefined : `${flag === 'context' ? '-C' : flag} ${count}`
}

function grepFlags(input: Record<string, unknown>): Span[] {
  const mode = str(input, 'output_mode')
  const limit = num(input, 'head_limit')
  const flags = [
    mode && mode !== DEFAULT_GREP_MODE ? mode.replace(/_/g, ' ') : undefined,
    ...['-i', '-n', 'multiline', '-A', '-B', '-C', 'context'].map(flag => grepFlag(input, flag)),
    limit !== undefined ? `first ${limit}` : undefined,
  ]
  return flags.filter((flag): flag is string => flag !== undefined).map(flag => muted(` ${flag}`))
}

function searchDetail(input: Record<string, unknown>, roots: Roots): Span[] {
  const path = str(input, 'path')
  const glob = str(input, 'glob')
  const type = str(input, 'type')
  const detail: Span[] = [quoted(str(input, 'pattern') ?? '')]
  if (path) detail.push(plain(' in '), pathSpan(path, roots))
  if (glob) detail.push(muted(` glob ${glob}`))
  if (type) detail.push(muted(` type ${type}`))
  return [...detail, ...grepFlags(input)]
}

function shellDetail(command: string): Span[] {
  const continues = commandNote(command) !== undefined
  return [...shellSpans(firstLine(command)), ...(continues ? [muted(ELLIPSIS)] : [])]
}

function lspDetail(input: Record<string, unknown>, roots: Roots): Span[] {
  const operation = str(input, 'operation') ?? ''
  const target = plain(`${LSP_TARGET[operation] ?? humanise(operation)} `)
  const query = str(input, 'query')
  if (operation === 'workspaceSymbol') return [target, ...(query ? [quoted(query)] : [])]
  const path = filePath(input)
  const line = num(input, 'line')
  return [target, ...(path ? [pathSpan(path, roots)] : []), ...(line !== undefined ? [muted(`:${line}`)] : [])]
}

function todoDetail(input: Record<string, unknown>): Span[] {
  const todos = listOf(input.todos)
  if (todos.length === 0) return []
  const finished = todos.filter(todo => todo.status === 'completed').length
  return [plain(plural(todos.length, 'todo')), muted(`${SEPARATOR}${finished} done`)]
}

function questionDetail(input: Record<string, unknown>): Span[] {
  const [first] = listOf(input.questions)
  const question = first ? str(first, 'question') : undefined
  return question ? inlineSpans(clip(question)) : []
}

function planDetail(input: Record<string, unknown>): Span[] {
  const plan = str(input, 'plan')
  return plan ? inlineSpans(clip(firstLine(plan).replace(/^#+\s*/, ''))) : []
}

export function loadedTools(tool: string | undefined, output: unknown): string[] | undefined {
  const matches = inputOf(output).matches
  if (tool !== 'ToolSearch' || !Array.isArray(matches)) return undefined
  return matches.filter((name): name is string => typeof name === 'string' && name.trim() !== '')
}

function namesWithin(names: ReadonlyArray<string>, budget: number): string[] {
  const kept: string[] = []
  for (const name of names) {
    if (kept.length > 0 && cellWidth([...kept, name].join(NAME_SEPARATOR)) > budget) break
    kept.push(name)
  }
  return kept
}

function toolNames(names: ReadonlyArray<string>): Span[] {
  const all = names.map(name => toolName(name.trim())).filter(name => name !== '')
  const shown = namesWithin(all, MAX_TOOL_NAMES)
  if (shown.length === 0) return []
  const rest = all.length - shown.length
  return [plain(clip(shown.join(NAME_SEPARATOR))), ...(rest > 0 ? [muted(` +${rest}`)] : [])]
}

function selectedNames(query: string): string[] | undefined {
  const selected = /^select:(.*)$/.exec(query)
  return selected ? (selected[1] ?? '').split(',').map(name => name.trim()).filter(name => name !== '') : undefined
}

function selectedFrom(loaded: string[], selected: string[] | undefined): string[] {
  const wanted = new Set((selected ?? []).map(name => name.toLowerCase()))
  const picked = loaded.filter(name => wanted.has(name.toLowerCase()))
  return picked.length > 0 ? picked : loaded
}

function toolSearchDetail(input: Record<string, unknown>, _roots: Roots, output?: unknown): Span[] {
  const loaded = loadedTools('ToolSearch', output)
  const query = str(input, 'query') ?? ''
  const selected = selectedNames(query)
  if (loaded !== undefined && loaded.length > 0) return toolNames(selectedFrom(loaded, selected))
  if (!selected) return query ? [quoted(query)] : []
  return toolNames(selected)
}

function cronDetail(input: Record<string, unknown>): Span[] {
  const cron = str(input, 'cron')
  const prompt = str(input, 'prompt')
  return [...(cron ? [{ text: cron, kind: 'code' as const }] : []), ...(prompt ? [plain(' '), ...inlineSpans(clip(prompt))] : [])]
}

function monitorDetail(input: Record<string, unknown>): Span[] {
  const command = str(input, 'command')
  if (command) return shellDetail(command)
  const watched = str(input, 'description') ?? str(inputOf(input.ws), 'url')
  return watched ? inlineSpans(clip(decapitalise(watched))) : []
}

function idDetail(...keys: string[]): Detail {
  return input => {
    const id = keys.map(key => str(input, key)).find(value => value !== undefined)
    return id ? [muted(id)] : []
  }
}

function nothing(): Span[] {
  return []
}

const DETAIL: Record<string, Detail> = {
  Grep: searchDetail,
  Glob: searchDetail,
  LSP: lspDetail,
  TodoWrite: todoDetail,
  AskUserQuestion: questionDetail,
  ExitPlanMode: planDetail,
  EnterPlanMode: nothing,
  ToolSearch: toolSearchDetail,
  Monitor: monitorDetail,
  CronCreate: cronDetail,
  CronDelete: idDetail('id'),
  CronList: nothing,
  TaskStop: idDetail('task_id', 'shell_id'),
  KillShell: idDetail('shell_id', 'task_id'),
}

function scalarArgs(input: Record<string, unknown>): Span[] {
  const scalars = Object.entries(input).filter(([, value]) => SCALARS.has(typeof value) && String(value).trim() !== '')
  return scalars.slice(0, MAX_ARGS).flatMap(([key, value], i) => [...(i > 0 ? [muted(SEPARATOR)] : []), muted(`${key}: `), plain(clip(String(value), MAX_ARG))])
}

function textOf(input: Record<string, unknown>): string | undefined {
  return TEXT_KEYS.map(key => str(input, key)).find(text => text !== undefined) ?? str(input, 'command')
}

export function summarise(tool: string, raw: unknown, roots: Roots, output?: unknown): ToolRow {
  const input = inputOf(raw)
  const name = toolName(tool)
  const path = filePath(input)
  const command = str(input, 'command')
  const detail = DETAIL[tool]

  if (tool === 'Bash' && command) return { name, detail: shellDetail(command), note: commandNote(command) }

  if (detail) return { name, detail: detail(input, roots, output) }

  if (path) {
    const note = input.replace_all === true ? 'all occurrences' : undefined
    return { name, detail: [pathSpan(path, roots), ...(tool === 'Read' ? lineRange(input) : [])], note }
  }

  const url = str(input, 'url')
  if (url) return { name, detail: [{ text: clip(url), kind: 'url' }] }

  const text = textOf(input)
  return { name, detail: text ? inlineSpans(clip(text)) : scalarArgs(input) }
}

function outputLine(output: unknown): string {
  return typeof output === 'string' ? firstLine(output) : ''
}

export function backgroundTaskId(tool: string, output: unknown): string | undefined {
  const record = inputOf(output)
  if (tool === 'Agent') return record.status === 'async_launched' ? str(record, 'agentId') : undefined
  if (tool === 'Bash') return str(record, 'backgroundTaskId')
  if (tool === 'Monitor') return str(record, 'taskId')
  return undefined
}

export function stoppedTaskId(call: Pick<ToolCall, 'tool' | 'input' | 'output'>): string | undefined {
  if (call.tool !== 'TaskStop' && call.tool !== 'KillShell') return undefined
  const input = inputOf(call.input)
  return str(inputOf(call.output), 'task_id') ?? str(input, 'task_id') ?? str(input, 'shell_id')
}

export function createdContent(tool: string, output: unknown): string | undefined {
  const record = inputOf(output)
  if (tool !== 'Write' || record.type !== 'create' || record.staged === true) return undefined
  return typeof record.content === 'string' ? record.content : undefined
}

function loadedNothing(call: Outcome): boolean {
  return loadedTools(call.tool, call.output)?.length === 0
}

export function stateOf(call: Outcome, taskStatus?: string): ToolState {
  if ((call.isErrored || call.isInterrupted) && REJECTION.test(outputLine(call.output))) return 'rejected'
  if (call.isInterrupted) return 'interrupted'
  if (call.isErrored || loadedNothing(call)) return 'failed'
  if (call.isRunning) return 'running'
  if (call.output === undefined) return 'pending'
  if (taskStatus === TASK_UNTRACKED) return 'started'
  if (taskStatus !== undefined && TASK_AT_WORK.has(taskStatus)) return 'running'
  return (taskStatus !== undefined && TASK_END[taskStatus]) || 'done'
}

export function unsuccessfulLines(calls: ReadonlyArray<TrackedCall>, roots: Roots): ToolLine[] {
  return calls
    .filter(call => UNSUCCESSFUL.includes(trackedState(call)))
    .map(call => {
      const row = describeCall(call, roots, call.taskStatus)
      return { label: row.name, detail: row.detail, note: row.note, state: trackedState(call) }
    })
}

export function unsuccessfulState(calls: ReadonlyArray<Outcome & { taskStatus?: string }>): ToolState | undefined {
  const states = new Set(calls.map(call => stateOf(call, call.taskStatus)))
  return UNSUCCESSFUL.find(state => states.has(state))
}

function verb(done: string, running: string, base: string): Verb {
  return { done, running, base, gerund: running.charAt(0).toLowerCase() + running.slice(1) }
}

const VERBS: Record<string, Verb> = {
  Bash: verb('Ran', 'Running', 'run'),
  Read: verb('Read', 'Reading', 'read'),
  Edit: verb('Edited', 'Editing', 'edit'),
  MultiEdit: verb('Edited', 'Editing', 'edit'),
  NotebookEdit: verb('Edited', 'Editing', 'edit'),
  Write: verb('Wrote', 'Writing', 'write'),
  Grep: verb('Searched', 'Searching', 'search'),
  Glob: verb('Listed', 'Listing', 'list'),
  WebFetch: verb('Fetched', 'Fetching', 'fetch'),
  WebSearch: verb('Searched web', 'Searching web', 'search web'),
  Skill: verb('Loaded skill', 'Loading skill', 'load skill'),
  ToolSearch: verb('Loaded tools', 'Loading tools', 'load tools'),
  TaskCreate: verb('Added task', 'Adding task', 'add task'),
  TaskUpdate: verb('Updated task', 'Updating task', 'update task'),
  TodoWrite: verb('Updated todos', 'Updating todos', 'update todos'),
  SendMessage: verb('Sent message', 'Sending message', 'send message'),
  AskUserQuestion: verb('Asked', 'Asking', 'ask'),
  Monitor: verb('Watched', 'Watching', 'watch'),
  LSP: verb('Looked up', 'Looking up', 'look up'),
  ExitPlanMode: verb('Proposed plan', 'Proposing plan', 'propose plan'),
  EnterPlanMode: verb('Entered plan mode', 'Entering plan mode', 'enter plan mode'),
  CronCreate: verb('Scheduled', 'Scheduling', 'schedule'),
  CronDelete: verb('Unscheduled', 'Unscheduling', 'unschedule'),
  CronList: verb('Listed schedules', 'Listing schedules', 'list schedules'),
  TaskStop: verb('Stopped task', 'Stopping task', 'stop task'),
  KillShell: verb('Stopped shell', 'Stopping shell', 'stop shell'),
}

function namedAgent(input: unknown): string | undefined {
  const type = str(inputOf(input), 'subagent_type')
  return type === DEFAULT_AGENT ? undefined : type
}

function agentVerb(input: unknown): Verb {
  const type = namedAgent(input)
  if (type === undefined) return verb('Delegated', 'Delegating', 'delegate')
  return verb(`Delegated to ${type}`, `Delegating to ${type}`, `delegate to ${type}`)
}

function fallbackVerb(tool: string): Verb {
  const name = toolName(tool)
  if (/^mcp__/.test(tool)) return verb(`Called ${name}`, `Calling ${name}`, `call ${name}`)
  return { done: name, running: name, base: `use ${name}`, gerund: `using ${name}` }
}

function verbOf(tool: string, raw?: unknown): Verb {
  if (tool === 'Agent') return agentVerb(raw)
  return VERBS[tool] ?? fallbackVerb(tool)
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const PHRASE: Record<ToolState, (verb: Verb) => string> = {
  pending: v => `Wants to ${v.base}`,
  running: v => v.running,
  started: v => `Started ${v.gerund}`,
  done: v => v.done,
  failed: v => `Couldn't ${v.base}`,
  rejected: v => `Denied ${v.base}`,
  interrupted: v => `Stopped ${v.gerund}`,
}

export function verbFor(tool: string, state: ToolState, input?: unknown): string {
  return PHRASE[state](verbOf(tool, input))
}

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const present = notes.filter((note): note is string => note !== undefined)
  return present.length > 0 ? present.join(SEPARATOR) : undefined
}

function introduced(tool: string, input: unknown, detail: Span[]): Span[] {
  return tool === 'Agent' && detail.length > 0 ? [muted('· '), ...detail] : detail
}

function backgroundNote(call: ToolCall, state: ToolState): string | undefined {
  if (backgroundTaskId(call.tool, call.output) === undefined) return undefined
  return state === 'running' || state === 'started' ? BACKGROUND_NOTE : undefined
}

export function describeCall(call: ToolCall, roots: Roots, taskStatus?: string): ToolRow {
  const summary = summarise(call.tool, call.input, roots, call.output)
  const row = { ...summary, detail: introduced(call.tool, call.input, summary.detail) }
  const state = stateOf(call, taskStatus)
  return { ...row, name: verbFor(call.tool, state, call.input), note: joinNotes(row.note, backgroundNote(call, state)) }
}

function spansKey(spans: ReadonlyArray<Span>): string {
  return spans.map(span => span.text).join('')
}

function distinct<T>(items: ReadonlyArray<T>, key: (item: T) => string): Array<{ item: T; count: number }> {
  const seen = new Map<string, { item: T; count: number }>()
  for (const item of items) {
    const entry = seen.get(key(item))
    if (entry) entry.count += 1
    else seen.set(key(item), { item, count: 1 })
  }
  return [...seen.values()]
}

function repeats(count: number): Span[] {
  return count > 1 ? [muted(` ×${count}`)] : []
}

function trackedState(call: TrackedCall): ToolState {
  return stateOf(call, call.taskStatus)
}

function commandLines(calls: ReadonlyArray<TrackedCall>, roots: Roots): ToolLine[] {
  const rows = distinct(
    calls.map(call => ({ call, row: summarise(call.tool, call.input, roots, call.output) })),
    ({ call, row }) => trackedState(call) + (call.taskStatus ?? '') + spansKey(row.detail) + (row.note ?? ''),
  )
  return rows.map(({ item: { call, row }, count }) => ({
    label: verbFor('Bash', trackedState(call)),
    detail: [...row.detail, ...repeats(count)],
    note: joinNotes(row.note, backgroundNote(call, trackedState(call))),
    state: trackedState(call),
  }))
}

function targetLine(tool: string, calls: ReadonlyArray<TrackedCall>, roots: Roots): ToolLine {
  const targets = distinct(
    calls.map(call => summarise(call.tool, call.input, roots, call.output).detail),
    spansKey,
  )
  const separator = tool === 'ToolSearch' ? plain(NAME_SEPARATOR) : muted(SEPARATOR)
  const detail = targets.flatMap(({ item, count }, i) => [...(i > 0 ? [separator] : []), ...item, ...repeats(count)])
  const [first] = calls
  const state = first ? trackedState(first) : 'done'
  return { label: verbFor(tool, state, first?.input), detail: introduced(tool, first?.input, detail), note: first ? backgroundNote(first, state) : undefined, state }
}

function byKey<T>(items: ReadonlyArray<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

function isAtWork(call: TrackedCall): boolean {
  return trackedState(call) === 'running'
}

function lineKey(call: TrackedCall): string {
  if (call.tool === 'Bash') return call.tool
  const agent = call.tool === 'Agent' ? `:${str(inputOf(call.input), 'subagent_type') ?? DEFAULT_AGENT}` : ''
  return `${call.tool}${agent}:${trackedState(call)}:${call.taskStatus ?? ''}`
}

function groupLines(calls: ReadonlyArray<TrackedCall>, roots: Roots): ToolLine[] {
  return [...byKey(calls, lineKey)].flatMap(([key, own]) => (key === 'Bash' ? commandLines(own, roots) : [targetLine(own[0]?.tool ?? key, own, roots)]))
}

function targetKey(call: ToolCall, roots: Roots): string {
  return filePath(inputOf(call.input)) ?? spansKey(summarise(call.tool, call.input, roots, call.output).detail)
}

function distinctTargets(calls: ReadonlyArray<ToolCall>, roots: Roots): number {
  return new Set(calls.map(call => targetKey(call, roots))).size
}

function runs(calls: ReadonlyArray<ToolCall>): number {
  return calls.length
}

function loadedCount(calls: ReadonlyArray<ToolCall>, roots: Roots): number {
  return new Set(calls.flatMap(call => loadedTools(call.tool, call.output) ?? [targetKey(call, roots)])).size
}

const OTHER: Tally = { verb: 'used', noun: 'tool', count: runs }

const TALLY: Record<string, Tally> = {
  Read: { verb: 'read', noun: 'file', count: distinctTargets },
  Edit: { verb: 'edited', noun: 'file', count: distinctTargets },
  MultiEdit: { verb: 'edited', noun: 'file', count: distinctTargets },
  NotebookEdit: { verb: 'edited', noun: 'notebook', count: distinctTargets },
  Write: { verb: 'wrote', noun: 'file', count: distinctTargets },
  Grep: { verb: 'searched for', noun: 'pattern', count: distinctTargets },
  Glob: { verb: 'listed', noun: 'pattern', count: distinctTargets },
  Bash: { verb: 'ran', noun: 'command', count: runs },
  WebFetch: { verb: 'fetched', noun: 'page', count: distinctTargets },
  WebSearch: { verb: 'searched web', noun: '', count: distinctTargets },
  Monitor: { verb: 'watched', noun: 'command', count: runs, started: 'started watching' },
  Skill: { verb: 'loaded', noun: 'skill', count: distinctTargets },
  ToolSearch: { verb: 'loaded', noun: 'tool', count: loadedCount },
  Agent: { verb: 'delegated', noun: 'task', count: runs },
}

function mcpServer(tool: string): string | undefined {
  return /^mcp__/.test(tool) ? toolName(tool).split(' › ')[0] : undefined
}

function tallyKey(call: TrackedCall): string {
  if (TALLY[call.tool] || VERBS[call.tool]) return call.tool
  const server = mcpServer(call.tool)
  return server === undefined ? 'other' : `mcp:${server}`
}

function decapitalise(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

function tallyOf(key: string, calls: ReadonlyArray<TrackedCall>): Tally {
  if (key.startsWith('mcp:')) return { verb: 'called', noun: `${key.slice(4)} tool`, count: runs }
  const kinds = new Set(calls.map(call => call.tool))
  const [only] = kinds
  const known = only !== undefined && kinds.size === 1 ? VERBS[only] : undefined
  return TALLY[key] ?? (known ? { verb: decapitalise(known.done), noun: '', count: runs } : OTHER)
}

function amount(tally: Tally, calls: ReadonlyArray<TrackedCall>, roots: Roots): string {
  const count = tally.count(calls, roots)
  if (tally.noun !== '') return plural(count, tally.noun)
  return count > 1 ? `×${count}` : ''
}

function isUntracked(call: TrackedCall): boolean {
  return trackedState(call) === 'started'
}

function isFailed(call: TrackedCall): boolean {
  return UNSUCCESSFUL.includes(trackedState(call))
}

function unsuccessfulCounts(calls: ReadonlyArray<TrackedCall>): Array<{ word: string; count: number }> {
  return UNSUCCESSFUL.map(state => ({ word: UNSUCCESSFUL_WORD[state] ?? state, count: calls.filter(call => trackedState(call) === state).length })).filter(({ count }) => count > 0)
}

function asides(calls: ReadonlyArray<TrackedCall>): string {
  const atWork = calls.filter(isAtWork).length
  const notes = [...(atWork > 0 ? [`${atWork} still running`] : []), ...unsuccessfulCounts(calls).map(({ word, count }) => `${count} ${word}`)]
  return notes.length > 0 ? ` (${notes.join(', ')})` : ''
}

function allUnsuccessful(tally: Tally, calls: ReadonlyArray<TrackedCall>): string {
  return unsuccessfulCounts(calls).map(({ word, count }) => `${plural(count, tally.noun || 'call')} ${word}`).join(', ')
}

function isSettledWell(call: TrackedCall): boolean {
  return !isAtWork(call) && !isFailed(call)
}

function partOfWhole(tally: Tally, part: number, whole: number): string {
  return `${part} of ${plural(whole, tally.noun || 'call')}`
}

function unfinishedPhrase(tally: Tally, calls: ReadonlyArray<TrackedCall>, roots: Roots): string {
  const atWork = calls.filter(isAtWork)
  const running = atWork.length > 0 ? `running ${amount(tally, atWork, roots)}`.trimEnd() : ''
  return [running, allUnsuccessful(tally, calls)].filter(part => part !== '').join(', ')
}

function settledPhrase(tally: Tally, calls: ReadonlyArray<TrackedCall>, roots: Roots): string {
  const settledWell = calls.filter(isSettledWell)
  if (settledWell.length === 0) return unfinishedPhrase(tally, calls, roots)
  const unfinished = calls.length - settledWell.length
  if (unfinished === 0) return `${tally.verb} ${amount(tally, calls, roots)}`.trimEnd()
  const done = tally.count(settledWell, roots)
  return `${tally.verb} ${partOfWhole(tally, done, done + unfinished)}${asides(calls)}`
}

function kindPhrase(tally: Tally, calls: ReadonlyArray<TrackedCall>, roots: Roots): string {
  const untracked = calls.filter(isUntracked)
  const tracked = calls.filter(call => !isUntracked(call))
  const started = untracked.length > 0 ? `${tally.started ?? 'started'} ${amount(tally, untracked, roots)}`.trimEnd() : undefined
  const settled = tracked.length > 0 ? settledPhrase(tally, tracked, roots) : undefined
  return [settled, started].filter((part): part is string => part !== undefined).join(', ')
}

function kindRank(calls: ReadonlyArray<TrackedCall>): number {
  if (calls.some(isAtWork)) return 0
  return calls.every(isFailed) ? 2 : 1
}

function failurePhrases(kinds: ReadonlyArray<[string, TrackedCall[]]>): string[] {
  const counts = new Map<string, { noun: string; word: string; count: number }>()
  for (const [key, own] of kinds) {
    const noun = tallyOf(key, own).noun || 'call'
    for (const { word, count } of unsuccessfulCounts(own)) {
      const entry = counts.get(`${noun}:${word}`) ?? { noun, word, count: 0 }
      counts.set(`${noun}:${word}`, { ...entry, count: entry.count + count })
    }
  }
  return [...counts.values()].map(({ noun, word, count }) => `${plural(count, noun)} ${word}`)
}

export function headline(calls: ReadonlyArray<TrackedCall>, roots: Roots): string {
  const kinds = [...byKey(calls, tallyKey)].sort(([, a], [, b]) => kindRank(a) - kindRank(b))
  const settled = kinds.filter(([, own]) => !own.every(isFailed)).map(([key, own]) => kindPhrase(tallyOf(key, own), own, roots))
  return capitalise([...settled, ...failurePhrases(kinds.filter(([, own]) => own.every(isFailed)))].join(', '))
}

function settledState(calls: ReadonlyArray<TrackedCall>): ToolState {
  if (calls.some(isAtWork)) return 'running'
  return calls.some(isUntracked) ? 'started' : 'done'
}

export function failureOf(output: unknown): string[] | undefined {
  const line = outputLine(output)
  if (REJECTION.test(line) || INTERRUPTION.test(line)) return undefined
  const reason = errorReason(output)
  return reason.length > 0 ? reason : undefined
}

function errorReason(output: unknown): string[] {
  const text = typeof output === 'string' ? output.replace(ERROR_TAG, '') : ''
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line.trim() !== '')
  const [first, ...rest] = lines
  return first === undefined ? [] : [first.trim().replace(ERROR_PREFIX, ''), ...rest]
}

export function summariseGroup(calls: ReadonlyArray<TrackedCall>, roots: Roots): { row: ToolRow; state: ToolState } {
  const [only] = calls
  if (calls.length === 1 && only) return { row: describeCall(only, roots, only.taskStatus), state: trackedState(only) }
  const state = unsuccessfulState(calls) ?? settledState(calls)
  return { row: { name: headline(calls, roots), detail: [], lines: groupLines(calls, roots) }, state }
}

function takeSpans(spans: ReadonlyArray<Span>, budget: number, fromEnd: boolean): Span[] {
  const ordered = fromEnd ? [...spans].reverse() : [...spans]
  const kept: Span[] = []
  let left = budget
  for (const span of ordered) {
    if (left <= 0) break
    const text = sliceCells(span.text, left, fromEnd)
    if (text !== '') kept.push({ ...span, text })
    left -= cellWidth(text)
    if (text !== span.text) break
  }
  return fromEnd ? kept.reverse() : kept
}

export function fitMiddle(spans: ReadonlyArray<Span>, width: number): Span[] {
  if (spansWidth([...spans]) <= width) return [...spans]
  if (width < 1) return []
  const room = width - 1
  const head = Math.ceil(room / 2)
  return [...takeSpans(spans, head, false), muted(ELLIPSIS), ...takeSpans(spans, room - head, true)]
}
