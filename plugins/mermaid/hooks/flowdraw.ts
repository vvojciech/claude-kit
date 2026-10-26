// Lays a flowchart out in ranks and draws it on a character grid.
//
// Ranks run down the page for TD/BT and across it for LR/RL. Every edge leaves its source through
// one port, crosses the channel between two ranks on a track of its own, and enters its target
// through a port of its own, so arrows never share a head. An edge that spans several ranks runs
// through a one-cell placeholder in each rank it passes. Lines are kept as directions per cell and
// turned into box-drawing glyphs at the end, so meeting lines join as ┬ ┼ ┤ instead of overwriting.
import type { Direction, Flow, FlowEdge, FlowNode, Shape, Stroke } from './flow'
import type { Ink, Run } from './render'
import { wrap } from './render'
import { cellWidth } from './width'

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
    const row = this.cells[y]!
    while (row.length <= x) row.push({ mask: 0, stroke: 'solid', ink: 'line' })
    return row[x]!
  }

  isFree(x: number, y: number): boolean {
    if (x < 0 || y < 0) return false
    const cell = this.cells[y]?.[x]
    return cell === undefined || (cell.mask === 0 && cell.char === undefined)
  }

  put(x: number, y: number, char: string, ink: Ink, lane?: number) {
    Object.assign(this.at(x, y), { char, ink, lane })
  }

  write(x: number, y: number, text: string, ink: Ink, lane?: number) {
    let at = x
    for (const char of text) {
      this.put(at, y, char, ink, lane)
      at += Math.max(1, cellWidth(char))
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
      for (let x = 0; x < Math.min(width, row.length); x++) {
        const cell = row[x]!
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
  return GLYPHS[cell.stroke === 'thick' ? 'thick' : 'solid'][mask]!
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

function boxOf(node: FlowNode, cap: number, across: boolean): Pick<Vertex, 'lines' | 'main' | 'cross'> {
  const lines = node.label.split('\n').flatMap(part => wrap(part, cap).lines).map(line => line.replace(/ /g, ' '))
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
  const named = new Map<string, number>()
  const into = new Set(flow.edges.filter(e => e.from !== e.to).map(e => e.to))
  const roots = flow.nodes.filter(n => !into.has(n.id))
  for (const start of [...roots, ...flow.nodes]) {
    if (named.has(start.id)) continue
    named.set(start.id, named.size)
    const queue = [start.id]
    while (queue.length > 0) {
      for (const edge of out.get(queue.shift()!) ?? []) {
        if (named.has(edge.to)) continue
        named.set(edge.to, named.size)
        queue.push(edge.to)
      }
    }
  }
  const reaches = (from: string, to: string) => {
    const seen = new Set([from])
    const queue = [from]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (id === to) return true
      for (const edge of out.get(id) ?? []) if (!back.has(edge) && !seen.has(edge.to)) seen.add(edge.to) && queue.push(edge.to)
    }
    return false
  }
  // the edge furthest against the flow turns first; one that no longer closes a cycle stays put
  const back = new Set<FlowEdge>()
  const against = flow.edges.filter(e => e.from !== e.to && named.get(e.to)! < named.get(e.from)!)
  against.sort((a, b) => named.get(b.from)! - named.get(b.to)! - (named.get(a.from)! - named.get(a.to)!))
  for (const edge of against) if (reaches(edge.to, edge.from)) back.add(edge)
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
  const rank = new Map<string, number>(flow.nodes.map(n => [n.id, 0]))
  // longest path, relaxed until nothing moves (the graph is acyclic once back edges turn round)
  for (let pass = 0; pass < flow.nodes.length; pass++) {
    let moved = false
    for (const edge of flow.edges) {
      if (edge.from === edge.to) continue
      const [a, b] = back.has(edge) ? [edge.to, edge.from] : [edge.from, edge.to]
      const want = rank.get(a)! + 1
      if (rank.get(b)! < want) {
        rank.set(b, want)
        moved = true
      }
    }
    if (!moved) break
  }
  return { rank, back }
}

// pool-adjacent-violators: places boxes in order, as close to where each wants to be as overlap allows
function settle(wants: number[], sizes: number[], gap: number, weights: number[] = sizes.map(() => 1)): number[] {
  type Block = { first: number; last: number; at: number; weight: number; sum: number }
  const blocks: Block[] = []
  const offset: number[] = []
  let run = 0
  sizes.forEach((size, i) => {
    offset.push(run)
    run += size + gap
  })
  wants.forEach((want, i) => {
    let block: Block = { first: i, last: i, sum: weights[i]! * (want - offset[i]!), weight: weights[i]!, at: want - offset[i]! }
    while (blocks.length > 0 && blocks.at(-1)!.at > block.at) {
      const prev = blocks.pop()!
      block = { first: prev.first, last: block.last, sum: prev.sum + block.sum, weight: prev.weight + block.weight, at: 0 }
      block.at = block.sum / block.weight
    }
    blocks.push(block)
  })
  const at: number[] = []
  for (const block of blocks) for (let i = block.first; i <= block.last; i++) at.push(Math.round(block.at) + offset[i]!)
  // rounding can close a gap by one; push right where it did
  for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i]!, at[i - 1]! + sizes[i - 1]! + gap)
  return at
}

type Layout = { vertices: Vertex[]; ranks: Vertex[][]; routes: Route[]; loops: Loop[]; across: boolean; reversed: boolean }

function layout(flow: Flow, cap: number): Layout {
  const across = isAcross(flow.direction)
  const reversed = flow.direction === 'BT' || flow.direction === 'RL'
  const { rank, back } = ranksOf(flow)
  const vertices: Vertex[] = []
  const byId = new Map<string, Vertex>()
  for (const node of flow.nodes) {
    const v: Vertex = { key: node.id, node, rank: rank.get(node.id)!, order: 0, at: 0, ...boxOf(node, cap, across) }
    vertices.push(v)
    byId.set(node.id, v)
  }
  const routes: Route[] = []
  const loops: Loop[] = []
  for (const edge of flow.edges) {
    if (edge.from === edge.to) continue
    const [a, b] = [byId.get(edge.from)!, byId.get(edge.to)!]
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
  // a box is long enough along its sides to give each arriving edge and each leaving stroke a port
  // of its own, two cells apart, so no two of them share a line
  // (left to right, extra strokes and arrows use a box's top and bottom instead, so it never grows)
  for (const v of vertices) {
    if (!v.node || across) continue
    // edges into a left-right decision all meet at its tip, so they need no room along its sides
    const meets = across && (v.node.shape === 'diamond' || v.node.shape === 'hexagon')
    const arriving = meets ? 1 : routes.filter(r => r.path.at(-1) === v).length
    const strokes = new Set(routes.filter(r => r.path[0] === v).map(r => r.edge.stroke)).size
    v.cross = Math.max(v.cross, 2 * Math.max(arriving, strokes) + 1)
  }
  const top = Math.max(0, ...vertices.map(v => v.rank))
  const ranks: Vertex[][] = Array.from({ length: top + 1 }, () => [])
  for (const v of vertices) ranks[v.rank]!.push(v)
  const ups = new Map<Vertex, Vertex[]>()
  const downs = new Map<Vertex, Vertex[]>()
  // the children a box reaches by solid edges: the main line it sits over
  const solid = new Map<Vertex, Vertex[]>()
  for (const { edge, path } of routes) if (edge.stroke === 'solid') solid.set(path[0]!, [...(solid.get(path[0]!) ?? []), path[1]!])
  for (const { path } of routes)
    for (let i = 1; i < path.length; i++) {
      ups.set(path[i]!, [...(ups.get(path[i]!) ?? []), path[i - 1]!])
      downs.set(path[i - 1]!, [...(downs.get(path[i - 1]!) ?? []), path[i]!])
    }
  ranks.forEach(list => list.forEach((v, i) => (v.order = i)))
  // barycentre sweeps cut crossings; ties keep the order the source gave
  const mean = (list: Vertex[] | undefined) => (list && list.length > 0 ? list.reduce((s, v) => s + v.order, 0) / list.length : undefined)
  // every sweep is scored by the crossings it leaves, and the best order seen is the one kept
  const crossings = () => {
    let count = 0
    for (const list of ranks) {
      const pairs = list.flatMap(u => (downs.get(u) ?? []).map(v => [u.order, v.order] as const))
      for (let i = 0; i < pairs.length; i++)
        for (let j = i + 1; j < pairs.length; j++) if ((pairs[i]![0] - pairs[j]![0]) * (pairs[i]![1] - pairs[j]![1]) < 0) count++
    }
    return count
  }
  let best = { count: crossings(), order: vertices.map(v => v.order) }
  for (let sweep = 0; sweep < 16; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? ranks.slice(1) : ranks.slice(0, -1).reverse()
    for (const list of order) {
      const keyed = list.map(v => ({ v, at: mean(down ? ups.get(v) : downs.get(v)) ?? v.order }))
      keyed.sort((a, b) => a.at - b.at || a.v.order - b.v.order)
      keyed.forEach(({ v }, i) => (v.order = i))
      list.sort((a, b) => a.order - b.order)
    }
    const count = crossings()
    if (count < best.count) best = { count, order: vertices.map(v => v.order) }
  }
  vertices.forEach((v, i) => (v.order = best.order[i]!))
  // a subgraph's members in one rank sit together, at the place its first member took
  for (const list of ranks) {
    const first = new Map<string, number>()
    for (const v of [...list].sort((a, b) => a.order - b.order)) if (v.node?.group && !first.has(v.node.group)) first.set(v.node.group, v.order)
    list.sort((a, b) => (a.node?.group ? first.get(a.node.group)! : a.order) - (b.node?.group ? first.get(b.node.group)! : b.order) || a.order - b.order)
    list.forEach((v, i) => (v.order = i))
  }
  // a loop runs on the side its source already sits: from the first box in a rank down the near
  // side, from the last down the far side, from a lone box down whichever side has fewer loops into
  // its target. A source or target in the middle of its rank moves to the end its loop runs by, so
  // the loop never runs through a neighbour; the rest of the rank keeps its declared order.
  loops.sort((a, b) => Math.abs(a.from.rank - a.to.rank) - Math.abs(b.from.rank - b.to.rank))
  const toEnd = (v: Vertex, near: boolean) => {
    const list = ranks[v.rank]!
    list.splice(list.indexOf(v), 1)
    if (near) list.unshift(v)
    else list.push(v)
    list.forEach((w, i) => (w.order = i))
  }
  for (const loop of loops) {
    const list = ranks[loop.from.rank]!.filter(v => v.node)
    const into = loops.filter(other => other !== loop && other.to === loop.to && loops.indexOf(other) < loops.indexOf(loop))
    const nearer = list.indexOf(loop.from) < (list.length - 1) / 2
    loop.near = list.length > 1 ? nearer : into.filter(o => o.near).length < into.filter(o => !o.near).length
    toEnd(loop.from, loop.near)
    toEnd(loop.to, loop.near)
  }
  // each loop leaving or entering a box gets a row of its own on its side of the box, so every loop
  // keeps its own head
  for (const v of vertices) {
    const on = (near: boolean) => loops.filter(loop => loop.near === near && (loop.from === v || loop.to === v)).length
    const n = Math.max(on(true), on(false))
    if (n > 1) v.main = Math.max(v.main, 2 * n + 1)
  }
  // a frame needs a cell either side of its members and a cell between it and its neighbour
  const gap = flow.groups.length > 0 ? 5 : across ? 1 : 3
  for (const list of ranks) {
    let at = 0
    for (const v of list) {
      v.at = at
      at += v.cross + gap
    }
  }
  const centre = (v: Vertex) => v.at + Math.floor(v.cross / 2)
  for (let sweep = 0; sweep < 12; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? ranks.slice(1) : ranks.slice(0, -1).reverse()
    for (const list of order) {
      const wants = list.map(v => {
        const near = [...((down ? ups.get(v) : downs.get(v)) ?? []), ...(sweep > 4 ? ((down ? downs.get(v) : ups.get(v)) ?? []) : [])]
        // a long edge pulls harder than a short one, so it runs straight and the short ones bend
        const weight = (n: Vertex) => (v.node && n.node ? 1 : 8)
        const total = near.reduce((s, n) => s + weight(n), 0)
        return near.length > 0 ? near.reduce((s, n) => s + weight(n) * centre(n), 0) / total - Math.floor(v.cross / 2) : v.at
      })
      // a long edge's placeholder outweighs a box when two crowd each other, so the edge stays put
      const placed = settle(wants, list.map(v => v.cross), gap, list.map(v => (v.node ? 1 : 8)))
      list.forEach((v, i) => (v.at = placed[i]!))
    }
  }
  // an only child sits straight under an only-child parent whenever its neighbours leave room, so
  // a chain runs down one column instead of jogging by a cell at each step
  const only = (v: Vertex, near: Map<Vertex, Vertex[]>) => (near.get(v)?.length === 1 ? near.get(v)![0] : undefined)
  // a parent with one child moves over that child when the child couldn't move under it
  const overChild = () => {
    for (const list of [...ranks].reverse())
      list.forEach((v, i) => {
        const d = only(v, downs)
        if (!v.node || !d || only(d, ups) !== v || centre(d) === centre(v)) return
        // the boxes beside it in its rank move aside to make room, keeping their order
        const want = centre(d) - Math.floor(v.cross / 2)
        v.at = want
        for (let k = i + 1; k < list.length; k++) list[k]!.at = Math.max(list[k]!.at, list[k - 1]!.at + list[k - 1]!.cross + gap)
        for (let k = i - 1; k >= 0; k--) list[k]!.at = Math.min(list[k]!.at, list[k + 1]!.at - gap - list[k]!.cross)
      })
  }
  for (let pass = 0; pass < 2; pass++) {
    overChild()
    for (const list of ranks)
      list.forEach((v, i) => {
        // a box also lines up under a long edge coming into it, which then never steps aside
        const long = ups.get(v)?.find(n => !n.node)
        const u = long ?? only(v, ups)
        if (!u || (v.node && !long && only(u, downs) !== v)) return
        const want = centre(u) - Math.floor(v.cross / 2)
        const left = list[i - 1]
        const right = list[i + 1]
        if ((!left || want >= left.at + left.cross + gap) && (!right || want + v.cross + gap <= right.at)) v.at = want
      })
  }
  // a parent of several children sits over the middle of their span when its neighbours leave room,
  // so its fan-out bar is even on both sides
  const overChildren = () => {
    for (const list of [...ranks].reverse())
      list.forEach((v, i) => {
        // a dotted side edge doesn't pull a box off its main line: it centres over its solid children
        const all = downs.get(v) ?? []
        const kids = (solid.get(v)?.length ?? 0) > 0 && all.length > 1 ? solid.get(v)! : all
        // a parent starting a long edge, or one a long edge comes into, stays on it, so the long
        // edge keeps running straight
        if (!v.node || all.length < 2 || kids.some(k => !k.node) || (ups.get(v) ?? []).some(u => !u.node)) return
        if (kids.length === 1) {
          v.at = centre(kids[0]!) - Math.floor(v.cross / 2)
          for (let k = i + 1; k < list.length; k++) list[k]!.at = Math.max(list[k]!.at, list[k - 1]!.at + list[k - 1]!.cross + gap)
          for (let k = i - 1; k >= 0; k--) list[k]!.at = Math.min(list[k]!.at, list[k + 1]!.at - gap - list[k]!.cross)
          return
        }
        // with an odd number of children it sits over the middle one, whose edge then runs straight
        const sorted = [...kids].sort((a, b) => centre(a) - centre(b))
        const middle = kids.length % 2 === 1 ? centre(sorted[(kids.length - 1) / 2]!) : (centre(sorted[0]!) + centre(sorted.at(-1)!)) / 2
        const want = Math.round(middle) - Math.floor(v.cross / 2)
        const left = list[i - 1]
        const right = list[i + 1]
        if ((!left || want >= left.at + left.cross + gap) && (!right || want + v.cross + gap <= right.at)) v.at = want
      })
  }
  // centring a box can leave its parent a cell off; the two settle together over a few rounds
  for (let round = 0; round < 3; round++) {
    overChildren()
    overChild()
  }
  // a box outside a subgraph that sits within the span of the subgraph's frame moves past it, along
  // with the boxes beyond it in its rank, so the frame never takes it in
  for (const group of flow.groups) {
    const members = vertices.filter(v => v.node?.group === group.id)
    if (members.length === 0) continue
    const first = Math.min(...members.map(v => v.rank))
    const last = Math.max(...members.map(v => v.rank))
    const near = Math.min(...members.map(v => v.at))
    const far = Math.max(...members.map(v => v.at + v.cross))
    for (const list of ranks.slice(first, last + 1)) {
      list.forEach((v, i) => {
        if (!v.node || v.node.group === group.id || v.at >= far + 2 || v.at + v.cross <= near - 2) return
        const shift = v.at + v.cross / 2 >= (near + far) / 2 ? far + gap - v.at : near - gap - (v.at + v.cross)
        for (const w of shift > 0 ? list.slice(i) : list.slice(0, i + 1)) w.at += shift
      })
    }
  }
  // a chart with subgraphs keeps two cells clear on its near side for a frame's border
  const least = Math.min(...vertices.map(v => v.at)) - (flow.groups.length > 0 ? 2 : 0)
  for (const v of vertices) v.at -= least
  return { vertices, ranks, routes, loops, across, reversed }
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
  const shape = v.node!.shape
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
  v.lines.forEach((line, k) => grid.write(x + Math.floor((width - cellWidth(line)) / 2), y + 1 + lift + k, line, 'name'))
}

const HEADS = { up: '▲', down: '▼', left: '◀', right: '▶' } as const

type Placed = { route: Route; tracks: number[] }

export function drawFlow(flow: Flow, width: number): FlowDrawn | undefined {
  for (const cap of [28, 22, 18, 14, 10, 8]) {
    const drawn = drawAt(flow, width, cap)
    if (drawn) return drawn
  }
  return undefined
}

function drawAt(flow: Flow, width: number, cap: number): FlowDrawn | undefined {
  const plan = layout(flow, cap)
  const { ranks, routes, loops, across, reversed } = plan
  const labelCap = Math.max(8, Math.min(cap, 20))
  // a one-word label (an event or field name) stays whole rather than splitting mid-identifier
  const labelOf = (edge: FlowEdge) =>
    edge.label === '' ? [] : edge.label.split('\n').flatMap(part => (!/\s/.test(part) && cellWidth(part) <= 32 ? [part] : wrap(part, labelCap).lines)).map(l => l.replace(/\u00a0/g, ' '))
  // near-side loops' lanes, and their labels top-down, sit before the chart, so every box moves over
  const nearRoom = loops.filter(l => l.near).reduce((sum, l) => sum + 2 + (across ? 0 : Math.max(0, ...labelOf(l.edge).map(w => cellWidth(w) + 2))), 0)
  const shift = nearRoom > 0 ? nearRoom + 1 : 0
  for (const v of plan.vertices) v.at += shift

  // each channel between rank r and r+1 holds a track per edge that changes cross position there
  const channels = ranks.slice(0, -1).map(() => ({ tracks: 0, label: 0 }))
  const portOut = new Map<Vertex, number>()
  const portIn = new Map<Vertex, Route[]>()
  const centre = (v: Vertex) => v.at + Math.floor(v.cross / 2)
  for (const route of routes) {
    const last = route.path.at(-1)!
    portIn.set(last, [...(portIn.get(last) ?? []), route])
  }
  // edges of one stroke fan out of a shared port at the middle; a dotted or thick edge from the same
  // box leaves through a port of its own beside it, so its stroke shows from the border on
  const leaving = new Map<Route, number>()
  const outOf = new Map<Vertex, Route[]>()
  for (const route of routes) if (route.path[0]!.node) outOf.set(route.path[0]!, [...(outOf.get(route.path[0]!) ?? []), route])
  for (const [v, list] of outOf) {
    // ports sit in the order of where their edges head, so two strokes never cross under the box
    const toward = (stroke: Stroke) => {
      const mine = list.filter(r => r.edge.stroke === stroke)
      return mine.reduce((sum, r) => sum + centre(r.path[1]!), 0) / mine.length
    }
    // the stroke most edges share keeps the middle; each other stroke steps out toward where it heads
    const count = (stroke: Stroke) => list.filter(r => r.edge.stroke === stroke).length
    const strokes = [...new Set(list.map(r => r.edge.stroke))]
    const main = [...strokes].sort((a, b) => count(b) - count(a) || Number(b === 'solid') - Number(a === 'solid'))[0]!
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
      const side = short.reduce((sum, r) => sum + centre(r.path[1]!), 0) / short.length < centre(v) ? -1 : 1
      const at = Math.max(v.at + 1, Math.min(v.at + v.cross - 2, centre(v) + side * Math.max(2, Math.floor(v.cross / 4))))
      for (const r of short) leaving.set(r, at)
    }
    lefts.forEach((stroke, k) => place(stroke, centre(v) - step * (k + 1)))
    rights.forEach((stroke, k) => place(stroke, centre(v) + step * (k + 1)))
  }
  // left to right, a stroke other than a box's main one leaves through its top or bottom, toward
  // where it heads, and runs along that row; the box keeps its height and its side keeps one port
  const off = new Map<Route, number>()
  if (across)
    for (const [v, list] of outOf) {
      const count = (stroke: Stroke) => list.filter(r => r.edge.stroke === stroke).length
      const main = [...new Set(list.map(r => r.edge.stroke))].sort((x, y) => count(y) - count(x) || Number(y === 'solid') - Number(x === 'solid'))[0]
      for (const route of list) {
        if (route.edge.stroke === main) {
          leaving.set(route, centre(v))
          continue
        }
        const row = centre(route.path[1]!)
        const up = row < v.at
        const [lo, hi] = up ? [row, v.at] : [v.at + v.cross, row]
        const clear = ranks[v.rank]!.every(w => w === v || w.at + w.cross <= lo || w.at > hi)
        if ((up || row >= v.at + v.cross) && clear) {
          off.set(route, up ? v.at - 1 : v.at + v.cross)
          leaving.set(route, row)
        }
      }
    }
  // a long edge's placeholders follow its port when that is a cell or two off their middle, so the
  // edge runs straight down instead of stepping aside under its box
  const through = (route: Route, i: number) => {
    const v = route.path[i]!
    if (i === 0) return leaving.get(route) ?? centre(v)
    if (v.node) return centre(v)
    const port = leaving.get(route)
    return port !== undefined && route.path.slice(1, -1).every(d => Math.abs(centre(d) - port) <= 2) ? port : centre(v)
  }
  // an arrow lands where its line already runs when that is over the box, so it drops straight in.
  // A solid edge claims its spot first; the others take the nearest spot a cell clear of every
  // arrow already placed. A decision's arrows keep off its slanted corners.
  const landing = new Map<Route, number>()
  // left to right, a decision takes its main arrow at its tip; another arriving from above or below
  // drops onto its top or bottom with a head of its own, never onto a slanted side
  const onto = new Map<Route, 'top' | 'bottom'>()
  for (const [v, list] of portIn) {
    const from = (route: Route) => through(route, route.path.length - 2)
    const inset = v.node!.shape === 'diamond' || v.node!.shape === 'hexagon' ? (across ? 1 : 2) : 1
    const lo = v.at + inset
    const hi = v.at + v.cross - 1 - inset
    // separate heads into one box sit five cells apart top-down, so neither reads as part of the other
    const apart = across ? 2 : Math.min(5, Math.max(3, Math.floor((hi - lo) / Math.max(1, list.length - 1))))
    if (across && (v.node!.shape === 'diamond' || v.node!.shape === 'hexagon')) {
      const ranked = [...list].sort((a, b) => Number(a.edge.stroke !== 'solid') - Number(b.edge.stroke !== 'solid') || Math.abs(from(a) - centre(v)) - Math.abs(from(b) - centre(v)))
      ranked.forEach((route, i) => {
        landing.set(route, centre(v))
        const row = from(route)
        const side = row < v.at - 1 ? 'top' : row > v.at + v.cross ? 'bottom' : undefined
        const [lo, hi] = side === 'top' ? [row, v.at] : [v.at + v.cross, row]
        const clear = ranks[v.rank]!.every(w => w === v || w.at + w.cross <= lo || w.at > hi)
        if (i > 0 && side && clear) onto.set(route, side)
      })
      continue
    }
    // a bus lands where one of its edges already runs straight in near the box's middle, so that edge
    // never steps aside; with none that close it lands mid-box
    // a long edge keeps out of a bus: it lands on its own straight line with its own head, so its
    // line never doubles as another edge's way in
    const isLong = (route: Route) => route.path.length > 2
    const bus = (route: Route) => {
      if (isLong(route)) return undefined
      const mine = list.filter(r => r.edge.stroke === route.edge.stroke && !isLong(r))
      if (mine.length < 2) return undefined
      const straight = mine.map(from).filter(at => Math.abs(at - centre(v)) <= 2).sort((a, b) => Math.abs(a - centre(v)) - Math.abs(b - centre(v)))
      return straight[0] ?? centre(v)
    }
    const want = (route: Route) => Math.max(lo, Math.min(hi, bus(route) ?? (list.length === 1 && route.path.at(-2)!.node ? centre(v) : from(route))))
    const first = [...list].sort((a, b) => Number(a.edge.stroke !== 'solid') - Number(b.edge.stroke !== 'solid') || Math.abs(want(a) - from(a)) - Math.abs(want(b) - from(b)))
    const taken: number[] = []
    const joined = new Map<Stroke, number>()
    for (const route of first) {
      // edges of one stroke join on one bus into the box and share its head, which sits mid-box
      // when more than one of them comes in
      const shared = isLong(route) ? undefined : joined.get(route.edge.stroke)
      if (shared !== undefined) {
        landing.set(route, shared)
        continue
      }
      const free = (at: number) => at >= lo && at <= hi && taken.every(t => Math.abs(t - at) >= apart)
      // it only looks on the side of the heads already placed that its line comes from, so it never
      // crosses another head's line; with no spot there far enough off, it takes the furthest one
      const near = taken.length === 0 ? undefined : taken.reduce((a, t) => (Math.abs(t - from(route)) < Math.abs(a - from(route)) ? t : a))
      const onSide = (x: number) => near === undefined || from(route) === near || (x !== near && Math.sign(x - near) === Math.sign(from(route) - near))
      const spots = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(onSide)
      const room = (x: number) => (taken.length === 0 ? Infinity : Math.min(...taken.map(t => Math.abs(t - x))))
      let at = spots.filter(free).sort((x, y) => Math.abs(x - want(route)) - Math.abs(y - want(route)))[0] ?? spots.reduce((best, x) => (room(x) > room(best) ? x : best), spots[0] ?? want(route))
      // heads side by side read as one; past the other head is better than that
      if (room(at) < 2) {
        const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
        at = all.filter(free).sort((x, y) => Math.abs(x - want(route)) - Math.abs(y - want(route)))[0] ?? all.reduce((best, x) => (room(x) > room(best) ? x : best), at)
      }
      taken.push(at)
      if (!isLong(route)) joined.set(route.edge.stroke, at)
      landing.set(route, at)
    }
  }
  const crossAt = (route: Route, i: number) => (i === route.path.length - 1 ? landing.get(route)! : through(route, i))
  const placed: Placed[] = routes.map(route => ({ route, tracks: [] }))
  for (let c = 0; c < channels.length; c++) {
    const spans: Array<{ p: Placed; lo: number; hi: number; owner: string }> = []
    for (const p of placed) {
      const i = p.route.path.findIndex(v => v.rank === c)
      if (i < 0 || i === p.route.path.length - 1) continue
      const a = crossAt(p.route, i)
      const b = crossAt(p.route, i + 1)
      if (a === b) continue
      // edges fanning out of one port share a track, and so do edges meeting at one head
      const meets = i + 1 === p.route.path.length - 1
      spans.push({ p, lo: Math.min(a, b), hi: Math.max(a, b), owner: meets && landing.get(p.route) !== undefined && [...landing].filter(([r, at]) => r.path.at(-1) === p.route.path.at(-1) && at === b).length > 1 ? `in:${p.route.path.at(-1)!.key}:${b}` : `${p.route.path[i]!.key}:${i === 0 ? crossAt(p.route, 0) : ''}` })
    }
    // edges fanning out of one node share a track; others take the first track they don't overlap
    const used: Array<Array<{ lo: number; hi: number; owner: string }>> = []
    spans.sort((a, b) => a.lo - b.lo)
    for (const span of spans) {
      let t = used.findIndex(track => track.every(o => o.owner === span.owner || o.hi < span.lo - 1 || o.lo > span.hi + 1))
      if (t < 0) {
        t = used.length
        used.push([])
      }
      used[t]!.push(span)
      span.p.tracks[c] = t
    }
    channels[c]!.tracks = used.length
  }
  for (const route of routes) {
    const into = route.path.at(-1)!.rank - 1
    const lines = labelOf(route.edge)
    if (lines.length === 0 || into < 0) continue
    const room = across ? Math.max(...lines.map(cellWidth)) + 2 : lines.length
    channels[into]!.label = Math.max(channels[into]!.label, room)
  }

  // a chart with subgraphs gets four spare rows at each end of every channel: a frame's border runs
  // on the one by the boxes, and the others keep it clear of the edges turning beyond
  const pad = flow.groups.length > 0 ? 4 : 0
  // main-axis offsets: rank bands and the channels between them
  const bandStart: number[] = []
  const bandSize = ranks.map(list => Math.max(0, ...list.map(v => v.main)))
  const channelStart: number[] = []
  let run = 2 * pad
  ranks.forEach((_, r) => {
    bandStart.push(run)
    run += bandSize[r]!
    if (r < channels.length) {
      channelStart.push(run)
      // left to right, a head gets a two-cell stub so it never crowds the box it enters
      run += 1 + 2 * pad + channels[r]!.tracks + channels[r]!.label + (across ? 2 : 1)
    }
  })
  const mainTotal = run
  const crossTotal = Math.max(1, ...plan.vertices.map(v => v.at + v.cross))
  const xy = (m: number, k: number): [number, number] => {
    const main = reversed ? mainTotal - 1 - m : m
    return across ? [main, k] : [k, main]
  }
  // loops nest outside the chart on their side, the shortest innermost, each on a lane of its own.
  // Top-down, a labelled loop's lane stands far enough out for its label to sit on the run leaving
  // its source, short of the lane, where it can only belong to that loop
  const far = loops.filter(loop => !loop.near)
  const near = loops.filter(loop => loop.near)
  const before = (loop: Loop) => (across ? 0 : Math.max(0, ...labelOf(loop.edge).map(w => cellWidth(w) + 2)))
  const laneAt = (loop: Loop) => {
    const side = loop.near ? near : far
    const k = side.indexOf(loop)
    const out = 2 * k + side.slice(0, k + 1).reduce((sum, l) => sum + before(l), 0)
    return loop.near ? shift - 2 - out : crossTotal + 1 + out
  }
  const farRoom = far.length === 0 ? 0 : laneAt(far.at(-1)!) - crossTotal + 1
  const total = across ? mainTotal : crossTotal + farRoom
  if (total > width || (across && crossTotal + farRoom > 400)) return undefined

  const grid = new Grid()
  // nodes first, so lines stop at their borders
  for (const v of plan.vertices) {
    if (!v.node) continue
    const m0 = bandStart[v.rank]! + (reversed ? bandSize[v.rank]! - v.main : 0)
    const [x0, y0] = xy(m0, v.at)
    const [x1, y1] = xy(m0 + v.main - 1, v.at + v.cross - 1)
    drawNode(grid, v, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1)
  }
  const segment = (m0: number, k0: number, m1: number, k1: number, stroke: Stroke) => {
    const [x0, y0] = xy(m0, k0)
    const [x1, y1] = xy(m1, k1)
    grid.line(x0, y0, x1, y1, stroke)
  }
  // heads stay bright on a dimmed dotted edge, so where it lands never fades
  const head = (m: number, k: number, forward: boolean) => {
    const [x, y] = xy(m, k)
    const ahead = forward !== reversed
    grid.put(x, y, across ? (ahead ? HEADS.right : HEADS.left) : ahead ? HEADS.down : HEADS.up, 'line')
  }
  const labels: Array<{ route: Route; m: number; k: number; lines: string[]; spots?: Array<[number, number]> }> = []
  for (const p of placed) {
    const { route } = p
    const stroke = route.edge.stroke
    const path = route.path
    for (let i = 0; i < path.length - 1; i++) {
      const v = path[i]!
      const c = v.rank
      const from = v.node ? bandStart[c]! + v.main : bandStart[c]!
      const a = crossAt(route, i)
      const b = crossAt(route, i + 1)
      const lane = channelStart[c]! + 1 + pad + (p.tracks[c] ?? 0)
      const end = channelStart[c + 1] === undefined && c + 1 === ranks.length - 1 ? bandStart[c + 1]! - 1 : bandStart[c + 1]! - 1
      if (!v.node) segment(bandStart[c]!, a, bandStart[c]! + bandSize[c]! - 1, a, stroke)
      if (i === 0 && off.has(route)) {
        const row = off.get(route)!
        const m = bandStart[c]! + Math.max(1, v.main - 3)
        segment(m, row, m, b, stroke)
        // its label rides along the row it runs on, just past the turn
        const said = labelOf(route.edge)
        if (said.length > 0 && i === path.length - 2) labels.push({ route, m: m + 2, k: b, lines: said })
        if (i === path.length - 2 && onto.has(route)) {
          const target = path[i + 1]!
          const mid = bandStart[c + 1]! + Math.floor(target.main / 2)
          const edge = onto.get(route) === 'top' ? target.at - 1 : target.at + target.cross
          segment(m, b, mid, b, stroke)
          segment(mid, b, mid, edge, stroke)
          const [hx, hy] = xy(mid, edge)
          if (route.edge.head) grid.put(hx, hy, onto.get(route) === 'top' ? HEADS.down : HEADS.up, 'line')
        } else segment(m, b, i === path.length - 2 ? end : bandStart[c + 1]! + bandSize[c + 1]! - 1, b, stroke)
        continue
      }
      if (i === path.length - 2 && onto.has(route)) {
        const target = path[i + 1]!
        const mid = bandStart[c + 1]! + Math.floor(target.main / 2)
        const edge = onto.get(route) === 'top' ? target.at - 1 : target.at + target.cross
        const said = labelOf(route.edge)
        if (said.length > 0) labels.push({ route, m: from + 1, k: a, lines: said })
        segment(from, a, mid, a, stroke)
        segment(mid, a, mid, edge, stroke)
        const [hx, hy] = xy(mid, edge)
        if (route.edge.head) grid.put(hx, hy, onto.get(route) === 'top' ? HEADS.down : HEADS.up, 'line')
        continue
      }
      const turn = a === b ? from : lane
      segment(from, a, turn, a, stroke)
      segment(turn, a, turn, b, stroke)
      segment(turn, b, end, b, stroke)
      if (i === path.length - 2) {
        const lines = labelOf(route.edge)
        if (lines.length > 0) labels.push({ route, m: channelStart[c]! + 2 + pad + channels[c]!.tracks, k: b, lines })
      }
    }
    const last = path.at(-1)!
    const first = path[0]!
    // the line leaves through the border, so the border shows where: ┬ under a box, ├ beside it
    const exit = off.get(route)
    const [bx, by] = exit !== undefined ? xy(bandStart[first.rank]! + Math.max(1, first.main - 3), exit < first.at ? first.at : first.at + first.cross - 1) : xy(bandStart[first.rank]! + first.main - 1, crossAt(route, 0))
    if (exit !== undefined) {
      const cell = grid.cells[by]?.[bx]
      if (cell) cell.char = exit < first.at ? '┴' : '┬'
    }
    const border = grid.cells[by]?.[bx]
    if (exit !== undefined) void 0
    else if (border?.char === '═') border.char = reversed ? '╧' : '╤'
    else if (border?.char === '║') border.char = reversed ? '╢' : '╟'
    else if (border?.char === '─' || border?.char === '│') border.char = across ? (reversed ? '┤' : '├') : reversed ? '┴' : '┬'
    const landingAt = crossAt(route, path.length - 1)
    if (route.edge.head && !onto.has(route)) head(bandStart[last.rank]! - 1, landingAt, true)
    if (route.edge.tail) head(bandStart[first.rank]! + first.main, crossAt(route, 0), false)
  }
  // a loop leaves its source through the side facing out, runs up its lane and comes into its
  // target's same side: right of a top-down chart, under a left-right one
  // a box's loop rows: the ways in on top, the outer loop highest, then the ways out, the inner loop
  // first, so no two loops' runs cross
  const slots = new Map<string, Loop[]>()
  const slotOf = (v: Vertex, loop: Loop) => `${v.key}:${loop.near}`
  for (const loop of loops) for (const v of [loop.to, loop.from]) slots.set(slotOf(v, loop), [...(slots.get(slotOf(v, loop)) ?? []), loop])
  const key = (v: Vertex, loop: Loop) => (loop.to === v ? -1000 - loops.indexOf(loop) : loops.indexOf(loop))
  for (const [k, list] of slots) list.sort((x, y) => key(list.find(l => slotOf(l.to, l) === k) ? x.to : x.from, x) - key(list.find(l => slotOf(l.to, l) === k) ? y.to : y.from, y))
  loops.forEach(loop => {
    const lane = laneAt(loop)
    // loops on one box spread along its side, so no two share an arrow or a stub
    const row = (v: Vertex) => {
      const list = slots.get(slotOf(v, loop))!
      const i = list.indexOf(loop)
      const start = bandStart[v.rank]! + (reversed ? bandSize[v.rank]! - v.main : 0)
      return list.length === 1 ? start + Math.floor(v.main / 2) : start + Math.round(((i + 1) * (v.main - 1)) / (list.length + 1))
    }
    const side = (v: Vertex) => (loop.near ? v.at - 1 : v.at + v.cross)
    const stroke = loop.edge.stroke
    const a = row(loop.from)
    const b = row(loop.to)
    segment(a, side(loop.from), a, lane, stroke)
    segment(a, lane, b, lane, stroke)
    segment(b, lane, b, side(loop.to), stroke)
    const out = (v: Vertex, m: number) => {
      const [x, y] = xy(m, loop.near ? side(v) + 1 : side(v) - 1)
      const cell = grid.cells[y]?.[x]
      if (cell?.char === '│' || cell?.char === '─' || cell?.char === '<' || cell?.char === '>' || cell?.char === '(' || cell?.char === ')') cell.char = across ? (loop.near ? '┴' : '┬') : loop.near ? '┤' : '├'
    }
    const arrow = (m: number, v: Vertex) => {
      const [x, y] = xy(m, side(v))
      grid.put(x, y, across ? (loop.near ? HEADS.down : HEADS.up) : loop.near ? HEADS.right : HEADS.left, 'line')
    }
    out(loop.from, a)
    if (loop.edge.head) arrow(b, loop.to)
    if (loop.edge.tail) arrow(a, loop.from)
    const lines = labelOf(loop.edge)
    // a loop's label sits on the run leaving its source, before the run turns up its lane
    if (lines.length > 0)
      labels.push({
        route: { edge: loop.edge, path: [] },
        m: across ? a + 2 : a,
        k: across ? side(loop.from) + lines.length : side(loop.from) - 1,
        lines,
        // top-down, it moves right of its lane when the run is too short to hold it
        spots: across ? undefined : loop.near ? [[a - lines.length, lane + 2]] : [[a - lines.length, side(loop.from) + 1], [Math.round((a + b) / 2) - Math.floor(lines.length / 2), lane + 2]],
      })
  })
  // each subgraph is framed round its members, unless a box outside it would land inside the frame
  for (const group of flow.groups) {
    const members = plan.vertices.filter(v => v.node?.group === group.id)
    if (members.length === 0) continue
    // a cell of edge runs between a frame and the boxes it holds, so a head lands inside the frame
    const lo = Math.min(...members.map(v => bandStart[v.rank]!)) - 3
    const hi = Math.max(...members.map(v => bandStart[v.rank]! + bandSize[v.rank]!)) + 2
    const near = Math.min(...members.map(v => v.at)) - 2
    const title = ` ${group.label} `
    // top-down, the frame is at least wide enough for its title
    const far = Math.max(...members.map(v => v.at + v.cross)) + 1 + (across ? 0 : Math.max(0, near + cellWidth(title) + 5 - Math.max(...members.map(v => v.at + v.cross)) - 1))
    const inside = (v: Vertex) => v.node && v.node.group !== group.id && bandStart[v.rank]! + v.main > lo && bandStart[v.rank]! < hi && v.at + v.cross > near && v.at < far
    if (plan.vertices.some(inside) || near < 0 || lo < 0) continue
    const [x0, y0] = xy(lo, near)
    const [x1, y1] = xy(hi, far)
    const [left, top, bottom] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
    // the frame reaches far enough past the last line crossing its top for the title to fit there
    const crossed = Array.from({ length: Math.max(x0, x1) - left + 1 }, (_, i) => left + i).filter(x => (grid.cells[top]?.[x]?.mask ?? 0) !== 0)
    const right = Math.max(Math.max(x0, x1), crossed.length > 0 && cellWidth(title) + 3 > crossed[0]! - left ? Math.max(...crossed) + cellWidth(title) + 4 : 0)
    if (right >= width) continue
    // where an edge crosses the border the crossing is drawn, so neither the edge nor the frame breaks
    const edge = (x: number, y: number, char: string) => {
      if (grid.isFree(x, y)) grid.put(x, y, char, 'frame')
      else {
        const cell = grid.cells[y]?.[x]
        const across = char === '─' ? UP | DOWN : char === '│' ? LEFT | RIGHT : 0
        if (cell && cell.char === undefined && across !== 0 && (cell.mask & across) === across) cell.mask |= UP | DOWN | LEFT | RIGHT
      }
    }
    for (let x = left + 1; x < right; x++) {
      edge(x, top, '─')
      edge(x, bottom, '─')
    }
    for (let y = top + 1; y < bottom; y++) {
      edge(left, y, '│')
      edge(right, y, '│')
    }
    edge(left, top, '╭')
    edge(right, top, '╮')
    edge(left, bottom, '╰')
    edge(right, bottom, '╯')
    // the title takes the first stretch of the top border no edge crosses
    const clear = (at: number) => [...title, '─'].every((_, i) => grid.cells[top]?.[at - 1 + i]?.char === '─' || (at - 1 + i === left && i === 0))
    const spot = Array.from({ length: Math.max(0, right - left - cellWidth(title) - 1) }, (_, i) => left + 2 + i).find(clear)
    // with no clear stretch on the border it sits just inside the frame's top corner
    if (spot !== undefined) grid.write(spot, top, title, 'name')
    else if ([...title].every((_, i) => grid.isFree(left + 1 + i, top + 1))) grid.write(left + 1, top + 1, title, 'name')
  }
  const notes: string[] = []
  let footnotes = 0
  for (const label of labels) {
    const fits = (m: number, k: number) =>
      label.lines.every((line, j) => {
        for (let i = 0; i < cellWidth(line); i++) {
          const [x, y] = across ? xy(m + i, k - label.lines.length + j) : xy(m + j, k + i)
          if (!grid.isFree(x, y) || x >= width) return false
        }
        return true
      })
    const put = (m: number, k: number) =>
      label.lines.forEach((line, j) => {
        const [x, y] = across ? xy(m, k - label.lines.length + j) : xy(m + j, k)
        grid.write(across && reversed ? x - cellWidth(line) + 1 : x, y, line, 'text')
      })
    const widest = Math.max(...label.lines.map(cellWidth))
    const tries: Array<[number, number]> = label.spots ?? (across
      ? [[label.m, label.k], [label.m, label.k + label.lines.length + 1]]
      : [[label.m - 1, label.k + 2], [label.m - 1, label.k - 1 - widest]])
    const spot = tries.find(([m, k]) => k >= 0 && fits(m, k))
    if (spot) put(...spot)
    else {
      footnotes++
      const mark = superscript(footnotes)
      const [x, y] = across ? xy(label.m - 1, label.k - 1) : xy(label.m - 1, label.k + 2)
      if (grid.isFree(x, y)) grid.write(x, y, mark, 'text')
      notes.push(`${mark} ${label.lines.join(' ')}`)
    }
  }
  for (const loop of flow.edges.filter(edge => edge.from === edge.to)) notes.push(`↺ ${loop.from} loops to itself${loop.label ? `: ${loop.label}` : ''}`)
  // rows kept clear for frames that were never drawn come off both ends
  const rows = grid.runs(width)
  while (rows.length > 0 && rows[0]!.length === 0) rows.shift()
  while (rows.length > 0 && rows.at(-1)!.length === 0) rows.pop()
  return { rows, notes }
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number) => [...String(n)].map(d => SUPERSCRIPT[Number(d)]).join('')
