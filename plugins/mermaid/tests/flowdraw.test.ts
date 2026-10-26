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

  test('keeps a long edge straight and lets the short detour bend round it', async () => {
    const { lines } = draw('flowchart TD\nE[Rate the request] --> F{Any quotes?}\nE -.-> K[Side check]\nK -.-> F')
    const leaves = [...lines[rowOf(lines, 'Rate the request') + 1]!].lastIndexOf('┬')
    const lands = lines.findIndex(line => line.includes('Any quotes?'))
    const above = lines.slice(rowOf(lines, 'Rate the request') + 2, lands - 1)

    expect(above.every(line => '│▼'.includes([...line][leaves] ?? ''))).toBe(true)
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

  test('draws a subroutine with doubled sides', async () => {
    const { lines } = draw('flowchart TD\nA[[Call it]]')

    expect(lines).toEqual(['╓─────────╖', '║ Call it ║', '╙─────────╜'])
    expect(draw('flowchart LR\nA[[Call it]] --> B').lines[1]).toMatch(/║ Call it ╟─+▶/)
  })

  test('rounds a tall stadium only at its middle row', async () => {
    const { lines } = draw('flowchart TD\nA([Twilio<br/>Flex<br/>UI])')

    expect(lines.filter(line => line.startsWith('('))).toHaveLength(1)
    expect(lines.filter(line => line.startsWith('│'))).toHaveLength(2)
  })

  test('keeps a one-word edge label whole', async () => {
    const { lines } = draw('flowchart LR\nA -->|prospect_data_collected| B', 120)

    expect(lines.join('\n')).toContain('prospect_data_collected')
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

  test('dims every cell of a dotted edge, corners included, so even a short one reads as dotted, but keeps its head bright', async () => {
    const { drawn } = draw('flowchart LR\nA -.-> B')
    const runs = drawn!.rows.flat()

    expect(runs.filter(run => run.text.includes('╌')).every(run => run.ink === 'frame')).toBe(true)
    expect(runs.find(run => run.text.includes('▶'))!.ink).toBe('line')
  })

  test('keeps the main stroke centred under a box and puts another stroke four cells out toward its target', async () => {
    const { lines } = draw('flowchart TD\nA[Rate the request now] --> B[Main]\nA -.-> C[Side]')
    const border = [...lines[2]!]
    const ports = border.flatMap((ch, i) => (ch === '┬' ? [i] : []))

    expect(ports).toHaveLength(2)
    expect(ports[1]! - ports[0]!).toBe(4)
  })

  test('keeps a tall diamond\'s sides slanted on every row', async () => {
    const { lines } = draw('flowchart LR\nA --> D{Is it<br/>safe to<br/>go now?}')
    const top = rowOf(lines, '╱───')
    const left = lines[top]!.indexOf('╱')
    const bottom = lines.findIndex((line, i) => i > top && [...line][left] === '╲' && line.includes('───'))
    const sides = lines.slice(top + 1, bottom).map(line => [...line][left])

    expect(sides.length).toBeGreaterThan(1)
    expect(sides.every(ch => ch === '╱' || ch === '╲' || ch === '<')).toBe(true)
  })

  test('draws a dotted edge with dotted strokes and a thick one heavy', async () => {
    const { lines } = draw('flowchart TD\nA -.-> B\nB ==> C')

    expect(lines.join('\n')).toContain('┊')
    expect(lines.join('\n')).toContain('┃')
  })

  test('narrows labels to fit, and gives up when even that cannot fit', async () => {
    const wide = 'flowchart TD\nA --> B[a rather long label that would like a lot of room]\nA --> C[another long label wanting room too]'

    expect(draw(wide, 40).lines.every(line => [...line].length <= 40)).toBe(true)
    expect(draw('flowchart TD\nA --> B & C & D & E & F & G & H & I', 12).drawn).toBeUndefined()
  })
})

describe('drawFlow labels and cycles', () => {
  test('draws a review loop whose labels would sit above the first row without throwing', async () => {
    const source = 'flowchart TD\nDraft --> Review\nReview -->|approved| Merged\nReview -->|changes requested| Draft\nMerged --> Deploy{Deploy ok?}\nDeploy -->|no| Rollback\nRollback --> Draft\nDeploy -->|yes| Live'

    const td = draw(source, 120).lines
    const draft = td.slice(0, rowOf(td, 'Review'))

    const review = td[rowOf(td, 'Review')]!
    const lane = review.indexOf('┘')

    expect(draft.filter(line => line.includes('◀'))).toHaveLength(2)
    expect(td.slice(0, rowOf(td, 'Review')).filter(line => /changes|requested/.test(line)).every(line => line.search(/changes|requested/) < lane)).toBe(true)
    expect(draw(source.replace('TD', 'LR'), 160).drawn).toBeDefined()
  })
})

describe('drawFlow cycles', () => {
  test('turns round the edge written against the flow, so a node keeps the rank its first parent gives it', async () => {
    const source = 'flowchart TD\nA --> B{Pick}\nB --> C[Short path]\nB --> D[Long path]\nC --> E[Merge]\nD --> F[Full]\nF --> E\nE --> G{Accept?}\nG --> H[Change]\nH --> F'
    const { lines } = draw(source)

    expect(rowOf(lines, 'Full')).toBeLessThan(rowOf(lines, 'Merge'))
    expect(rowOf(lines, 'Full')).toBeGreaterThan(rowOf(lines, 'Long path'))
  })
})

describe('drawFlow cycle order', () => {
  test('keeps a node named late in the source between the nodes its edges join', async () => {
    const { lines } = draw('flowchart TD\nE[Rate] --> F{Any?}\nF -->|none| G[Fallback]\nG --> E\nF -->|some| H[Apply]\nE -.-> K[Overlay]\nK -.-> F')

    expect(rowOf(lines, 'Overlay')).toBeLessThan(rowOf(lines, 'Any?'))
    expect(rowOf(lines, 'Overlay')).toBeGreaterThan(rowOf(lines, 'Rate'))
  })
})

describe('drawFlow ordering', () => {
  test('keeps siblings beside each other when that saves a crossing', async () => {
    const { lines } = draw('graph TD\nA[Chopin] --> Q[Quid]\nA --> O[OKaaS]\nA --> C[CMAS]\nQ --> R[Rater]\nQ --> E[Earnix]\nO --> F[Flexor]\nF --> I[Idiophone]\nF --> T[Twilio]\nI --> T\nC --> G[Gateway]\nG --> P[PIMMS]')
    const row = lines[rowOf(lines, 'Rater')]!

    expect(row.indexOf('Earnix')).toBeLessThan(row.indexOf('Flexor'))
  })
})

describe('drawFlow subgraphs', () => {
  test('frames a subgraph round its members with its title in the top border', async () => {
    const { lines } = draw('flowchart TD\nX[Outside] --> A\nsubgraph S [Services]\nA[Alpha] --> B[Beta]\nend\nB --> Y[After]')
    const top = rowOf(lines, 'Services')
    const left = lines[top]!.indexOf('╭')

    expect(lines[top]).toMatch(/^ *╭[─│┼]*─ Services ─+╮$/)
    expect(top).toBeGreaterThan(rowOf(lines, 'Outside'))
    expect(top).toBeLessThan(rowOf(lines, 'Alpha'))
    for (const name of ['Alpha', 'Beta']) expect(lines[rowOf(lines, name)]![left]).toBe('│')
    expect(lines[rowOf(lines, 'After')]![left]).not.toBe('│')
  })

  test('moves a box that is not a member out of the way of a subgraph\'s frame, and draws no blank rows above the chart', async () => {
    const { lines } = draw('flowchart LR\nsubgraph In [Ingest]\nW[Webhook] --> R[Router]\nend\nsubgraph Fx [Flexor]\nL[Lead] --> S{Score?}\nS -->|yes| H[Hot]\nS -->|no| N[Cold]\nend\nR --> L\nR -.-> D[(Warehouse)]', 200)

    expect(lines.join('\n')).toContain('Ingest')
    expect(lines.join('\n')).toContain('Flexor')
    expect(lines[0]!.trim()).not.toBe('')
  })

  test('marks where an edge crosses a frame instead of breaking the border', async () => {
    const { lines } = draw('flowchart TD\nX[Outside] --> A\nsubgraph S [Services]\nA[Alpha] --> B[Beta]\nend\nB --> Y[After]')
    const top = rowOf(lines, 'Services')
    const bottom = lines.findIndex((line, i) => i > top && line.includes('╰'))

    expect(lines[top]).toContain('┼')
    expect(lines[bottom]).toContain('┼')
  })

  test('gives each edge into a top-down box its own head, at least three cells apart', async () => {
    const { lines } = draw('flowchart TD\nA[Left] --> C[Done]\nB[Right] --> C')
    const heads = [...lines[rowOf(lines, 'Done') - 2]!].flatMap((ch, i) => (ch === '▼' ? [i] : []))

    expect(heads).toHaveLength(2)
    expect(heads[1]! - heads[0]!).toBeGreaterThanOrEqual(3)
  })

  test('joins edges of one stroke into a left-right box at one port on its side', async () => {
    const { lines } = draw('flowchart LR\nA[Top] --> C[Done]\nB[Low] --> C\nX[Up] --> A\nX --> B')

    expect(lines.join('\n').split('▶│ Done').length - 1).toBe(1)
    expect(lines.join('\n')).not.toMatch(/[▼▲]/)
  })

  test('keeps the members of a subgraph side by side in a rank', async () => {
    const { lines } = draw('flowchart TD\nR --> A & X & B\nsubgraph G [Group]\nA\nB\nend')
    const row = lines[rowOf(lines, ' A ')]!

    const [a, b, x] = [' A ', ' B ', ' X '].map(name => row.indexOf(name))

    expect(x! > Math.min(a!, b!) && x! < Math.max(a!, b!)).toBe(false)
  })
})

describe('drawFlow left-right', () => {
  test('sets the target to the right of its source with ▶ on the line between', async () => {
    const { lines } = draw('flowchart LR\nA[Start] --> B[Stop]')

    expect(rowOf(lines, 'Start')).toBe(rowOf(lines, 'Stop'))
    expect(colOf(lines, 'Stop')).toBeGreaterThan(colOf(lines, 'Start'))
    expect(lines[rowOf(lines, 'Start')]).toMatch(/Start ├─+▶│ Stop/)
  })

  test('sends a second stroke out of the box\'s top or bottom toward its target, so the box keeps its height', async () => {
    const { lines } = draw('flowchart LR\nE[Rate] --> F[Any]\nE -.-> K[Side]\nK -.-> F')
    const top = rowOf(lines, 'Rate') - 1
    const bottom = rowOf(lines, 'Rate') + 1

    expect(lines[top]).toMatch(/┌──┴?.*┐|┌─*┴─*┐/)
    expect(lines[bottom]).toMatch(/└─+┘/)
    expect(lines[top]! + lines[bottom]!).toMatch(/[┴┬]/)
  })

  test('keeps the label on an edge that leaves through a box\'s top or bottom', async () => {
    const { lines } = draw('flowchart LR\nR[Router] -->|captured| L[Lead]\nR -.->|collected| D[(Store)]\nL --> X[Next]', 160)

    expect(lines.join('\n')).toContain('captured')
    expect(lines.join('\n')).toContain('collected')
  })

  test('runs the main edge into a left-right decision\'s tip and drops another onto its top with a head of its own', async () => {
    const { lines } = draw('flowchart LR\nE[Rate] --> F{Any?}\nE -.-> K[Side]\nK -.-> F')
    const top = rowOf(lines, '╱───')
    const tip = lines.find(line => line.includes('<'))!

    expect(tip).toMatch(/Rate *├─+▶</)
    expect(lines[top - 1]).toContain('▼')
    expect([...lines[top - 1]!].indexOf('▼')).toBeGreaterThan([...lines[top]!].indexOf('╱'))
    expect([...lines[top - 1]!].indexOf('▼')).toBeLessThan([...lines[top]!].indexOf('╲'))
  })

  test('writes an edge label above the line into its target', async () => {
    const { lines } = draw('flowchart LR\nA -->|go| B')

    expect(rowOf(lines, 'go')).toBe(rowOf(lines, 'A') - 1)
    expect(colOf(lines, 'go')).toBeGreaterThan(colOf(lines, 'A'))
  })

  test('leaves a cell between a branch label and the line it turns from, and a two-cell stub before each head', async () => {
    const { lines } = draw('flowchart LR\nA{Ok?} -->|yes| B[Go]\nA -->|no| C[Stop]')

    expect(lines.some(line => /│yes|│no/.test(line))).toBe(false)
    expect(lines.filter(line => /──▶│ (Go|Stop)/.test(line))).toHaveLength(2)
  })
})
