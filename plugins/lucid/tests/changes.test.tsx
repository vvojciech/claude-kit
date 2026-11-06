import { describe, expect, test } from 'claude-code/testing'

import { changeOf, changeText, sumChanges } from '../hooks/changes'
import { dark } from '../hooks/palette'
import { renderToolRow } from '../hooks/tool-rows'
import { describeCall, summariseGroup } from '../hooks/tools'

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const element = (type: string) => (props: Record<string, unknown>) => ({ type, props, children: [] })

const KIT = { Box: element('Box'), Text: element('Text'), Link: element('Link') } as never

const ROOTS = { cwd: '/repo', home: '/Users/me' }

const settled = { isRunning: false, isErrored: false, isInterrupted: false }

const patch = (lines: string[]) => [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }]

function nodes(node: unknown): Drawn[] {
  if (node === null || typeof node !== 'object') return []
  const drawn = node as Drawn
  return [drawn, ...[...(drawn.children ?? []), ...((drawn.props?.children as unknown[] | undefined) ?? [])].flat().flatMap(nodes)]
}

function textOf(node: Drawn): string {
  return [node.props?.children].flat().filter(child => typeof child === 'string').join('')
}

describe('change counts', () => {
  test('counts added and removed lines from the patch an edit returns', () => {
    expect(changeOf('Edit', { structuredPatch: patch([' keep', '-old', '-older', '+new']) })).toEqual({ added: 1, removed: 2 })
  })

  test('counts every line of a file a write created', () => {
    expect(changeOf('Write', { type: 'create', content: 'a\nb\nc\n', structuredPatch: [] })).toEqual({ added: 3, removed: 0 })
  })

  test('counts nothing for a tool that changes no file, or an output with no patch', () => {
    expect([changeOf('Read', { structuredPatch: patch(['+x']) }), changeOf('Edit', 'Error: no match')]).toEqual([undefined, undefined])
  })

  test('adds the counts of several edits and leaves out a zero side', () => {
    expect(sumChanges([{ added: 2, removed: 0 }, undefined, { added: 1, removed: 0 }])).toEqual({ added: 3, removed: 0 })
    expect(changeText({ added: 3, removed: 0 })).toEqual({ added: '+3', removed: undefined })
  })

  test('draws the counts after the target, green for added and red for removed', () => {
    const call = { tool: 'Edit', input: { file_path: '/repo/a.ts' }, output: { structuredPatch: patch(['-a', '+b', '+c']) }, ...settled }
    const drawn = nodes(renderToolRow({ kit: KIT, palette: dark }, describeCall(call, ROOTS), 'done', 80))
    const counts = drawn.filter(n => /^ [+−]\d+$/.test(textOf(n))).map(n => [textOf(n), n.props?.color])
    expect(counts).toEqual([[' +2', dark.added], [' −1', dark.removed]])
  })

  test('sums the counts of a folded group of edits on its line', () => {
    const edit = (path: string, lines: string[]) => ({ tool: 'Edit', input: { file_path: path }, output: { structuredPatch: patch(lines) }, ...settled })
    const { row } = summariseGroup([edit('/repo/a.ts', ['+a']), edit('/repo/b.ts', ['+b', '-c'])], ROOTS)
    expect(row.lines?.map(line => line.change)).toEqual([{ added: 2, removed: 1 }])
  })
})
