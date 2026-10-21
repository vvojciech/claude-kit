import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInputOf, UiPressArgument } from 'claude-code'

import { copyText } from './clipboard'
import { ARGUMENT_HINT, chooseBlock, missingReply, parse } from './commands'
import type { BlockRequest, Choice } from './commands'
import { replyBlocks } from './model'
import { NOT_OUTERMOST, NO_SELECTION, SELECTION_ELSEWHERE, confirmation, failure, moreTargets, sharedTail, sharedTailNote } from './notices'
import { forgetTone, themeTone } from './palette'
import { repliesEndingWith, repliesFrom, replyText } from './replies'
import { MARKER_ROOM, copyMarker } from './row'
import type { Note } from './row'
import { firstSourceBehind } from './selection'
import { freshSession, session } from './session'
import { blockTargets, fitRow, replyTargets } from './targets'
import type { Resolved, Target } from './targets'
import { ownersOf, writtenText } from './turns'
import type { Owners, Replies, Reply } from '../types'

type AssistantRender = RenderInputOf<'AssistantMessage', 'terminal'>

type Owned = { reply: Reply; shared?: number[] }

const COMMAND = 'ditto'
const replies = atom({ plugin: 'ditto', key: 'replies' } as const, null as Replies)
const owners = atom({ plugin: 'ditto', key: 'owners' } as const, {} as Owners)
const live = atom({ plugin: 'ditto', key: 'live' } as const, false)

async function transcriptReplies($: EngineInterface): Promise<Reply[]> {
  return repliesFrom(await $.session.messages())
}

async function readTranscript($: EngineInterface): Promise<Reply[]> {
  const found = await transcriptReplies($)
  await update($, replies, () => found)
  session.seeded = undefined
  return found
}

function refresh($: EngineInterface): Promise<Reply[]> {
  const current = session
  current.reading ??= readTranscript($).finally(() => {
    current.reading = undefined
  })
  return current.reading
}

async function forget($: EngineInterface): Promise<void> {
  await update($, replies, () => null)
  await update($, owners, () => ({}))
  await update($, live, () => false)
}

function unreadable($: EngineInterface, error: unknown): Reply[] {
  $.ui.log(`ditto could not read the transcript, so resumed replies get no ⧉: ${failure(error)}`, { to: 'debug' })
  return []
}

async function history($: EngineInterface): Promise<Reply[]> {
  const stored = await read($, replies)
  if (stored !== null) return stored
  session.seeded ??= transcriptReplies($).catch(error => unreadable($, error))
  return session.seeded
}

async function ownedReply($: EngineInterface, e: AssistantRender): Promise<Owned | undefined> {
  const known = await read($, owners)
  if (e.requestId in known) {
    const reply = known[e.requestId]
    return reply ? { reply } : undefined
  }
  if (session.writing(e.requestId) || (await read($, live))) return undefined
  const all = await history($)
  const matches = repliesEndingWith(all, e.props.text)
  if (matches.length === 0) return undefined
  const only = matches.length === 1 ? all[matches[0] ?? 0] : undefined
  if (only) return { reply: only }
  return { reply: { texts: [e.props.text], partial: false }, shared: matches.map(i => all.length - i).reverse() }
}

async function resolve($: EngineInterface, reply: Reply): Promise<Resolved> {
  return { text: replyText(reply), partial: reply.partial, blocks: await replyBlocks($, reply.texts) }
}

async function settleTurn($: EngineInterface, isAborted: boolean): Promise<void> {
  const settled = ownersOf(session.turn, isAborted)
  session.turn = []
  await update($, live, () => false)
  if (Object.keys(settled).length === 0) return
  session.completedReplies++
  await update($, owners, current => ({ ...current, ...settled }))
}

async function copied($: EngineInterface, target: Target, press: UiPressArgument): Promise<string> {
  try {
    return confirmation(await copyText($, target.text, press.surface), target.what, target.text)
  } catch (error) {
    $.ui.log(failure(error), { to: 'debug' })
    return failure(error)
  }
}

function warnIfWrapped($: EngineInterface): void {
  if (session.warned || session.reached || !session.interactive || session.completedReplies < 2) return
  session.warned = true
  $.ui.toast(NOT_OUTERMOST)
}

function selectionSources(requestId: string | undefined, all: Reply[]): string[] | undefined {
  if (requestId !== undefined) {
    const row = session.drawn.get(requestId)
    return row === undefined ? undefined : [row]
  }
  const rows = [...session.drawn.values()].reverse()
  return [...rows, ...all.map(replyText).reverse()]
}

async function copySelection($: EngineInterface): Promise<string> {
  const selected = await $.ui.selection()
  if (selected === undefined || selected.text.trim() === '') return NO_SELECTION
  const sources = selectionSources(selected.requestId, await refresh($))
  const found = sources && firstSourceBehind(sources, selected.text)
  if (found === undefined || found === '') return SELECTION_ELSEWHERE
  return confirmation(await copyText($, found), 'selection as markdown', found)
}

async function copyBlock($: EngineInterface, request: BlockRequest): Promise<string> {
  const all = await refresh($)
  const reply = all[all.length - request.reply]
  if (reply === undefined) return missingReply(all.length)
  const picked: Choice = chooseBlock(await resolve($, reply), request)
  if ('error' in picked) return picked.error
  return confirmation(await copyText($, picked.text), picked.what, picked.text)
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const request = parse(args)
  if ('error' in request) return request.error
  return request.kind === 'selection' ? copySelection($) : copyBlock($, request)
}

function noteFor($: EngineInterface, shared: number[] | undefined): Note | undefined {
  if (shared === undefined) return undefined
  return { label: sharedTailNote(shared), press: () => $.ui.toast(sharedTail(shared)) }
}

async function withMarker($: EngineInterface, e: AssistantRender, drawn: RenderElement): Promise<RenderElement> {
  const owned = await ownedReply($, e)
  if (owned === undefined) return drawn
  const resolved = await resolve($, owned.reply)
  const targets = owned.shared ? blockTargets(resolved.blocks) : replyTargets(resolved)
  const note = noteFor($, owned.shared)
  const columns = (e.viewport?.columns ?? 0) - MARKER_ROOM - (note ? note.label.length + 2 : 0)
  const row = fitRow(targets, columns)
  if (row.shown.length === 0 && row.hidden.length === 0 && note === undefined) return drawn
  return copyMarker($.ui.resolve(e), drawn, {
    scope: `ditto-${e.requestId}`,
    row,
    tone: await themeTone($),
    partial: owned.reply.partial,
    note,
    press: target => async press => $.ui.toast(await copied($, target, press)),
    more: hidden => () => $.ui.toast(moreTargets(hidden)),
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    freshSession().interactive = e.isInteractive === true
    await $.command.register({ name: COMMAND, description: 'Copy a reply as markdown, one of its code blocks or tables, or the markdown behind a mouse selection', argumentHint: ARGUMENT_HINT })
    await forget($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    freshSession()
    await forget($)
    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    forgetTone()
    if (result.deny === undefined) $.ui.invalidate('ui.render')
    return result
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined || stored.uuid === undefined) return stored
    session.turn.push({ uuid: stored.uuid, text: writtenText(stored.message.content) })
    if (!(await read($, live))) await update($, live, () => true)
    return stored
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await settleTurn($, e.isAborted)
    await refresh($)
    warnIfWrapped($)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) }
    } catch (error) {
      $.ui.log(failure(error), { to: 'debug' })
      return { text: failure(error) }
    }
  }).catch(($, e) => ({ text: `Copy failed: ${e.args === '' ? 'the reply' : `"${e.args}"`} could not be copied in time` }))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    session.reached = true
    const drawn = await next(e)
    if (e.surface !== 'terminal') return drawn
    session.remember(e.requestId, e.props.text)
    if (e.props.isSummary || e.viewport?.isFullscreen !== true) return drawn
    try {
      return await withMarker($, e, drawn)
    } catch (error) {
      $.ui.log(failure(error), { to: 'debug' })
      return drawn
    }
  }).catch(($, e, next) => next(e))
}
