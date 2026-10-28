// Lays a flowchart out in ranks and draws it on a character grid.
//
// Ranks run down the page for TD/BT and across it for LR/RL. Every edge leaves its source through
// one port, crosses the channel between two ranks on a track of its own, and enters its target
// through a port of its own, so arrows never share a head. An edge that spans several ranks runs
// through a one-cell placeholder in each rank it passes. Lines are kept as directions per cell and
// turned into box-drawing glyphs at the end, so meeting lines join as ┬ ┼ ┤ instead of overwriting.
import type { Direction, Flow, FlowEdge, FlowNode, Group, Shape, Stroke } from './flow'
import type { Ink, Run } from './render'
import { wrap } from './render'
import { must } from './must'
import { cellWidth } from './width'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8

const GLYPHS: Record<'solid' | 'thick', string[]> = {
  //       0    U    D    UD   L    UL   DL   UDL  R    UR   DR   UDR  LR   ULR  DLR  UDLR
  solid: [' ', '│', '│', '│', '─', '┘', '┐', '┤', '─', '└', '┌', '├', '─', '┴', '┬', '┼'],
  thick: [' ', '┃', '┃', '┃', '━', '┛', '┓', '┫', '━', '┗', '┏', '┣', '━', '┻', '┳', '╋'],
}

type Cell = { mask: number; stroke: Stroke; char?: string; ink: Ink; lane?: number }

class Grid {
  cells: Cell[][] = []

  at(x: number, y: number): Cell {
    // off the grid's top or left edge a cell is thrown away, never drawn
    if (x < 0 || y < 0) return { mask: 0, stroke: 'solid', ink: 'line' }
    while (this.cells.length <= y) this.cells.push([])
    const row = must(this.cells[y], 'grid row')
    while (row.length <= x) row.push({ mask: 0, stroke: 'solid', ink: 'line' })
    return must(row[x], 'grid cell')
  }

  isFree(x: number, y: number): boolean {
    if (x < 0 || y < 0) return false
    const cell = this.cells[y]?.[x]
    return cell === undefined || (cell.mask === 0 && cell.char === undefined)
  }

  put(x: number, y: number, char: string, ink: Ink, lane?: number) {
    Object.assign(this.at(x, y), { char, ink, lane })
  }

  // a wide character's second cell is left empty, so the row keeps its width
  write(x: number, y: number, text: string, ink: Ink, lane?: number) {
    let at = x
    for (const { segment } of segmenter.segment(text)) {
      const w = cellWidth(segment)
      if (w === 0) continue
      this.put(at, y, segment, ink, lane)
      if (w === 2) this.put(at + 1, y, '', ink, lane)
      at += w
    }
  }

  // a straight run of line between two cells on one row or one column, ends included
  line(x0: number, y0: number, x1: number, y1: number, stroke: Stroke, lane?: number) {
    if (stroke === 'invisible') return
    if (y0 === y1) {
      const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0]
      for (let x = a; x <= b; x++) this.mark(x, y0, (x > a ? LEFT : 0) | (x < b ? RIGHT : 0), stroke, lane)
    } else {
      const [a, b] = y0 < y1 ? [y0, y1] : [y1, y0]
      for (let y = a; y <= b; y++) this.mark(x0, y, (y > a ? UP : 0) | (y < b ? DOWN : 0), stroke, lane)
    }
  }

  mark(x: number, y: number, bits: number, stroke: Stroke, lane?: number) {
    const cell = this.at(x, y)
    if (cell.char !== undefined) return
    // where two edges share a cell the solid one shows, so a trunk two strokes meet on stays solid
    if (cell.mask === 0 || stroke === 'solid') cell.stroke = stroke
    cell.mask |= bits
    if (lane !== undefined) cell.lane = lane
  }

  runs(width: number): Run[][] {
    return this.cells.map(row => {
      const runs: Run[] = []
      for (const cell of row.slice(0, width)) {
        const char = cell.char ?? glyph(cell)
        // a dotted edge is dimmed as well as dashed, so a run too short to show a gap still reads dotted
        const ink = cell.char === undefined && cell.stroke === 'dotted' ? 'frame' : cell.ink
        if (char === '') continue
        const last = runs.at(-1)
        if (last && last.ink === ink && last.lane === cell.lane) last.text += char
        else runs.push({ text: char, ink, ...(cell.lane === undefined ? {} : { lane: cell.lane }) })
      }
      const end = runs.at(-1)
      if (end) end.text = end.text.trimEnd()
      return runs.filter(run => run.text !== '')
    })
  }
}

function glyph(cell: Cell): string {
  const mask = cell.mask === UP || cell.mask === DOWN ? UP | DOWN : cell.mask === LEFT || cell.mask === RIGHT ? LEFT | RIGHT : cell.mask
  if (cell.stroke === 'dotted') {
    if (mask === (UP | DOWN)) return '┊'
    if (mask === (LEFT | RIGHT)) return '╌'
  }
  return must(GLYPHS[cell.stroke === 'thick' ? 'thick' : 'solid'][mask], 'glyph')
}

// ── layout ────────────────────────────────────────────────────────────────────────────────────

type Vertex = {
  key: string
  node?: FlowNode
  rank: number
  order: number
  lines: string[]
  main: number // size along the rank axis
  cross: number // size along the order axis
  at: number // cross position of the first cell
}

type Route = { edge: FlowEdge; path: Vertex[] }
// an edge that turns back up a cycle, drawn round the outside of the chart
type Loop = { edge: FlowEdge; from: Vertex; to: Vertex; near: boolean }

export type FlowDrawn = { rows: Run[][]; notes: string[] }

const isAcross = (d: Direction) => d === 'LR' || d === 'RL'

// a word longer than the cap widens the label rather than losing its end
function uncut(text: string, cap: number): string[] {
  const wrapped = wrap(text, cap)
  return wrapped.isCut ? wrap(text, Math.max(cap, ...text.split(' ').map(cellWidth))).lines : wrapped.lines
}

function boxOf(node: FlowNode, cap: number, across: boolean): Pick<Vertex, 'lines' | 'main' | 'cross'> {
  const lines = node.label.split('\n').flatMap(part => uncut(part, cap)).map(line => line.replace(/ /g, ' '))
  const text = Math.max(1, ...lines.map(cellWidth))
  const pad = node.shape === 'diamond' || node.shape === 'hexagon' || node.shape === 'circle' ? 3 : 2
  // top-down, a box is an odd number of cells wide, so it has one middle column for its stems
  const width = text + 2 * pad + (!across && (text + 2 * pad) % 2 === 0 ? 1 : 0)
  const height = lines.length + 2
  return { lines, main: across ? width : height, cross: across ? height : width }
}

// Edges that close a cycle are laid out reversed, so every rank points one way. The edge turned
// round is the one against the flow: on a cycle, from a node to one reached before it walking
// breadth-first from the roots in source order. Whatever cycle that leaves is broken where a
// depth-first walk closes it.
function ranksOf(flow: Flow): { rank: Map<string, number>; back: Set<FlowEdge> } {
  const out = new Map<string, FlowEdge[]>(flow.nodes.map(n => [n.id, []]))
  for (const edge of flow.edges) if (edge.from !== edge.to) out.get(edge.from)?.push(edge)
  const back = againstFlow(flow, out, reachOrder(flow, out))
  closeCycles(flow, out, back)
  return { rank: longestPath(flow, back), back }
}

function reachOrder(flow: Flow, out: Map<string, FlowEdge[]>): Map<string, number> {
  const named = new Map<string, number>()
  const into = new Set(flow.edges.filter(e => e.from !== e.to).map(e => e.to))
  const roots = flow.nodes.filter(n => !into.has(n.id))
  for (const start of [...roots, ...flow.nodes]) {
    if (named.has(start.id)) continue
    named.set(start.id, named.size)
    const queue = [start.id]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      for (const edge of out.get(id) ?? []) {
        if (named.has(edge.to)) continue
        named.set(edge.to, named.size)
        queue.push(edge.to)
      }
    }
  }
  return named
}

function againstFlow(flow: Flow, out: Map<string, FlowEdge[]>, named: Map<string, number>): Set<FlowEdge> {
  const reaches = (from: string, to: string) => {
    const seen = new Set([from])
    const queue = [from]
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (id === to) return true
      for (const edge of out.get(id) ?? []) if (!back.has(edge) && !seen.has(edge.to)) seen.add(edge.to) && queue.push(edge.to)
    }
    return false
  }
  const order = (id: string) => must(named.get(id), 'reach order')
  // the edge furthest against the flow turns first; one that no longer closes a cycle stays put
  const back = new Set<FlowEdge>()
  const against = flow.edges.filter(e => e.from !== e.to && order(e.to) < order(e.from))
  against.sort((a, b) => order(b.from) - order(b.to) - (order(a.from) - order(a.to)))
  for (const edge of against) if (reaches(edge.to, edge.from)) back.add(edge)
  return back
}

function closeCycles(flow: Flow, out: Map<string, FlowEdge[]>, back: Set<FlowEdge>) {
  const state = new Map<string, 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const edge of out.get(id) ?? []) {
      if (back.has(edge)) continue
      const seen = state.get(edge.to)
      if (seen === 1) back.add(edge)
      else if (seen === undefined) visit(edge.to)
    }
    state.set(id, 2)
  }
  for (const node of flow.nodes) if (!state.has(node.id)) visit(node.id)
}

function longestPath(flow: Flow, back: Set<FlowEdge>): Map<string, number> {
  const rank = new Map<string, number>(flow.nodes.map(n => [n.id, 0]))
  const rankOf = (id: string) => must(rank.get(id), 'rank')
  // longest path, relaxed until nothing moves (the graph is acyclic once back edges turn round)
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let moved = false
    for (const edge of flow.edges) {
      if (edge.from === edge.to) continue
      const [a, b] = back.has(edge) ? [edge.to, edge.from] : [edge.from, edge.to]
      const want = rankOf(a) + 1
      if (rankOf(b) < want) {
        rank.set(b, want)
        moved = true
      }
    }
    if (!moved) break
  }
  return rank
}

// pool-adjacent-violators: places boxes in order, as close to where each wants to be as overlap allows
function settle(wants: number[], sizes: number[], gap: number, weights: number[] = sizes.map(() => 1)): number[] {
  type Block = { first: number; last: number; at: number; weight: number; sum: number }
  const blocks: Block[] = []
  const offset: number[] = []
  let run = 0
  sizes.forEach(size => {
    offset.push(run)
    run += size + gap
  })
  wants.forEach((want, i) => {
    const weight = must(weights[i], 'weight')
    const from = must(offset[i], 'offset')
    let block: Block = { first: i, last: i, sum: weight * (want - from), weight, at: want - from }
    for (let prev = blocks.at(-1); prev && prev.at > block.at; prev = blocks.at(-1)) {
      blocks.pop()
      block = { first: prev.first, last: block.last, sum: prev.sum + block.sum, weight: prev.weight + block.weight, at: 0 }
      block.at = block.sum / block.weight
    }
    blocks.push(block)
  })
  const at: number[] = []
  for (const block of blocks) for (let i = block.first; i <= block.last; i++) at.push(Math.round(block.at) + must(offset[i], 'offset'))
  // rounding can close a gap by one; push right where it did
  let end = -Infinity
  return at.map((x, i) => {
    const pushed = Math.max(x, end)
    end = pushed + must(sizes[i], 'size') + gap
    return pushed
  })
}

type Layout = { vertices: Vertex[]; ranks: Vertex[][]; routes: Route[]; loops: Loop[]; across: boolean; reversed: boolean }

// each vertex's neighbours a rank up and a rank down, and the gap kept between boxes in a rank
type Ranked = { ranks: Vertex[][]; ups: Map<Vertex, Vertex[]>; downs: Map<Vertex, Vertex[]>; solid: Map<Vertex, Vertex[]>; gap: number }

const centre = (v: Vertex) => v.at + Math.floor(v.cross / 2)

function layout(flow: Flow, cap: number): Layout {
  const across = isAcross(flow.direction)
  const reversed = flow.direction === 'BT' || flow.direction === 'RL'
  const { rank, back } = ranksOf(flow)
  const vertices = flow.nodes.map((node): Vertex => ({ key: node.id, node, rank: must(rank.get(node.id), 'rank'), order: 0, at: 0, ...boxOf(node, cap, across) }))
  const { routes, loops } = routesOf(flow, vertices, back)
  portRoom(vertices, routes, across)
  const top = Math.max(0, ...vertices.map(v => v.rank))
  const ranks: Vertex[][] = Array.from({ length: top + 1 }, () => [])
  for (const v of vertices) must(ranks[v.rank], 'rank').push(v)
  // a frame needs a cell either side of its members and a cell between it and its neighbour
  const t: Ranked = { ranks, ...neighbours(routes), gap: flow.groups.length > 0 ? 5 : across ? 1 : 3 }
  for (const list of ranks) list.forEach((v, i) => {
    v.order = i
  })
  orderRanks(vertices, t)
  gatherGroups(ranks)
  sideLoops(loops, ranks)
  loopRows(vertices, loops)
  spread(t)
  for (let pass = 0; pass < 2; pass++) {
    overChild(t)
    underParent(t)
  }
  // centring a box can leave its parent a cell off; the two settle together over a few rounds
  for (let round = 0; round < 3; round++) {
    overChildren(t)
    overChild(t)
  }
  clearFrames(flow, vertices, t)
  // a chart with subgraphs keeps two cells clear on its near side for a frame's border
  const least = Math.min(...vertices.map(v => v.at)) - (flow.groups.length > 0 ? 2 : 0)
  for (const v of vertices) v.at -= least
  return { vertices, ranks, routes, loops, across, reversed }
}

function routesOf(flow: Flow, vertices: Vertex[], back: Set<FlowEdge>): { routes: Route[]; loops: Loop[] } {
  const byId = new Map<string, Vertex>(vertices.map(v => [v.key, v]))
  const vertexOf = (id: string) => must(byId.get(id), 'vertex')
  const routes: Route[] = []
  const loops: Loop[] = []
  for (const edge of flow.edges) {
    if (edge.from === edge.to) continue
    const [a, b] = [vertexOf(edge.from), vertexOf(edge.to)]
    if (back.has(edge) || a.rank === b.rank) {
      loops.push({ edge, from: a, to: b, near: false })
      continue
    }
    const path = [a]
    for (let r = a.rank + 1; r < b.rank; r++) {
      const dummy: Vertex = { key: `${edge.from}>${edge.to}#${routes.length}@${r}`, rank: r, order: 0, at: 0, lines: [], main: 0, cross: 1 }
      vertices.push(dummy)
      path.push(dummy)
    }
    path.push(b)
    routes.push({ edge, path })
  }
  return { routes, loops }
}

// a box is long enough along its sides to give each arriving edge and each leaving stroke a port
// of its own, two cells apart, so no two of them share a line
// (left to right, extra strokes and arrows use a box's top and bottom instead, so it never grows)
function portRoom(vertices: Vertex[], routes: Route[], across: boolean) {
  for (const v of vertices) {
    if (!v.node) continue
    // left to right, a line without a head lands a port apart from the arrows into the same side
    const into = routes.filter(r => r.path.at(-1) === v)
    if (across && new Set(into.map(r => r.edge.head)).size > 1) v.cross = Math.max(v.cross, 2 * new Set(into.map(joinKey)).size + 1)
    if (across) continue
    // edges into a left-right decision all meet at its tip, so they need no room along its sides
    const meets = across && (v.node.shape === 'diamond' || v.node.shape === 'hexagon')
    const arriving = meets ? 1 : routes.filter(r => r.path.at(-1) === v).length
    const strokes = new Set(routes.filter(r => r.path[0] === v).map(r => r.edge.stroke)).size
    v.cross = Math.max(v.cross, 2 * Math.max(arriving, strokes) + 1)
  }
}

function neighbours(routes: Route[]): Pick<Ranked, 'ups' | 'downs' | 'solid'> {
  const ups = new Map<Vertex, Vertex[]>()
  const downs = new Map<Vertex, Vertex[]>()
  // the children a box reaches by solid edges: the main line it sits over
  const solid = new Map<Vertex, Vertex[]>()
  const add = (map: Map<Vertex, Vertex[]>, from: Vertex, to: Vertex) => map.set(from, [...(map.get(from) ?? []), to])
  for (const { edge, path } of routes) if (edge.stroke === 'solid') add(solid, must(path[0], 'source'), must(path[1], 'step'))
  for (const { path } of routes)
    for (const [i, v] of path.slice(1).entries()) {
      const u = must(path[i], 'step')
      add(ups, v, u)
      add(downs, u, v)
    }
  return { ups, downs, solid }
}

// every sweep is scored by the crossings it leaves, and the best order seen is the one kept
function crossings(ranks: Vertex[][], downs: Map<Vertex, Vertex[]>): number {
  let count = 0
  for (const list of ranks) {
    const pairs = list.flatMap(u => (downs.get(u) ?? []).map(v => [u.order, v.order] as const))
    for (const [i, [a0, a1]] of pairs.entries()) for (const [b0, b1] of pairs.slice(i + 1)) if ((a0 - b0) * (a1 - b1) < 0) count++
  }
  return count
}

// barycentre sweeps cut crossings; ties keep the order the source gave
function orderRanks(vertices: Vertex[], { ranks, ups, downs }: Ranked) {
  const mean = (list: Vertex[] | undefined) => (list && list.length > 0 ? list.reduce((s, v) => s + v.order, 0) / list.length : undefined)
  let best = { count: crossings(ranks, downs), order: vertices.map(v => v.order) }
  for (let sweep = 0; sweep < 16; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? ranks.slice(1) : ranks.slice(0, -1).reverse()
    for (const list of order) {
      const keyed = list.map(v => ({ v, at: mean(down ? ups.get(v) : downs.get(v)) ?? v.order }))
      keyed.sort((a, b) => a.at - b.at || a.v.order - b.v.order)
      keyed.forEach(({ v }, i) => {
        v.order = i
      })
      list.sort((a, b) => a.order - b.order)
    }
    const count = crossings(ranks, downs)
    if (count < best.count) best = { count, order: vertices.map(v => v.order) }
  }
  vertices.forEach((v, i) => {
    v.order = must(best.order[i], 'order')
  })
}

// a subgraph's members in one rank sit together, at the place its first member took
function gatherGroups(ranks: Vertex[][]) {
  for (const list of ranks) {
    const first = new Map<string, number>()
    for (const v of [...list].sort((a, b) => a.order - b.order)) if (v.node?.group && !first.has(v.node.group)) first.set(v.node.group, v.order)
    const place = (v: Vertex) => (v.node?.group ? must(first.get(v.node.group), 'group order') : v.order)
    list.sort((a, b) => place(a) - place(b) || a.order - b.order)
    list.forEach((v, i) => {
      v.order = i
    })
  }
}

// a loop runs on the side its source already sits: from the first box in a rank down the near
// side, from the last down the far side, from a lone box down whichever side has fewer loops into
// its target. A source or target in the middle of its rank moves to the end its loop runs by, so
// the loop never runs through a neighbour; the rest of the rank keeps its declared order.
function sideLoops(loops: Loop[], ranks: Vertex[][]) {
  loops.sort((a, b) => Math.abs(a.from.rank - a.to.rank) - Math.abs(b.from.rank - b.to.rank))
  const toEnd = (v: Vertex, near: boolean) => {
    const list = must(ranks[v.rank], 'rank')
    list.splice(list.indexOf(v), 1)
    if (near) list.unshift(v)
    else list.push(v)
    list.forEach((w, i) => {
      w.order = i
    })
  }
  for (const loop of loops) {
    const list = must(ranks[loop.from.rank], 'rank').filter(v => v.node)
    const into = loops.filter(other => other !== loop && other.to === loop.to && loops.indexOf(other) < loops.indexOf(loop))
    const nearer = list.indexOf(loop.from) < (list.length - 1) / 2
    loop.near = list.length > 1 ? nearer : into.filter(o => o.near).length < into.filter(o => !o.near).length
    toEnd(loop.from, loop.near)
    toEnd(loop.to, loop.near)
  }
}

// each loop leaving or entering a box gets a row of its own on its side of the box, so every loop
// keeps its own head
function loopRows(vertices: Vertex[], loops: Loop[]) {
  for (const v of vertices) {
    const on = (near: boolean) => loops.filter(loop => loop.near === near && (loop.from === v || loop.to === v)).length
    const n = Math.max(on(true), on(false))
    if (n > 1) v.main = Math.max(v.main, 2 * n + 1)
  }
}

function spread({ ranks, ups, downs, gap }: Ranked) {
  for (const list of ranks) {
    let at = 0
    for (const v of list) {
      v.at = at
      at += v.cross + gap
    }
  }
  for (let sweep = 0; sweep < 12; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? ranks.slice(1) : ranks.slice(0, -1).reverse()
    for (const list of order) {
      const wants = list.map(v => {
        const near = [...((down ? ups.get(v) : downs.get(v)) ?? []), ...(sweep > 4 ? ((down ? downs.get(v) : ups.get(v)) ?? []) : [])]
        // a long edge pulls harder than a short one, so it runs straight and the short ones bend
        const weight = (n: Vertex) => (v.node && n.node ? 1 : 8)
        if (near.length === 0) return v.at
        const total = near.reduce((s, n) => s + weight(n), 0)
        return near.reduce((s, n) => s + weight(n) * centre(n), 0) / total - Math.floor(v.cross / 2)
      })
      // a long edge's placeholder outweighs a box when two crowd each other, so the edge stays put
      const placed = settle(wants, list.map(v => v.cross), gap, list.map(v => (v.node ? 1 : 8)))
      list.forEach((v, i) => {
        v.at = must(placed[i], 'placed')
      })
    }
  }
}

// an only child sits straight under an only-child parent whenever its neighbours leave room, so
// a chain runs down one column instead of jogging by a cell at each step
function only(v: Vertex, near: Map<Vertex, Vertex[]>): Vertex | undefined {
  const list = near.get(v)
  if (list?.length === 1) return list[0]
  return undefined
}

const hasRoom = (list: Vertex[], i: number, v: Vertex, want: number, gap: number) => {
  const left = list[i - 1]
  const right = list[i + 1]
  return (!left || want >= left.at + left.cross + gap) && (!right || want + v.cross + gap <= right.at)
}

// the boxes beside it in its rank move aside to make room, keeping their order
function makeRoom(list: Vertex[], i: number, gap: number) {
  let prev = must(list[i], 'box')
  for (const w of list.slice(i + 1)) {
    w.at = Math.max(w.at, prev.at + prev.cross + gap)
    prev = w
  }
  let next = must(list[i], 'box')
  for (const w of list.slice(0, i).reverse()) {
    w.at = Math.min(w.at, next.at - gap - w.cross)
    next = w
  }
}

// a parent with one child moves over that child when the child couldn't move under it
function overChild({ ranks, ups, downs, gap }: Ranked) {
  for (const list of [...ranks].reverse())
    for (const [i, v] of list.entries()) {
      const d = only(v, downs)
      if (!v.node || !d || only(d, ups) !== v || centre(d) === centre(v)) continue
      v.at = centre(d) - Math.floor(v.cross / 2)
      makeRoom(list, i, gap)
    }
}

function underParent({ ranks, ups, downs, gap }: Ranked) {
  for (const list of ranks)
    for (const [i, v] of list.entries()) {
      // a box also lines up under a long edge coming into it, which then never steps aside
      const long = ups.get(v)?.find(n => !n.node)
      const u = long ?? only(v, ups)
      if (!u || (v.node && !long && only(u, downs) !== v)) continue
      const want = centre(u) - Math.floor(v.cross / 2)
      if (hasRoom(list, i, v, want, gap)) v.at = want
    }
}

// a parent of several children sits over the middle of their span when its neighbours leave room,
// so its fan-out bar is even on both sides
function overChildren(t: Ranked) {
  for (const list of [...t.ranks].reverse()) for (const [i, v] of list.entries()) centreOverChildren(t, list, i, v)
}

function centreOverChildren(t: Ranked, list: Vertex[], i: number, v: Vertex) {
  const all = t.downs.get(v) ?? []
  const kids = mainChildren(t, v, all)
  // a parent starting a long edge, or one a long edge comes into, stays on it, so the long
  // edge keeps running straight
  if (!v.node || all.length < 2 || kids.some(k => !k.node) || (t.ups.get(v) ?? []).some(u => !u.node)) return
  if (kids.length === 1) {
    v.at = centre(must(kids[0], 'child')) - Math.floor(v.cross / 2)
    makeRoom(list, i, t.gap)
    return
  }
  const want = Math.round(middleOf(kids)) - Math.floor(v.cross / 2)
  if (hasRoom(list, i, v, want, t.gap)) v.at = want
}

// a dotted side edge doesn't pull a box off its main line: it centres over its solid children
function mainChildren(t: Ranked, v: Vertex, all: Vertex[]): Vertex[] {
  const main = t.solid.get(v) ?? []
  if (main.length > 0 && all.length > 1) return main
  return all
}

// with an odd number of children it sits over the middle one, whose edge then runs straight
function middleOf(kids: Vertex[]): number {
  const sorted = [...kids].sort((a, b) => centre(a) - centre(b))
  if (kids.length % 2 === 1) return centre(must(sorted[(kids.length - 1) / 2], 'child'))
  return (centre(must(sorted[0], 'child')) + centre(must(sorted.at(-1), 'child'))) / 2
}

// a box outside a subgraph that sits within the span of the subgraph's frame moves past it, along
// with the boxes beyond it in its rank, so the frame never takes it in
function clearFrames(flow: Flow, vertices: Vertex[], { ranks, gap }: Ranked) {
  for (const group of flow.groups) {
    const members = vertices.filter(v => v.node?.group === group.id)
    if (members.length === 0) continue
    const first = Math.min(...members.map(v => v.rank))
    const last = Math.max(...members.map(v => v.rank))
    const near = Math.min(...members.map(v => v.at))
    const far = Math.max(...members.map(v => v.at + v.cross))
    for (const list of ranks.slice(first, last + 1)) {
      for (const [i, v] of list.entries()) {
        if (!v.node || v.node.group === group.id || v.at >= far + 2 || v.at + v.cross <= near - 2) continue
        const shift = v.at + v.cross / 2 >= (near + far) / 2 ? far + gap - v.at : near - gap - (v.at + v.cross)
        for (const w of shift > 0 ? list.slice(i) : list.slice(0, i + 1)) w.at += shift
      }
    }
  }
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────

type Corners = [string, string, string, string, string, string] // ┌ ┐ └ ┘ side-left side-right

const CORNERS: Record<Shape, Corners> = {
  box: ['┌', '┐', '└', '┘', '│', '│'],
  round: ['╭', '╮', '╰', '╯', '│', '│'],
  stadium: ['╭', '╮', '╰', '╯', '(', ')'],
  circle: ['╭', '╮', '╰', '╯', '(', ')'],
  // a decision's tips are ◇ so it never reads as a {{hexagon}}, which keeps < and >
  diamond: ['╱', '╲', '╲', '╱', '◇', '◇'],
  hexagon: ['╱', '╲', '╲', '╱', '<', '>'],
  database: ['╒', '╕', '╘', '╛', '│', '│'],
  flag: ['┌', '┐', '└', '┘', '>', '│'],
  subroutine: ['╓', '╖', '╙', '╜', '║', '║'],
}

function drawNode(grid: Grid, v: Vertex, x: number, y: number, width: number, height: number) {
  const shape = must(v.node, 'box').shape
  const [tl, tr, bl, br, sl, sr] = CORNERS[shape]
  // a database's doubled top and bottom stand in for the cylinder's curved ends
  const rule = shape === 'database' ? '═' : '─'
  grid.write(x, y, tl + rule.repeat(width - 2) + tr, 'frame')
  grid.write(x, y + height - 1, bl + rule.repeat(width - 2) + br, 'frame')
  // a decision taller than three rows keeps slanting sides: ╱ above its tip, < at it, ╲ below
  const isSlanted = shape === 'diamond' || shape === 'hexagon'
  for (let k = 1; k < height - 1; k++) {
    const side = 2 * k - (height - 1)
    // a tall stadium or circle rounds only at its middle row, its other rows straight
    const isRounded = shape === 'stadium' || shape === 'circle'
    const middle = side === 0 || (height % 2 === 0 && side === -1)
    const [l, r] = isSlanted ? (side < 0 ? ['╱', '╲'] : side === 0 ? [sl, sr] : ['╲', '╱']) : isRounded && !middle ? ['│', '│'] : [sl, sr]
    grid.put(x, y + k, l, 'frame')
    grid.put(x + width - 1, y + k, r, 'frame')
    for (let i = 1; i < width - 1; i++) grid.put(x + i, y + k, ' ', 'name')
  }
  const lift = Math.floor((height - 2 - v.lines.length) / 2)
  v.lines.forEach((line, k) => {
    grid.write(x + Math.floor((width - cellWidth(line)) / 2), y + 1 + lift + k, line, 'name')
  })
}

const HEADS = { up: '▲', down: '▼', left: '◀', right: '▶' } as const

type Placed = { route: Route; tracks: number[] }

type Channel = { tracks: number; label: number }
type Label = { route: Route; m: number; k: number; lines: string[]; spots?: Array<[number, number]> }
type Side = 'top' | 'bottom'

// everything drawing needs once the chart is laid out and its ports, tracks and offsets are known
type Sheet = {
  plan: Layout
  grid: Grid
  pad: number
  channels: Channel[]
  bandStart: number[]
  bandSize: number[]
  channelStart: number[]
  xy: (m: number, k: number) => [number, number]
  crossAt: (route: Route, i: number) => number
  off: Map<Route, number>
  onto: Map<Route, Side>
  labelOf: (edge: FlowEdge) => string[]
  labels: Label[]
}

export function drawFlow(flow: Flow, width: number): FlowDrawn | undefined {
  for (const cap of [28, 22, 18, 14, 10, 8]) {
    const drawn = drawAt(flow, width, cap)
    if (drawn) return drawn
  }
  return undefined
}

function drawAt(flow: Flow, width: number, cap: number): FlowDrawn | undefined {
  const plan = layout(flow, cap)
  const { routes, loops, across } = plan
  const labelOf = (edge: FlowEdge) => labelLines(edge, cap)
  const shift = nearShift(loops, across, labelOf)
  for (const v of plan.vertices) v.at += shift

  const { leaving, outOf } = portsOut(routes, across)
  const off = sideExits(plan, outOf, leaving)
  const { landing, onto } = landings(plan, leaving)
  const crossAt = (route: Route, i: number) => (i === route.path.length - 1 ? must(landing.get(route), 'landing') : through(route, i, leaving))
  const placed: Placed[] = routes.map(route => ({ route, tracks: [] }))
  const channels = channelsOf(plan, placed, crossAt, landing, labelOf)
  const axes = axesOf(flow, plan, channels)
  const laneAt = lanesFor(loops, across, labelOf, shift, axes.crossTotal)
  const outer = loops.filter(loop => !loop.near).at(-1)
  const farRoom = outer ? laneAt(outer) - axes.crossTotal + 1 : 0
  const total = across ? axes.mainTotal : axes.crossTotal + farRoom
  if (total > width || (across && axes.crossTotal + farRoom > 400)) return undefined

  const s: Sheet = { plan, grid: new Grid(), channels, ...axes, crossAt, off, onto, labelOf, labels: [] }
  // nodes first, so lines stop at their borders
  for (const v of plan.vertices) if (v.node) drawBox(s, v)
  for (const p of placed) drawRoute(s, p)
  const slots = loopSlots(loops)
  for (const loop of loops) drawLoop(s, loop, laneAt(loop), slots)
  for (const group of flow.groups) if (!drawFrame(s, group, width)) return undefined
  const notes = [...placeLabels(s, width), ...flow.edges.filter(edge => edge.from === edge.to).map(selfLoopNote)]
  return { rows: trimmed(s.grid.runs(width)), notes }
}

// rows kept clear for frames that were never drawn come off both ends
function trimmed(rows: Run[][]): Run[][] {
  while (rows[0]?.length === 0) rows.shift()
  while (rows.at(-1)?.length === 0) rows.pop()
  return rows
}

// near-side loops' lanes, and their labels top-down, sit before the chart, so every box moves over
function nearShift(loops: Loop[], across: boolean, labelOf: Sheet['labelOf']): number {
  const nearRoom = loops.filter(l => l.near).reduce((sum, l) => sum + 2 + (across ? 0 : Math.max(0, ...labelOf(l.edge).map(w => cellWidth(w) + 2))), 0)
  if (nearRoom > 0) return nearRoom + 1
  return 0
}

function selfLoopNote(loop: FlowEdge): string {
  if (!loop.label) return `↺ ${loop.from} loops to itself`
  return `↺ ${loop.from} loops to itself: ${loop.label}`
}

// a one-word label (an event or field name) stays whole rather than splitting mid-identifier
function labelLines(edge: FlowEdge, cap: number): string[] {
  const labelCap = Math.max(8, Math.min(cap, 20))
  return edge.label === '' ? [] : edge.label.split('\n').flatMap(part => (!/\s/.test(part) && cellWidth(part) <= 32 ? [part] : uncut(part, labelCap))).map(l => l.replace(/\u00a0/g, ' '))
}

const mainStroke = (list: Route[]): Stroke | undefined => {
  const count = (stroke: Stroke) => list.filter(r => r.edge.stroke === stroke).length
  return [...new Set(list.map(r => r.edge.stroke))].sort((a, b) => count(b) - count(a) || Number(b === 'solid') - Number(a === 'solid'))[0]
}

// edges of one stroke fan out of a shared port at the middle; a dotted or thick edge from the same
// box leaves through a port of its own beside it, so its stroke shows from the border on
function portsOut(routes: Route[], across: boolean): { leaving: Map<Route, number>; outOf: Map<Vertex, Route[]> } {
  const leaving = new Map<Route, number>()
  const outOf = new Map<Vertex, Route[]>()
  for (const route of routes) {
    const source = must(route.path[0], 'source')
    if (source.node) outOf.set(source, [...(outOf.get(source) ?? []), route])
  }
  for (const [v, list] of outOf) portsFrom(v, list, across, leaving)
  return { leaving, outOf }
}

function portsFrom(v: Vertex, list: Route[], across: boolean, leaving: Map<Route, number>) {
  const next = (r: Route) => centre(must(r.path[1], 'step'))
  // ports sit in the order of where their edges head, so two strokes never cross under the box
  const toward = (stroke: Stroke) => {
    const mine = list.filter(r => r.edge.stroke === stroke)
    return mine.reduce((sum, r) => sum + next(r), 0) / mine.length
  }
  // the stroke most edges share keeps the middle; each other stroke steps out toward where it heads
  const strokes = [...new Set(list.map(r => r.edge.stroke))]
  const main = must(mainStroke(list), 'main stroke')
  const step = across ? 2 : 4
  const others = strokes.filter(stroke => stroke !== main).sort((a, b) => toward(a) - toward(b))
  const lefts = others.filter(stroke => toward(stroke) < centre(v)).reverse()
  const rights = others.filter(stroke => toward(stroke) >= centre(v))
  const place = (stroke: Stroke, at: number) => {
    for (const r of list) if (r.edge.stroke === stroke) leaving.set(r, Math.max(v.at + 1, Math.min(v.at + v.cross - 2, at)))
  }
  place(main, centre(v))
  // a short edge fanning out beside a long one leaves through its own port, toward where it heads,
  // so the long edge's line never doubles as the short one's way out
  const long = list.filter(r => r.edge.stroke === main && r.path.length > 2)
  const short = list.filter(r => r.edge.stroke === main && r.path.length === 2)
  if (long.length > 0 && short.length > 0) {
    const side = short.reduce((sum, r) => sum + next(r), 0) / short.length < centre(v) ? -1 : 1
    const at = Math.max(v.at + 1, Math.min(v.at + v.cross - 2, centre(v) + side * Math.max(2, Math.floor(v.cross / 4))))
    for (const r of short) leaving.set(r, at)
  }
  lefts.forEach((stroke, k) => {
    place(stroke, centre(v) - step * (k + 1))
  })
  rights.forEach((stroke, k) => {
    place(stroke, centre(v) + step * (k + 1))
  })
}

const isClear = (ranks: Vertex[][], v: Vertex, lo: number, hi: number) => must(ranks[v.rank], 'rank').every(w => w === v || w.at + w.cross <= lo || w.at > hi)

// left to right, a stroke other than a box's main one leaves through its top or bottom, toward
// where it heads, and runs along that row; the box keeps its height and its side keeps one port
function sideExits(plan: Layout, outOf: Map<Vertex, Route[]>, leaving: Map<Route, number>): Map<Route, number> {
  const off = new Map<Route, number>()
  if (!plan.across) return off
  for (const [v, list] of outOf) {
    const main = mainStroke(list)
    for (const route of list) {
      if (route.edge.stroke === main) {
        leaving.set(route, centre(v))
        continue
      }
      const row = centre(must(route.path[1], 'step'))
      const up = row < v.at
      const [lo, hi] = up ? [row, v.at] : [v.at + v.cross, row]
      if ((up || row >= v.at + v.cross) && isClear(plan.ranks, v, lo, hi)) {
        off.set(route, up ? v.at - 1 : v.at + v.cross)
        leaving.set(route, row)
      }
    }
  }
  return off
}

// a long edge's placeholders follow its port when that is a cell or two off their middle, so the
// edge runs straight down instead of stepping aside under its box
function through(route: Route, i: number, leaving: Map<Route, number>): number {
  const v = must(route.path[i], 'step')
  if (i === 0) return leaving.get(route) ?? centre(v)
  if (v.node) return centre(v)
  const port = leaving.get(route)
  return port !== undefined && route.path.slice(1, -1).every(d => Math.abs(centre(d) - port) <= 2) ? port : centre(v)
}

// where a route's line runs in the rank before its target, so where it comes in from
const inbound = (route: Route, leaving: Map<Route, number>) => through(route, route.path.length - 2, leaving)
const isDecision = (shape: Shape) => shape === 'diamond' || shape === 'hexagon'
// only edges of one stroke and one head share a bus, so a line without a head never reads as an arrow
const joinKey = (route: Route) => `${route.edge.stroke}${route.edge.head}`
const solidFirst = (a: Route, b: Route) => Number(a.edge.stroke !== 'solid') - Number(b.edge.stroke !== 'solid')

// an arrow lands where its line already runs when that is over the box, so it drops straight in.
// A solid edge claims its spot first; the others take the nearest spot a cell clear of every
// arrow already placed. A decision's arrows keep off its slanted corners.
function landings(plan: Layout, leaving: Map<Route, number>): { landing: Map<Route, number>; onto: Map<Route, Side> } {
  const portIn = new Map<Vertex, Route[]>()
  for (const route of plan.routes) {
    const last = must(route.path.at(-1), 'target')
    portIn.set(last, [...(portIn.get(last) ?? []), route])
  }
  const landing = new Map<Route, number>()
  // left to right, a decision takes its main arrow at its tip; another arriving from above or below
  // drops onto its top or bottom with a head of its own, never onto a slanted side
  const onto = new Map<Route, Side>()
  for (const [v, list] of portIn) {
    const shape = must(v.node, 'target box').shape
    if (plan.across && isDecision(shape)) landOnDecision(plan.ranks, v, list, leaving, landing, onto)
    else landOnBox(v, shape, list, leaving, plan.across, landing)
    const shared = list.filter(route => !onto.has(route) && list.some(other => other.edge.head !== route.edge.head && !onto.has(other) && landing.get(other) === landing.get(route)))
    if (shared.length > 0) throw new Error(`a line and an arrow into ${must(v.node, 'target box').id} would share one head`)
  }
  return { landing, onto }
}

function landOnDecision(ranks: Vertex[][], v: Vertex, list: Route[], leaving: Map<Route, number>, landing: Map<Route, number>, onto: Map<Route, Side>) {
  const from = (route: Route) => inbound(route, leaving)
  const ranked = [...list].sort((a, b) => solidFirst(a, b) || Math.abs(from(a) - centre(v)) - Math.abs(from(b) - centre(v)))
  for (const [i, route] of ranked.entries()) {
    landing.set(route, centre(v))
    const row = from(route)
    const side = row < v.at - 1 ? 'top' : row > v.at + v.cross ? 'bottom' : undefined
    const [lo, hi] = side === 'top' ? [row, v.at] : [v.at + v.cross, row]
    if (i > 0 && side && isClear(ranks, v, lo, hi)) onto.set(route, side)
  }
}

function landOnBox(v: Vertex, shape: Shape, list: Route[], leaving: Map<Route, number>, across: boolean, landing: Map<Route, number>) {
  const from = (route: Route) => inbound(route, leaving)
  const inset = isDecision(shape) ? (across ? 1 : 2) : 1
  const lo = v.at + inset
  const hi = v.at + v.cross - 1 - inset
  // separate heads into one box sit five cells apart top-down, so neither reads as part of the other
  const apart = across ? 2 : Math.min(5, Math.max(3, Math.floor((hi - lo) / Math.max(1, list.length - 1))))
  // a bus lands where one of its edges already runs straight in near the box's middle, so that edge
  // never steps aside; with none that close it lands mid-box
  // a long edge keeps out of a bus: it lands on its own straight line with its own head, so its
  // line never doubles as another edge's way in
  const isLong = (route: Route) => route.path.length > 2
  const bus = (route: Route) => {
    if (isLong(route)) return undefined
    const mine = list.filter(r => joinKey(r) === joinKey(route) && !isLong(r))
    if (mine.length < 2) return undefined
    let nearest: number | undefined
    for (const r of mine) {
      const at = from(r)
      const off = Math.abs(at - centre(v))
      if (off <= 2 && (nearest === undefined || off < Math.abs(nearest - centre(v)))) nearest = at
    }
    return nearest ?? centre(v)
  }
  const want = (route: Route) => Math.max(lo, Math.min(hi, bus(route) ?? (list.length === 1 && must(route.path.at(-2), 'step').node ? centre(v) : from(route))))
  const first = [...list].sort((a, b) => solidFirst(a, b) || Math.abs(want(a) - from(a)) - Math.abs(want(b) - from(b)))
  const taken: number[] = []
  const joined = new Map<string, number>()
  for (const route of first) {
    // edges of one stroke join on one bus into the box and share its head, which sits mid-box
    // when more than one of them comes in
    const shared = isLong(route) ? undefined : joined.get(joinKey(route))
    if (shared !== undefined) {
      landing.set(route, shared)
      continue
    }
    const at = headSpot(from(route), want(route), { lo, hi, apart }, taken)
    taken.push(at)
    if (!isLong(route)) joined.set(joinKey(route), at)
    landing.set(route, at)
  }
}

function headSpot(from: number, want: number, { lo, hi, apart }: { lo: number; hi: number; apart: number }, taken: number[]): number {
  const free = (at: number) => at >= lo && at <= hi && taken.every(t => Math.abs(t - at) >= apart)
  // it only looks on the side of the heads already placed that its line comes from, so it never
  // crosses another head's line; with no spot there far enough off, it takes the furthest one
  const near = taken.length === 0 ? undefined : taken.reduce((a, t) => (Math.abs(t - from) < Math.abs(a - from) ? t : a))
  const onSide = (x: number) => near === undefined || from === near || (x !== near && Math.sign(x - near) === Math.sign(from - near))
  const spots = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(onSide)
  const room = (x: number) => (taken.length === 0 ? Infinity : Math.min(...taken.map(t => Math.abs(t - x))))
  const at = spots.filter(free).sort((x, y) => Math.abs(x - want) - Math.abs(y - want))[0] ?? spots.reduce((best, x) => (room(x) > room(best) ? x : best), spots[0] ?? want)
  // heads side by side read as one; past the other head is better than that
  if (room(at) < 2) {
    const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    return all.filter(free).sort((x, y) => Math.abs(x - want) - Math.abs(y - want))[0] ?? all.reduce((best, x) => (room(x) > room(best) ? x : best), at)
  }
  return at
}

// each channel between rank r and r+1 holds a track per edge that changes cross position there
function channelsOf(plan: Layout, placed: Placed[], crossAt: Sheet['crossAt'], landing: Map<Route, number>, labelOf: Sheet['labelOf']): Channel[] {
  const channels = plan.ranks.slice(0, -1).map(() => ({ tracks: 0, label: 0 }))
  for (const [c, channel] of channels.entries()) channel.tracks = trackChannel(c, placed, crossAt, landing)
  for (const route of plan.routes) {
    const into = must(route.path.at(-1), 'target').rank - 1
    const lines = labelOf(route.edge)
    if (lines.length === 0 || into < 0) continue
    const room = plan.across ? Math.max(...lines.map(cellWidth)) + 2 : lines.length
    const channel = must(channels[into], 'channel')
    channel.label = Math.max(channel.label, room)
  }
  return channels
}

function trackChannel(c: number, placed: Placed[], crossAt: Sheet['crossAt'], landing: Map<Route, number>): number {
  type Span = { lo: number; hi: number; owner: string }
  const spans: Array<Span & { p: Placed }> = []
  for (const p of placed) {
    const i = p.route.path.findIndex(v => v.rank === c)
    if (i < 0 || i === p.route.path.length - 1) continue
    const a = crossAt(p.route, i)
    const b = crossAt(p.route, i + 1)
    if (a === b) continue
    spans.push({ p, lo: Math.min(a, b), hi: Math.max(a, b), owner: ownerOf(p.route, i, b, crossAt, landing) })
  }
  // edges fanning out of one node share a track; others take the first track they don't overlap
  const used: Span[][] = []
  spans.sort((a, b) => a.lo - b.lo)
  for (const span of spans) {
    let track = used.find(list => list.every(o => o.owner === span.owner || o.hi < span.lo - 1 || o.lo > span.hi + 1))
    if (!track) {
      track = []
      used.push(track)
    }
    track.push(span)
    span.p.tracks[c] = used.indexOf(track)
  }
  return used.length
}

// edges fanning out of one port share a track, and so do edges meeting at one head
function ownerOf(route: Route, i: number, b: number, crossAt: Sheet['crossAt'], landing: Map<Route, number>): string {
  const target = must(route.path.at(-1), 'target')
  const meets = i + 1 === route.path.length - 1
  if (meets && landing.get(route) !== undefined && [...landing].filter(([r, at]) => r.path.at(-1) === target && at === b).length > 1) return `in:${target.key}:${b}`
  return `${must(route.path[i], 'step').key}:${i === 0 ? crossAt(route, 0) : ''}`
}

function axesOf(flow: Flow, plan: Layout, channels: Channel[]) {
  // a chart with subgraphs gets four spare rows at each end of every channel: a frame's border runs
  // on the one by the boxes, and the others keep it clear of the edges turning beyond
  const pad = flow.groups.length > 0 ? 4 : 0
  // main-axis offsets: rank bands and the channels between them
  const bandStart: number[] = []
  const bandSize = plan.ranks.map(list => Math.max(0, ...list.map(v => v.main)))
  const channelStart: number[] = []
  let run = 2 * pad
  for (const [r, size] of bandSize.entries()) {
    bandStart.push(run)
    run += size
    const channel = channels[r]
    if (channel) {
      channelStart.push(run)
      // left to right, a head gets a two-cell stub so it never crowds the box it enters
      run += 1 + 2 * pad + channel.tracks + channel.label + (plan.across ? 2 : 1)
    }
  }
  const mainTotal = run
  const crossTotal = Math.max(1, ...plan.vertices.map(v => v.at + v.cross))
  const xy = (m: number, k: number): [number, number] => {
    const main = plan.reversed ? mainTotal - 1 - m : m
    if (plan.across) return [main, k]
    return [k, main]
  }
  return { pad, bandStart, bandSize, channelStart, mainTotal, crossTotal, xy }
}

// loops nest outside the chart on their side, the shortest innermost, each on a lane of its own.
// Top-down, a labelled loop's lane stands far enough out for its label to sit on the run leaving
// its source, short of the lane, where it can only belong to that loop
function lanesFor(loops: Loop[], across: boolean, labelOf: Sheet['labelOf'], shift: number, crossTotal: number): (loop: Loop) => number {
  const far = loops.filter(loop => !loop.near)
  const near = loops.filter(loop => loop.near)
  const before = (loop: Loop) => (across ? 0 : Math.max(0, ...labelOf(loop.edge).map(w => cellWidth(w) + 2)))
  return loop => {
    const side = loop.near ? near : far
    const k = side.indexOf(loop)
    const out = 2 * k + side.slice(0, k + 1).reduce((sum, l) => sum + before(l), 0)
    if (loop.near) return shift - 2 - out
    return crossTotal + 1 + out
  }
}

const bandOf = (s: Sheet, v: Vertex) => must(s.bandStart[v.rank], 'band')
// where a box starts along the main axis: a band's boxes line up on the side their edges leave
const boxStart = (s: Sheet, v: Vertex) => bandOf(s, v) + (s.plan.reversed ? must(s.bandSize[v.rank], 'band') - v.main : 0)

function drawBox(s: Sheet, v: Vertex) {
  const m0 = boxStart(s, v)
  const [x0, y0] = s.xy(m0, v.at)
  const [x1, y1] = s.xy(m0 + v.main - 1, v.at + v.cross - 1)
  drawNode(s.grid, v, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1)
}

function segment(s: Sheet, m0: number, k0: number, m1: number, k1: number, stroke: Stroke) {
  const [x0, y0] = s.xy(m0, k0)
  const [x1, y1] = s.xy(m1, k1)
  s.grid.line(x0, y0, x1, y1, stroke)
}

// heads stay bright on a dimmed dotted edge, so where it lands never fades
function head(s: Sheet, m: number, k: number, forward: boolean) {
  const [x, y] = s.xy(m, k)
  const ahead = forward !== s.plan.reversed
  s.grid.put(x, y, s.plan.across ? (ahead ? HEADS.right : HEADS.left) : ahead ? HEADS.down : HEADS.up, 'line')
}

function drawRoute(s: Sheet, p: Placed) {
  const { route } = p
  const { path } = route
  for (let i = 0; i < path.length - 1; i++) drawStep(s, p, i)
  const last = must(path.at(-1), 'target')
  const first = must(path[0], 'source')
  // the line leaves through the border, so the border shows where: ┬ under a box, ├ beside it
  const exit = s.off.get(route)
  const [bx, by] = exit !== undefined ? s.xy(bandOf(s, first) + Math.max(1, first.main - 3), exit < first.at ? first.at : first.at + first.cross - 1) : s.xy(bandOf(s, first) + first.main - 1, s.crossAt(route, 0))
  const border = s.grid.cells[by]?.[bx]
  const joined = exit === undefined ? joinBorder(border?.char, s.plan) : (exit < first.at ? '┴' : '┬')
  if (border && joined !== undefined) border.char = joined
  const landingAt = s.crossAt(route, path.length - 1)
  if (route.edge.head && !s.onto.has(route)) head(s, bandOf(s, last) - 1, landingAt, true)
  if (route.edge.tail) head(s, bandOf(s, first) + first.main, s.crossAt(route, 0), false)
}

function joinBorder(char: string | undefined, { across, reversed }: Layout): string | undefined {
  if (char === '═') return reversed ? '╧' : '╤'
  if (char === '║') return reversed ? '╢' : '╟'
  if (char === '─' || char === '│') return across ? (reversed ? '┤' : '├') : (reversed ? '┴' : '┬')
  return undefined
}

function drawStep(s: Sheet, p: Placed, i: number) {
  const { route } = p
  const v = must(route.path[i], 'step')
  const band = bandOf(s, v)
  const a = s.crossAt(route, i)
  const isLast = i === route.path.length - 2
  if (!v.node) segment(s, band, a, band + must(s.bandSize[v.rank], 'band') - 1, a, route.edge.stroke)
  const row = s.off.get(route)
  if (i === 0 && row !== undefined) runAlongRow(s, route, v, row, isLast)
  else if (isLast && s.onto.has(route)) runOnto(s, route, v, a)
  else crossChannel(s, p, i, isLast)
}

function runAlongRow(s: Sheet, route: Route, v: Vertex, row: number, isLast: boolean) {
  const c = v.rank
  const b = s.crossAt(route, 1)
  const stroke = route.edge.stroke
  const m = bandOf(s, v) + Math.max(1, v.main - 3)
  segment(s, m, row, m, b, stroke)
  // its label rides along the row it runs on, just past the turn
  const said = s.labelOf(route.edge)
  if (said.length > 0 && isLast) s.labels.push({ route, m: m + 2, k: b, lines: said })
  if (isLast && s.onto.has(route)) dropOnto(s, route, c, m, b)
  else segment(s, m, b, isLast ? must(s.bandStart[c + 1], 'band') - 1 : must(s.bandStart[c + 1], 'band') + must(s.bandSize[c + 1], 'band') - 1, b, stroke)
}

function runOnto(s: Sheet, route: Route, v: Vertex, a: number) {
  const band = bandOf(s, v)
  const from = v.node ? band + v.main : band
  const said = s.labelOf(route.edge)
  if (said.length > 0) s.labels.push({ route, m: from + 1, k: a, lines: said })
  dropOnto(s, route, v.rank, from, a)
}

function crossChannel(s: Sheet, p: Placed, i: number, isLast: boolean) {
  const { route } = p
  const v = must(route.path[i], 'step')
  const c = v.rank
  const band = bandOf(s, v)
  const from = v.node ? band + v.main : band
  const a = s.crossAt(route, i)
  const b = s.crossAt(route, i + 1)
  const lane = must(s.channelStart[c], 'channel') + 1 + s.pad + (p.tracks[c] ?? 0)
  const end = must(s.bandStart[c + 1], 'band') - 1
  const stroke = route.edge.stroke
  const turn = a === b ? from : lane
  segment(s, from, a, turn, a, stroke)
  segment(s, turn, a, turn, b, stroke)
  segment(s, turn, b, end, b, stroke)
  const lines = isLast ? s.labelOf(route.edge) : []
  if (lines.length > 0) s.labels.push({ route, m: must(s.channelStart[c], 'channel') + 2 + s.pad + must(s.channels[c], 'channel').tracks, k: b, lines })
}

// the last run turns along the channel to the middle of its target, then drops onto its top or bottom
function dropOnto(s: Sheet, route: Route, c: number, m: number, k: number) {
  const stroke = route.edge.stroke
  const target = must(route.path.at(-1), 'target')
  const mid = must(s.bandStart[c + 1], 'band') + Math.floor(target.main / 2)
  const side = s.onto.get(route)
  const edge = side === 'top' ? target.at - 1 : target.at + target.cross
  segment(s, m, k, mid, k, stroke)
  segment(s, mid, k, mid, edge, stroke)
  const [hx, hy] = s.xy(mid, edge)
  if (route.edge.head) s.grid.put(hx, hy, side === 'top' ? HEADS.down : HEADS.up, 'line')
}

const LOOP_EXITS = new Set(['│', '─', '<', '>', '(', ')'])

// a loop leaves its source through the side facing out, runs up its lane and comes into its
// target's same side: right of a top-down chart, under a left-right one
// a box's loop rows: the ways in on top, the outer loop highest, then the ways out, the inner loop
// first, so no two loops' runs cross
function loopSlots(loops: Loop[]): Map<string, Loop[]> {
  const slots = new Map<string, Loop[]>()
  for (const loop of loops) for (const v of [loop.to, loop.from]) slots.set(slotOf(v, loop), [...(slots.get(slotOf(v, loop)) ?? []), loop])
  const key = (v: Vertex, loop: Loop) => (loop.to === v ? -1000 - loops.indexOf(loop) : loops.indexOf(loop))
  for (const [k, list] of slots) list.sort((x, y) => key(list.find(l => slotOf(l.to, l) === k) ? x.to : x.from, x) - key(list.find(l => slotOf(l.to, l) === k) ? y.to : y.from, y))
  return slots
}

const slotOf = (v: Vertex, loop: Loop) => `${v.key}:${loop.near}`

function drawLoop(s: Sheet, loop: Loop, lane: number, slots: Map<string, Loop[]>) {
  const { across } = s.plan
  // loops on one box spread along its side, so no two share an arrow or a stub
  const row = (v: Vertex) => {
    const list = must(slots.get(slotOf(v, loop)), 'loop slot')
    const i = list.indexOf(loop)
    const start = boxStart(s, v)
    return list.length === 1 ? start + Math.floor(v.main / 2) : start + Math.round(((i + 1) * (v.main - 1)) / (list.length + 1))
  }
  const side = (v: Vertex) => (loop.near ? v.at - 1 : v.at + v.cross)
  const stroke = loop.edge.stroke
  const a = row(loop.from)
  const b = row(loop.to)
  segment(s, a, side(loop.from), a, lane, stroke)
  segment(s, a, lane, b, lane, stroke)
  segment(s, b, lane, b, side(loop.to), stroke)
  loopExit(s, loop, a, side(loop.from))
  if (loop.edge.head) loopArrow(s, loop, b, side(loop.to))
  if (loop.edge.tail) loopArrow(s, loop, a, side(loop.from))
  const lines = s.labelOf(loop.edge)
  // a loop's label sits on the run leaving its source, before the run turns up its lane
  if (lines.length > 0)
    s.labels.push({
      route: { edge: loop.edge, path: [] },
      m: across ? a + 2 : a,
      k: across ? side(loop.from) + lines.length : side(loop.from) - 1,
      lines,
      // top-down, it moves right of its lane when the run is too short to hold it
      spots: across ? undefined : loop.near ? [[a - lines.length, lane + 2]] : [[a - lines.length, side(loop.from) + 1], [Math.round((a + b) / 2) - Math.floor(lines.length / 2), lane + 2]],
    })
}

function loopExit(s: Sheet, loop: Loop, m: number, side: number) {
  const [x, y] = s.xy(m, loop.near ? side + 1 : side - 1)
  const cell = s.grid.cells[y]?.[x]
  if (cell?.char !== undefined && LOOP_EXITS.has(cell.char)) cell.char = s.plan.across ? (loop.near ? '┴' : '┬') : (loop.near ? '┤' : '├')
}

function loopArrow(s: Sheet, loop: Loop, m: number, side: number) {
  const [x, y] = s.xy(m, side)
  s.grid.put(x, y, s.plan.across ? (loop.near ? HEADS.down : HEADS.up) : loop.near ? HEADS.right : HEADS.left, 'line')
}

// each subgraph is framed round its members, unless a box outside it would land inside the frame;
// a frame too wide for the terminal is reported, so the chart isn't drawn without it
function drawFrame(s: Sheet, group: Group, width: number): boolean {
  const { vertices, across } = s.plan
  const members = vertices.filter(v => v.node?.group === group.id)
  if (members.length === 0) return true
  // a cell of edge runs between a frame and the boxes it holds, so a head lands inside the frame
  const lo = Math.min(...members.map(v => bandOf(s, v))) - 3
  const hi = Math.max(...members.map(v => bandOf(s, v) + must(s.bandSize[v.rank], 'band'))) + 2
  const near = Math.min(...members.map(v => v.at)) - 2
  const title = ` ${group.label} `
  // top-down, the frame is at least wide enough for its title
  const far = Math.max(...members.map(v => v.at + v.cross)) + 1 + (across ? 0 : Math.max(0, near + cellWidth(title) + 5 - Math.max(...members.map(v => v.at + v.cross)) - 1))
  const inside = (v: Vertex) => v.node && v.node.group !== group.id && bandOf(s, v) + v.main > lo && bandOf(s, v) < hi && v.at + v.cross > near && v.at < far
  if (vertices.some(inside) || near < 0 || lo < 0) return true
  const [x0, y0] = s.xy(lo, near)
  const [x1, y1] = s.xy(hi, far)
  const [left, top, bottom] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
  const right = frameRight(s.grid, left, Math.max(x0, x1), top, title)
  if (right >= width) return false
  frameBorder(s.grid, left, top, right, bottom)
  frameTitle(s.grid, left, top, right, title)
  return true
}

// the frame reaches far enough past the last line crossing its top for the title to fit there
function frameRight(grid: Grid, left: number, end: number, top: number, title: string): number {
  const crossed = Array.from({ length: end - left + 1 }, (_, i) => left + i).filter(x => (grid.cells[top]?.[x]?.mask ?? 0) !== 0)
  const [first] = crossed
  return Math.max(end, first !== undefined && cellWidth(title) + 3 > first - left ? Math.max(...crossed) + cellWidth(title) + 4 : 0)
}

// where an edge crosses the border the crossing is drawn, so neither the edge nor the frame breaks
function frameCell(grid: Grid, x: number, y: number, char: string) {
  if (grid.isFree(x, y)) {
    grid.put(x, y, char, 'frame')
    return
  }
  const cell = grid.cells[y]?.[x]
  const across = char === '─' ? UP | DOWN : char === '│' ? LEFT | RIGHT : 0
  if (cell && cell.char === undefined && across !== 0 && (cell.mask & across) === across) cell.mask |= UP | DOWN | LEFT | RIGHT
}

function frameBorder(grid: Grid, left: number, top: number, right: number, bottom: number) {
  for (let x = left + 1; x < right; x++) {
    frameCell(grid, x, top, '─')
    frameCell(grid, x, bottom, '─')
  }
  for (let y = top + 1; y < bottom; y++) {
    frameCell(grid, left, y, '│')
    frameCell(grid, right, y, '│')
  }
  frameCell(grid, left, top, '╭')
  frameCell(grid, right, top, '╮')
  frameCell(grid, left, bottom, '╰')
  frameCell(grid, right, bottom, '╯')
}

// the title takes the first stretch of the top border no edge crosses
function frameTitle(grid: Grid, left: number, top: number, right: number, title: string) {
  const cells = Array.from({ length: cellWidth(title) })
  const clear = (at: number) => [...cells, '─'].every((_, i) => grid.cells[top]?.[at - 1 + i]?.char === '─' || (at - 1 + i === left && i === 0))
  const spot = Array.from({ length: Math.max(0, right - left - cellWidth(title) - 1) }, (_, i) => left + 2 + i).find(clear)
  // with no clear stretch on the border it sits just inside the frame's top corner
  if (spot !== undefined) grid.write(spot, top, title, 'name')
  else if (cells.every((_, i) => grid.isFree(left + 1 + i, top + 1))) grid.write(left + 1, top + 1, title, 'name')
}

function placeLabels(s: Sheet, width: number): string[] {
  const notes: string[] = []
  for (const label of s.labels) {
    const spot = labelSpot(s, label, width)
    if (spot) putLabel(s, label, ...spot)
    else notes.push(footnote(s, label, notes.length + 1))
  }
  return notes
}

function labelSpot(s: Sheet, label: Label, width: number): [number, number] | undefined {
  const { across } = s.plan
  const fits = (m: number, k: number) =>
    label.lines.every((line, j) => {
      for (let i = 0; i < cellWidth(line); i++) {
        const [x, y] = across ? s.xy(m + i, k - label.lines.length + j) : s.xy(m + j, k + i)
        if (!s.grid.isFree(x, y) || x >= width) return false
      }
      return true
    })
  const widest = Math.max(...label.lines.map(cellWidth))
  const tries: Array<[number, number]> = label.spots ?? (across
    ? [[label.m, label.k], [label.m, label.k + label.lines.length + 1]]
    : [[label.m - 1, label.k + 2], [label.m - 1, label.k - 1 - widest]])
  return tries.find(([m, k]) => k >= 0 && fits(m, k))
}

function putLabel(s: Sheet, label: Label, m: number, k: number) {
  const { across, reversed } = s.plan
  label.lines.forEach((line, j) => {
    const [x, y] = across ? s.xy(m, k - label.lines.length + j) : s.xy(m + j, k)
    s.grid.write(across && reversed ? x - cellWidth(line) + 1 : x, y, line, 'text')
  })
}

function footnote(s: Sheet, label: Label, n: number): string {
  const mark = superscript(n)
  const [x, y] = s.plan.across ? s.xy(label.m - 1, label.k - 1) : s.xy(label.m - 1, label.k + 2)
  if (s.grid.isFree(x, y)) s.grid.write(x, y, mark, 'text')
  return `${mark} ${label.lines.join(' ')}`
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number) => [...String(n)].map(d => SUPERSCRIPT[Number(d)]).join('')
