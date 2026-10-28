import { describe, expect, test } from 'claude-code/testing'

import { isFlow, parseFlow } from '../hooks/flow'
import { must } from '../hooks/must'

const edges = (source: string) => parseFlow(source).edges.map(e => `${e.from}>${e.to}${e.label ? `:${e.label}` : ''}`)

describe('isFlow', () => {
  test('knows flowchart and graph headers', async () => {
    expect(isFlow('flowchart LR\nA-->B')).toBe(true)
    expect(isFlow('%% c\ngraph TD\nA-->B')).toBe(true)
    expect(isFlow('sequenceDiagram\nA->>B: hi')).toBe(false)
  })
})

describe('parseFlow', () => {
  test('reads the direction, TB meaning TD', async () => {
    expect(parseFlow('flowchart LR\nA-->B').direction).toBe('LR')
    expect(parseFlow('graph TB\nA-->B').direction).toBe('TD')
    expect(parseFlow('graph\nA-->B').direction).toBe('TD')
  })

  test('reads node shapes and labels', async () => {
    const { nodes } = parseFlow('flowchart TD\nA[Start] --> B{Is it?}\nB --> C(Round)\nC --> D([Stadium])\nD --> E[(Store)]\nE --> F((Hub))\nF --> G{{Prep}}\nG --> H[[Call]]')

    expect(nodes.map(n => [n.id, n.label, n.shape])).toEqual([
      ['A', 'Start', 'box'],
      ['B', 'Is it?', 'diamond'],
      ['C', 'Round', 'round'],
      ['D', 'Stadium', 'stadium'],
      ['E', 'Store', 'database'],
      ['F', 'Hub', 'circle'],
      ['G', 'Prep', 'hexagon'],
      ['H', 'Call', 'subroutine'],
    ])
  })

  test('keeps a quoted label whole, brackets and <br/> included', async () => {
    const { nodes } = parseFlow('flowchart TD\nA["Rate (v2)<br/>[beta]"] --> B')

    expect(must(nodes[0], 'node').label).toBe('Rate (v2)\n[beta]')
  })

  test('reads edge labels in both spellings and chains', async () => {
    expect(edges('flowchart TD\nA -->|yes| B --> C\nA -- no --> D')).toEqual(['A>B:yes', 'B>C', 'A>D:no'])
  })

  test('reads strokes and heads', async () => {
    const { edges: all } = parseFlow('flowchart TD\nA -.-> B\nB ==> C\nC --- D\nD <--> E\nE ~~~ F')

    expect(all.map(e => [e.stroke, e.head, e.tail])).toEqual([
      ['dotted', true, false],
      ['thick', true, false],
      ['solid', false, false],
      ['solid', true, true],
      ['invisible', false, false],
    ])
  })

  test('reads compact edges with no spaces, keeping hyphens and dots inside ids', async () => {
    const flow = parseFlow('flowchart TD\nA-->B\nB---C\nC-.->D\nD==>E\nE--oF\nmy-node.v2-->G\nmy-order-->G')

    expect(flow.edges.map(e => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C', 'C>D', 'D>E', 'E>F', 'my-node.v2>G', 'my-order>G'])
    expect(flow.nodes.map(n => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'my-node.v2', 'G', 'my-order'])
    expect(flow.problems).toEqual([])
  })

  test('splits statements on ; but not inside a quoted label or an entity', async () => {
    const flow = parseFlow('flowchart TD\nA["first; second"] --> B; B --> C["no &#35;1"]')

    expect(flow.edges.map(e => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C'])
    expect(flow.nodes.map(n => n.label)).toEqual(['first; second', 'B', 'no #1'])
    expect(flow.problems).toEqual([])
  })

  test('fans out over &', async () => {
    expect(edges('flowchart TD\nA & B --> C & D')).toEqual(['A>C', 'A>D', 'B>C', 'B>D'])
  })

  test('puts nodes in the subgraph that names them and skips styling lines', async () => {
    const flow = parseFlow('flowchart TD\nX --> A\nsubgraph S [Services]\nA --> B\nend\nclassDef hot fill:#f00\nclass A hot\nstyle B fill:#0f0')

    expect(flow.groups).toEqual([{ id: 'S', label: 'Services', parent: undefined }])
    expect(flow.nodes.map(n => [n.id, n.group])).toEqual([
      ['X', undefined],
      ['A', 'S'],
      ['B', 'S'],
    ])
    expect(flow.problems).toEqual([])
  })

  test('keeps a line it cannot read as a problem', async () => {
    expect(parseFlow('flowchart TD\nA --> B\nA -> ->').problems).toEqual(['line not read: A -> ->'])
  })
})
