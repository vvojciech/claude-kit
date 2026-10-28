import type { CommandRunInput, EngineInterface, RenderSurface } from 'claude-code'

import { commandSurface, copyText } from './clipboard'
import { USAGE, chooseBlock, chooseGroupCall, chooseNamedCall, chooseTool, missingReply, parse } from './commands'
import type { Choice } from './commands'
import type { BlockRequest, CallRequest, ToolRequest } from './commands'
import { wrappedWarning } from './hints'
import { agentReport, refresh, resolve } from './history'
import { NO_SELECTION, SELECTION_ELSEWHERE, confirmation, selectionRepeats, withWarning } from './notices'
import { replyText } from './replies'
import { behindAny } from './selection'
import { session } from './session'
import { toolTargets } from './tools'
import type { Reply } from '../types'

type CommandRun = Pick<CommandRunInput, 'args' | 'origin'>

type Surface = RenderSurface | undefined

function selectionSources(requestId: string | undefined, all: Reply[]): string[] | undefined {
  if (requestId !== undefined) {
    const row = session.drawn.get(requestId)
    return row === undefined ? undefined : [row]
  }
  const rows = [...session.drawn.values()].reverse()
  return [...rows, ...all.map(replyText).reverse()]
}

async function copySelection($: EngineInterface, surface: Surface): Promise<string> {
  const selected = await $.ui.selection()
  if (selected === undefined || selected.text.trim() === '') return NO_SELECTION
  const sources = selectionSources(selected.requestId, await refresh($))
  const found = sources && behindAny(sources, selected.text)
  if (found === undefined) return SELECTION_ELSEWHERE
  if ('places' in found) return selectionRepeats(found.places)
  return confirmation(await copyText($, found.text, surface), 'selection as markdown', found.text)
}

async function copyBlock($: EngineInterface, request: BlockRequest, surface: Surface): Promise<string> {
  const all = await refresh($)
  const reply = all[all.length - request.reply]
  const named = () => (request.name === '' ? Promise.resolve(undefined) : namedCall($, request))
  const block = reply === undefined ? { error: missingReply(all.length) } : chooseBlock(await resolve($, reply), request)
  const picked = 'error' in block ? ((await named()) ?? block) : block
  if ('error' in picked) return picked.error
  return confirmation(await copyText($, picked.text, surface), picked.what, picked.text)
}

async function namedCall($: EngineInterface, request: BlockRequest): Promise<Choice | undefined> {
  if (request.reply !== 1) return undefined
  const messages = await $.session.messages()
  const lookup = (agentId: string) => agentReport($, agentId)
  const [files, outputs] = await Promise.all([toolTargets(messages, 'file', lookup), toolTargets(messages, 'output', lookup)])
  return chooseNamedCall([...files, ...outputs], request.name)
}

async function copyTool($: EngineInterface, request: ToolRequest, surface: Surface): Promise<string> {
  const targets = await toolTargets(await $.session.messages(), request.tool, agentId => agentReport($, agentId))
  const picked = chooseTool(targets, request)
  if ('error' in picked) return picked.error
  return confirmation(await copyText($, picked.text, surface), picked.what, picked.text)
}

async function copyGroupCall($: EngineInterface, request: CallRequest, surface: Surface): Promise<string> {
  const order = (await $.session.messages()).flatMap(message => message.toolUses.map(use => use.tool_use_id))
  const picked = chooseGroupCall([...session.groupCalls.values()], order, request.name)
  if ('error' in picked) return picked.error
  return confirmation(await copyText($, picked.text, surface), picked.what, picked.text)
}

async function answer($: EngineInterface, args: string, surface: Surface): Promise<string> {
  const request = parse(args)
  if ('error' in request) return request.error
  if (request.kind === 'help') return USAGE
  if (request.kind === 'selection') return copySelection($, surface)
  if (request.kind === 'call') return copyGroupCall($, request, surface)
  return request.kind === 'tool' ? copyTool($, request, surface) : copyBlock($, request, surface)
}

export async function runCommand($: EngineInterface, e: CommandRun): Promise<string> {
  return withWarning(await answer($, e.args, commandSurface(e.origin)), wrappedWarning())
}
