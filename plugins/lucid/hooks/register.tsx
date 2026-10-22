import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { renderMarkdown } from './blocks'
import { renderPrompt } from './prompt'
import type { Draw } from './runs'
import { renderFailure, renderToolRow, renderWrittenFile } from './tool-rows'
import { ReplyStream } from './live'
import { CallLedger } from './permits'
import { blocksOf } from './message'
import { drawnTone, forgetTheme, themePalette } from './theme'
import { TASK_STILL_RUNNING, TASK_UNTRACKED, backgroundTaskId, callEnd, createdContent, describeCall, failureOf, isInterimNotice, notificationRow, stateOf, stoppedTaskId, summariseGroup, unsuccessfulState } from './tools'
import type { CallEnd, Roots, ToolCall } from './tools'

const DEFAULT_COLUMNS = 100

const STOPPED = 'killed'

const replies = new ReplyStream()

const ledger = new CallLedger()

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

export const register: Register = on => {
  on('engine.create', async (_$, e, next) => {
    forgetTheme()
    return {
      ...(await next(e)),
      lucid: { blocks: ({ text, requestId }) => blocksOf(text, { streaming: requestId !== undefined && replies.isStreaming(requestId) }), tone: drawnTone },
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) replies.turnStarted()
    return next(e)
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined) {
      replies.stored(e.uuid)
      $.ui.invalidate('ui.render')
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const draw = { kit: $.ui.resolve(e), palette: await themePalette($) }
    const message = renderMarkdown(draw, e.props.text, e.viewport?.columns ?? DEFAULT_COLUMNS, replies.isStreaming(e.requestId))
    return e.props.isSummary ? markSummary(draw, message) : message
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    ledger.started(e.tool_use_id, e.agentId)
    try {
      const answer = await next(e)
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
    const fate = await fateOf($, e.props)
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.isRunning) return next(e)
    const call = { ...e.props, ...fate }
    if (stateOf(call) === 'done') await recordEnd($, stoppedTaskId(call), STOPPED)
    const taskStatus = await taskStatusOf($, call)
    const row = describeCall(call, await rootsOf($), taskStatus)
    return renderToolRow({ kit: $.ui.resolve(e), palette: await themePalette($) }, row, stateOf(call, taskStatus), e.viewport?.columns ?? DEFAULT_COLUMNS)
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
    const fates = await Promise.all(calls.map(call => fateOf($, call)))
    if (e.surface !== 'terminal' || isExpanded || isActive || calls.length === 0) return next(e)
    const tracked = await Promise.all(calls.map(async (call, index) => ({ ...call, ...fates[index], taskStatus: await taskStatusOf($, call) })))
    if (isCallsOnly !== true && unsuccessfulState(tracked) === undefined) return next(e)
    const { row, state } = summariseGroup(tracked, await rootsOf($))
    return renderToolRow({ kit: $.ui.resolve(e), palette: await themePalette($) }, row, state, e.viewport?.columns ?? DEFAULT_COLUMNS)
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
    if (e.agentId === undefined) replies.turnEnded()
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
