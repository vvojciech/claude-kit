import { REPLY, replyTargets } from './targets'
import type { Resolved, Target } from './targets'

export type Choice = { text: string; what: string } | { error: string }

export type BlockRequest = { kind: 'block'; reply: number; name: string }

export type Request = BlockRequest | { kind: 'selection' } | { error: string }

export const SELECTION = 'selection'

export const ARGUMENT_HINT = `[R] [md | <language> | code | table] [N] | ${SELECTION}`

export const USAGE = `Usage: /ditto ${ARGUMENT_HINT}. R picks the reply, 1 = the last. The name is a ⧉ chip's, so /ditto ruby 2 copies the chip "⧉ ruby 2": blocks of one name count from the top of the reply. code is a block with no language, or any code block when none lacks one. /ditto ${SELECTION} copies the markdown behind what you last selected with the mouse.`

export const BAD_REPLY = 'R counts back from 1, the last reply'

const COUNT = /^[1-9]\d*$/

const DIGITS = /^\d+$/

const UNNAMED_CODE = 'code'

function words(args: string): string[] {
  return args.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function parse(args: string): Request {
  const given = words(args)
  if (given.length === 1 && given[0] === SELECTION) return { kind: 'selection' }
  if (given[0] === '0') return { error: BAD_REPLY }
  const explicitReply = COUNT.test(given[0] ?? '')
  const reply = explicitReply ? Number(given.shift()) : 1
  const [name = REPLY, index, ...rest] = given
  if (rest.length > 0 || (!explicitReply && DIGITS.test(name))) return { error: USAGE }
  if (index === undefined) return { kind: 'block', reply, name }
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
  if (base !== UNNAMED_CODE || targets.some(t => t.kind === 'code' && t.what === 'code block')) return undefined
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
