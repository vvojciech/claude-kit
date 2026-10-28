import type { EngineInterface, Elements, Register, RenderElement, RenderInputOf, RenderNode } from 'claude-code'

import { isFlow, parseFlow } from './flow'
import { MOST_WAYPOINTS, drawFlow, isTangled } from './flowdraw'
import { isSequence, kindOf, parseSequence } from './parse'
import type { Sequence } from './parse'
import { drawSequence } from './render'
import type { Ink, Run } from './render'
import { segmentsOf } from './segments'
import type { Segment } from './segments'

type AssistantRender = RenderInputOf<'AssistantMessage', 'terminal'>

type Kit = Pick<Elements['terminal'], 'Box' | 'Text'>

type Style = { dimColor?: boolean; bold?: boolean; italic?: boolean; backgroundColor?: string; color?: string }

// six hues spread round the wheel, a darker set for light themes so each reads at 4.5:1; the n-th
// participant to send a message takes palette[n % length], and participants that never send stay uncoloured
export const PALETTES = {
  dark: ['#5f87ff', '#ff8700', '#5fd75f', '#d75fd7', '#00d7d7', '#d7d700'],
  light: ['#005fd7', '#a65200', '#007a00', '#af00af', '#00787f', '#7a6a00'],
} as const

type Look = { colour: boolean; quiet: boolean; boxnote: boolean }

type Picture = { title?: string; rows: Run[][]; notes: string[]; problems: string[] }

type Drawing = { picture: Picture; source?: undefined } | { source: string[] }

// colour, quiet returns and boxed notes are on by default; MERMAID_STYLE=plain turns them all off
async function readLook($: EngineInterface): Promise<Look> {
  const value = (await $.env.get('MERMAID_STYLE').catch(() => undefined)) ?? ''
  const isPlain = String(value).split(',').some(part => part.trim() === 'plain')
  return { colour: !isPlain, quiet: !isPlain, boxnote: !isPlain }
}

const PAINTED: ReadonlySet<Ink> = new Set(['frame', 'name', 'line'])

function runStyle(style: Styles, run: Run, chosen: Look): Style {
  const base = { ...(run.shade ? style.shade : {}), ...(chosen.boxnote && run.ink === 'note' ? { italic: true } : style[run.ink]) }
  const coloured = chosen.colour && run.lane !== undefined && run.lane >= 0 && PAINTED.has(run.ink) ? { color: style.palette[run.lane % style.palette.length] } : {}
  const quiet = chosen.quiet && run.reply && run.ink === 'line' ? { dimColor: true } : {}
  return { ...base, ...coloured, ...quiet }
}

export const TINT = { dark: '#303030', light: '#e4e4e4' } as const
// `rect` blocks sit on a fainter background than notes, so a note inside one still stands out
const SHADE = { dark: '#262626', light: '#efefef' } as const

const INDENT = 2

type Styles = Record<Ink, Style> & { shade: Style; palette: readonly string[] }

export function styles(tint: string): Styles {
  return {
    palette: tint === TINT.light ? PALETTES.light : PALETTES.dark,
    shade: { backgroundColor: tint === TINT.light ? SHADE.light : SHADE.dark },
    frame: { dimColor: true },
    line: {},
    name: { bold: true },
    note: { italic: true, backgroundColor: tint },
    block: { dimColor: true },
    text: {},
    number: { dimColor: true },
  }
}

export const notDrawn = (kind: string) =>
  kind === '' ? 'mermaid: no diagram type' : `mermaid: ${kind} not drawn yet, sequenceDiagram and flowchart only`

let tint: Promise<string> | undefined

async function readTint($: EngineInterface): Promise<string> {
  const rows = await $.config.list().catch(() => [])
  const theme = rows.find(row => row.key === 'theme')?.value
  return typeof theme === 'string' && /light/i.test(theme) ? TINT.light : TINT.dark
}

function keyed<T>(items: readonly T[], name: (item: T) => string): Array<[string, T]> {
  const seen = new Map<string, number>()
  return items.map((item): [string, T] => {
    const base = name(item)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return [`${base}#${count}`, item]
  })
}

const textOf = (runs: Run[]) => runs.map(run => run.text).join('')

function row({ Box, Text }: Kit, style: Styles, chosen: Look, runs: Run[], key: string): RenderNode {
  return (
    <Box key={key} flexDirection="row">
      {keyed(runs, run => run.text).map(([id, run]) => (
        <Text key={`${key}-run-${id}`} {...runStyle(style, run, chosen)}>
          {run.text}
        </Text>
      ))}
    </Box>
  )
}

function dimmed({ Text }: Kit, lines: string[], key: string): RenderNode[] {
  return keyed(lines, line => line).map(([id, line]) => (
    <Text key={`${key}-${id}`} dimColor>
      {line}
    </Text>
  ))
}

function problemList(kit: Kit, lines: string[], key: string): RenderNode {
  return (
    <kit.Box key={key} flexDirection="column" paddingLeft={INDENT}>
      {dimmed(kit, lines, key)}
    </kit.Box>
  )
}

function picture(kit: Kit, style: Styles, chosen: Look, { title, rows, notes, problems }: Picture, key: string): RenderNode {
  const { Box, Text } = kit
  return (
    <Box key={key} flexDirection="column" paddingLeft={INDENT}>
      {title && (
        <Text key={`${key}-title`} bold>
          {title}
        </Text>
      )}
      {keyed(rows, textOf).map(([id, runs]) => row(kit, style, chosen, runs, `${key}-row-${id}`))}
      {notes.length > 0 && <Text key={`${key}-gap`}> </Text>}
      {dimmed(kit, notes, `${key}-note`)}
      {dimmed(kit, problems, `${key}-problem`)}
    </Box>
  )
}

function notice({ Box, Text }: Kit, kind: string, key: string): RenderNode {
  return (
    <Box key={key} paddingLeft={INDENT}>
      <Text dimColor>{notDrawn(kind)}</Text>
    </Box>
  )
}

const isUnreadable = (sequence: Sequence) => sequence.participants.length === 0 || (sequence.unread ?? 0) > 0

function sequenceDrawing(source: string, width: number, chosen: Look): Drawing {
  const sequence = parseSequence(source)
  if (isUnreadable(sequence)) return { source: sequence.problems }
  return { picture: { ...drawSequence(sequence, width, { boxedNotes: chosen.boxnote, labelsAbove: true }), problems: sequence.problems } }
}

function flowDrawing(source: string, width: number): Drawing {
  const flow = parseFlow(source)
  if (flow.nodes.length === 0 || flow.problems.length > 0) return { source: flow.problems.length > 0 ? flow.problems : ['mermaid: no nodes in this flowchart'] }
  if (isTangled(flow)) return { source: [`mermaid: this flowchart is too tangled to lay out, its links cross over ${MOST_WAYPOINTS} ranks`] }
  const drawn = drawFlow(flow, width)
  if (!drawn) return { source: [`mermaid: this flowchart needs more than ${width} columns`] }
  return { picture: { ...drawn, title: flow.title, problems: [] } }
}

function drawing($: EngineInterface, part: { kind: 'sequence' | 'flow'; source: string }, width: number, chosen: Look): Drawing {
  try {
    return part.kind === 'sequence' ? sequenceDrawing(part.source, width, chosen) : flowDrawing(part.source, width)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mermaid could not draw a diagram: ${reason}`, { to: 'debug' })
    return { source: [`mermaid: could not draw this diagram (${reason})`] }
  }
}

async function drawParts($: EngineInterface, e: AssistantRender, next: (e: AssistantRender) => Promise<RenderElement>, parts: Segment[]): Promise<RenderElement> {
  const kit = $.ui.resolve(e)
  tint ??= readTint($)
  const style = styles(await tint)
  const chosen = await readLook($)
  const width = (e.viewport?.columns ?? 80) - INDENT - 1
  const drawn: RenderNode[] = []
  let isFirst = e.props.isFirstOfReply
  for (const [i, part] of parts.entries()) {
    const key = `mermaid-part-${i}`
    if (part.kind === 'text') {
      const element = await next({ ...e, props: { ...e.props, text: part.text, isFirstOfReply: isFirst } })
      isFirst = false
      drawn.push(<kit.Box key={key}>{element}</kit.Box>)
    } else if (part.kind === 'other') {
      drawn.push(notice(kit, part.type, key))
    } else {
      const shown = drawing($, part, width, chosen)
      if (shown.source !== undefined) {
        const source = await next({ ...e, props: { ...e.props, text: part.fence, isFirstOfReply: isFirst } })
        isFirst = false
        drawn.push(
          <kit.Box key={key} flexDirection="column">
            {source}
            {problemList(kit, shown.source, `${key}-problems`)}
          </kit.Box>,
        )
      } else drawn.push(picture(kit, style, chosen, shown.picture, key))
    }
  }
  return (
    <kit.Box flexDirection="column" rowGap={1}>
      {drawn}
    </kit.Box>
  )
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const parts = segmentsOf(e.props.text, source => (isSequence(source) ? 'sequence' : isFlow(source) ? 'flow' : kindOf(source)))
    if (!parts.some(part => part.kind !== 'text')) return next(e)
    try {
      return await drawParts($, e as AssistantRender, next as (e: AssistantRender) => Promise<RenderElement>, parts)
    } catch (error) {
      $.ui.log(`mermaid could not draw a diagram: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
      return next(e)
    }
  }).catch((_$, e, next) => next(e))

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    tint = undefined
    if (result.deny === undefined) $.ui.invalidate('ui.render')
    return result
  }).catch((_$, e, next) => next(e))
}
