import type { EngineInterface, RenderElement, RenderInputOf, RenderViewport, UiPressArgument } from 'claude-code'

import { copyText } from './clipboard'
import { NOTICE_MS, hintOnce } from './hints'
import { agentReport, ownedReply, resolve } from './history'
import type { AssistantRender } from './history'
import { FIRST_RUN, confirmation, failure, flashOf, flashSuffices, callsInGroup, moreCalls, moreTargets, sharedTail, sharedTailNote, toastWidth } from './notices'
import { drawnTone } from './palette'
import { MARKER_ROOM, STRIP_LEAD, headWidth, keyOf, replyMarker, toolMarker } from './row'
import type { Flash, Marker, Note } from './row'
import { session } from './session'
import { GAP, blockTargets, fitRow, overflowLabel, replyTargets, rowWidth } from './targets'
import type { Row, Target } from './targets'
import { groupTargets, launchedInBackground, reportedTarget, toolTarget } from './tools'
import type { ToolCall } from './tools'
import { cellWidth } from './width'

export type ToolRender = RenderInputOf<'ToolUse', 'terminal'>

export type GroupRender = RenderInputOf<'ToolGroup', 'terminal'>

type Settled = Pick<ToolCall, 'tool' | 'input' | 'output'> & { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

type Copied = { notice?: string; flash: string; ok: boolean }

type Overflow = (hidden: Target[], width: number) => string

type MarkerSpec = Pick<Marker, 'scope' | 'row' | 'partial' | 'note' | 'besideLabel' | 'compact'> & { overflow: Overflow; columns: number | undefined }

type Placed = Pick<Marker, 'row' | 'compact'>

const NO_ROW: Row = { shown: [], hidden: [] }

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
    const notice = flashSuffices(outcome) ? undefined : confirmation(outcome, target.what, target.text)
    return { notice, flash: flashOf(outcome), ok: outcome.ok }
  } catch (error) {
    $.ui.log(failure(error), { to: 'debug' })
    return { notice: failure(error), flash: flashOf({ ok: false, error: '' }), ok: false }
  }
}

function noteFor($: EngineInterface, shared: number[] | undefined): Note | undefined {
  if (shared === undefined) return undefined
  return { label: sharedTailNote(shared), press: () => $.ui.toast(sharedTail(shared)) }
}

function noteRoom(note: Note | undefined): number {
  return note === undefined ? 0 : cellWidth(note.label) + GAP
}

async function markerFor($: EngineInterface, spec: MarkerSpec): Promise<Marker> {
  const { overflow, columns, ...shown } = spec
  return {
    ...shown,
    tone: await drawnTone($),
    flash: session.flashes.get(spec.scope),
    press: target => async press => {
      const done = await copied($, target, press)
      flash($, spec.scope, { key: keyOf(target), text: done.flash, ok: done.ok })
      if (done.notice !== undefined) $.ui.toast(done.notice)
    },
    more: hidden => () => $.ui.toast(overflow(hidden, toastWidth(columns))),
  }
}

export function withFlash(targets: Target[], shown: Flash | undefined): Target[] {
  return shown === undefined ? targets : targets.map(t => (keyOf(t) === shown.key ? { ...t, label: shown.text } : t))
}

function flashedRow(targets: Target[], scope: string, columns: number): Row {
  return fitRow(withFlash(targets, session.flashes.get(scope)), columns)
}

function room(viewport: RenderViewport | undefined, note?: Note): number {
  return (viewport?.columns ?? 0) - MARKER_ROOM - noteRoom(note)
}

function stripBeside(targets: Target[], scope: string, beside: number): Row {
  const flashing = flashedRow(targets, scope, beside)
  if (flashing.shown.length > 0) return flashing
  const plain = fitRow(targets, beside)
  if (plain.shown.length > 0) return plain
  return targets.length > 1 && rowWidth([overflowLabel(targets.length)]) <= beside ? plain : NO_ROW
}

function besideHead(targets: Target[], scope: string, viewport: RenderViewport | undefined, drawn: RenderElement): Placed {
  const head = headWidth(drawn)
  const row = head === undefined ? NO_ROW : stripBeside(targets, scope, room(viewport) - STRIP_LEAD - head)
  const compact = empty(row) && targets.length > 0
  return { row: compact ? { shown: [], hidden: targets } : row, compact }
}

function empty(row: Row): boolean {
  return row.shown.length === 0 && row.hidden.length === 0
}

export async function withMarker($: EngineInterface, e: AssistantRender, drawn: RenderElement): Promise<RenderElement> {
  const owned = await ownedReply($, e)
  if (owned === undefined) return drawn
  const resolved = await resolve($, owned.reply)
  const targets = owned.shared ? blockTargets(resolved.blocks) : replyTargets(resolved)
  const note = noteFor($, owned.shared)
  const scope = `ditto-${e.requestId}`
  const row = flashedRow(targets, scope, room(e.viewport, note))
  if (empty(row) && note === undefined) return drawn
  hintOnce($, 'firstRun', FIRST_RUN)
  const spec = { scope, row, partial: owned.reply.partial, besideLabel: false, compact: false, note, overflow: moreTargets, columns: e.viewport?.columns }
  return replyMarker($.ui.resolve(e), drawn, await markerFor($, spec))
}

async function rowTarget($: EngineInterface, call: ToolCall): Promise<Target | undefined> {
  if (!launchedInBackground(call)) return toolTarget(call)
  return reportedTarget(call, await $.session.messages(), agentId => agentReport($, agentId))
}

export async function withToolMarker($: EngineInterface, e: ToolRender, drawn: RenderElement): Promise<RenderElement> {
  const found = await rowTarget($, e.props)
  if (found === undefined) return drawn
  const scope = `ditto-tool-${e.requestId}`
  const placed = besideHead([found], scope, e.viewport, drawn)
  if (empty(placed.row)) return drawn
  const spec = { scope, ...placed, partial: false, besideLabel: true, overflow: moreCalls, columns: e.viewport?.columns }
  return toolMarker($.ui.resolve(e), drawn, await markerFor($, spec))
}

export function settled(call: Settled): boolean {
  return !call.isRunning && !call.isErrored && !call.isInterrupted
}

function groupScope(e: GroupRender): string {
  return e.requestId ?? e.props.calls.map(call => call.tool_use_id ?? call.tool).join('-')
}

function groupCalls(compact: boolean, drawn: RenderElement): Overflow {
  const widenable = headWidth(drawn) !== undefined
  return compact ? (calls, width) => callsInGroup(calls, widenable, width) : moreCalls
}

export async function withGroupMarker($: EngineInterface, e: GroupRender, drawn: RenderElement): Promise<RenderElement> {
  const scope = `ditto-group-${groupScope(e)}`
  const targets = groupTargets(e.props.calls.filter(settled))
  session.rememberGroup(targets)
  const placed = besideHead(targets, scope, e.viewport, drawn)
  if (empty(placed.row)) return drawn
  const spec = { scope, ...placed, partial: false, besideLabel: true, overflow: groupCalls(placed.compact, drawn), columns: e.viewport?.columns }
  return toolMarker($.ui.resolve(e), drawn, await markerFor($, spec))
}
