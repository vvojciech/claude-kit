import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { runCommand } from './answer'
import { ARGUMENT_HINT } from './commands'
import { checkWrappedLater, hintOnce } from './hints'
import { forget, markLive, refresh, settleTurn } from './history'
import { settled, withGroupMarker, withMarker, withToolMarker } from './markers'
import { NO_FULLSCREEN, failure } from './notices'
import { forgetTone } from './palette'
import { freshSession, session } from './session'
import { writtenText } from './turns'

const COMMAND = 'copy-that'

const DESCRIPTION = [
  'Copy a reply as markdown, one of its blocks,',
  'a file, plan or tool output Claude produced, or the markdown behind a selection',
].join(' ')

async function drawnOr($: EngineInterface, drawn: RenderElement, mark: () => Promise<RenderElement>): Promise<RenderElement> {
  try {
    return await mark()
  } catch (error) {
    $.ui.log(failure(error), { to: 'debug' })
    return drawn
  }
}

function timedOut(args: string): string {
  return `Copy failed: ${args === '' ? 'the reply' : `"${args}"`} could not be copied in time`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    freshSession().interactive = e.isInteractive === true
    await $.command.register({ name: COMMAND, description: DESCRIPTION, argumentHint: ARGUMENT_HINT })
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
  }).catch((_$, e, next) => next(e))

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined || stored.uuid === undefined) return stored
    session.turn.push({ uuid: stored.uuid, text: writtenText(stored.message.content) })
    await markLive($)
    return stored
  }).catch((_$, e, next) => next(e))

  on('turn.start', async (_$, e, next) => {
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
      return { text: await runCommand($, e) }
    } catch (error) {
      $.ui.log(failure(error), { to: 'debug' })
      return { text: failure(error) }
    }
  }).catch((_$, e) => ({ text: timedOut(e.args) }))

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
    return drawnOr($, drawn, () => withMarker($, e, drawn))
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || !settled(e.props)) return drawn
    return drawnOr($, drawn, () => withToolMarker($, e, drawn))
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const drawn = await next(e)
    const folded = !e.props.isExpanded && !e.props.isActive
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true || !folded) return drawn
    return drawnOr($, drawn, () => withGroupMarker($, e, drawn))
  }).catch((_$, e, next) => next(e))
}
