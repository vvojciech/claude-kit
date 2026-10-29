import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderInputOf } from 'claude-code'

import { replyBlocks } from './model'
import { failure } from './notices'
import { repliesEndingWith, repliesFrom, replyText } from './replies'
import { session } from './session'
import type { Session } from './session'
import type { Resolved } from './targets'
import { handbackReport } from './tools'
import { ownersOf } from './turns'
import type { Owners, Replies, Reply } from '../types'

export type AssistantRender = RenderInputOf<'AssistantMessage', 'terminal'>

type Owned = { reply: Reply; shared?: number[] }

const replies = atom({ plugin: 'copy-that', key: 'replies' } as const, null as Replies)
const owners = atom({ plugin: 'copy-that', key: 'owners' } as const, {} as Owners)
const live = atom({ plugin: 'copy-that', key: 'live' } as const, false)

async function transcriptReplies($: EngineInterface): Promise<Reply[]> {
  return repliesFrom(await $.session.messages())
}

const startsWith = (reply: Reply, head: Reply) => head.texts.length <= reply.texts.length && head.texts.every((text, i) => reply.texts[i] === text)

type Unstored = Session['unstored'][number]

// right after the turn: over the transcript's last reply when it is this turn's stored start,
// otherwise after it
function placeOf(found: Reply[], entry: Unstored): { index: number; replaces: boolean } {
  const last = found.at(-1)
  const isOwn = entry.storedStart && last !== undefined && (startsWith(entry.reply, last) || startsWith(last, entry.reply))
  return isOwn ? { index: found.length - 1, replaces: true } : { index: found.length, replaces: false }
}

// puts back each interrupted reply the engine never stored in full, where it was drawn
function withUnstored(found: Reply[]): Reply[] {
  const merged = [...found]
  let shift = 0
  for (const entry of session.unstored) {
    entry.place ??= placeOf(found, entry)
    const own = entry.place.replaces ? found[entry.place.index] : undefined
    if (own !== undefined && startsWith(own, entry.reply)) continue
    merged.splice(entry.place.index + shift, entry.place.replaces ? 1 : 0, entry.reply)
    if (!entry.place.replaces) shift++
  }
  return merged
}

async function readTranscript($: EngineInterface): Promise<Reply[]> {
  const found = withUnstored(await transcriptReplies($))
  await update($, replies, () => found)
  session.seeded = undefined
  return found
}

export function refresh($: EngineInterface): Promise<Reply[]> {
  const current = session
  current.reading ??= readTranscript($).finally(() => {
    current.reading = undefined
  })
  return current.reading
}

export async function forget($: EngineInterface): Promise<void> {
  await update($, replies, () => null)
  await update($, owners, () => ({}))
  await update($, live, () => false)
}

export async function markLive($: EngineInterface): Promise<void> {
  if (!(await read($, live))) await update($, live, () => true)
}

function unreadable($: EngineInterface, error: unknown): Reply[] {
  $.ui.log(`copy-that could not read the transcript, so resumed replies get no ⧉: ${failure(error)}`, { to: 'debug' })
  return []
}

async function history($: EngineInterface): Promise<Reply[]> {
  const stored = await read($, replies)
  if (stored !== null) return stored
  session.seeded ??= transcriptReplies($).catch(error => unreadable($, error))
  return session.seeded
}

async function stillWriting($: EngineInterface, requestId: string): Promise<boolean> {
  return session.writing(requestId) || session.liveRows.has(requestId) || ((await read($, live)) && !session.shownBeforeTurn.has(requestId))
}

function sharedBy(all: Reply[], matches: number[], text: string): Owned {
  const only = matches.length === 1 ? all[matches[0] ?? 0] : undefined
  if (only) return { reply: only }
  return { reply: { texts: [text], partial: false }, shared: matches.map(i => all.length - i).reverse() }
}

export async function ownedReply($: EngineInterface, e: AssistantRender): Promise<Owned | undefined> {
  const known = await read($, owners)
  if (e.requestId in known) {
    const reply = known[e.requestId]
    return reply ? { reply } : undefined
  }
  if (await stillWriting($, e.requestId)) return undefined
  const all = await history($)
  const matches = repliesEndingWith(all, e.props.text)
  return matches.length === 0 ? undefined : sharedBy(all, matches, e.props.text)
}

// R of a reply as /copy-that counts it now, 1 the last
export async function replyNumber($: EngineInterface, reply: Reply): Promise<number | undefined> {
  const back = [...(await history($))].reverse().findIndex(one => one.texts.length === reply.texts.length && startsWith(one, reply))
  return back === -1 ? undefined : back + 1
}

export async function resolve($: EngineInterface, reply: Reply): Promise<Resolved> {
  return { text: replyText(reply), partial: reply.partial, blocks: await replyBlocks($, reply.texts) }
}

export async function settleTurn($: EngineInterface, isAborted: boolean): Promise<void> {
  const settled = ownersOf(session.closeTurn(isAborted), isAborted)
  await update($, live, () => false)
  if (Object.keys(settled).length === 0) return
  await update($, owners, current => ({ ...current, ...settled }))
}

export async function agentReport($: EngineInterface, agentId: string): Promise<string | undefined> {
  const found = await $.session.messages({ agentId })
  return Array.isArray(found) ? handbackReport(found) : undefined
}
