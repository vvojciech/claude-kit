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

  test('looks past YAML front matter for the header', async () => {
    expect(isFlow('---\ntitle: Orders\n---\nflowchart LR\nA-->B')).toBe(true)
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
    const flow = parseFlow('flowchart TD\nA-->B\nB---C\nC-.->D\nD==>E\nmy-node.v2-->G\nmy-order-->G')

    expect(flow.edges.map(e => `${e.from}>${e.to}`)).toEqual(['A>B', 'B>C', 'C>D', 'D>E', 'my-node.v2>G', 'my-order>G'])
    expect(flow.nodes.map(n => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'my-node.v2', 'G', 'my-order'])
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

  test('keeps controls out of labels, numeric entities and literal ones alike', async () => {
    const { nodes } = parseFlow('flowchart TD\nA["wipe &#27;[2J"] --> B["bell \u0007 #55296;"]')

    expect(nodes.map(n => n.label)).toEqual(['wipe \ufffd[2J', 'bell  \ufffd'])
    expect(() => parseFlow('flowchart TD\nA["&#99999999;"]')).toThrow()
  })

  test('decodes Mermaid #...; entities, numeric and named, without splitting the statement', async () => {
    const flow = parseFlow('flowchart TD\nA[Ticket #35;42] --> B["say #quot;hi#quot;"]')

    expect(flow.nodes.map(n => n.label)).toEqual(['Ticket #42', 'say "hi"'])
    expect(flow.problems).toEqual([])
  })

  test('reads %% as a comment only outside a quoted label', async () => {
    const flow = parseFlow('flowchart TD\nA["completion %% done"] --> B %% trailing note')

    expect(flow.nodes.map(n => n.label)).toEqual(['completion %% done', 'B'])
    expect(flow.problems).toEqual([])
  })

  test('reports circle and cross ends, which it cannot draw', async () => {
    for (const link of ['--o', '--x', 'o--o', 'x--x', '-- text --o', '---o']) expect(parseFlow(`flowchart TD\nA ${link} B`).problems).toHaveLength(1)
    expect(parseFlow('flowchart TD\nA --- oak').problems).toEqual([])
  })

  test('reports a subgraph direction other than the chart\'s', async () => {
    expect(parseFlow('flowchart TD\nsubgraph S\ndirection LR\nA --> B\nend').problems).toEqual(['subgraph direction not drawn yet: direction LR'])
    expect(parseFlow('flowchart TD\nsubgraph S\ndirection TB\nA --> B\nend').problems).toEqual([])
  })

  test('reports a subgraph inside a subgraph', async () => {
    expect(parseFlow('flowchart TD\nsubgraph O\nsubgraph I\nA --> B\nend\nend').problems).toEqual(['subgraph inside a subgraph not drawn yet: I'])
  })

  test('reports an extra end and a subgraph left open', async () => {
    expect(parseFlow('flowchart TD\nA --> B\nend').problems).toEqual(['end with no subgraph open'])
    expect(parseFlow('flowchart TD\nsubgraph S\nA --> B').problems).toEqual(['subgraph not closed: S'])
  })

  test('reports an edge to a subgraph, declared before or after it', async () => {
    expect(parseFlow('flowchart TD\nX --> S\nsubgraph S\nA\nend').problems).toEqual(['links to a subgraph not drawn yet: S'])
    expect(parseFlow('flowchart TD\nsubgraph S [Group]\nA\nend\nS --> X').problems).toEqual(['links to a subgraph not drawn yet: S'])
  })
})
