import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { renderMarkdown } from './blocks'
import { renderPrompt } from './prompt'
import type { Draw } from './runs'
import { renderFailure, renderToolRow, renderWrittenFile } from './tool-rows'
import { ReplyStream } from './live'
import { blocksOf } from './message'
import { drawnTone, forgetTheme, themePalette } from './theme'
import { TASK_STILL_RUNNING, TASK_UNTRACKED, backgroundTaskId, createdContent, describeCall, failureOf, notificationRow, stateOf, stoppedTaskId, summariseGroup, unsuccessfulState } from './tools'
import type { Roots, ToolCall } from './tools'

const DEFAULT_COLUMNS = 100

const STOPPED = 'killed'

const endedTasks = new Map<string, string>()

const launchedTasks = new Set<string>()

const ranCalls = new Set<string>()

const replies = new ReplyStream()

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

async function taskStatusOf($: Pick<EngineInterface, 'agent'>, call: Pick<ToolCall, 'tool' | 'output'>): Promise<string | undefined> {
  const id = backgroundTaskId(call.tool, call.output)
  if (id === undefined) return undefined
  if (call.tool === 'Agent') return (await agentStatusOf($, id)) ?? endedTasks.get(id) ?? TASK_UNTRACKED
  return endedTasks.get(id) ?? (launchedTasks.has(id) ? TASK_STILL_RUNNING : TASK_UNTRACKED)
}

function recordRun(call: { tool_use_id?: string; isRunning: boolean }): void {
  if (call.isRunning && call.tool_use_id !== undefined) ranCalls.add(call.tool_use_id)
}

function hasRun(call: { tool_use_id?: string }): boolean {
  return call.tool_use_id !== undefined && ranCalls.has(call.tool_use_id)
}

function recordLaunch(tool: string, result: unknown): void {
  const id = backgroundTaskId(tool, result)
  if (id !== undefined) launchedTasks.add(id)
}

function recordEnd($: Pick<EngineInterface, 'ui'>, id: string | undefined, status: string | undefined): void {
  if (id === undefined || status === undefined || endedTasks.get(id) === status) return
  endedTasks.set(id, status)
  $.ui.invalidate('ui.render')
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
    const answer = await next(e)
    if ('result' in answer) recordLaunch(e.tool, answer.result)
    return answer
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    recordRun(e.props)
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.isRunning) return next(e)
    const call = { ...e.props, hasRun: hasRun(e.props) }
    if (stateOf(call) === 'done') recordEnd($, stoppedTaskId(call), STOPPED)
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
    calls.forEach(recordRun)
    if (e.surface !== 'terminal' || isExpanded || isActive || calls.length === 0) return next(e)
    const tracked = await Promise.all(calls.map(async call => ({ ...call, hasRun: hasRun(call), taskStatus: await taskStatusOf($, call) })))
    if (isCallsOnly !== true && unsuccessfulState(tracked) === undefined) return next(e)
    const { row, state } = summariseGroup(tracked, await rootsOf($))
    return renderToolRow({ kit: $.ui.resolve(e), palette: await themePalette($) }, row, state, e.viewport?.columns ?? DEFAULT_COLUMNS)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    recordEnd($, e.props.task?.id, e.props.task?.status)
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
