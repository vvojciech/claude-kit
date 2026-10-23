import { describe, expect, test } from 'claude-code/testing'

import { parseFlow } from '../hooks/flow'
import { drawFlow } from '../hooks/flowdraw'
import { plainRows } from '../hooks/render'

const draw = (source: string, width = 80) => {
  const drawn = drawFlow(parseFlow(source), width)
  return { lines: drawn ? plainRows(drawn.rows) : [], notes: drawn?.notes ?? [], drawn }
}

const rowOf = (lines: string[], text: string) => lines.findIndex(line => line.includes(text))
const colOf = (lines: string[], text: string) => lines[rowOf(lines, text)]!.indexOf(text)

describe('drawFlow top-down', () => {
  test('stacks a box over the box it points to, joined by a line ending in ▼', async () => {
    const { lines } = draw('flowchart TD\nA[Start] --> B[Stop]')

    expect(lines).toEqual(['┌───────┐', '│ Start │', '└───┬───┘', '    │', '    ▼', '┌──────┐', '│ Stop │', '└──────┘'])
  })

  test('sets siblings side by side under their parent, the lines joining on one rail', async () => {
    const { lines } = draw('flowchart TD\nA --> B\nA --> C')

    expect(rowOf(lines, 'B')).toBe(rowOf(lines, 'C'))
    expect(rowOf(lines, 'B')).toBeGreaterThan(rowOf(lines, 'A'))
    expect(lines.some(line => /┌─*┴─*┐/.test(line))).toBe(true)
  })

  test('runs a chain of only children straight down one column', async () => {
    const { lines } = draw('flowchart TD\nA{Pick} --> B[Short]\nA --> C[A much longer box]\nC --> D[Mid]\nD --> E([End of the line])')
    const chain = lines.slice(rowOf(lines, 'A much longer box'), rowOf(lines, 'End of the line'))
    const columns = new Set(chain.flatMap(line => [...line].flatMap((ch, i) => ('┬▼│'.includes(ch) && !/[A-Za-z]/.test(line) ? [i] : []))))

    expect([...columns]).toHaveLength(1)
  })

  test('writes an edge label beside the line into its target', async () => {
    const { lines } = draw('flowchart TD\nA{Ok?} -->|yes| B\nA -->|no| C')

    const yes = rowOf(lines, 'yes')
    expect(yes).toBeGreaterThan(rowOf(lines, 'Ok?'))
    expect(yes).toBeLessThan(rowOf(lines, 'B'))
    expect(rowOf(lines, 'no')).toBe(yes)
  })

  test('draws a decision with slanted corners', async () => {
    const { lines } = draw('flowchart TD\nA{Ok?} --> B')

    expect(lines[0]).toMatch(/^╱─+╲$/)
    expect(lines[1]).toMatch(/^< +Ok\? +>$/)
  })

  test('draws a database with doubled top and bottom borders', async () => {
    const { lines } = draw('flowchart TD\nA[(Store)] --> B')

    expect(lines[0]).toMatch(/^╒═+╕$/)
    expect(lines[2]).toMatch(/^╘═+╤═+╛$/)
  })

  test('loops an edge back up a cycle round the right of the chart, out of its source\'s side into its target\'s', async () => {
    const { lines } = draw('flowchart TD\nA --> B\nB --> C\nB --> D\nD --> B')
    const b = rowOf(lines, ' B ')
    const d = rowOf(lines, ' D ')

    expect(lines[b]).toMatch(/ B │◀─+┐$/)
    expect(lines[d]).toMatch(/ D ├─+┘$/)
    for (const line of lines.slice(b + 1, d)) expect(line).toMatch(/│$/)
  })

  test('keeps a loop off the other boxes in its source\'s rank by setting that source outermost', async () => {
    const { lines } = draw('flowchart TD\nA --> B\nB --> C[Loop back]\nB --> D[Carry on]\nC --> A')
    const row = lines[rowOf(lines, 'Loop back')]!

    expect(row.indexOf('Loop back')).toBeGreaterThan(row.indexOf('Carry on'))
  })

  test('loops a back edge under the chart when it runs left to right', async () => {
    const { lines } = draw('flowchart LR\nA --> B\nB --> C\nC --> A')
    const last = lines.at(-1)!

    expect(lines.join('\n')).toContain('▲')
    expect(last).toMatch(/^\s*└─+┘$/)
  })

  test('gives a dotted edge its own port out of a box, apart from the solid fan-out', async () => {
    const { lines } = draw('flowchart TD\nA[Rate the request] --> B\nA --> C\nA -.-> D')
    const border = lines[2]!

    expect([...border].filter(ch => ch === '┬')).toHaveLength(2)
  })

  test('draws a dotted edge with dotted strokes and a thick one heavy', async () => {
    const { lines } = draw('flowchart TD\nA -.-> B\nB ==> C')

    expect(lines.join('\n')).toContain('┆')
    expect(lines.join('\n')).toContain('┃')
  })

  test('narrows labels to fit, and gives up when even that cannot fit', async () => {
    const wide = 'flowchart TD\nA --> B[a rather long label that would like a lot of room]\nA --> C[another long label wanting room too]'

    expect(draw(wide, 40).lines.every(line => [...line].length <= 40)).toBe(true)
    expect(draw('flowchart TD\nA --> B & C & D & E & F & G & H & I', 12).drawn).toBeUndefined()
  })
})

describe('drawFlow left-right', () => {
  test('sets the target to the right of its source with ▶ on the line between', async () => {
    const { lines } = draw('flowchart LR\nA[Start] --> B[Stop]')

    expect(rowOf(lines, 'Start')).toBe(rowOf(lines, 'Stop'))
    expect(colOf(lines, 'Stop')).toBeGreaterThan(colOf(lines, 'Start'))
    expect(lines[rowOf(lines, 'Start')]).toMatch(/Start ├─+▶│ Stop/)
  })

  test('writes an edge label above the line into its target', async () => {
    const { lines } = draw('flowchart LR\nA -->|go| B')

    expect(rowOf(lines, 'go')).toBe(rowOf(lines, 'A') - 1)
    expect(colOf(lines, 'go')).toBeGreaterThan(colOf(lines, 'A'))
  })
})
