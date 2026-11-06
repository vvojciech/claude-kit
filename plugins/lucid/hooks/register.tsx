import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { renderMarkdown } from './blocks'
import { renderPrompt } from './prompt'
import type { Draw } from './runs'
import { emptyTally, renderLap } from './laps'
import type { LapTally } from './laps'
import { changeOf } from './changes'
import { SETTLE_FLASH_MS, renderFailure, renderToolRow, renderWrittenFile } from './tool-rows'
import { ReplyStream } from './live'
import { CallLedger } from './permits'
import { blocksOf, parseBlocks } from './message'
import { imageSources, picturesOf, thumbnail } from './pictures'
import type { Pictures } from './pictures'
import { drawnTone, forgetTheme, themePalette } from './theme'
import { TASK_STILL_RUNNING, TASK_UNTRACKED, backgroundTaskId, callEnd, createdContent, describeCall, failureOf, isInterimNotice, notificationRow, stateOf, stoppedTaskId, summariseGroup, unsuccessfulState } from './tools'
import type { CallEnd, Roots, ToolCall } from './tools'

const DEFAULT_COLUMNS = 100

const STOPPED = 'killed'

const replies = new ReplyStream()

const ledger = new CallLedger()

let lastReply: string | undefined

let lastTurn: { at: number; durationMs: number; tally: LapTally } | undefined

let turnTally: LapTally = emptyTally()

const turnFiles = new Set<string>()

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

function tallyCall(tool: string, input: Record<string, unknown>, answer: { result?: unknown; isError?: boolean }): void {
  const failed = stateOf({ tool, output: answer.result, isErrored: answer.isError === true, isRunning: false, isInterrupted: false }) === 'failed'
  if (failed) turnTally.failed += 1
  if (tool === 'Bash') turnTally.commands += 1
  if (tool === 'Read' && answer.isError !== true) turnTally.reads += 1
  if (!EDIT_TOOLS.has(tool) || answer.isError === true) return
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined
  if (path !== undefined) turnFiles.add(path)
  const change = changeOf(tool, answer.result)
  turnTally = { ...turnTally, files: turnFiles.size, added: turnTally.added + (change?.added ?? 0), removed: turnTally.removed + (change?.removed ?? 0) }
}

async function lapOf($: Pick<EngineInterface, 'clock'>, durationMs: number): Promise<{ at: number; tally: LapTally } | undefined> {
  const now = await $.clock.now()
  if (lastTurn === undefined || now - lastTurn.at > LAP_STAMP_WINDOW_MS) return undefined
  return Math.abs(lastTurn.durationMs - durationMs) <= LAP_MATCH_MS ? lastTurn : undefined
}

type Block = { type: string }

function replyAfter(previous: string | undefined, uuid: string, content: ReadonlyArray<Block>): string | undefined {
  if (content.some(block => block.type === 'tool_use')) return undefined
  return content.some(block => block.type === 'text') ? uuid : previous
}

async function endsTurn($: Tracker, id: string): Promise<boolean> {
  return (await $.state.get({ plugin: 'lucid', key: 'turnEnders', id })).value === true
}

async function markTurnEnder($: Tracker, id: string | undefined): Promise<void> {
  if (id !== undefined) await $.state.set({ plugin: 'lucid', key: 'turnEnders', id }, true)
}

function markSummary({ kit, palette }: Draw, message: RenderElement): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column">
      {message}
      <Text color={palette.muted}>· summary</Text>
    </Box>
  )
}

async function rootsOf($: Pick<EngineInterface, 'session' | 'env'>): Promise<Roots> {
  const home = await $.env.get('HOME').catch(() => undefined)
  return { cwd: await $.session.cwd(), home }
}

async function agentStatusOf($: Pick<EngineInterface, 'agent'>, id: string): Promise<string | undefined> {
  const agents = await $.agent.list().catch(() => [])
  return agents.find(agent => agent.id === id)?.status
}

type Tracker = Pick<EngineInterface, 'state' | 'clock'>

async function endOf($: Tracker, id: string): Promise<string | undefined> {
  return (await $.state.get({ plugin: 'lucid', key: 'endedTasks', id })).value
}

async function wasLaunched($: Tracker, id: string): Promise<boolean> {
  return (await $.state.get({ plugin: 'lucid', key: 'launchedTasks', id })).value === true
}

async function taskStatusOf($: Tracker & Pick<EngineInterface, 'agent'>, call: Pick<ToolCall, 'tool' | 'output'>): Promise<string | undefined> {
  const id = backgroundTaskId(call.tool, call.output)
  if (id === undefined) return undefined
  if (call.tool === 'Agent') return (await agentStatusOf($, id)) ?? (await endOf($, id)) ?? TASK_UNTRACKED
  return (await endOf($, id)) ?? ((await wasLaunched($, id)) ? TASK_STILL_RUNNING : TASK_UNTRACKED)
}

async function hasRun($: Tracker, id: string | undefined): Promise<boolean> {
  return id !== undefined && (await $.state.get({ plugin: 'lucid', key: 'ranCalls', id })).value === true
}

async function wasRefused($: Tracker, id: string | undefined): Promise<boolean> {
  return id !== undefined && (await $.state.get({ plugin: 'lucid', key: 'refusedCalls', id })).value === true
}

const SETTLING_STATES = new Set(['done', 'failed'])

const LAP_STAMP_WINDOW_MS = 5000

const LAP_MATCH_MS = 1500

const settleScheduled = new Set<string>()

function parsedTally(text: string | undefined): LapTally | undefined {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as LapTally
  } catch {
    return undefined
  }
}

async function markLive($: Tracker, id: string | undefined): Promise<void> {
  if (id === undefined || (await $.state.get({ plugin: 'lucid', key: 'liveCalls', id })).value === true) return
  $.clock.after(0, () => quietly($.state.set({ plugin: 'lucid', key: 'liveCalls', id }, true)))
}

async function isSettling($: Tracker, id: string | undefined, state: string): Promise<boolean> {
  if (id === undefined || !SETTLING_STATES.has(state)) return false
  if ((await $.state.get({ plugin: 'lucid', key: 'liveCalls', id })).value !== true) return false
  if ((await $.state.get({ plugin: 'lucid', key: 'settledCalls', id })).value === true) return false
  if (!settleScheduled.has(id)) {
    settleScheduled.add(id)
    $.clock.after(SETTLE_FLASH_MS * 2, () => {
      settleScheduled.delete(id)
      quietly($.state.set({ plugin: 'lucid', key: 'settledCalls', id }, true))
    })
  }
  return true
}

async function fateOf($: Tracker, call: { tool_use_id?: string }): Promise<{ hasRun: boolean; refused: boolean }> {
  return { hasRun: await hasRun($, call.tool_use_id), refused: await wasRefused($, call.tool_use_id) }
}

async function observing(bookkeeping: () => Promise<void>): Promise<void> {
  await bookkeeping().catch(() => undefined)
}

function quietly(write: Promise<unknown>): void {
  write.catch(() => undefined)
}

async function markAllRun($: Tracker, ids: ReadonlyArray<string>): Promise<void> {
  for (const id of ids) {
    if (!(await hasRun($, id))) $.clock.after(0, () => quietly($.state.set({ plugin: 'lucid', key: 'ranCalls', id }, true)))
  }
}

async function markRefused($: Tracker, id: string | undefined): Promise<void> {
  if (id !== undefined && !(await wasRefused($, id))) $.clock.after(0, () => quietly($.state.set({ plugin: 'lucid', key: 'refusedCalls', id }, true)))
}

async function recordEnding($: Tracker, id: string | undefined, ending: CallEnd | undefined): Promise<void> {
  if (ending === 'ran' && id !== undefined) await markAllRun($, [id])
  if (ending === 'declined') await markRefused($, id)
}

async function recordLaunch($: Tracker, tool: string, result: unknown): Promise<void> {
  const id = backgroundTaskId(tool, result)
  if (id !== undefined) await $.state.set({ plugin: 'lucid', key: 'launchedTasks', id }, true)
}

async function recordEnd($: Tracker, id: string | undefined, status: string | undefined): Promise<void> {
  if (id === undefined || status === undefined || (await endOf($, id)) === status) return
  $.clock.after(0, () => quietly($.state.set({ plugin: 'lucid', key: 'endedTasks', id }, status)))
}

async function opened($: EngineInterface, path: string): Promise<void> {
  await $.peek.open({ path }).catch(() => undefined)
}

export const register: Register = on => {
  on('engine.create', async (_$, e, next) => {
    forgetTheme()
    return {
      ...(await next(e)),
      lucid: { blocks: ({ text, requestId }) => blocksOf(text, { streaming: requestId !== undefined && replies.isStreaming(requestId) }), tone: drawnTone },
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      replies.turnStarted()
      lastReply = undefined
      turnTally = emptyTally()
      turnFiles.clear()
    }
    return next(e)
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined) {
      replies.stored(e.uuid)
      lastReply = replyAfter(lastReply, e.uuid, e.message.content)
      $.ui.invalidate('ui.render')
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const kit = $.ui.resolve(e)
    const draw = { kit, palette: await themePalette($) }
    const columns = e.viewport?.columns ?? DEFAULT_COLUMNS
    const streaming = replies.isStreaming(e.requestId)
    const sources = imageSources(parseBlocks(e.props.text, { streaming }))
    const found = sources.length === 0 ? new Map() : await picturesOf($, sources, { requestId: e.requestId, columns, isFullscreen: e.viewport?.isFullscreen })
    const pictures: Pictures = { found, node: (picture, key) => thumbnail(kit, draw.palette, picture, key, () => void opened($, picture.path)) }
    const asking = !streaming && !e.props.isSummary && (await endsTurn($, e.requestId).catch(() => false))
    const message = renderMarkdown(draw, e.props.text, columns, streaming, pictures, asking)
    return e.props.isSummary ? markSummary(draw, message) : message
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    ledger.started(e.tool_use_id, e.agentId)
    try {
      const answer = await next(e)
      if ('result' in answer && e.agentId === undefined) {
        try {
          tallyCall(e.tool, e as unknown as Record<string, unknown>, answer)
        } catch {}
      }
      if ('result' in answer) {
        await observing(() => recordLaunch($, e.tool, answer.result))
        await observing(() => recordEnding($, e.tool_use_id, callEnd(answer)))
      }
      return answer
    } finally {
      ledger.settled(e.tool_use_id)
    }
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    await observing(() => markAllRun($, ledger.decided(e.tool_use_id, verdict.decision)))
    if (verdict.decision === 'deny') await observing(() => markRefused($, e.tool_use_id))
    return verdict
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    await observing(() => markRefused($, e.tool_use_id))
    return next(e)
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    await markAllRun($, ledger.sharingProgress(e.props.tool_use_id))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isRunning) await observing(() => markLive($, e.props.tool_use_id))
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.isRunning) return next(e)
    const fate = await fateOf($, e.props)
    const call = { ...e.props, ...fate }
    if (stateOf(call) === 'done') await recordEnd($, stoppedTaskId(call), STOPPED)
    const taskStatus = await taskStatusOf($, call)
    const row = describeCall(call, await rootsOf($), taskStatus)
    const state = stateOf(call, taskStatus)
    const settling = await isSettling($, e.props.tool_use_id, state)
    return renderToolRow({ kit: $.ui.resolve(e), palette: await themePalette($) }, row, state, e.viewport?.columns ?? DEFAULT_COLUMNS, { settling })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) return next(e)
    const failure = e.props.isErrored ? failureOf(e.props.output) : undefined
    const content = e.props.isErrored ? undefined : createdContent(e.props.tool, e.props.output)
    if (failure !== undefined) return renderFailure({ kit: $.ui.resolve(e), palette: await themePalette($) }, failure)
    if (content !== undefined) return renderWrittenFile({ kit: $.ui.resolve(e), palette: await themePalette($) }, content)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { calls, isActive, isCallsOnly, isExpanded } = e.props
    if (isActive) await observing(() => markLive($, e.requestId))
    if (e.surface !== 'terminal' || isExpanded || isActive || calls.length === 0) return next(e)
    const fates = await Promise.all(calls.map(call => fateOf($, call)))
    const tracked = await Promise.all(calls.map(async (call, index) => ({ ...call, ...fates[index], taskStatus: await taskStatusOf($, call) })))
    if (isCallsOnly !== true && unsuccessfulState(tracked) === undefined) return next(e)
    const { row, state } = summariseGroup(tracked, await rootsOf($))
    const settling = await isSettling($, e.requestId, state)
    return renderToolRow({ kit: $.ui.resolve(e), palette: await themePalette($) }, row, state, e.viewport?.columns ?? DEFAULT_COLUMNS, { settling })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.waitingFor !== undefined) return next(e)
    const stored = (await $.state.get({ plugin: 'lucid', key: 'lapEnds', id: e.requestId })).value
    const storedTally = (await $.state.get({ plugin: 'lucid', key: 'lapTallies', id: e.requestId })).value
    const lap = stored === undefined ? await lapOf($, e.props.durationMs) : undefined
    if (lap !== undefined) {
      $.clock.after(0, () => quietly($.state.set({ plugin: 'lucid', key: 'lapEnds', id: e.requestId }, lap.at)))
      $.clock.after(0, () => quietly($.state.set({ plugin: 'lucid', key: 'lapTallies', id: e.requestId }, JSON.stringify(lap.tally))))
    }
    const endedAt = stored ?? lap?.at
    const tally = lap?.tally ?? parsedTally(storedTally)
    return renderLap({ kit: $.ui.resolve(e), palette: await themePalette($) }, e.props.word, e.props.durationMs, endedAt, e.viewport?.columns ?? DEFAULT_COLUMNS, tally)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!isInterimNotice(e.props.text)) await recordEnd($, e.props.task?.id, e.props.task?.status)
    if (e.surface !== 'terminal') return next(e)
    const notice = e.props.task !== undefined && !e.props.isExpanded ? notificationRow(e.props.text, e.props.task) : undefined
    if (notice !== undefined) return renderToolRow({ kit: $.ui.resolve(e), palette: await themePalette($) }, notice.row, notice.state, e.viewport?.columns ?? DEFAULT_COLUMNS)
    if (e.props.origin.kind !== 'composer') return next(e)
    return renderPrompt({ kit: $.ui.resolve(e), palette: await themePalette($) }, e.props.text, e.viewport?.columns ?? DEFAULT_COLUMNS)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now().catch(() => undefined)
      if (at !== undefined) lastTurn = { at, durationMs: e.durationMs, tally: { ...turnTally } }
      replies.turnEnded()
      if (e.reason === 'answer') await observing(() => markTurnEnder($, lastReply))
      lastReply = undefined
    }
    $.ui.invalidate('ui.render')
    return result
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    forgetTheme()
    $.ui.invalidate('ui.render')
    return result
  })
}
