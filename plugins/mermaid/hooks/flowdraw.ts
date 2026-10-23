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
    while (this.cells.length <= y) this.cells.push([])
    const row = this.cells[y]!
    while (row.length <= x) row.push({ mask: 0, stroke: 'solid', ink: 'line' })
    return row[x]!
  }

  isFree(x: number, y: number): boolean {
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
    cell.mask |= bits
    if (stroke !== 'solid' || cell.stroke === 'solid') cell.stroke = stroke
    if (lane !== undefined) cell.lane = lane
  }

  runs(width: number): Run[][] {
    return this.cells.map(row => {
      const runs: Run[] = []
      for (let x = 0; x < Math.min(width, row.length); x++) {
        const cell = row[x]!
        const char = cell.char ?? glyph(cell)
        if (char === '') continue
        const last = runs.at(-1)
        if (last && last.ink === cell.ink && last.lane === cell.lane) last.text += char
        else runs.push({ text: char, ink: cell.ink, ...(cell.lane === undefined ? {} : { lane: cell.lane }) })
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
    if (mask === (UP | DOWN)) return '┆'
    if (mask === (LEFT | RIGHT)) return '┄'
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
type Loop = { edge: FlowEdge; from: Vertex; to: Vertex }

export type FlowDrawn = { rows: Run[][]; notes: string[] }

const isAcross = (d: Direction) => d === 'LR' || d === 'RL'

function boxOf(node: FlowNode, cap: number, across: boolean): Pick<Vertex, 'lines' | 'main' | 'cross'> {
  const lines = node.label.split('\n').flatMap(part => wrap(part, cap).lines).map(line => line.replace(/ /g, ' '))
  const text = Math.max(1, ...lines.map(cellWidth))
  const pad = node.shape === 'diamond' || node.shape === 'hexagon' || node.shape === 'circle' ? 3 : 2
  const width = text + 2 * pad
  const height = lines.length + 2
  return { lines, main: across ? width : height, cross: across ? height : width }
}

// Edges that close a cycle are laid out reversed, so every rank points one way.
function ranksOf(flow: Flow): { rank: Map<string, number>; back: Set<FlowEdge> } {
  const out = new Map<string, FlowEdge[]>(flow.nodes.map(n => [n.id, []]))
  for (const edge of flow.edges) if (edge.from !== edge.to) out.get(edge.from)?.push(edge)
  const back = new Set<FlowEdge>()
  const state = new Map<string, 1 | 2>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const edge of out.get(id) ?? []) {
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
      loops.push({ edge, from: a, to: b })
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
  const top = Math.max(0, ...vertices.map(v => v.rank))
  const ranks: Vertex[][] = Array.from({ length: top + 1 }, () => [])
  for (const v of vertices) ranks[v.rank]!.push(v)
  const ups = new Map<Vertex, Vertex[]>()
  const downs = new Map<Vertex, Vertex[]>()
  for (const { path } of routes)
    for (let i = 1; i < path.length; i++) {
      ups.set(path[i]!, [...(ups.get(path[i]!) ?? []), path[i - 1]!])
      downs.set(path[i - 1]!, [...(downs.get(path[i - 1]!) ?? []), path[i]!])
    }
  ranks.forEach(list => list.forEach((v, i) => (v.order = i)))
  // barycentre sweeps cut crossings; ties keep the order the source gave
  const mean = (list: Vertex[] | undefined) => (list && list.length > 0 ? list.reduce((s, v) => s + v.order, 0) / list.length : undefined)
  for (let sweep = 0; sweep < 8; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? ranks.slice(1) : ranks.slice(0, -1).reverse()
    for (const list of order) {
      const keyed = list.map(v => ({ v, at: mean(down ? ups.get(v) : downs.get(v)) ?? v.order }))
      keyed.sort((a, b) => a.at - b.at || a.v.order - b.v.order)
      keyed.forEach(({ v }, i) => (v.order = i))
      list.sort((a, b) => a.order - b.order)
    }
  }
  // a box a loop leaves or enters goes last in its rank, on the side the loop's lane runs, so the
  // loop never runs through a neighbour
  const looped = new Set(loops.flatMap(loop => [loop.from, loop.to]))
  for (const list of ranks) {
    list.sort((a, b) => Number(looped.has(a)) - Number(looped.has(b)) || a.order - b.order)
    list.forEach((v, i) => (v.order = i))
  }
  const gap = across ? 1 : 3
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
  for (let pass = 0; pass < 2; pass++)
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
  const least = Math.min(...vertices.map(v => v.at))
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
  diamond: ['╱', '╲', '╲', '╱', '<', '>'],
  hexagon: ['╱', '╲', '╲', '╱', '<', '>'],
  database: ['╒', '╕', '╘', '╛', '│', '│'],
  flag: ['┌', '┐', '└', '┘', '>', '│'],
}

function drawNode(grid: Grid, v: Vertex, x: number, y: number, width: number, height: number) {
  const shape = v.node!.shape
  const [tl, tr, bl, br, sl, sr] = CORNERS[shape]
  // a database's doubled top and bottom stand in for the cylinder's curved ends
  const rule = shape === 'database' ? '═' : '─'
  grid.write(x, y, tl + rule.repeat(width - 2) + tr, 'frame')
  grid.write(x, y + height - 1, bl + rule.repeat(width - 2) + br, 'frame')
  for (let k = 1; k < height - 1; k++) {
    const middle = shape === 'diamond' || shape === 'hexagon' ? k === Math.ceil((height - 2) / 2) : true
    grid.put(x, y + k, middle ? sl : '│', 'frame')
    grid.put(x + width - 1, y + k, middle ? sr : '│', 'frame')
    for (let i = 1; i < width - 1; i++) grid.put(x + i, y + k, ' ', 'name')
  }
  v.lines.forEach((line, k) => grid.write(x + Math.floor((width - cellWidth(line)) / 2), y + 1 + k, line, 'name'))
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
  const labelOf = (edge: FlowEdge) => (edge.label === '' ? [] : edge.label.split('\n').flatMap(part => wrap(part, labelCap).lines).map(l => l.replace(/ /g, ' ')))

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
    const strokes = [...new Set(list.map(r => r.edge.stroke))].sort((a, b) => toward(a) - toward(b))
    strokes.forEach((stroke, k) => {
      const at = Math.max(v.at + 1, Math.min(v.at + v.cross - 2, centre(v) + 2 * k - (strokes.length - 1)))
      for (const r of list) if (r.edge.stroke === stroke) leaving.set(r, at)
    })
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
  // an arrow lands where its line already runs when that is over the box, so it drops straight in;
  // arrows that would land within a cell of each other spread out along the side
  const landing = new Map<Route, number>()
  for (const [v, list] of portIn) {
    const from = (route: Route) => through(route, route.path.length - 2)
    list.sort((a, b) => from(a) - from(b))
    const lo = v.at + 1
    const hi = v.at + v.cross - 2
    const at = list.map(route => Math.max(lo, Math.min(hi, list.length === 1 && route.path.at(-2)!.node ? centre(v) : from(route))))
    for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i]!, at[i - 1]! + 3)
    for (let i = at.length - 1; i >= 0; i--) at[i] = Math.min(at[i]!, i === at.length - 1 ? hi : at[i + 1]! - 3)
    list.forEach((route, i) => landing.set(route, Math.max(lo, at[i]!)))
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
      spans.push({ p, lo: Math.min(a, b), hi: Math.max(a, b), owner: `${p.route.path[i]!.key}:${i === 0 ? crossAt(p.route, 0) : ''}` })
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
    const room = across ? Math.max(...lines.map(cellWidth)) + 1 : lines.length
    channels[into]!.label = Math.max(channels[into]!.label, room)
  }

  // main-axis offsets: rank bands and the channels between them
  const bandStart: number[] = []
  const bandSize = ranks.map(list => Math.max(0, ...list.map(v => v.main)))
  const channelStart: number[] = []
  let run = 0
  ranks.forEach((_, r) => {
    bandStart.push(run)
    run += bandSize[r]!
    if (r < channels.length) {
      channelStart.push(run)
      run += 1 + channels[r]!.tracks + channels[r]!.label + 1
    }
  })
  const mainTotal = run
  const crossTotal = Math.max(1, ...plan.vertices.map(v => v.at + v.cross))
  const xy = (m: number, k: number): [number, number] => {
    const main = reversed ? mainTotal - 1 - m : m
    return across ? [main, k] : [k, main]
  }
  // loops nest outside the chart, the shortest innermost, each on a lane of its own
  loops.sort((a, b) => Math.abs(a.from.rank - a.to.rank) - Math.abs(b.from.rank - b.to.rank))
  const laneAt = (k: number) => crossTotal + 1 + 2 * k
  const loopRoom = loops.length === 0 ? 0 : 2 * loops.length
  const total = across ? mainTotal : crossTotal + loopRoom
  if (total > width || (across && crossTotal + loopRoom > 400)) return undefined

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
  const head = (m: number, k: number, forward: boolean) => {
    const [x, y] = xy(m, k)
    const ahead = forward !== reversed
    grid.put(x, y, across ? (ahead ? HEADS.right : HEADS.left) : ahead ? HEADS.down : HEADS.up, 'line')
  }
  const labels: Array<{ route: Route; m: number; k: number; lines: string[] }> = []
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
      const lane = channelStart[c]! + 1 + (p.tracks[c] ?? 0)
      const end = channelStart[c + 1] === undefined && c + 1 === ranks.length - 1 ? bandStart[c + 1]! - 1 : bandStart[c + 1]! - 1
      if (!v.node) segment(bandStart[c]!, a, bandStart[c]! + bandSize[c]! - 1, a, stroke)
      const turn = a === b ? from : lane
      segment(from, a, turn, a, stroke)
      segment(turn, a, turn, b, stroke)
      segment(turn, b, end, b, stroke)
      if (i === path.length - 2) {
        const lines = labelOf(route.edge)
        if (lines.length > 0) labels.push({ route, m: channelStart[c]! + 2 + channels[c]!.tracks, k: b, lines })
      }
    }
    const last = path.at(-1)!
    const first = path[0]!
    // the line leaves through the border, so the border shows where: ┬ under a box, ├ beside it
    const [bx, by] = xy(bandStart[first.rank]! + first.main - 1, crossAt(route, 0))
    const border = grid.cells[by]?.[bx]
    if (border?.char === '═') border.char = reversed ? '╧' : '╤'
    else if (border?.char === '─' || border?.char === '│') border.char = across ? (reversed ? '┤' : '├') : reversed ? '┴' : '┬'
    const landingAt = crossAt(route, path.length - 1)
    if (route.edge.head) head(bandStart[last.rank]! - 1, landingAt, true)
    if (route.edge.tail) head(bandStart[first.rank]! + first.main, crossAt(route, 0), false)
  }
  // a loop leaves its source through the side facing out, runs up its lane and comes into its
  // target's same side: right of a top-down chart, under a left-right one
  loops.forEach((loop, k) => {
    const lane = laneAt(k)
    const middle = (v: Vertex) => bandStart[v.rank]! + (reversed ? bandSize[v.rank]! - v.main : 0) + Math.floor(v.main / 2)
    const side = (v: Vertex) => v.at + v.cross
    const stroke = loop.edge.stroke
    const a = middle(loop.from)
    const b = middle(loop.to)
    segment(a, side(loop.from), a, lane, stroke)
    segment(a, lane, b, lane, stroke)
    segment(b, lane, b, side(loop.to), stroke)
    const out = (v: Vertex, m: number) => {
      const [x, y] = xy(m, side(v) - 1)
      const cell = grid.cells[y]?.[x]
      if (cell?.char === '│' || cell?.char === '─' || cell?.char === '<' || cell?.char === '>' || cell?.char === '(' || cell?.char === ')') cell.char = across ? '┬' : '├'
    }
    const arrow = (m: number, v: Vertex) => {
      const [x, y] = xy(m, side(v))
      grid.put(x, y, across ? HEADS.up : HEADS.left, 'line')
    }
    out(loop.from, a)
    if (loop.edge.head) arrow(b, loop.to)
    if (loop.edge.tail) arrow(a, loop.from)
    const lines = labelOf(loop.edge)
    if (lines.length > 0) labels.push({ route: { edge: loop.edge, path: [] }, m: across ? b + 2 : b - 1, k: across ? side(loop.to) + 1 + lines.length : side(loop.to) + 1 - 2, lines })
  })
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
    const tries: Array<[number, number]> = across
      ? [[label.m - 1, label.k], [label.m - 1, label.k + label.lines.length + 1]]
      : [[label.m - 1, label.k + 2], [label.m - 1, label.k - 1 - widest]]
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
  return { rows: grid.runs(width), notes }
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number) => [...String(n)].map(d => SUPERSCRIPT[Number(d)]).join('')
