import type { SessionMessage } from 'claude-code'

import { CALL_MARK, OUTPUT, TOOL_WHAT, numbered, target } from './targets'
import type { Target, ToolKind } from './targets'

export type ToolCall = { tool: string; input: unknown; output?: unknown; tool_use_id?: string }

type Fields = Record<string, unknown>

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

export const OUTPUT_TOOLS = new Set(['Bash', 'Grep', 'Glob', 'WebFetch', 'Agent', 'Task'])

const MCP = /^mcp__/

const AGENT_TOOLS = new Set(['Agent', 'Task'])

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

function fields(value: unknown): Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function joined(parts: (string | undefined)[]): string | undefined {
  return text(parts.filter((part): part is string => part !== undefined).join('\n'))
}

function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return text(content)
  return joined(content.map(block => (fields(block).type === 'text' ? text(fields(block).text) : undefined)))
}

function editedFile(input: Fields, output: Fields): string | undefined {
  const original = output.originalFile
  const before = output.oldString ?? input.old_string
  const after = output.newString ?? input.new_string
  if (typeof after !== 'string') return undefined
  if (typeof original !== 'string' || typeof before !== 'string' || before === '' || !original.includes(before)) return text(after)
  const everywhere = output.replaceAll === true || input.replace_all === true
  return everywhere ? original.split(before).join(after) : original.replace(before, () => after)
}

function readFile(output: Fields): string | undefined {
  return output.type === 'text' ? text(fields(output.file).content) : undefined
}

function fileText(call: ToolCall): string | undefined {
  const input = fields(call.input)
  const output = fields(call.output)
  if (call.tool === 'Write') return text(input.content)
  if (call.tool === 'Edit') return editedFile(input, output)
  if (call.tool === 'Read') return readFile(output)
  return undefined
}

function planText(call: ToolCall): string | undefined {
  return call.tool === 'ExitPlanMode' ? (text(fields(call.input).plan) ?? text(fields(call.output).plan)) : undefined
}

function agentText(output: Fields): string | undefined {
  return text(fields(output.handbackReport).text) ?? contentText(output.content) ?? text(output.report)
}

function grepText(output: Fields): string | undefined {
  const names = Array.isArray(output.filenames) ? output.filenames.filter((name): name is string => typeof name === 'string') : []
  return text(output.content) ?? joined(names)
}

function rawOutput(call: ToolCall): string | undefined {
  if (typeof call.output === 'string') return text(call.output)
  const output = fields(call.output)
  if (call.tool === 'Bash') return joined([text(output.stdout), text(output.stderr)])
  if (call.tool === 'Grep' || call.tool === 'Glob') return grepText(output)
  if (call.tool === 'WebFetch') return text(output.result)
  if (AGENT_TOOLS.has(call.tool)) return agentText(output)
  return contentText(call.output) ?? contentText(output.content) ?? text(output.result) ?? text(output.stdout)
}

const HANDBACK_STUB = /^This agent's report was delivered to you as a message from "([^"]+)"/

const HANDBACK = 'SubagentHandback'

export function handbackStub(output: string | undefined): { agentId: string } | undefined {
  const agentId = output === undefined ? undefined : HANDBACK_STUB.exec(output.trim())?.[1]
  return agentId === undefined ? undefined : { agentId }
}

function outputText(call: ToolCall): string | undefined {
  if (!OUTPUT_TOOLS.has(call.tool) && !MCP.test(call.tool)) return undefined
  const raw = rawOutput(call)
  return raw === undefined || handbackStub(raw) ? undefined : text(stripAnsi(raw))
}

const READERS: [ToolKind, (call: ToolCall) => string | undefined][] = [
  ['file', fileText],
  ['plan', planText],
  ['output', outputText],
]

export function fileName(call: ToolCall): string | undefined {
  const path = text(fields(call.input).file_path) ?? text(fields(call.output).filePath) ?? text(fields(fields(call.output).file).filePath)
  return path?.split('/').filter(Boolean).at(-1)
}

function whatOf(kind: ToolKind, call: ToolCall): string {
  if (kind === 'output') return `${callName(call, kind)} ${OUTPUT}`
  const name = kind === 'file' ? fileName(call) : undefined
  return name === undefined ? TOOL_WHAT[kind] : `${TOOL_WHAT[kind]} ${name}`
}

type Produced = { kind: ToolKind; text: string }

function produced(call: ToolCall): Produced | undefined {
  for (const [kind, read] of READERS) {
    const found = read(call)
    if (found !== undefined) return { kind, text: found }
  }
  return undefined
}

export function toolTarget(call: ToolCall): Target | undefined {
  const found = produced(call)
  return found === undefined ? undefined : target(found.kind, found.kind, found.text, whatOf(found.kind, call))
}

export function callName(call: ToolCall, kind: ToolKind): string {
  if (kind === 'file') return fileName(call) ?? kind
  if (kind === 'plan') return kind
  if (MCP.test(call.tool)) return 'mcp'
  return AGENT_TOOLS.has(call.tool) ? 'agent' : call.tool.toLowerCase()
}

const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g

const TASK_ID = /<task-id>([\s\S]*?)<\/task-id>/
const RESULT = /<result>([\s\S]*?)<\/result>/

function tagged(body: string, tag: RegExp): string | undefined {
  return tag.exec(body)?.[1]?.trim()
}

export function backgroundReports(messages: SessionMessage[]): Map<string, string> {
  const reports = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const [, body = ''] of message.text.matchAll(NOTIFICATION)) {
      const id = tagged(body, TASK_ID)
      const result = tagged(body, RESULT)
      if (id !== undefined && result !== undefined && result !== '') reports.set(id, result)
    }
  }
  return reports
}

function launchedAgent(output: unknown): string | undefined {
  const launched = fields(output)
  return launched.status === 'async_launched' && typeof launched.agentId === 'string' ? launched.agentId : undefined
}

function withReport(call: ToolCall, reports: Map<string, string>): ToolCall {
  const agentId = launchedAgent(call.output)
  if (agentId === undefined) return call
  return { ...call, output: { report: reports.get(agentId), agentId } }
}

export type ReportLookup = (agentId: string) => Promise<string | undefined>

export function handbackReport(messages: SessionMessage[]): string | undefined {
  const handbacks = messages.flatMap(message => message.toolUses.filter(use => use.tool === HANDBACK))
  return text(handbacks.at(-1)?.input.message)
}

function calls(messages: SessionMessage[]): ToolCall[] {
  const reports = backgroundReports(messages)
  const uses = messages.flatMap(message => message.toolUses.filter(use => use.isError !== true))
  return uses.map(use => withReport({ tool: use.tool, input: use.input, output: use.result ?? use.text }, reports))
}

function unreported(call: ToolCall): string | undefined {
  const output = fields(call.output)
  return output.report === undefined && typeof output.agentId === 'string' ? output.agentId : undefined
}

async function handedBack(call: ToolCall, agentId: string, lookup: ReportLookup): Promise<ToolCall> {
  const report = await lookup(agentId)
  return report === undefined ? call : { ...call, output: { report } }
}

function unavailable(agentId: string): Target {
  const unavailable = `the report of agent ${agentId} reached the session as a message copy-that cannot read, so nothing was copied`
  return { ...target('output', 'output', '', `agent ${OUTPUT}`), unavailable }
}

async function delivered(call: ToolCall, lookup: ReportLookup): Promise<ToolCall | Target> {
  if (!AGENT_TOOLS.has(call.tool)) return call
  const waiting = unreported(call)
  if (waiting !== undefined) return handedBack(call, waiting, lookup)
  const stub = handbackStub(rawOutput(call))
  if (stub === undefined) return call
  const found = await handedBack(call, stub.agentId, lookup)
  return found === call ? unavailable(stub.agentId) : found
}

export function groupTargets(group: ToolCall[]): Target[] {
  const found = group.flatMap(call => {
    const one = produced(call)
    return one === undefined ? [] : [{ call, ...one, name: callName(call, one.kind) }]
  })
  const names = found.length === 1 ? [found[0]?.kind ?? ''] : numbered(found.map(f => f.name), CALL_MARK)
  return found.map((f, i) => withCallId(target(f.kind, names[i] ?? f.name, f.text, whatOf(f.kind, f.call)), f.call.tool_use_id))
}

function withCallId(found: Target, callId: string | undefined): Target {
  return callId === undefined ? found : { ...found, callId }
}

function targetOf(found: ToolCall | Target): Target | undefined {
  return 'tool' in found ? toolTarget(found) : found
}

export function launchedInBackground(call: ToolCall): boolean {
  return launchedAgent(call.output) !== undefined
}

export async function reportedTarget(call: ToolCall, messages: SessionMessage[], lookup: ReportLookup): Promise<Target | undefined> {
  const picked = targetOf(await delivered(withReport(call, backgroundReports(messages)), lookup))
  return picked?.unavailable === undefined ? picked : undefined
}

export async function toolTargets(messages: SessionMessage[], kind: ToolKind, lookup: ReportLookup): Promise<Target[]> {
  const found = await Promise.all(calls(messages).map(call => delivered(call, lookup)))
  return found.flatMap(one => {
    const picked = targetOf(one)
    return picked?.kind === kind ? [picked] : []
  })
}
