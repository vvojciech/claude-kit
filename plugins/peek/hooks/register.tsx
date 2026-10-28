import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { UNRESOLVED, openFor, pictureFor, replyImageKey } from './api'
import { probe, settleCapability } from './capability'
import { ARGUMENT_HINT, COMMAND, DESCRIPTION, parseCommand, runPeek } from './commands'
import { imageKeysIn, itemsFor, maxColumnsFor, picturesFor, withThumbs } from './draws'
import type { Frame, Wanted } from './draws'
import { BAND_ROWS, THUMB_ROWS, bandColumns, bandCount } from './fit'
import { hostOf } from './host'
import { barePaths, imageTags, localImages, resolvePath, toolImagePaths } from './paths'
import type { Places } from './places'
import { pastedImage, placesOf } from './places'
import { band } from './view'
import type { Kit } from './view'

const draft = atom({ plugin: 'peek', key: 'draft' } as const, { text: '' })

let places: Promise<Places> | undefined

function placesFor($: EngineInterface): Promise<Places> {
  places ??= $.session.cwd().then(cwd => placesOf($, hostOf($), cwd))
  return places
}

type Viewed = { requestId: string; viewport?: { columns?: number; isFullscreen?: boolean } }

async function frameOf($: EngineInterface, e: Viewed, kit: Kit, maxRows: number): Promise<Frame> {
  const pictures = picturesFor(e.viewport?.isFullscreen)
  return { host: hostOf($), places: await placesFor($), kit, requestId: e.requestId, pictures, maxColumns: maxColumnsFor(e.viewport?.columns), maxRows }
}

function settledTool(props: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }): boolean {
  return !props.isRunning && !props.isErrored && !props.isInterrupted
}

function wantedPaths(paths: string[], where: Places, prefix: string): Wanted[] {
  return paths.map((path, i) => ({ id: `${prefix}-${i}`, path: resolvePath(path, where.cwd, where.home) }))
}

async function pastedWanted($: EngineInterface, where: Places, text: string): Promise<Wanted[]> {
  const host = hostOf($)
  const found = await Promise.all(imageTags(text).map(async n => ({ n, path: await pastedImage(host, where, n) })))
  return found.flatMap(({ n, path }) => (path === undefined ? [] : [{ id: `pasted-${n}`, path, name: `Image #${n}` }]))
}

async function draftWanted($: EngineInterface, where: Places, text: string): Promise<Wanted[]> {
  const bare = wantedPaths(barePaths(text), where, 'bare').map(w => ({ ...w, clip: true }))
  return [...(await pastedWanted($, where, text)), ...bare]
}

async function syncDraft($: EngineInterface, text: string): Promise<void> {
  if ((await read($, draft)).text !== text) await update($, draft, () => ({ text }))
}

function keep($: EngineInterface, drawn: RenderElement, error: unknown): RenderElement {
  $.ui.log(`peek: ${String(error)}`, { to: 'debug' })
  return drawn
}

export const register: Register = on => {
  on('engine.create', async (_$, e, next) => ({
    ...(await next(e)),
    peek: { picture: async () => UNRESOLVED, open: async () => ({ error: 'peek is not ready' }) },
  }))

  on('peek.picture', async ($, e) => {
    const picture = await pictureFor(hostOf($), e, await placesFor($))
    if ('key' in picture && e.requestId !== undefined) probe($, e.requestId, picture.key, picture.source)
    return { value: picture }
  }).catch(() => ({ value: UNRESOLVED }))

  on('peek.open', async ($, e) => {
    const opened = await openFor(hostOf($), e, await placesFor($))
    if (opened.error !== undefined) $.ui.toast(opened.error)
    return { value: opened }
  }).catch(() => ({ value: { error: 'peek could not open the image' } }))

  on('session.start', async ($, e, next) => {
    places = undefined
    await settleCapability($)
    await $.command.register({ name: COMMAND, description: DESCRIPTION, argumentHint: ARGUMENT_HINT })
    void placesFor($)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const parsed = parseCommand(e.args)
    const outcome = await runPeek(hostOf($), await placesFor($), parsed)
    if (parsed.kind === 'help') return { text: outcome.text }
    $.ui.toast(outcome.text)
    return outcome.ok ? {} : { text: outcome.text }
  }).catch((_$, e) => ({ text: `peek could not finish "${e.args}"` }))

  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    await syncDraft($, e.text)
    return result
  })

  on('prompt.edit', async ($, e, next) => {
    const result = await next(e)
    await syncDraft($, result.text)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, draft, () => ({ text: '' }))
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || !settledTool(e.props)) return drawn
    const paths = toolImagePaths(e.props.tool, e.props.input)
    if (paths.length === 0) return drawn
    const frame = await frameOf($, e, $.ui.resolve(e), THUMB_ROWS)
    return withThumbs($, frame, drawn, wantedPaths(paths, frame.places, 'tool')).catch(error => keep($, drawn, error))
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.isActive) return drawn
    const paths = e.props.calls.filter(settledTool).flatMap(call => toolImagePaths(call.tool, call.input))
    if (paths.length === 0) return drawn
    const frame = await frameOf($, e, $.ui.resolve(e), THUMB_ROWS)
    return withThumbs($, frame, drawn, wantedPaths([...new Set(paths)], frame.places, 'group')).catch(error => keep($, drawn, error))
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || e.props.isSummary) return drawn
    const links = localImages(e.props.text)
    if (links.length === 0) return drawn
    const frame = await frameOf($, e, $.ui.resolve(e), THUMB_ROWS)
    const inPlace = imageKeysIn(drawn)
    const wanted = wantedPaths(links.map(l => l.src), frame.places, 'reply').filter(w => !inPlace.has(replyImageKey(w.path)))
    return withThumbs($, frame, drawn, wanted).catch(error => keep($, drawn, error))
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.surface !== 'terminal' || imageTags(e.props.text).length === 0) return drawn
    const frame = await frameOf($, e, $.ui.resolve(e), THUMB_ROWS)
    return withThumbs($, frame, drawn, await pastedWanted($, frame.places, e.props.text)).catch(error => keep($, drawn, error))
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal' || e.props.hasSurvey) return below
    const { text } = await read($, draft)
    if (imageTags(text).length === 0 && barePaths(text).length === 0) return below
    const shared = await frameOf($, e, $.ui.resolve(e), Math.max(1, Math.min(BAND_ROWS, e.props.maxRows - 2)))
    const wanted = await draftWanted($, shared.places, text)
    const count = bandCount(e.props.bodyColumns, wanted.length)
    const frame = { ...shared, maxColumns: Math.min(shared.maxColumns, bandColumns(e.props.bodyColumns, count)) }
    const items = await itemsFor($, frame, wanted).catch(() => [])
    return items.length === 0 ? below : band(frame.kit, below, items.slice(0, frame.pictures ? count : frame.maxRows), frame.pictures)
  }).catch((_$, e, next) => next(e))
}
