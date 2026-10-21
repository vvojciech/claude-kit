import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInputOf, UiPressArgument, RenderViewport } from 'claude-code'

import { copyText } from './clipboard'
import { ARGUMENT_HINT, USAGE, chooseBlock, chooseTool, missingReply, parse } from './commands'
import type { BlockRequest, Choice, ToolRequest } from './commands'
import { replyBlocks } from './model'
import { FIRST_RUN, NOT_OUTERMOST, NO_FULLSCREEN, NO_SELECTION, SELECTION_ELSEWHERE, confirmation, flashOf, selectionRepeats, failure, moreTargets, sharedTail, sharedTailNote, withWarning } from './notices'
import { forgetTone, themeTone } from './palette'
import { repliesEndingWith, repliesFrom, replyText } from './replies'
import { MARKER_ROOM, keyOf, replyMarker, toolMarker } from './row'
import type { Flash, Marker, Note } from './row'
import { behindAny } from './selection'
import { freshSession, hinted, session } from './session'
import { blockTargets, fitRow, replyTargets } from './targets'
import type { Resolved, Row, Target } from './targets'
import { groupTargets, handbackReport, toolTarget, toolTargets } from './tools'
import type { ToolCall } from './tools'
import { ownersOf, writtenText } from './turns'
import type { Owners, Replies, Reply } from '../types'

type AssistantRender = RenderInputOf<'AssistantMessage', 'terminal'>

type ToolRender = RenderInputOf<'ToolUse', 'terminal'>

type GroupRender = RenderInputOf<'ToolGroup', 'terminal'>

type Settled = Pick<ToolCall, 'tool' | 'input' | 'output'> & { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

type Copied = { notice: string; flash: string }

type Owned = { reply: Reply; shared?: number[] }

const COMMAND = 'ditto'
const NARROW_COLUMNS = 60
const NOTICE_MS = 4000
const WRAPPED_CHECK_MS = 1500
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
  if (session.writing(e.requestId) || session.liveRows.has(e.requestId) || (await read($, live))) return undefined
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
  const settled = ownersOf(session.closeTurn(isAborted), isAborted)
  await update($, live, () => false)
  if (Object.keys(settled).length === 0) return
  await update($, owners, current => ({ ...current, ...settled }))
}

function announce($: EngineInterface, text: string, columns: number): void {
  if (columns >= NARROW_COLUMNS) {
    $.ui.toast(text)
    return
  }
  session.notice = text
  void $.ui.status(text)
  setTimeout(() => {
    if (session.notice === text) void $.ui.status(undefined)
  }, NOTICE_MS)
}

function announceCopy($: EngineInterface, text: string, columns: number): void {
  if (columns >= NARROW_COLUMNS) $.ui.toast(text)
}

function flash($: EngineInterface, scope: string, shown: Flash): void {
  session.flashes.set(scope, shown)
  $.ui.invalidate('ui.render')
  setTimeout(() => {
    if (session.flashes.get(scope) !== shown) return
    session.flashes.delete(scope)
    $.ui.invalidate('ui.render')
  }, NOTICE_MS)
}

async function copied($: EngineInterface, target: Target, press: UiPressArgument): Promise<Copied> {
  try {
    const outcome = await copyText($, target.text, press.surface)
    return { notice: confirmation(outcome, target.what, target.text), flash: flashOf(outcome) }
  } catch (error) {
    $.ui.log(failure(error), { to: 'debug' })
    return { notice: failure(error), flash: flashOf({ ok: false, error: '' }) }
  }
}

function wrappedWarning(): string | undefined {
  return session.interactive && session.settledOnce && !session.reached ? NOT_OUTERMOST : undefined
}

function warnIfWrapped($: EngineInterface): void {
  const warning = wrappedWarning()
  if (warning === undefined || session.warned) return
  session.warned = true
  void $.ui.status(warning)
}

function checkWrappedLater($: EngineInterface): void {
  session.settledOnce = true
  setTimeout(() => warnIfWrapped($), WRAPPED_CHECK_MS)
}

function hintOnce($: EngineInterface, hint: 'firstRun' | 'noFullscreen', text: string): void {
  if (!session.interactive || hinted.has(hint)) return
  hinted.add(hint)
  $.ui.toast(text)
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
  const found = sources && behindAny(sources, selected.text)
  if (found === undefined) return SELECTION_ELSEWHERE
  if ('places' in found) return selectionRepeats(found.places)
  if (found.text === '') return SELECTION_ELSEWHERE
  return confirmation(await copyText($, found.text), 'selection as markdown', found.text)
}

async function copyBlock($: EngineInterface, request: BlockRequest): Promise<string> {
  const all = await refresh($)
  const reply = all[all.length - request.reply]
  if (reply === undefined) return missingReply(all.length)
  const picked: Choice = chooseBlock(await resolve($, reply), request)
  if ('error' in picked) return picked.error
  return confirmation(await copyText($, picked.text), picked.what, picked.text)
}

async function agentReport($: EngineInterface, agentId: string): Promise<string | undefined> {
  const found = await $.session.messages({ agentId })
  return Array.isArray(found) ? handbackReport(found) : undefined
}

async function copyTool($: EngineInterface, request: ToolRequest): Promise<string> {
  const picked = chooseTool(await toolTargets(await $.session.messages(), request.tool, agentId => agentReport($, agentId)), request)
  if ('error' in picked) return picked.error
  return confirmation(await copyText($, picked.text), picked.what, picked.text)
}

async function answer($: EngineInterface, args: string): Promise<string> {
  const request = parse(args)
  if ('error' in request) return request.error
  if (request.kind === 'help') return USAGE
  if (request.kind === 'selection') return copySelection($)
  return request.kind === 'tool' ? copyTool($, request) : copyBlock($, request)
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  return withWarning(await answer($, args), wrappedWarning())
}

function noteFor($: EngineInterface, shared: number[] | undefined): Note | undefined {
  if (shared === undefined) return undefined
  return { label: sharedTailNote(shared), press: () => $.ui.toast(sharedTail(shared)) }
}

function markerFor($: EngineInterface, scope: string, row: Row, tone: Marker['tone'], viewport: RenderViewport | undefined, extra: Pick<Marker, 'partial' | 'note'>): Marker {
  const columns = viewport?.columns ?? 0
  return {
    scope,
    row,
    tone,
    ...extra,
    flash: session.flashes.get(scope),
    press: target => async press => {
      const done = await copied($, target, press)
      flash($, scope, { key: keyOf(target), text: done.flash })
      announceCopy($, done.notice, columns)
    },
    more: hidden => () => announce($, moreTargets(hidden), columns),
  }
}

async function withMarker($: EngineInterface, e: AssistantRender, drawn: RenderElement): Promise<RenderElement> {
  const owned = await ownedReply($, e)
  if (owned === undefined) return drawn
  const resolved = await resolve($, owned.reply)
  const targets = owned.shared ? blockTargets(resolved.blocks) : replyTargets(resolved)
  const note = noteFor($, owned.shared)
  const viewport = e.viewport?.columns ?? 0
  const row = fitRow(targets, viewport - MARKER_ROOM - (note ? note.label.length + 2 : 0))
  if (row.shown.length === 0 && row.hidden.length === 0 && note === undefined) return drawn
  hintOnce($, 'firstRun', FIRST_RUN)
  return replyMarker($.ui.resolve(e), drawn, markerFor($, `ditto-${e.requestId}`, row, await themeTone($), e.viewport, { partial: owned.reply.partial, note }))
}

async function withToolMarker($: EngineInterface, e: ToolRender, drawn: RenderElement): Promise<RenderElement> {
  const found = toolTarget(e.props)
  if (found === undefined) return drawn
  const row = fitRow([found], (e.viewport?.columns ?? 0) - MARKER_ROOM)
  if (row.shown.length === 0) return drawn
  return toolMarker($.ui.resolve(e), drawn, markerFor($, `ditto-tool-${e.requestId}`, row, await themeTone($), e.viewport, { partial: false }))
}

function settled(call: Settled): boolean {
  return !call.isRunning && !call.isErrored && !call.isInterrupted
}

async function withGroupMarker($: EngineInterface, e: GroupRender, drawn: RenderElement): Promise<RenderElement> {
  const row = fitRow(groupTargets(e.props.calls.filter(settled)), (e.viewport?.columns ?? 0) - MARKER_ROOM)
  if (row.shown.length === 0 && row.hidden.length === 0) return drawn
  return toolMarker($.ui.resolve(e), drawn, markerFor($, `ditto-group-${groupScope(e)}`, row, await themeTone($), e.viewport, { partial: false }))
}

function groupScope(e: GroupRender): string {
  return e.requestId ?? e.props.calls.map(call => call.tool_use_id ?? call.tool).join('-')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    freshSession().interactive = e.isInteractive === true
    await $.command.register({ name: COMMAND, description: 'Copy a reply as markdown, one of its blocks, a file, plan or tool output Claude produced, or the markdown behind a selection', argumentHint: ARGUMENT_HINT })
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) session.openTurn()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await settleTurn($, e.isAborted)
    await refresh($)
    checkWrappedLater($)
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
    session.drawnInTurn(e.requestId)
    session.remember(e.requestId, e.props.text)
    if (e.props.isSummary) return drawn
    if (e.viewport?.isFullscreen !== true) {
      hintOnce($, 'noFullscreen', NO_FULLSCREEN)
      return drawn
    }
    try {
      return await withMarker($, e, drawn)
    } catch (error) {
      $.ui.log(failure(error), { to: 'debug' })
      return drawn
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || !settled(e.props)) return drawn
    try {
      return await withToolMarker($, e, drawn)
    } catch (error) {
      $.ui.log(failure(error), { to: 'debug' })
      return drawn
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || e.props.isExpanded || e.props.isActive) return drawn
    try {
      return await withGroupMarker($, e, drawn)
    } catch (error) {
      $.ui.log(failure(error), { to: 'debug' })
      return drawn
    }
  }).catch(($, e, next) => next(e))
}
