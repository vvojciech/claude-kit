import { describe, expect, test } from 'claude-code/testing'

import { parseFlow } from '../hooks/flow'
import { drawFlow } from '../hooks/flowdraw'
import { must } from '../hooks/must'
import { plainRows } from '../hooks/render'
import { cellWidth } from '../hooks/width'

const draw = (source: string, width = 80) => {
  const drawn = drawFlow(parseFlow(source), width)
  return { lines: drawn ? plainRows(drawn.rows) : [], notes: drawn?.notes ?? [], drawn }
}

const rowOf = (lines: string[], text: string) => lines.findIndex(line => line.includes(text))
const lineAt = (lines: string[], row: number) => must(lines[row], `row ${row}`)
const colOf = (lines: string[], text: string) => lineAt(lines, rowOf(lines, text)).indexOf(text)

describe('drawFlow top-down', () => {
  test('stacks a box over the box it points to, joined by a line ending in ▼', async () => {
    const { lines } = draw('flowchart TD\nA[Start] --> B[Stop]')

    expect(lines).toEqual(['┌───────┐', '│ Start │', '└───┬───┘', '    │', '    ▼', '┌───────┐', '│ Stop  │', '└───────┘'])
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

  test('never lands two heads side by side on a decision a long edge runs into', async () => {
    const { lines } = draw('flowchart TD\n    A[Customer submits REQ] --> B{Trade supported?}\n    B -->|no| C[Decline]\n    B -->|yes| D[Enrich risk profile]\n    D --> E[Rate with Tarif]\n    E --> F{Any quotes?}\n    F -->|none| G[PL limit fallback]\n    G --> E\n    F -->|some| H[Apply filter overrides]\n    H --> I[(Persist offerset)]\n    I --> J([Show QCP])\n    E -.-> K[Oracle overlay]\n    K -.-> F', 117)

    expect(lines.some(line => /▼▼/.test(line))).toBe(false)
  })

  test('keeps a long edge straight and lets the short detour bend round it', async () => {
    const { lines } = draw('flowchart TD\nE[Rate the request] --> F{Any quotes?}\nE -.-> K[Side check]\nK -.-> F')
    const leaves = [...lineAt(lines, rowOf(lines, 'Rate the request') + 1)].lastIndexOf('┬')
    const lands = lines.findIndex(line => line.includes('Any quotes?'))
    const above = lines.slice(rowOf(lines, 'Rate the request') + 2, lands - 1)

    expect(above.every(line => '│▼'.includes([...line][leaves] ?? ''))).toBe(true)
    expect(lines[lands - 1]).not.toMatch(/▼▼/)
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
    expect(lines[1]).toMatch(/^◇ +Ok\? +◇$/)
    expect(draw('flowchart TD\nA{{Prep}} --> B').lines[1]).toMatch(/^< +Prep +>$/)
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

  test('runs a loop down the side its source sits on, so it never passes a neighbour', async () => {
    const { lines } = draw('flowchart TD\nA --> B\nB --> C[Loop back]\nB --> D[Carry on]\nC --> A')
    const row = lineAt(lines, rowOf(lines, 'Loop back'))

    expect(row.indexOf('Loop back')).toBeLessThan(row.indexOf('Carry on'))
    expect(row).toMatch(/^ *└─*┤ Loop back │/)
  })

  test('loops a back edge under the chart when it runs left to right', async () => {
    const { lines } = draw('flowchart LR\nA --> B\nB --> C\nC --> A')
    const last = must(lines.at(-1), 'last row')

    expect(lines.join('\n')).toContain('▲')
    expect(last).toMatch(/^\s*└─+┘$/)
  })

  test('gives a dotted edge its own port out of a box, apart from the solid fan-out', async () => {
    const { lines } = draw('flowchart TD\nA[Rate the request] --> B\nA --> C\nA -.-> D')
    const border = lineAt(lines, 2)

    expect([...border].filter(ch => ch === '┬')).toHaveLength(2)
  })

  test('dims every cell of a dotted edge, corners included, so even a short one reads as dotted, but keeps its head bright', async () => {
    const { drawn } = draw('flowchart LR\nA -.-> B')
    const runs = must(drawn, 'drawing').rows.flat()

    expect(runs.filter(run => run.text.includes('╌')).every(run => run.ink === 'frame')).toBe(true)
    expect(must(runs.find(run => run.text.includes('▶')), 'head').ink).toBe('line')
  })

  test('keeps the main stroke centred under a box and puts another stroke four cells out toward its target', async () => {
    const { lines } = draw('flowchart TD\nA[Rate the request now] --> B[Main]\nA -.-> C[Side]')
    const border = [...lineAt(lines, 2)]
    const ports = border.flatMap((ch, i) => (ch === '┬' ? [i] : []))

    expect(ports).toHaveLength(2)
    expect(must(ports[1], 'port') - must(ports[0], 'port')).toBe(4)
  })

  test('keeps a tall diamond\'s sides slanted on every row', async () => {
    const { lines } = draw('flowchart LR\nA --> D{Is it<br/>safe to<br/>go now?}')
    const top = rowOf(lines, '╱───')
    const left = lineAt(lines, top).indexOf('╱')
    const bottom = lines.findIndex((line, i) => i > top && [...line][left] === '╲' && line.includes('───'))
    const sides = lines.slice(top + 1, bottom).map(line => [...line][left])

    expect(sides.length).toBeGreaterThan(1)
    expect(sides.every(ch => ch === '╱' || ch === '╲' || ch === '◇')).toBe(true)
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

    const review = lineAt(td, rowOf(td, 'Review'))
    const lane = review.indexOf('┘')

    expect(draft.filter(line => /[◀▶]/.test(line))).toHaveLength(1)
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

describe('drawFlow declared order', () => {
  test('keeps branches in the order the source declares them, a loop from the first one running down the left', async () => {
    const source = 'flowchart TD\nDraft --> Review\nReview -->|approved| Merged\nReview -->|changes requested| Draft\nMerged --> Deploy{Deploy ok?}\nDeploy -->|no| Rollback\nRollback --> Draft\nDeploy -->|yes| Live'
    const { lines } = draw(source, 120)
    const row = lineAt(lines, rowOf(lines, 'Rollback'))
    const draft = rowOf(lines, 'Draft')

    expect(row.indexOf('Rollback')).toBeLessThan(row.indexOf('Live'))
    expect(lines[draft]).toMatch(/▶│ Draft │◀/)
  })

  test('keeps a long edge out of a bus with its own head, and sets a lone parent over its only child', async () => {
    const source = 'graph TD\nA[Chopin] --> Q[Quid]\nA --> O[OKaaS]\nA --> C[CMAS]\nQ --> R[Rater]\nQ --> E[Earnix]\nO --> F[Flexor]\nF --> I[Idiophone]\nF --> T[Twilio]\nI --> T\nC --> G[account-api-gw]\nG --> P[PIMMS]'
    const { lines } = draw(source, 117)
    const twilio = rowOf(lines, 'Twilio')
    const nearest = (row: number, glyph: string, name: string) =>
      [...lineAt(lines, row)].flatMap((ch, i) => (ch === glyph ? [i] : [])).sort((a, b) => Math.abs(a - colOf(lines, name)) - Math.abs(b - colOf(lines, name)))[0]
    const flexor = colOf(lines, 'Flexor')
    const flexorStem = Math.max(...[...lineAt(lines, rowOf(lines, 'Flexor') + 1)].flatMap((ch, i) => (ch === '┬' && Math.abs(i - flexor - 3) < 6 ? [i] : [])))

    const heads = [...lineAt(lines, twilio - 2)].flatMap((ch, i) => (ch === '▼' ? [i] : []))

    expect(heads).toContain(flexorStem)
    expect(heads).toHaveLength(2)
    expect(heads[0]).toBeLessThan(flexorStem)
    expect(lines.slice(rowOf(lines, 'Idiophone'), twilio).some(line => line.includes('┼'))).toBe(false)
    expect(nearest(rowOf(lines, 'OKaaS') + 1, '┬', 'OKaaS')).toBe(nearest(rowOf(lines, 'Flexor') - 2, '▼', 'Flexor'))
  })

  test('keeps a bus mid-box when the only straight edge would land near a corner', async () => {
    const { lines } = draw('flowchart TD\n    Start([Policy expiring]) --> Auto{HV vertical?}\n    Auto -->|no| CoCo[Auto renewal via CoCo]\n    Auto -->|yes| ARWI[ARWI with consultant]\n    CoCo --> Rate[Premium adjustment]\n    ARWI --> Full[Full rating]\n    Rate --> Offer[Renewal offer]\n    Full --> Offer\n    Offer --> Accept{Customer accepts?}\n    Accept -->|yes| Bind[Bind renewal]\n    Accept -->|no| Lapse[Lapse policy]\n    Accept -->|changes| MTA[Manual renewal in backoffice]\n    MTA --> Full\n    Bind --> Docs[[Generate documents]]\n    Docs --> Done([Done])\n    Lapse --> Done', 117)
    const offer = rowOf(lines, 'Renewal offer')
    const head = [...lineAt(lines, offer - 2)].indexOf('▼')
    const middle = colOf(lines, 'Renewal offer') + 'Renewal offer'.length / 2

    expect(Math.abs(head - middle)).toBeLessThanOrEqual(2)
  })

  test('draws top-down boxes an odd number of cells wide, so stems and heads sit on the exact middle', async () => {
    const { lines } = draw('flowchart TD\nA[Draft] --> B[Review]')
    for (const row of [0, rowOf(lines, 'Review') - 1]) {
      const top = [...lineAt(lines, row)]
      expect((top.lastIndexOf('┐') - top.indexOf('┌')) % 2).toBe(0)
    }
    const top = [...lineAt(lines, 0)]
    expect([...lineAt(lines, 2)].indexOf('┬')).toBe((top.indexOf('┌') + top.lastIndexOf('┐')) / 2)
  })

  test('centres a parent over the span of its children', async () => {
    const { lines } = draw('graph TD\nA[Chopin] --> Q[Quid]\nA --> O[OKaaS]\nA --> C[CMAS]\nQ --> R[Rater]\nQ --> E[Earnix]\nO --> F[Flexor]\nC --> G[account-api-gw]', 117)
    expect(lines[4]).toMatch(/┼/)
    for (const [parent, bar] of [['Quid', rowOf(lines, 'Quid') + 3]] as const) {
      const stem = [...lineAt(lines, rowOf(lines, parent) + 1)].indexOf('┬')
      const bus = [...lineAt(lines, bar)]
      const ends = bus.flatMap((ch, i) => ('┌┐'.includes(ch) ? [i] : [])).filter(i => Math.abs(i - stem) < 30)
      expect(Math.abs(stem - (Math.min(...ends) + Math.max(...ends)) / 2)).toBeLessThanOrEqual(1)
    }
  })

  test('keeps a lone parent over a child that was centred over its own children', async () => {
    const { lines } = draw('flowchart TD\n    A[Customer submits REQ] --> B{Trade supported?}\n    B -->|no| C[Decline]\n    B -->|yes| D[Enrich risk profile]\n    D --> E[Rate with Tarif]\n    E --> F{Any quotes?}\n    F -->|none| G[PL limit fallback]\n    G --> E\n    F -->|some| H[Apply filter overrides]\n    H --> I[(Persist offerset)]\n    I --> J([Show QCP])\n    E -.-> K[Oracle overlay]\n    K -.-> F', 117)
    const stem = [...lineAt(lines, 2)].indexOf('┬')
    const head = [...lineAt(lines, rowOf(lines, 'Trade supported') - 2)].indexOf('▼')

    expect(head).toBe(stem)
    expect(lines.slice(3, rowOf(lines, 'Trade supported') - 2).every(line => line.trim() === '│')).toBe(true)
  })

  test('sends a short edge out of its own port when the box also starts a long edge', async () => {
    const { lines } = draw('flowchart TD\nF[Flexor] --> I[Idiophone]\nF --> T[Twilio]\nI --> T')

    expect([...lineAt(lines, 2)].filter(ch => ch === '┬')).toHaveLength(2)
  })

  test('keeps a decision\'s branches in declared order', async () => {
    const { lines } = draw('flowchart TD\nA[Start] --> F{Any?}\nF -->|none| G[Fallback]\nG --> A\nF -->|some| H[Apply]')
    const row = lineAt(lines, rowOf(lines, 'Fallback'))

    expect(row.indexOf('Fallback')).toBeLessThan(row.indexOf('Apply'))
  })
})

describe('drawFlow ordering', () => {
  test('keeps siblings beside each other when that saves a crossing', async () => {
    const { lines } = draw('graph TD\nA[Chopin] --> Q[Quid]\nA --> O[OKaaS]\nA --> C[CMAS]\nQ --> R[Rater]\nQ --> E[Earnix]\nO --> F[Flexor]\nF --> I[Idiophone]\nF --> T[Twilio]\nI --> T\nC --> G[Gateway]\nG --> P[PIMMS]')
    const row = lineAt(lines, rowOf(lines, 'Rater'))

    expect(row.indexOf('Earnix')).toBeLessThan(row.indexOf('Flexor'))
  })
})

describe('drawFlow subgraphs', () => {
  test('frames a subgraph round its members with its title in the top border', async () => {
    const { lines } = draw('flowchart TD\nX[Outside] --> A\nsubgraph S [Services]\nA[Alpha] --> B[Beta]\nend\nB --> Y[After]')
    const top = rowOf(lines, 'Services')
    const left = lineAt(lines, top).indexOf('╭')

    expect(lines[top]).toMatch(/^ *╭[─│┼]*─ Services ─+╮$/)
    expect(top).toBeGreaterThan(rowOf(lines, 'Outside'))
    expect(top).toBeLessThan(rowOf(lines, 'Alpha'))
    for (const name of ['Alpha', 'Beta']) expect(lineAt(lines, rowOf(lines, name))[left]).toBe('│')
    expect(lineAt(lines, rowOf(lines, 'After'))[left]).not.toBe('│')
  })

  test('moves a box that is not a member out of the way of a subgraph\'s frame, and draws no blank rows above the chart', async () => {
    const { lines } = draw('flowchart LR\nsubgraph In [Ingest]\nW[Webhook] --> R[Router]\nend\nsubgraph Fx [Flexor]\nL[Lead] --> S{Score?}\nS -->|yes| H[Hot]\nS -->|no| N[Cold]\nend\nR --> L\nR -.-> D[(Warehouse)]', 200)

    expect(lines.join('\n')).toContain('Ingest')
    expect(lines.join('\n')).toContain('Flexor')
    expect(lineAt(lines, 0).trim()).not.toBe('')
  })

  test('marks where an edge crosses a frame instead of breaking the border', async () => {
    const { lines } = draw('flowchart TD\nX[Outside] --> A\nsubgraph S [Services]\nA[Alpha] --> B[Beta]\nend\nB --> Y[After]')
    const top = rowOf(lines, 'Services')
    const bottom = lines.findIndex((line, i) => i > top && line.includes('╰'))

    expect(lines[top]).toContain('┼')
    expect(lines[bottom]).toContain('┼')
  })

  test('joins edges of one stroke into a box on a bus that meets over one centred head', async () => {
    const { lines } = draw('flowchart TD\nA[Left side] --> C[Done]\nB[Right side] --> C')
    const done = rowOf(lines, 'Done')
    const head = [...lineAt(lines, done - 2)].indexOf('▼')
    const box = lineAt(lines, done)

    expect([...lineAt(lines, done - 2)].filter(ch => ch === '▼')).toHaveLength(1)
    expect(Math.abs(head - (box.indexOf('│') + box.lastIndexOf('│')) / 2)).toBeLessThanOrEqual(1)
    expect(lines.some(line => /└─+┬─+┘/.test(line))).toBe(true)
  })

  test('joins edges of one stroke into a left-right box at one port on its side', async () => {
    const { lines } = draw('flowchart LR\nA[Top] --> C[Done]\nB[Low] --> C\nX[Up] --> A\nX --> B')

    expect(lines.join('\n').split('▶│ Done').length - 1).toBe(1)
    expect(lines.join('\n')).not.toMatch(/[▼▲]/)
  })

  test('ends an arrow into a framed box inside the frame, with a cell between frame and head', async () => {
    const { lines } = draw('flowchart LR\nA[Before] --> L\nsubgraph G [Group]\nL[Lead] --> M[More]\nend', 120)
    const row = lineAt(lines, rowOf(lines, 'Lead'))

    expect(row).toMatch(/┼─+▶│ Lead/)
  })

  test('keeps edges turning outside a frame at least three cells clear of it', async () => {
    const { lines } = draw('flowchart LR\nsubgraph G [Group]\nA[One] --> B[Two]\nA --> C[Three]\nend\nB --> T[Out]\nC --> T', 160)
    const frame = must(lines.find(line => line.includes('╮')), 'frame').indexOf('╮')
    const turns = lines.flatMap(line => [...line].flatMap((ch, i) => ('┐┘├┤'.includes(ch) && i > frame ? [i] : [])))

    expect(Math.min(...turns) - frame).toBeGreaterThanOrEqual(3)
  })

  test('sets a lone parent level with its only child even when a neighbour has to move aside', async () => {
    const { lines } = draw('flowchart LR\n    subgraph Ingest\n        W[SB-webhook] --> R[lead-router]\n    end\n    subgraph Flexor\n        L[Lead processor] --> S{Score >= 70?}\n        S -->|yes| H[CBD queue]\n        S -->|no| N[Nurture queue]\n    end\n    R -->|lead_captured| L\n    R -.->|prospect_data_collected| D[(Snowflake)]\n    H --> T([Twilio Flex])\n    N --> T', 200)

    expect(rowOf(lines, 'Lead processor')).toBe(rowOf(lines, 'Score >= 70?'))
    expect(rowOf(lines, 'lead-router')).toBe(rowOf(lines, 'Lead processor'))
  })

  test('keeps the members of a subgraph side by side in a rank', async () => {
    const { lines } = draw('flowchart TD\nR --> A & X & B\nsubgraph G [Group]\nA\nB\nend')
    const row = lineAt(lines, rowOf(lines, ' A '))

    const a = row.indexOf(' A ')
    const b = row.indexOf(' B ')
    const x = row.indexOf(' X ')

    expect(x > Math.min(a, b) && x < Math.max(a, b)).toBe(false)
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
    expect(lineAt(lines, top) + lineAt(lines, bottom)).toMatch(/[┴┬]/)
  })

  test('keeps the label on an edge that leaves through a box\'s top or bottom', async () => {
    const { lines } = draw('flowchart LR\nR[Router] -->|captured| L[Lead]\nR -.->|collected| D[(Store)]\nL --> X[Next]', 160)

    expect(lines.join('\n')).toContain('captured')
    expect(lines.join('\n')).toContain('collected')
  })

  test('runs the main edge into a left-right decision\'s tip and drops another onto its top with a head of its own', async () => {
    const { lines } = draw('flowchart LR\nE[Rate] --> F{Any?}\nE -.-> K[Side]\nK -.-> F')
    const top = rowOf(lines, '╱───')
    const tip = must(lines.find(line => line.includes('◇')), 'tip')

    expect(tip).toMatch(/Rate *├─+▶◇/)
    expect(lines[top - 1]).toContain('▼')
    expect([...lineAt(lines, top - 1)].indexOf('▼')).toBeGreaterThan([...lineAt(lines, top)].indexOf('╱'))
    expect([...lineAt(lines, top - 1)].indexOf('▼')).toBeLessThan([...lineAt(lines, top)].indexOf('╲'))
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

describe('drawFlow labels it cannot shorten', () => {
  test('widens a box for a word longer than the wrap width instead of cutting it', async () => {
    const { lines } = draw('flowchart TD\nA[supercalifragilisticexpialidocious] --> B')

    expect(lines.join('\n')).toContain('supercalifragilisticexpialidocious')
  })

  test('keeps a long word in an edge label whole', async () => {
    const { lines, notes } = draw('flowchart TD\nA -- a supercalifragilisticexpialidocious label --> B')

    expect([...lines, ...notes].join('\n')).toContain('supercalifragilisticexpialidocious')
    expect([...lines, ...notes].join('\n')).not.toContain('…')
  })

  test('draws nothing when a box word is wider than the terminal', async () => {
    expect(draw('flowchart TD\nA[supercalifragilisticexpialidocious] --> B', 20).drawn).toBeUndefined()
  })
})

describe('drawFlow wide and combining characters', () => {
  test('lets a wide character fill two cells, with no gap after it', async () => {
    const { lines } = draw('flowchart TD\nA[東京] --> B')

    expect(lines.join('\n')).toContain('│ 東京  │')
  })

  test('keeps every row of a box the same width round wide and combining characters', async () => {
    for (const label of ['東京', 'Cafe\u0301']) {
      const { lines } = draw(`flowchart TD\nA[${label}]`)

      expect(new Set(lines.map(cellWidth)).size).toBe(1)
    }
  })
})

describe('drawFlow subgraph frames that cannot fit', () => {
  test('draws nothing rather than a subgraph without its frame', async () => {
    expect(draw('flowchart TD\nsubgraph S [A subgraph title far too long for this terminal]\nA\nend', 30).drawn).toBeUndefined()
  })
})


describe('drawFlow heads into one box', () => {
  test('keeps a line without a head off the bus of arrows into the same box, top-down', async () => {
    const { lines } = draw('flowchart TD\nA --> C\nB --- C')

    const into = lineAt(lines, rowOf(lines, 'C') - 2)

    expect(into.trim()).toBe('▼ │')
  })

  test('gives a line without a head its own port beside an arrow, left to right', async () => {
    const { lines } = draw('flowchart LR\nA --> C\nB --- C')

    expect(lines.filter(line => line.includes('▶'))).toHaveLength(1)
    expect(lines.some(line => line.includes('├─▶'))).toBe(false)
  })

  test('throws, so the source shows, when a line and an arrow would meet at a decision tip', async () => {
    expect(() => draw('flowchart LR\nA --> C{ok?}\nB --- C')).toThrow('a line and an arrow into C would share one head')
  })
})
