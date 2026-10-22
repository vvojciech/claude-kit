import type { RenderNode } from 'claude-code'

import { highlightFrom } from './highlight'
import type { CodeRole, HighlightState } from './highlight'
import { shellSpans } from './markdown'
import type { Palette } from './palette'
import { appendRun, drawRuns, spanRuns } from './runs'
import type { Draw, Look, Run } from './runs'
import { cellWidth, sliceCells } from './width'

const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'terminal'])

const DIFF_LANGUAGES = new Set(['diff', 'patch'])

const SHELL_PROMPT = /^(\s*\$\s)/

const CONTINUATION_MARK = '↪'

const CONTINUATION_GUTTER = 2

const TAB = /\t/g

const TAB_STOP = 8

const TAB_CELLS = ' '.repeat(TAB_STOP)

const MARKED_WIDTH = CONTINUATION_GUTTER + 2

type Stretch = { runs: Run[][]; wraps: boolean }

type Prepared = { language: string; palette: Palette; lines: string[]; runs: Run[][]; cells: number[]; states: HighlightState[] }

const PREPARED_KEPT = 4

const STRETCH_LINES = 64

let prepared: Prepared[] = []

const drawnStretches = new WeakMap<Run[], Map<string, { stretch: Stretch; node: RenderNode }>>()

function codeLook(role: CodeRole, palette: Palette): Look {
  if (role === 'keyword') return { bold: true }
  if (role === 'comment') return { color: palette.muted, italic: true }
  return {}
}

function diffLook(line: string, palette: Palette): Look {
  if (line.startsWith('+++') || line.startsWith('---')) return { bold: true }
  if (line.startsWith('+')) return { color: palette.added }
  if (line.startsWith('-')) return { color: palette.removed }
  if (line.startsWith('@@') || line.startsWith('\\')) return { color: palette.muted }
  return {}
}

function shellRuns(line: string, palette: Palette): Run[] {
  const prompt = SHELL_PROMPT.exec(line)?.[1] ?? ''
  return spanRuns(shellSpans(line.slice(prompt.length)), palette, prompt === '' ? [] : [{ text: prompt, look: { color: palette.muted } }])
}

function linewiseRuns(language: string, palette: Palette): ((line: string) => Run[]) | undefined {
  if (DIFF_LANGUAGES.has(language)) return line => [{ text: line, look: diffLook(line, palette) }]
  if (SHELL_LANGUAGES.has(language)) return line => shellRuns(line, palette)
  return undefined
}

function sharedLines(a: string[], b: string[]): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i++
  return i
}

function closestPrepared(language: string, palette: Palette, lines: string[]): { kept: Prepared | undefined; shared: number } {
  return prepared
    .filter(entry => entry.language === language && entry.palette === palette)
    .reduce<{ kept: Prepared | undefined; shared: number }>((best, entry) => {
      const shared = sharedLines(entry.lines, lines)
      return shared > best.shared ? { kept: entry, shared } : best
    }, { kept: undefined, shared: 0 })
}

function freshLines(language: string, lines: string[], palette: Palette, carried: HighlightState): Pick<Prepared, 'runs' | 'states'> {
  const linewise = linewiseRuns(language, palette)
  if (lines.join('') === '' || linewise) return { runs: lines.map(line => (line === '' ? [] : (linewise?.(line) ?? []))), states: lines.map(() => carried) }
  const { tokens, states } = highlightFrom(language, lines, carried)
  return { runs: tokens.map(line => line.map(token => ({ text: token.text, look: codeLook(token.role, palette) }))), states }
}

function preparedLines(language: string, lines: string[], palette: Palette): Prepared {
  const { kept, shared } = closestPrepared(language, palette, lines)
  if (kept && shared === lines.length && kept.lines.length === lines.length) return kept
  const tail = lines.slice(shared)
  const fresh = freshLines(language, tail, palette, kept?.states[shared - 1])
  const entry: Prepared = {
    language,
    palette,
    lines,
    runs: [...(kept?.runs.slice(0, shared) ?? []), ...fresh.runs],
    cells: [...(kept?.cells.slice(0, shared) ?? []), ...tail.map(lineCells)],
    states: [...(kept?.states.slice(0, shared) ?? []), ...fresh.states],
  }
  prepared = [entry, ...prepared.filter(other => other !== kept)].slice(0, PREPARED_KEPT)
  return entry
}

function joinedRuns(lines: Run[][]): Run[] {
  const runs: Run[] = []
  lines.forEach((line, i) => {
    if (i > 0) appendRun(runs, '\n', {})
    for (const run of line) appendRun(runs, run.text, run.look)
  })
  return runs
}

export function codeLines(source: string): string[] {
  return source.replace(/\n+$/, '').split('\n')
}

function lineCells(line: string): number {
  return cellWidth(line.replace(TAB, TAB_CELLS))
}

function wrapsAt(cells: number, width: number): boolean {
  return width >= MARKED_WIDTH && cells > width
}

export function wrapsInCode(line: string, width: number): boolean {
  return wrapsAt(lineCells(line), width)
}

function stretches(cells: number[], runs: Run[][], width: number): Stretch[] {
  const found: Stretch[] = []
  cells.forEach((cellCount, i) => {
    const wraps = wrapsAt(cellCount, width)
    const last = found.at(-1)
    if (last && !wraps && !last.wraps && last.runs.length < STRETCH_LINES) last.runs.push(runs[i] ?? [])
    else found.push({ runs: [runs[i] ?? []], wraps })
  })
  return found
}

function continuationMarks(cells: number, room: number): string {
  const rows = Math.ceil((2 * cells) / room) + 1
  return Array.from({ length: rows }, () => CONTINUATION_MARK).join('\n')
}

function cutRuns(runs: Run[], at: number): [Run[], Run[]] {
  const head: Run[] = []
  const rest: Run[] = []
  let seen = 0
  for (const run of runs) {
    const take = Math.max(0, Math.min(run.text.length, at - seen))
    if (take > 0) head.push({ text: run.text.slice(0, take), look: run.look })
    if (take < run.text.length) rest.push({ text: run.text.slice(take), look: run.look })
    seen += run.text.length
  }
  return [head, rest]
}

type Head = { head: Run[]; rest: Run[]; cells: number }

function glyphCells(glyph: string, column: number): number {
  return glyph === '\t' ? TAB_STOP - (column % TAB_STOP) : cellWidth(glyph)
}

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

function graphemes(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment)
}

function headGlyphs(text: string): { taken: number; cells: number; spill: number } | undefined {
  let taken = 0
  let cells = 0
  for (const glyph of graphemes(text)) {
    if (cells >= CONTINUATION_GUTTER) break
    const width = glyphCells(glyph, cells)
    if (width === 0) return undefined
    taken += glyph.length
    cells += width
  }
  if (cells < CONTINUATION_GUTTER) return undefined
  const spill = text[taken - 1] === '\t' ? cells - CONTINUATION_GUTTER : 0
  return { taken, cells: cells - spill, spill }
}

function expandedTabs(runs: Run[]): Run[] {
  let column = 0
  return runs.map(run => {
    const text = graphemes(run.text)
      .map(glyph => {
        const width = glyphCells(glyph, column)
        column += width
        return glyph === '\t' ? ' '.repeat(width) : glyph
      })
      .join('')
    return { text, look: run.look }
  })
}

function lineHead(runs: Run[]): Head | undefined {
  const found = headGlyphs(runs.map(run => run.text).join(''))
  if (found === undefined) return undefined
  const [head, rest] = cutRuns(runs, found.taken)
  const expanded = expandedTabs(head)
  const shown = cutRuns(expanded, sliceCells(expanded.map(run => run.text).join(''), found.cells).length)[0]
  return { head: shown, rest: found.spill > 0 ? [{ text: ' '.repeat(found.spill), look: {} }, ...rest] : rest, cells: found.cells }
}

function sourceText(draw: Draw, runs: Run[]): RenderNode {
  return <draw.kit.Text color={draw.palette.text}>{drawRuns(draw, runs)}</draw.kit.Text>
}

function wrappedLine(draw: Draw, runs: Run[], width: number): RenderNode {
  const { kit, palette } = draw
  const split = lineHead(runs)
  if (split === undefined) return sourceText(draw, runs)
  const { head, rest, cells: gutter } = split
  const room = width - gutter
  const cells = lineCells(rest.map(run => run.text).join(''))
  return (
    <kit.Box flexDirection="column" width={width} paddingLeft={gutter}>
      {sourceText(draw, rest)}
      <kit.Box position="absolute" left={0} top={0} width={gutter} height={1}>
        {sourceText(draw, head)}
      </kit.Box>
      <kit.Box position="absolute" left={0} top={1} bottom={0} width={1} overflow="hidden">
        <kit.Text color={palette.faint}>{continuationMarks(cells, room)}</kit.Text>
      </kit.Box>
    </kit.Box>
  )
}

function freshStretchNode(draw: Draw, stretch: Stretch, width: number): RenderNode {
  const [first = []] = stretch.runs
  if (stretch.wraps) return wrappedLine(draw, first, width)
  const runs = joinedRuns(stretch.runs)
  return <draw.kit.Text color={draw.palette.text}>{runs.length === 0 ? ' ' : drawRuns(draw, runs)}</draw.kit.Text>
}

function sameStretch(a: Stretch, b: Stretch): boolean {
  return a.wraps === b.wraps && a.runs.length === b.runs.length && a.runs.every((runs, i) => runs === b.runs[i])
}

function stretchNode(draw: Draw, stretch: Stretch, width: number): RenderNode {
  const [first] = stretch.runs
  if (first === undefined) return freshStretchNode(draw, stretch, width)
  const key = `${width}|${draw.palette.text}`
  const drawn = drawnStretches.get(first) ?? new Map<string, { stretch: Stretch; node: RenderNode }>()
  drawnStretches.set(first, drawn)
  const cached = drawn.get(key)
  if (cached && sameStretch(cached.stretch, stretch)) return cached.node
  const node = freshStretchNode(draw, stretch, width)
  drawn.set(key, { stretch, node })
  return node
}

function label(draw: Draw, language: string, cue: string): RenderNode {
  const { Box, Text } = draw.kit
  const bars = cue.trimEnd()
  return (
    <Box paddingLeft={bars === '' ? 0 : cellWidth(bars) + 1}>
      <Text color={draw.palette.muted}>{language}</Text>
      {bars === '' ? null : (
        <Box position="absolute" left={0} top={0}>
          <Text color={draw.palette.faint}>{bars}</Text>
        </Box>
      )}
    </Box>
  )
}

export function code(draw: Draw, language: string, source: string, width: number, cue = ''): RenderNode {
  const { kit, palette } = draw
  const { runs, cells } = preparedLines(language, codeLines(source), palette)
  return (
    <kit.Box flexDirection="column">
      {language === '' ? null : label(draw, language, cue)}
      {stretches(cells, runs, width).map(stretch => stretchNode(draw, stretch, width))}
    </kit.Box>
  )
}
