import type { EngineInterface, RenderElement, RenderInputOf, RenderViewport, SessionMessage, UiPressArgument } from 'claude-code'

import { copyText } from './clipboard'
import { NOTICE_MS, hintOnce } from './hints'
import { agentReport, ownedReply, replyNumber, resolve } from './history'
import type { AssistantRender } from './history'
import { holdsCall, holdsText, menuCap, fitMenu, menuRows, menuWidth, opening, rowsBefore, wrappedRows } from './menu'
import { FIRST_RUN, LONGEST_FLASH, confirmation, failure, flashOf, flashSuffices, callsInGroup, moreTargets, sharedTail, sharedTailNote, toastWidth } from './notices'
import { drawnTone } from './palette'
import { headerRow, keyOf, menuLabels, replyMarker, toolMarker } from './row'
import type { Flash, Marker, Note } from './row'
import { session } from './session'
import { blockTargets, replyTargets } from './targets'
import type { Target } from './targets'
import { AGENT_TOOLS, groupTargets, launchedInBackground, reportedCalls, reportedTarget, toolTarget } from './tools'
import type { ToolCall } from './tools'

type ToolRender = RenderInputOf<'ToolUse', 'terminal'>

type GroupRender = RenderInputOf<'ToolGroup', 'terminal'>

type Settled = Pick<ToolCall, 'tool' | 'input' | 'output'> & { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

type Copied = { notice?: string; flash: string; ok: boolean }

type Overflow = (hidden: Target[], width: number) => string | Promise<string>

type MarkerSpec = Pick<Marker, 'scope' | 'row' | 'partial' | 'note' | 'flashOnGlyph' | 'opening' | 'width'> & { overflow: Overflow; columns: number | undefined }

type Placed = Pick<Marker, 'row' | 'opening' | 'width'>

type Menu = { targets: Target[]; scope: string; partial: boolean; note?: Note; above: number; viewport: RenderViewport | undefined }

const PANE_EDGE = 2

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
    more: hidden => async () => $.ui.toast(await overflow(hidden, toastWidth(columns))),
  }
}

function withFlash(targets: Target[], shown: Flash | undefined): Target[] {
  return shown === undefined ? targets : targets.map(t => (keyOf(t) === shown.key ? { ...t, label: shown.text } : t))
}

function placed(menu: Menu): Placed {
  const { partial, note, above, viewport } = menu
  const extras = (partial ? 1 : 0) + (note === undefined ? 0 : 1)
  const row = fitMenu(withFlash(menu.targets, session.flashes.get(menu.scope)), menuCap(above, viewport?.rows ?? 0), extras)
  const width = menuWidth([...menuLabels({ row, partial, note }), LONGEST_FLASH], (viewport?.columns ?? 0) - PANE_EDGE)
  return { row, opening: opening(menuRows(row, extras), above), width }
}

async function transcript($: EngineInterface): Promise<SessionMessage[]> {
  const found = await $.session.messages()
  return Array.isArray(found) ? found : []
}

async function replyRoom($: EngineInterface, e: AssistantRender): Promise<number> {
  const columns = e.viewport?.columns ?? 0
  return wrappedRows(e.props.text, columns) + rowsBefore(await transcript($), holdsText(e.props.text), columns)
}

async function toolRoom($: EngineInterface, ids: (string | undefined)[], drawn: RenderElement, columns: number | undefined): Promise<number> {
  return headerRow(drawn) + rowsBefore(await transcript($), holdsCall(ids), columns ?? 0)
}

export async function withMarker($: EngineInterface, e: AssistantRender, drawn: RenderElement): Promise<RenderElement> {
  const owned = await ownedReply($, e)
  if (owned === undefined) return drawn
  const resolved = await resolve($, owned.reply)
  const targets = owned.shared ? blockTargets(resolved.blocks) : replyTargets(resolved)
  const note = noteFor($, owned.shared)
  const scope = `copy-that-${e.requestId}`
  if (targets.length === 0 && note === undefined) return drawn
  hintOnce($, 'firstRun', FIRST_RUN)
  const partial = owned.reply.partial
  const menu = placed({ targets, scope, partial, note, above: await replyRoom($, e), viewport: e.viewport })
  const overflow = async (hidden: Target[]) => moreTargets(hidden, owned.shared ? undefined : await replyNumber($, owned.reply))
  const spec = { scope, ...menu, partial, flashOnGlyph: false, note, overflow, columns: e.viewport?.columns }
  return replyMarker($.ui.resolve(e), drawn, await markerFor($, spec))
}

async function rowTarget($: EngineInterface, call: ToolCall): Promise<Target | undefined> {
  const direct = launchedInBackground(call) ? undefined : toolTarget(call)
  if (direct !== undefined || !AGENT_TOOLS.has(call.tool)) return direct
  return reportedTarget(call, await $.session.messages(), agentId => agentReport($, agentId))
}

export async function withToolMarker($: EngineInterface, e: ToolRender, drawn: RenderElement): Promise<RenderElement> {
  const found = await rowTarget($, e.props)
  if (found === undefined) return drawn
  const scope = `copy-that-tool-${e.requestId}`
  const above = await toolRoom($, [e.props.tool_use_id], drawn, e.viewport?.columns)
  const menu = placed({ targets: [found], scope, partial: false, above, viewport: e.viewport })
  const spec = { scope, ...menu, partial: false, flashOnGlyph: true, overflow: callsInGroup, columns: e.viewport?.columns }
  return toolMarker($.ui.resolve(e), drawn, await markerFor($, spec))
}

export function settled(call: Settled): boolean {
  return !call.isRunning && !call.isErrored && !call.isInterrupted
}

function groupScope(e: GroupRender): string {
  return e.requestId ?? e.props.calls.map(call => call.tool_use_id ?? call.tool).join('-')
}

export async function withGroupMarker($: EngineInterface, e: GroupRender, drawn: RenderElement): Promise<RenderElement> {
  const scope = `copy-that-group-${groupScope(e)}`
  const calls = await reportedCalls(e.props.calls.filter(settled), () => $.session.messages(), agentId => agentReport($, agentId))
  const targets = groupTargets(calls)
  session.rememberGroup(targets)
  if (targets.length === 0) return drawn
  const above = await toolRoom($, e.props.calls.map(call => call.tool_use_id), drawn, e.viewport?.columns)
  const menu = placed({ targets, scope, partial: false, above, viewport: e.viewport })
  const spec = { scope, ...menu, partial: false, flashOnGlyph: true, overflow: callsInGroup, columns: e.viewport?.columns }
  return toolMarker($.ui.resolve(e), drawn, await markerFor($, spec))
}
