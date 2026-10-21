import type { RenderNode } from 'claude-code'

import { highlight } from './highlight'
import type { CodeRole } from './highlight'
import { shellSpans } from './markdown'
import type { Palette } from './palette'
import { appendRun, drawRuns, spanRuns } from './runs'
import type { Draw, Look, Run } from './runs'
import { cellWidth } from './width'

const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'terminal'])

const DIFF_LANGUAGES = new Set(['diff', 'patch'])

const SHELL_PROMPT = /^(\s*\$\s)/

const CONTINUATION_MARK = '↪'

const CONTINUATION_GUTTER = 2

const TAB = /\t/g

const TAB_CELLS = '        '

const MARKED_WIDTH = CONTINUATION_GUTTER + 2

type Stretch = { runs: Run[][]; wraps: boolean }

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

function lineRuns(language: string, lines: string[], palette: Palette): Run[][] {
  if (DIFF_LANGUAGES.has(language)) return lines.map(line => [{ text: line, look: diffLook(line, palette) }])
  if (SHELL_LANGUAGES.has(language)) {
    return lines.map(line => {
      const prompt = SHELL_PROMPT.exec(line)?.[1] ?? ''
      return spanRuns(shellSpans(line.slice(prompt.length)), palette, prompt === '' ? [] : [{ text: prompt, look: { color: palette.muted } }])
    })
  }
  return highlight(language, lines).map(tokens => tokens.map(token => ({ text: token.text, look: codeLook(token.role, palette) })))
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

export function wrapsInCode(line: string, width: number): boolean {
  return width >= MARKED_WIDTH && lineCells(line) > width
}

function stretches(lines: string[], runs: Run[][], width: number): Stretch[] {
  const found: Stretch[] = []
  lines.forEach((line, i) => {
    const wraps = wrapsInCode(line, width)
    const last = found.at(-1)
    if (last && !wraps && !last.wraps) last.runs.push(runs[i] ?? [])
    else found.push({ runs: [runs[i] ?? []], wraps })
  })
  return found
}

function continuationMarks(cells: number, room: number): string {
  const rows = Math.ceil((2 * cells) / room) + 1
  return Array.from({ length: rows }, () => CONTINUATION_MARK).join('\n')
}

function isNarrowCell(glyph: string): boolean {
  return glyph !== '\t' && cellWidth(glyph) === 1
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

function lineHead(runs: Run[]): [Run[], Run[]] | undefined {
  const glyphs = Array.from(runs.map(run => run.text).join('')).slice(0, CONTINUATION_GUTTER)
  if (glyphs.length < CONTINUATION_GUTTER || !glyphs.every(isNarrowCell)) return undefined
  return cutRuns(runs, glyphs.join('').length)
}

function sourceText(draw: Draw, runs: Run[]): RenderNode {
  return <draw.kit.Text color={draw.palette.text}>{drawRuns(draw, runs)}</draw.kit.Text>
}

function wrappedLine(draw: Draw, runs: Run[], width: number): RenderNode {
  const { kit, palette } = draw
  const split = lineHead(runs)
  if (split === undefined) return sourceText(draw, runs)
  const [head, rest] = split
  const room = width - CONTINUATION_GUTTER
  const cells = lineCells(rest.map(run => run.text).join(''))
  return (
    <kit.Box flexDirection="column" width={width} paddingLeft={CONTINUATION_GUTTER}>
      {sourceText(draw, rest)}
      <kit.Box position="absolute" left={0} top={0} width={CONTINUATION_GUTTER} height={1}>
        {sourceText(draw, head)}
      </kit.Box>
      <kit.Box position="absolute" left={0} top={1} bottom={0} width={1} overflow="hidden">
        <kit.Text color={palette.faint}>{continuationMarks(cells, room)}</kit.Text>
      </kit.Box>
    </kit.Box>
  )
}

function stretchNode(draw: Draw, stretch: Stretch, width: number): RenderNode {
  const [first = []] = stretch.runs
  if (stretch.wraps) return wrappedLine(draw, first, width)
  const runs = joinedRuns(stretch.runs)
  return <draw.kit.Text color={draw.palette.text}>{runs.length === 0 ? ' ' : drawRuns(draw, runs)}</draw.kit.Text>
}

function label(draw: Draw, language: string, cue: string): RenderNode {
  const { Box, Text } = draw.kit
  const bars = cue.trimEnd()
  return (
    <Box paddingLeft={cellWidth(cue)}>
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
  const lines = codeLines(source)
  const runs = lines.join('') === '' ? lines.map(() => []) : lineRuns(language, lines, palette)
  return (
    <kit.Box flexDirection="column">
      {language === '' ? null : label(draw, language, cue)}
      {stretches(lines, runs, width).map(stretch => stretchNode(draw, stretch, width))}
    </kit.Box>
  )
}
