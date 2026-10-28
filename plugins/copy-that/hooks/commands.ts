import { CALL_MARK, CODE, OUTPUT, REPLY, TOOL_KINDS, TOOL_WHAT, replyTargets } from './targets'
import type { Resolved, Target, ToolKind } from './targets'

export type Choice = { text: string; what: string } | { error: string }

export type BlockRequest = { kind: 'block'; reply: number; name: string }

export type ToolRequest = { kind: 'tool'; tool: ToolKind; back: number }

export type CallRequest = { kind: 'call'; name: string }

export type Request = BlockRequest | ToolRequest | CallRequest | { kind: 'selection' } | { kind: 'help' } | { error: string }

const HELP = new Set(['help', '-h', '--help', '?'])

export const SELECTION = 'selection'

export const ARGUMENT_HINT = `[R] [reply | <language> | code | table | quote] [N] | file [N] | plan | output [N] | ${SELECTION} | help`

const PARAGRAPHS = [
  [`Usage: /copy-that ${ARGUMENT_HINT}`],
  [
    '/copy-that copies the last reply as markdown.',
    'R picks the reply, 1 = the last: /copy-that 2 is the reply before.',
  ],
  [
    'A name copies one block, as its ⧉ chip shows it: /copy-that ruby 2 is the chip "⧉ ruby 2";',
    'blocks of one name count from the top of the reply.',
    'code is a block with no language, or any code block when none lacks one.',
    'A chip named by digits, as ⧉ 123, needs R first: /copy-that 1 123.',
  ],
  [
    '/copy-that quote [N] copies the Nth quote in the reply without its > markers, ready to paste as a draft;',
    '/copy-that 2 quote takes it from the reply before.',
    'A GitHub alert is named by its type, as /copy-that note or /copy-that warning, and copies without its [!NOTE] line.',
  ],
  [
    '/copy-that file [N] copies the Nth last file Claude wrote, edited (the whole file after the edit) or read.',
    '/copy-that plan copies the last plan.',
    '/copy-that output [N] copies the Nth last Bash, Grep, Glob, WebFetch, Agent or MCP output, colours stripped.',
  ],
  [
    'N counts back from the last, 1 = the last.',
    'A tool row with one copyable call says ⧉ output or ⧉ file like a single call.',
    'Chips on a group with more name each call instead, and /copy-that copies the last call of that name:',
    '/copy-that notes.md for ⧉ notes.md, /copy-that bash for ⧉ bash.',
    'A repeated name, as ⧉ bash #2, numbers a call from the top of its group: /copy-that bash #2 copies it from the last group that has it.',
    'Quote a name with spaces: /copy-that "my file.md" #2.',
  ],
  [`/copy-that ${SELECTION} copies the markdown behind what you last selected with the mouse.`],
  ['The ⧉ markers need fullscreen; a reply still being written gets its marker when it ends.'],
]

export const USAGE = PARAGRAPHS.map(lines => lines.join(' ')).join('\n')

export const SELECTION_HAS_NO_REPLY = `${SELECTION} takes no reply number: run /copy-that ${SELECTION}`

export const BAD_REPLY = 'R counts back from 1, the last reply'

export function badToolCount(tool: ToolKind): string {
  return `N counts back from 1, the last ${tool}: /copy-that ${tool} 1`
}

const COUNT = /^[1-9]\d*$/

const CALL_ORDINAL = /^#\d+$/

const COUNTS_BACK = '/copy-that output N or /copy-that file N counts calls back from the last'

export function callNameAlone(given: string): string {
  const name = given.split(' ').slice(-2).join(' ')
  return `A call name takes nothing else: /copy-that ${name}`
}

export function noGroupCall(name: string): string {
  return `No tool group shown so far has a call ${name}; ${COUNTS_BACK}`
}

const DIGITS = /^\d+$/

export function numberFirst(index: string, name: string): string {
  return name === SELECTION ? SELECTION_HAS_NO_REPLY : `The reply number goes first: /copy-that ${index} ${name}`
}

// a quoted name is one word, spaces kept, as a file chip ⧉ my file.md shows it
function words(args: string): string[] {
  const parts = args.toLowerCase().split('"')
  return parts.flatMap((part, i) => (i % 2 === 1 ? [part] : part.split(/\s+/))).filter(Boolean)
}

function isCallOrdinal(word: string): boolean {
  const digits = word.slice(CALL_MARK.length)
  return word.startsWith(CALL_MARK) && digits !== '' && [...digits].every(digit => digit >= '0' && digit <= '9')
}

// how to type a chip name: a name with spaces quoted, its #N after the quotes
export function typedName(name: string): string {
  const ordinal = name.split(' ').at(-1) ?? ''
  const base = name.includes(' ') && isCallOrdinal(ordinal) ? name.slice(0, -ordinal.length - 1) : name
  return base.includes(' ') ? `"${base}"${name.slice(base.length)}` : name
}

function toolRequest(given: string[]): Request | undefined {
  const [name, back = '1', ...rest] = given
  const tool = TOOL_KINDS.find(kind => kind === name)
  if (tool === undefined) return undefined
  if (rest.length > 0 || !DIGITS.test(back)) return { error: USAGE }
  return COUNT.test(back) ? { kind: 'tool', tool, back: Number(back) } : { error: badToolCount(tool) }
}

function callRequest(given: string[]): Request | undefined {
  if (!given.some(word => CALL_ORDINAL.test(word))) return undefined
  const [name, ordinal, ...rest] = given
  const alone = rest.length === 0 && name !== undefined && !CALL_ORDINAL.test(name) && CALL_ORDINAL.test(ordinal ?? '')
  return alone ? { kind: 'call', name: `${name} ${ordinal}` } : { error: callNameAlone(given.join(' ')) }
}

function soleRequest(given: string[]): Request | undefined {
  const [only] = given
  if (given.length !== 1 || only === undefined) return undefined
  if (HELP.has(only)) return { kind: 'help' }
  return only === SELECTION ? { kind: 'selection' } : undefined
}

function indexedBlock(reply: number, name: string, index: string, explicitReply: boolean): Request {
  const misplaced = !explicitReply && (name === REPLY || name === SELECTION) && COUNT.test(index)
  if (misplaced) return { error: numberFirst(index, name) }
  return COUNT.test(index) ? { kind: 'block', reply, name: `${name} ${index}` } : { error: USAGE }
}

function blockRequest(given: string[]): Request {
  if (given[0] === '0') return { error: BAD_REPLY }
  const explicitReply = COUNT.test(given[0] ?? '')
  const reply = explicitReply ? Number(given.shift()) : 1
  const [name = REPLY, index, ...rest] = given
  if (explicitReply && name === SELECTION && index === undefined) return { error: SELECTION_HAS_NO_REPLY }
  if (rest.length > 0 || (!explicitReply && DIGITS.test(name))) return { error: USAGE }
  return index === undefined ? { kind: 'block', reply, name } : indexedBlock(reply, name, index, explicitReply)
}

export function parse(args: string): Request {
  const given = words(args)
  return soleRequest(given) ?? toolRequest(given) ?? callRequest(given) ?? blockRequest(given)
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
  const names = targets.map(t => t.name).join(', ')
  return { error: `No "${request.name}" in ${whichReply(request.reply)}; it has ${names}` }
}

export function missingTool(tool: ToolKind, back: number, count: number): string {
  if (count === 0) return `No ${TOOL_WHAT[tool]} to copy in this session yet`
  return `Only ${count} ${TOOL_WHAT[tool]}${count === 1 ? '' : 's'} so far, not ${back}`
}

function namedAs(call: Target, name: string): boolean {
  const what = call.what.toLowerCase()
  return what === `${TOOL_WHAT.file} ${name}` || what === `${name} ${OUTPUT}`
}

export function chooseNamedCall(calls: Target[], name: string): Choice | undefined {
  const found = calls.filter(call => namedAs(call, name)).at(-1)
  if (found === undefined) return undefined
  const what = `last ${found.what}`
  return found.unavailable === undefined ? { text: found.text, what } : { error: `Cannot copy the ${what}: ${found.unavailable}` }
}

function latestFirst(order: string[]): (call: Target) => number {
  const at = new Map(order.map((id, i) => [id, i]))
  return call => at.get(call.callId ?? '') ?? -1
}

export function chooseGroupCall(calls: Target[], order: string[], name: string): Choice {
  const rank = latestFirst(order)
  const named = calls.filter(call => call.name.toLowerCase() === name)
  const found = named.reduce<Target | undefined>((best, call) => (best === undefined || rank(call) >= rank(best) ? call : best), undefined)
  if (found === undefined) return { error: noGroupCall(name) }
  const what = `${found.what} ${found.name.split(' ').at(-1)}`
  return found.unavailable === undefined ? { text: found.text, what } : { error: `Cannot copy the ${what}: ${found.unavailable}` }
}

export function chooseTool(targets: Target[], request: ToolRequest): Choice {
  const found = targets[targets.length - request.back]
  if (found === undefined) return { error: missingTool(request.tool, request.back, targets.length) }
  const what = request.back === 1 ? `last ${found.what}` : `${found.what}, ${request.back} back`
  if (found.unavailable !== undefined) return { error: `Cannot copy the ${what}: ${found.unavailable}` }
  return { text: found.text, what }
}
