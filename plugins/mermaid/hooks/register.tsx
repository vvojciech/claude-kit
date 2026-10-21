import type { EngineInterface, Elements, Register, RenderElement, RenderInputOf, RenderNode } from 'claude-code'

import { isSequence, kindOf, parseSequence } from './parse'
import type { Sequence } from './parse'
import { drawSequence } from './render'
import type { Ink, Run } from './render'
import { segmentsOf } from './segments'
import type { Segment } from './segments'

type AssistantRender = RenderInputOf<'AssistantMessage', 'terminal'>

type Kit = Pick<Elements['terminal'], 'Box' | 'Text'>

type Style = { dimColor?: boolean; bold?: boolean; italic?: boolean; backgroundColor?: string }

export const TINT = { dark: '#303030', light: '#e4e4e4' } as const

const INDENT = 2

function styles(tint: string): Record<Ink, Style> {
  return {
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
  kind === '' ? 'mermaid: no diagram type' : `mermaid: ${kind} not drawn yet, sequenceDiagram only`

let tint: Promise<string> | undefined

async function readTint($: EngineInterface): Promise<string> {
  const rows = await $.config.list().catch(() => [])
  const theme = rows.find(row => row.key === 'theme')?.value
  return typeof theme === 'string' && /light/i.test(theme) ? TINT.light : TINT.dark
}

function row({ Box, Text }: Kit, style: Record<Ink, Style>, runs: Run[], key: string): RenderNode {
  return (
    <Box key={key} flexDirection="row">
      {runs.map(run => (
        <Text {...style[run.ink]}>{run.text}</Text>
      ))}
    </Box>
  )
}

const isUnreadable = (sequence: Sequence) => sequence.participants.length === 0 || (sequence.unread ?? 0) > 0

function problems({ Box, Text }: Kit, lines: string[], key: string): RenderNode {
  return (
    <Box key={key} flexDirection="column" paddingLeft={INDENT}>
      {lines.map(line => (
        <Text dimColor>{line}</Text>
      ))}
    </Box>
  )
}

function diagram(kit: Kit, style: Record<Ink, Style>, sequence: Sequence, width: number, key: string): RenderNode {
  const { Box, Text } = kit
  const { rows, notes } = drawSequence(sequence, width)
  return (
    <Box key={key} flexDirection="column" paddingLeft={INDENT}>
      {rows.map((runs, i) => row(kit, style, runs, `${key}-row-${i}`))}
      {notes.length > 0 && <Text key={`${key}-gap`}> </Text>}
      {notes.map(note => (
        <Text dimColor>{note}</Text>
      ))}
      {sequence.problems.map(problem => (
        <Text dimColor>{problem}</Text>
      ))}
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

type Shown = { node: RenderNode; source?: undefined } | { source: string[] }

function sequencePart($: EngineInterface, kit: Kit, style: Record<Ink, Style>, part: { source: string }, width: number, key: string): Shown {
  try {
    const sequence = parseSequence(part.source)
    if (isUnreadable(sequence)) return { source: sequence.problems }
    return { node: diagram(kit, style, sequence, width, key) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`mermaid could not draw a diagram: ${reason}`, { to: 'debug' })
    return { source: [`mermaid: could not draw this diagram (${reason})`] }
  }
}

async function drawParts($: EngineInterface, e: AssistantRender, next: (e: AssistantRender) => Promise<RenderElement>, parts: Segment[]): Promise<RenderElement> {
  const kit = $.ui.resolve(e)
  const style = styles(await (tint ??= readTint($)))
  const width = (e.viewport?.columns ?? 80) - INDENT - 1
  const drawn: RenderNode[] = []
  let isFirst = e.props.isFirstOfReply
  for (const [i, part] of parts.entries()) {
    const key = `mermaid-part-${i}`
    if (part.kind === 'text') {
      const element = await next({ ...e, props: { ...e.props, text: part.text, isFirstOfReply: isFirst } })
      isFirst = false
      drawn.push(<kit.Box key={key}>{element}</kit.Box>)
    } else if (part.kind === 'sequence') {
      const shown = sequencePart($, kit, style, part, width, key)
      if (shown.source) {
        const source = await next({ ...e, props: { ...e.props, text: part.fence, isFirstOfReply: isFirst } })
        isFirst = false
        drawn.push(
          <kit.Box key={key} flexDirection="column">
            {source}
            {problems(kit, shown.source, `${key}-problems`)}
          </kit.Box>,
        )
      } else drawn.push(shown.node)
    } else {
      drawn.push(notice(kit, part.kind === 'other' ? part.type : '', key))
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
    const parts = segmentsOf(e.props.text, source => (isSequence(source) ? 'sequence' : kindOf(source)))
    if (!parts.some(part => part.kind === 'sequence' || part.kind === 'other')) return next(e)
    try {
      return await drawParts($, e as AssistantRender, next as (e: AssistantRender) => Promise<RenderElement>, parts)
    } catch (error) {
      $.ui.log(`mermaid could not draw a diagram: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
      return next(e)
    }
  }).catch(($, e, next) => next(e))
}
