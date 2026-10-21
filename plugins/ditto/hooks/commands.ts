import { CODE, REPLY, TOOL_KINDS, replyTargets } from './targets'
import type { Resolved, Target, ToolKind } from './targets'

export type Choice = { text: string; what: string } | { error: string }

export type BlockRequest = { kind: 'block'; reply: number; name: string }

export type ToolRequest = { kind: 'tool'; tool: ToolKind; back: number }

export type Request = BlockRequest | ToolRequest | { kind: 'selection' } | { kind: 'help' } | { error: string }

const HELP = new Set(['help', '-h', '--help', '?'])

export const SELECTION = 'selection'

export const ARGUMENT_HINT = `[R] [reply | <language> | code | table] [N] | file [N] | plan | output [N] | ${SELECTION} | help`

export const USAGE = [
  `Usage: /ditto ${ARGUMENT_HINT}`,
  '/ditto copies the last reply as markdown. R picks the reply, 1 = the last: /ditto 2 is the reply before.',
  'A name copies one block, as its ⧉ chip shows it: /ditto ruby 2 is the chip "⧉ ruby 2": blocks of one name count from the top of the reply. code is a block with no language, or any code block when none lacks one. A chip named by digits, as ⧉ 123, needs R first: /ditto 1 123.',
  '/ditto file [N] copies the Nth last file Claude wrote, edited (the whole file after the edit) or read. /ditto plan copies the last plan. /ditto output [N] copies the Nth last Bash, Grep, WebFetch, Agent or MCP output, colours stripped.',
  'N counts back from the last, 1 = the last. Chips on a group of tool calls count back the same way from its last call, so ⧉ output 2 is /ditto output 2 only while that group holds the last tool call.',
  `/ditto ${SELECTION} copies the markdown behind what you last selected with the mouse.`,
  'The ⧉ markers need fullscreen; a reply still being written gets its marker when it ends.',
].join('\n')

export const SELECTION_HAS_NO_REPLY = `${SELECTION} takes no reply number: run /ditto ${SELECTION}`

export const BAD_REPLY = 'R counts back from 1, the last reply'

export function badToolCount(tool: ToolKind): string {
  return `N counts back from 1, the last ${tool}: /ditto ${tool} 1`
}

const COUNT = /^[1-9]\d*$/

const DIGITS = /^\d+$/

export function numberFirst(index: string, name: string): string {
  return name === SELECTION ? SELECTION_HAS_NO_REPLY : `The reply number goes first: /ditto ${index} ${name}`
}

function words(args: string): string[] {
  return args.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function toolRequest(given: string[]): Request | undefined {
  const [name, back = '1', ...rest] = given
  const tool = TOOL_KINDS.find(kind => kind === name)
  if (tool === undefined) return undefined
  if (rest.length > 0 || !DIGITS.test(back)) return { error: USAGE }
  return COUNT.test(back) ? { kind: 'tool', tool, back: Number(back) } : { error: badToolCount(tool) }
}

export function parse(args: string): Request {
  const given = words(args)
  if (given.length === 1 && HELP.has(given[0] ?? '')) return { kind: 'help' }
  const tool = toolRequest(given)
  if (tool !== undefined) return tool
  if (given.length === 1 && given[0] === SELECTION) return { kind: 'selection' }
  if (given[0] === '0') return { error: BAD_REPLY }
  const explicitReply = COUNT.test(given[0] ?? '')
  const reply = explicitReply ? Number(given.shift()) : 1
  const [name = REPLY, index, ...rest] = given
  if (explicitReply && name === SELECTION && index === undefined) return { error: SELECTION_HAS_NO_REPLY }
  if (rest.length > 0 || (!explicitReply && DIGITS.test(name))) return { error: USAGE }
  if (index === undefined) return { kind: 'block', reply, name }
  if (!explicitReply && (name === REPLY || name === SELECTION) && COUNT.test(index)) return { error: numberFirst(index, name) }
  return COUNT.test(index) ? { kind: 'block', reply, name: `${name} ${index}` } : { error: USAGE }
}

export function whichReply(reply: number): string {
  return reply === 1 ? 'the last reply' : `reply ${reply} back`
}

function replyCount(count: number): string {
  return count === 1 ? '1 reply' : `${count} replies`
}

export function missingReply(count: number): string {
  return count === 0 ? 'No reply to copy yet' : `Only ${replyCount(count)} so far`
}

function split(name: string): { base: string; index: number } {
  const match = /^(.*) ([1-9]\d*)$/.exec(name)
  return match ? { base: match[1] ?? name, index: Number(match[2]) } : { base: name, index: 1 }
}

function named(targets: Target[], name: string): Target | undefined {
  const exact = targets.find(t => t.name === name)
  if (exact) return exact
  const { base, index } = split(name)
  return index === 1 ? targets.find(t => t.name === base || t.name === `${base} 1`) : undefined
}

function anyCode(targets: Target[], name: string): Target | undefined {
  const { base, index } = split(name)
  if (base !== CODE || targets.some(t => t.kind === 'code' && t.what === 'code block')) return undefined
  return targets.filter(t => t.kind === 'code')[index - 1]
}

export function chooseBlock(reply: Resolved, request: BlockRequest): Choice {
  if (request.name === REPLY) {
    const what = whichReply(request.reply).replace(/^the /, '')
    return { text: reply.text, what: reply.partial ? `${what} (partial)` : what }
  }
  const targets = replyTargets(reply)
  const found = named(targets, request.name) ?? anyCode(targets, request.name)
  if (found) return { text: found.text, what: found.what }
  return { error: `No "${request.name}" in ${whichReply(request.reply)}; it has ${targets.map(t => t.name).join(', ')}` }
}

const TOOL_WHAT: Record<ToolKind, string> = { file: 'file', plan: 'plan', output: 'tool output' }

export function missingTool(tool: ToolKind, back: number, count: number): string {
  if (count === 0) return `No ${TOOL_WHAT[tool]} to copy in this session yet`
  return `Only ${count} ${TOOL_WHAT[tool]}${count === 1 ? '' : 's'} so far, not ${back}`
}

export function chooseTool(targets: Target[], request: ToolRequest): Choice {
  const found = targets[targets.length - request.back]
  if (found === undefined) return { error: missingTool(request.tool, request.back, targets.length) }
  const what = request.back === 1 ? `last ${found.what}` : `${found.what} ${request.back} back`
  if (found.unavailable !== undefined) return { error: `Cannot copy the ${what}: ${found.unavailable}` }
  return { text: found.text, what }
}
