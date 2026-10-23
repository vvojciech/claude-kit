import type { Arrow, Participant, Sequence, Step } from './parse'
import { cellWidth } from './width'

export type Ink = 'frame' | 'name' | 'line' | 'text' | 'note' | 'block' | 'number'
// `shade` marks cells inside a `rect` block, drawn on a faint background
// `lane` is the participant a cell belongs to (its box, lifeline, or the sender of its message);
// `reply` marks a dashed return, so a surface can colour or quieten them
export type Run = { text: string; ink: Ink; shade?: boolean; lane?: number; reply?: boolean }

type Message = Extract<Step, { kind: 'message' }>
type Note = Extract<Step, { kind: 'note' }>
type Opening = Extract<Step, { kind: 'open' | 'branch' }>
type Cell = { char: string; ink: Ink; shade?: boolean; lane?: number; reply?: boolean }
type Paint = { lane?: number; reply?: boolean }
type Owner = Step | string
type Span = { a: number; b: number; need: number; owners: Owner[] }
type Wrapped = { lines: string[]; isCut: boolean }
type Block = { open: Extract<Step, { kind: 'open' }>; branches: Opening[]; steps: Step[]; children: Block[] }

type Item = {
  step: Step
  text: string
  number?: string
  fullWidth: number
  maxCap: number
  minCap: number
  wordCap: number
  pieceCap: number
  canInline: boolean
  isFrame: boolean
}
type State = { inline: boolean; tight?: boolean; cap: number; isHidden?: boolean }

type Plan = {
  lanes: Participant[]
  lane: Map<string, number>
  centre: number[]
  width: number
  states: Map<Step, State>
  names: number[]
  stacked: boolean[]
  isBare: boolean
  pads: Map<Block, { lo: number; hi: number; left: number; right: number }>
  creates: Map<Message, string>
  tight: Set<Owner>
  rows: number
  nested: Set<Step>
}

const HIDDEN_ROOM = 10
const NAME_MIN = 5
const NAME_KEEP = 6
const SOFT_CAP = 12
const HARD_CAP = 6
const FRAME_CAP = 8
const FRAME_ROOM = 6
const NEST_GAP = 2
const LOOSEN_TRIES = 12
// Room left of the first lifeline for a footnoted left-of note's `[n] ` marker.
const LEFT_MARK_ROOM = 4
// Layout work (items measured, summed over passes) one fit may spend on optional improvements,
// so a large diagram stays fast while a small one still gets every pass it can use.
const WORK_BUDGET = 2000
const SETTLE_RUNS = 60
let work = 0
const SELF_CAP = 24
// The most columns one allocation step hands a gap; wider steps rarely beat several narrow ones.
const STEP_MOST = 48
// A dashed return needs enough dashes beside its label to read as dashed.
const DASHES = 3
const LEADER = 1
// the fewest stroke cells an arrow keeps when a label shares its row
const ARROW_MIN = 3
const COLS_PER_ROW = 12
const ACTOR = '☺ '
const plain = (text: string) => text.replace(/\u00a0/g, ' ')
const GLUE = '\u00a0'
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const HEADS: Record<Arrow, { right: string; left: string }> = {
  filled: { right: '▶', left: '◀' },
  open: { right: '', left: '' },
  cross: { right: '×', left: '×' },
  async: { right: '▷', left: '◁' },
  both: { right: '▶', left: '◀' },
  half: { right: '⇀', left: '↽' },
}

const SHAPES: Record<string, string> = { queue: '≋ ', database: '◫ ', entity: '◇ ', boundary: '⊢ ', control: '↻ ', collections: '▤ ' }

const markerOf = (p: Participant) => (p.kind === 'actor' ? ACTOR : (p.shape && SHAPES[p.shape]) ?? '')

const SIMPLE = /^[\x20-\x7e\u00a0\u2026\u2190-\u21ff\u2500-\u25fc]*$/
const graphemes = (text: string) => (SIMPLE.test(text) ? [...text] : [...segmenter.segment(text)].map(s => s.segment))
const odd = (n: number) => (n % 2 === 0 ? n + 1 : n)
const half = (w: number) => (w - 1) / 2
const leftOf = (w: number) => Math.floor(w / 2)
const rightOf = (w: number) => w - 1 - Math.floor(w / 2)

function cut(text: string, most: number): { text: string; isCut: boolean } {
  if (cellWidth(text) <= most) return { text, isCut: false }
  if (most <= 0) return { text: '', isCut: true }
  let kept = ''
  for (const g of graphemes(text)) {
    if (cellWidth(kept + g) + 1 > most) break
    kept += g
  }
  return { text: `${kept.trimEnd()}…`, isCut: true }
}

const GLUED = '\u0001'
const BREAK_AFTER = /(?<=[/_,→])(?=[^\s/_,→])|(?<=::)(?=[^:\s])/u
const HUMP = /(?<=\p{Ll})(?=\p{Lu})/u
const BREAK_PREFERRED = /(?<=[/,→])(?=[^\s/,→])|(?<=[^\s(])(?=\()/u

// A token wider than the line splits after `/ , →` or before `(` first, so an identifier like
// `generate_offerset(req_identity,` wraps at its seams; `_` and `::` are used only when a part still
// doesn't fit. A run of letters and digits is never split, except in a participant name
// (`humps`), which may fold at a CamelCase hump rather than be cut.
function seams(part: string, cap: number, rule: RegExp): string[] {
  return cellWidth(part) > cap ? part.split(rule).filter(piece => piece !== '') : [part]
}

function pieces(token: string, cap: number, humps = false): string[] {
  if (cellWidth(token) <= cap) return [token]
  const parts = seams(token, cap, BREAK_PREFERRED)
    .flatMap(part => seams(part, cap, BREAK_AFTER))
    .flatMap(part => (humps ? seams(part, cap, HUMP) : [part]))
  if (parts.length < 2) return [token]
  const out: string[] = []
  let current = ''
  for (const part of parts) {
    if (current !== '' && cellWidth(current + part) > cap) {
      out.push(current)
      current = part
    } else current += part
  }
  if (current !== '') out.push(current)
  return out.map((piece, i) => (i === 0 ? piece : GLUED + piece))
}

function greedy(tokens: string[], cap: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const raw of tokens) {
    const isGlued = raw.startsWith(GLUED)
    const token = isGlued ? raw.slice(1) : raw
    if (current === '') current = token
    else if (isGlued && cellWidth(current + token) <= cap) current += token
    else if (!isGlued && cellWidth(`${current} ${token}`) <= cap) current = `${current} ${token}`
    else {
      lines.push(current)
      current = token
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

// Lines wrap split at a seam rejoin without the space a word break would need.
const joinLines = (lines: string[]) => lines.reduce((all, line) => (all === '' ? line : /([/_,→]|::)$/.test(all) ? all + line : `${all} ${line}`), '')

const wrapped = new Map<string, Wrapped>()

export function wrap(text: string, cap: number, humps = false): Wrapped {
  const key = `${cap}\u0000${humps ? 1 : 0}\u0000${text}`
  const hit = wrapped.get(key)
  if (hit) return hit
  if (wrapped.size > 20000) wrapped.clear()
  const result = wrapUncached(text, cap, humps)
  wrapped.set(key, result)
  return result
}

function wrapUncached(text: string, cap: number, humps: boolean): Wrapped {
  let isCut = false
  const lines = text.split('\n').flatMap(paragraph => {
    // A free-standing arrow or slash stays with the word before it, so no line starts with one.
    const kept = paragraph.replace(/ ([→⇢/|]) /gu, ' $1 ')
    const tokens = kept.split(' ').filter(t => t !== '').flatMap(token => pieces(token, cap, humps)).map(token => {
      const isGlued = token.startsWith(GLUED)
      const shown = cut(isGlued ? token.slice(1) : token, cap)
      isCut ||= shown.isCut
      return isGlued ? GLUED + shown.text : shown.text
    })
    if (tokens.length === 0) return []
    const lines = greedy(tokens, cap)
    let tight = cap
    const longest = Math.max(...tokens.map(token => cellWidth(token.replace(GLUED, ''))))
    while (lines.length > 1 && tight - 1 >= longest && greedy(tokens, tight - 1).length === lines.length) tight--
    return greedy(tokens, tight)
  })
  return { lines, isCut }
}

// A wrapped label whose last line leaves no room for the arrow costs a row of its own. A slightly
// narrower wrap with the same line count often frees that room, so try it before giving up the row.
const balancedCache = new Map<string, Map<number, Wrapped>>()

function balanced(lines: Wrapped, text: string, most: number): Wrapped {
  const fits = (line: string) => line !== '' && cellWidth(line) <= most
  const last = lines.lines.at(-1) ?? ''
  if (lines.isCut || lines.lines.length < 2 || fits(last)) return lines
  const wide = widest(lines.lines)
  const key = (most * 1024 + wide) * 1024 + lines.lines.length
  if (balancedCache.size > 2000) balancedCache.clear()
  const known = balancedCache.get(text) ?? new Map<number, Wrapped>()
  balancedCache.set(text, known)
  const hit = known.get(key)
  if (hit) return hit
  let found = lines
  for (let cap = wide - 1; cap >= Math.max(1, wide - 16); cap--) {
    const tried = wrap(text, cap)
    if (tried.isCut || tried.lines.length > lines.lines.length) break
    if (fits(tried.lines.at(-1) ?? '')) {
      found = tried
      break
    }
  }
  known.set(key, found)
  return found
}

const noteWidth = (step: Note, text: number) => (step.side === 'over' ? odd(text + 2) : text + 2)
const widest = (lines: string[]) => Math.max(0, ...lines.map(cellWidth))

export const canStack = (p: Participant) => !p.label.includes('\n') && p.label.trim().includes(' ')

function stackedLabel(label: string): string[] {
  const words = label.trim().split(/ +/)
  let best = [label]
  let bestWidth = Number.MAX_SAFE_INTEGER
  for (let k = 1; k < words.length; k++) {
    const lines = [words.slice(0, k).join(' '), words.slice(k).join(' ')]
    const w = widest(lines)
    if (w < bestWidth) {
      best = lines
      bestWidth = w
    }
  }
  return best
}

// A box shows at most four lines of name; past that the fitter widens the lane, and only a lane
// that can't widen loses the tail of its name to `…`.
const HEADER_MOST = 4

function fullHeader(p: Participant, cap: number, stacked = false, isBare = false): string[] {
  const lines = stacked && canStack(p) ? stackedLabel(p.label) : p.label.split('\n')
  const marker = isBare ? '' : markerOf(p)
  return lines.flatMap((line, i) => {
    const mark = i === 0 ? marker : ''
    return wrap(line.trim(), Math.max(1, cap), true).lines.map((text, k) => `${k === 0 ? mark : ''}${text}`)
  })
}

function headerLines(p: Participant, cap: number, stacked = false, isBare = false): string[] {
  const all = fullHeader(p, cap, stacked, isBare)
  if (all.length <= HEADER_MOST) return all
  return [...all.slice(0, HEADER_MOST - 1), cut(joinLines(all.slice(HEADER_MOST - 1)), Math.max(1, cap)).text]
}

const boxWidths = new WeakMap<Participant, Map<string, number>>()

function boxWidth(p: Participant, cap: number, isBare: boolean, stacked = false): number {
  const known = boxWidths.get(p) ?? new Map<string, number>()
  boxWidths.set(p, known)
  const key = `${cap}:${isBare}:${stacked}`
  const hit = known.get(key)
  if (hit !== undefined) return hit
  const width = widest(headerLines(p, cap, stacked, isBare)) + (isBare ? 2 : 4)
  known.set(key, width)
  return width
}
const boxHeight = (p: Participant, cap: number, stacked = false) => headerLines(p, cap, stacked).length + 2

const createsCache = new WeakMap<Step[], Map<Message, string>>()

function createsOf(steps: Step[]): Map<Message, string> {
  const hit = createsCache.get(steps)
  if (hit) return hit
  const creates = new Map<Message, string>()
  createsCache.set(steps, creates)
  steps.forEach((step, k) => {
    if (step.kind !== 'create') return
    const next = steps.slice(k + 1).find((s): s is Message => s.kind === 'message' && s.from !== s.to && (s.from === step.id || s.to === step.id))
    if (next && !creates.has(next)) creates.set(next, step.id)
  })
  return creates
}

const nestedCache = new WeakMap<Block[], Set<Step>>()

// Steps inside a frame. A self message outside every frame may run its label over the lanes to
// its right, since its rows belong to it alone; inside a frame the label stays within the frame.
function nestedOf(tree: Block[]): Set<Step> {
  const hit = nestedCache.get(tree)
  if (hit) return hit
  const nested = new Set<Step>()
  const collect = (block: Block) => {
    block.steps.forEach(step => nested.add(step))
    block.children.forEach(collect)
  }
  tree.forEach(collect)
  nestedCache.set(tree, nested)
  return nested
}

const isSpilling = (step: Step, nested: Set<Step>) => step.kind === 'message' && step.from === step.to && !nested.has(step)

// A call outside every frame owns its rows too, so a label that doesn't sit on its arrow may run
// right over idle lanes instead of wrapping inside the gap between its two lifelines.
const canSpill = (step: Step, nested: Set<Step>, creates: Map<Message, string>): step is Message =>
  step.kind === 'message' && step.from !== step.to && !nested.has(step) && !creates.has(step)

// A label sits on its arrow only while it fits on one line; a longer one spills over the rows
// above, where its last line may still land on the arrow.
function isSpill(step: Step, states: Map<Step, State>, items: Item[], nested: Set<Step>, creates: Map<Message, string>): boolean {
  if (!canSpill(step, nested, creates)) return false
  const state = states.get(step)
  if (!state?.inline) return true
  const item = itemIndex(items).get(step)
  return item !== undefined && labelOf(item, state).lines.length > 1
}

const indexes = new WeakMap<Item[], Map<Step, Item>>()

function itemIndex(items: Item[]): Map<Step, Item> {
  const hit = indexes.get(items)
  if (hit) return hit
  const index = new Map(items.map(item => [item.step, item]))
  indexes.set(items, index)
  return index
}

function blocksOf(steps: Step[]): { top: Step[]; blocks: Block[] } {
  const root: Block = { open: { kind: 'open', keyword: '', text: '' }, branches: [], steps: [], children: [] }
  const stack = [root]
  for (const step of steps) {
    const current = stack.at(-1)!
    if (step.kind === 'open') {
      const block: Block = { open: step, branches: [], steps: [], children: [] }
      current.children.push(block)
      stack.push(block)
    } else if (step.kind === 'close') {
      if (stack.length > 1) stack.pop()
    } else if (step.kind === 'branch' && stack.length > 1) current.branches.push(step)
    else current.steps.push(step)
  }
  return { top: root.steps, blocks: root.children }
}

const WORD_KEEP = 14
const wordKeep = (text: string) => Math.min(WORD_KEEP, widest(text.split(/[\s\n]+/)))
const NAME_WORD_KEEP = 12
const nameCut = (p: Participant, cap: number) => p.label.split('\n').some(line => wrap(line.trim(), cap, true).isCut) || fullHeader(p, cap).length > HEADER_MOST
const floors = new WeakMap<Participant, number>()
// The narrowest box a name fits in without cutting a word, counting the breaks wrap makes inside
// identifiers (`Tarif::Rating` folds after `::`), capped so one long word can't hold a lane wide.
function nameFloor(p: Participant): number {
  const hit = floors.get(p)
  if (hit !== undefined) return hit
  const most = Math.max(NAME_MIN, Math.min(NAME_WORD_KEEP, widest(p.label.split(/[\s\n]+/))))
  let floor = NAME_MIN
  while (floor < most && nameCut(p, floor)) floor++
  floors.set(p, floor)
  return floor
}

const NAME_LINES = HEADER_MOST

// The narrowest box a name fits in whole within four lines (or its explicit line count). Labels
// need width more than boxes do: a wrapped name costs header rows once, a wrapped label on every
// message, so boxes start here and only widen with width the labels leave.
const folds = new WeakMap<Participant, number>()

function nameFold(p: Participant): number {
  const hit = folds.get(p)
  if (hit !== undefined) return hit
  const full = widest(p.label.split('\n').map(line => line.trim()))
  const lines = Math.max(NAME_LINES, p.label.split('\n').length)
  let fold = full
  for (let cap = nameFloor(p); cap < full; cap++) {
    if (!nameCut(p, cap) && headerLines(p, cap).length <= lines) {
      fold = cap
      break
    }
  }
  folds.set(p, fold)
  return fold
}

// mermaid writes a frame's condition in brackets; a frame too narrow for them shows the bare condition instead.
const frameText = (step: Opening) => (step.kind === 'open' && step.keyword === 'rect' ? '' : step.text === '' ? step.keyword : `${step.keyword} [${step.text}]`)
const bareText = (step: Opening) => `${step.keyword} ${step.text}`.trim()

// The narrowest width a text wraps to without cutting a word, counting the breaks wrap makes
// inside identifiers, so `generate_quote_set_for_new_business` counts as its pieces, not 35 columns.
function uncut(text: string): number {
  let lo = 1
  let hi = Math.max(1, ...text.split(/[ \n\u00a0]+/).map(cellWidth))
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (wrap(text, mid).isCut) lo = mid + 1
    else hi = mid
  }
  return lo
}

function itemsOf(sequence: Sequence): { items: Item[]; numbers: Map<Message, string> } {
  const items: Item[] = []
  const numbers = new Map<Message, string>()
  for (const step of sequence.steps) {
    if (step.kind === 'message') {
      const number = step.number === undefined ? undefined : String(step.number)
      if (number) numbers.set(step, number)
      const text = number ? (step.text === '' ? number : `${number}${GLUE}${step.text}`) : step.text
      const fullWidth = widest(wrap(text, Number.MAX_SAFE_INTEGER).lines)
      const isSelf = step.from === step.to
      items.push({ step, text, number, fullWidth, maxCap: fullWidth, minCap: HARD_CAP, wordCap: wordKeep(text), pieceCap: 0, canInline: !isSelf && !labelsAbove, isFrame: false })
    } else if (step.kind === 'note') {
      const fullWidth = widest(wrap(step.text, Number.MAX_SAFE_INTEGER).lines)
      items.push({ step, text: step.text, fullWidth, maxCap: fullWidth, minCap: HARD_CAP, wordCap: wordKeep(step.text), pieceCap: 0, canInline: false, isFrame: false })
    } else if (step.kind === 'open' || step.kind === 'branch') {
      const text = frameText(step)
      if (text === '') continue
      const floor = Math.min(cellWidth(text), Math.max(cellWidth(step.keyword), FRAME_CAP))
      items.push({ step, text, fullWidth: cellWidth(text), maxCap: cellWidth(text), minCap: floor, wordCap: 0, pieceCap: 0, canInline: false, isFrame: true })
    }
  }
  for (const item of items) {
    item.wordCap = Math.max(0, ...item.text.split(/[ \n\u00a0]+/).map(cellWidth))
    item.pieceCap = uncut(item.text)
  }
  return { items, numbers }
}

function labelOf(item: Item, state: State): Wrapped {
  const wrapped = wrap(item.text, state.cap)
  if (!item.isFrame || wrapped.lines.length <= 2) return wrapped
  return { lines: [wrapped.lines[0]!, cut(wrapped.lines.slice(1).join(' '), state.cap).text], isCut: true }
}

function solve(n: number, spans: Span[], left: number, right: number, base?: number[]): { centre: number[]; width: number; gaps: number[] } {
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => base?.[i] ?? 0)
  for (const { a, b, need } of [...spans].sort((x, y) => x.b - x.a - (y.b - y.a))) {
    const k = b - a
    if (k <= 0) continue
    const have = gaps.slice(a, b).reduce((s, g) => s + g, 0)
    const deficit = need - have
    if (deficit <= 0) continue
    for (let i = 0; i < k; i++) gaps[a + i]! += Math.floor(deficit / k) + (i < deficit % k ? 1 : 0)
  }
  const centre = [left]
  for (const g of gaps) centre.push(centre.at(-1)! + g)
  return { centre, width: centre.at(-1)! + right + 1, gaps }
}

function measure(sequence: Sequence, lanes: Participant[], items: Item[], states: Map<Step, State>, names: number[], stacked: boolean[], tree: Block[], isBare: boolean, base?: number[], limit?: number): Plan {
  const n = lanes.length
  const last = n - 1
  const lane = new Map(lanes.map((p, i) => [p.id, i]))
  const spans: Span[] = []
  const edges: { side: 'left' | 'right'; value: number; owners: Owner[] }[] = []
  let left = 0
  let right = 0
  let owners: Owner[] = []
  const gap = (a: number, b: number, need: number) => spans.push({ a, b, need, owners })
  const edge = (side: 'left' | 'right', value: number) => {
    edges.push({ side, value, owners })
    if (side === 'left') left = Math.max(left, value)
    else right = Math.max(right, value)
  }
  const widths = lanes.map((p, i) => boxWidth(p, names[i]!, isBare, stacked[i]))
  const creates = createsOf(sequence.steps)
  widths.forEach((w, i) => {
    owners = i === last ? [`lane:${i}`] : [`lane:${i}`, `lane:${i + 1}`]
    if (i === 0) edge('left', leftOf(w))
    if (i === last) edge('right', rightOf(w))
    else gap(i, i + 1, rightOf(w) + leftOf(widths[i + 1]!) + 2)
  })
  owners = []
  sequence.boxes.forEach((group, k) => {
    const members = lanes.flatMap((p, i) => (p.box === k ? [i] : []))
    if (members.length === 0 || group.label === '') return
    const a = members[0]!
    const b = members.at(-1)!
    const extra = cellWidth(group.label) + 6 - (leftOf(widths[a]!) + rightOf(widths[b]!) + 1)
    if (a < b) gap(a, b, extra)
    else if (extra > 0 && a === last) edge('right', rightOf(widths[a]!) + extra)
    else if (extra > 0) gap(a, a + 1, rightOf(widths[a]!) + extra + leftOf(widths[a + 1]!) + 2)
  })
  const byStep = new Map(items.map(item => [item.step, item]))
  const itemOf = (step: Step) => byStep.get(step)!
  const labelWidth = new Map<Step, number>()
  for (const item of items) labelWidth.set(item.step, widest(labelOf(item, states.get(item.step)!).lines))
  const isShown = (step: Step) => !states.get(step)?.isHidden
  // a boxed note's border takes a column each side, so the layout reserves them too
  const noteBox = (step: Note) => noteWidth(step, labelWidth.get(step) ?? 0) + (boxed ? 2 : 0)
  const isHidden = (step: Message) => !lane.has(step.from) || !lane.has(step.to)
  const nested = nestedOf(tree)
  const spills = (step: Step) => limit !== undefined && isSpill(step, states, items, nested, creates)

  const depth = lanes.map(() => 0)
  const stops = new Map<Step, number>()
  sequence.steps.forEach((step, k) => {
    owners = [step]
    if (step.kind === 'activate') {
      const i = lane.get(step.id)
      if (i !== undefined) depth[i] = Math.max(0, depth[i]! + (step.isOn ? 1 : -1))
      return
    }
    if (step.kind === 'message') {
      if (isHidden(step)) {
        edge('right', HIDDEN_ROOM)
        return
      }
      const from = lane.get(step.from)!
      const to = lane.get(step.to)!
      const w = labelWidth.get(step) ?? 0
      const n = step.arrow === 'both' ? 1 : 0
      if (from === to) {
        const next = sequence.steps[k + 1]
        const lit = next?.kind === 'activate' && next.isOn && next.id === step.to ? 1 : 0
        const bar = depth[from]! + lit >= 2 ? 1 : 0
        if (from === last) edge('right', w + 4 + bar)
        else if (!isSpilling(step, nested)) gap(from, from + 1, w + 5 + bar)
        else if (limit !== undefined) gap(from, from + 1, 6 + bar)
        else {
          gap(from, from + 1, 6 + bar)
          gap(from, last, w + 5 + bar - rightOf(widths[last]!))
        }
        return
      }
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      const born = creates.get(step)
      if (born !== undefined) owners = [step, `lane:${lane.get(born)}`]
      const boxSide = born === undefined ? 0 : lane.get(born) === hi ? leftOf(widths[hi]!) : lane.get(born) === lo ? rightOf(widths[lo]!) : 0
      const state = states.get(step)
      if (spills(step)) {
        const busy = depth.findIndex((d, i) => i > lo && d > 0)
        if (busy >= 0) stops.set(step, busy)
        gap(lo, hi, 7 + n + (step.isDashed ? DASHES : 0))
        return
      }
      if (state?.inline) {
        const lines = labelOf(itemOf(step), state).lines
        const tail = cellWidth(lines.at(-1) ?? '') + (state.tight ? 5 : LEADER + 5) + n + (step.isDashed ? DASHES : 0) + 1
        gap(lo, hi, tail + boxSide)
        if (lines.length > 1) gap(lo, hi, widest(lines.slice(0, -1)) + (to > from ? LEADER + 3 : 5) + boxSide)
      } else gap(lo, hi, w + (to > from ? LEADER + 3 : 5) + boxSide)
      return
    }
    if (step.kind === 'note' && !isShown(step) && step.side === 'left' && step.over.some(id => lane.get(id) === 0)) {
      edge('left', LEFT_MARK_ROOM)
      return
    }
    if (step.kind !== 'note' || !isShown(step)) return
    const over = step.over.flatMap(id => lane.get(id) ?? []).sort((a, b) => a - b)
    if (over.length === 0) return
    const bw = noteBox(step)
    const a = over[0]!
    const b = over.at(-1)!
    const side = step.side
    if (side === 'left') {
      if (a === 0) edge('left', bw + 1)
      else gap(a - 1, a, bw + 3)
    } else if (side === 'right') {
      if (b === last) edge('right', bw + 2)
      else gap(b, b + 1, bw + 4)
    } else if (a === b) {
      if (a === 0) edge('left', half(bw))
      else gap(a - 1, a, half(bw) + 2)
      if (a === last) edge('right', half(bw))
      else gap(a, a + 1, half(bw) + 2)
    } else {
      // like mermaid, a note keeps each of its source lines whole when the terminal has room: its
      // widest line is a floor on the span while it takes no more than a third of the width
      const natural = widest(step.text.split('\n')) + 2
      if (limit === undefined) gap(a, b, (labelWidth.get(step) ?? 0) - 1)
      // the note may spread to the lifelines either side of its span, so its floor is shared
      // across those gaps rather than forcing one gap wide
      // placeNote leaves two cells inside each neighbouring lifeline, so the floor matches that room
      else if (natural <= Math.floor(limit / 3)) gap(a > 0 ? a - 1 : a, b < last ? b + 1 : b, natural - 1 + (a > 0 ? 3 : 0) + (b < last ? 3 : 0))
      if (a === 0) edge('left', 1)
      if (b === last) edge('right', 1)
    }
  })
  owners = []

  const pads = new Map<Block, { lo: number; hi: number; left: number; right: number }>()
  const touched = (step: Step): number[] => {
    if (step.kind === 'message') {
      const ends = [lane.get(step.from), lane.get(step.to)]
      return ends.some(e => e === undefined) ? [...ends.flatMap(e => (e === undefined ? [] : [e])), last] : (ends as number[])
    }
    if (step.kind === 'note') return step.over.flatMap(id => lane.get(id) ?? [])
    if (step.kind === 'create' || step.kind === 'destroy' || step.kind === 'activate') return lane.has(step.id) ? [lane.get(step.id)!] : []
    return []
  }
  const ownersOf = (block: Block): Owner[] => [block.open, ...block.branches, ...block.steps, ...block.children.flatMap(ownersOf), ...block.steps.flatMap(touched).map(i => `lane:${i}`)]
  const pad = (block: Block): { lo: number; hi: number; left: number; right: number } => {
    const children = block.children.map(pad)
    owners = ownersOf(block)
    const all = [...block.steps.flatMap(touched), ...children.flatMap(c => [c.lo, c.hi])]
    const lo = all.length > 0 ? Math.min(...all) : 0
    const hi = all.length > 0 ? Math.max(...all) : last
    let l = 2
    let r = 2
    const labelNeed = Math.max(0, ...[block.open, ...block.branches].map(opening => {
      const w = labelWidth.get(opening) ?? 0
      return w > 0 ? w + FRAME_ROOM : 0
    }))
    for (const step of block.steps) {
      if (step.kind === 'note' && isShown(step)) {
        const over = step.over.flatMap(id => lane.get(id) ?? [])
        const bw = noteBox(step)
        const side = step.side
        if (over.length === 0) continue
        if (side === 'left' && Math.min(...over) === lo) l = Math.max(l, bw + 3)
        if (side === 'right' && Math.max(...over) === hi) r = Math.max(r, bw + 4)
        if (side === 'over' && Math.min(...over) === Math.max(...over)) {
          if (over[0] === lo) l = Math.max(l, half(bw) + 2)
          if (over[0] === hi) r = Math.max(r, half(bw) + 2)
        }
        if (side === 'over' && Math.min(...over) !== Math.max(...over)) {
          if (Math.min(...over) === lo) l = Math.max(l, 3)
          if (Math.max(...over) === hi) r = Math.max(r, 3)
        }
      }
      if (step.kind === 'message' && step.from === step.to && lane.get(step.from) === hi) r = Math.max(r, (labelWidth.get(step) ?? 0) + 5)
      if (step.kind === 'message' && isHidden(step)) r = Math.max(r, HIDDEN_ROOM)
      if (step.kind === 'create' && lane.has(step.id)) {
        const i = lane.get(step.id)!
        if (i === lo) l = Math.max(l, leftOf(widths[i]!) + 2)
        if (i === hi) r = Math.max(r, rightOf(widths[i]!) + 2)
      }
    }
    for (const child of children) {
      if (child.lo === lo) l = Math.max(l, child.left + NEST_GAP)
      if (child.hi === hi) r = Math.max(r, child.right + NEST_GAP)
    }
    if (lo === hi) r = Math.max(r, labelNeed - 1)
    else if (labelNeed > 0) gap(lo, lo + 1, labelNeed - 1)
    const result = { lo, hi, left: l, right: r }
    pads.set(block, result)
    if (lo > 0) gap(lo - 1, lo, l + 2)
    else edge('left', l)
    if (hi < last) gap(hi, hi + 1, r + 2)
    else edge('right', r)
    return result
  }
  tree.forEach(pad)

  const { centre, width, gaps } = solve(n, spans, left, right, base)
  const tight = new Set<Owner>()
  for (const span of spans) {
    if (span.b <= span.a || span.need <= 0) continue
    let have = 0
    for (let i = span.a; i < span.b; i++) have += gaps[i]!
    if (have <= span.need) span.owners.forEach(o => tight.add(o))
  }
  for (const { side, value, owners: o } of edges) if (value >= (side === 'left' ? left : right)) o.forEach(x => tight.add(x))
  let rows = Math.max(0, ...lanes.map((p, i) => boxHeight(p, names[i]!, stacked[i])))
  for (const item of items) {
    const state = states.get(item.step)!
    const lines = state.isHidden ? 1 : labelOf(item, state).lines.length
    const step = item.step
    if (step.kind !== 'message' || state.isHidden) {
      rows += Math.max(1, lines)
      continue
    }
    if (isHidden(step)) {
      rows += lines + 1
      continue
    }
    const from = lane.get(step.from)!
    const to = lane.get(step.to)!
    if (from === to) {
      const spills = limit !== undefined && from !== last && isSpilling(step, nested)
      rows += Math.max(2, spills ? wrap(item.text, Math.max(1, limit - centre[from]! - 6)).lines.length : lines)
      continue
    }
    if ((state.inline && !spills(step)) || creates.has(step)) {
      rows += state.inline ? lines : lines + 1
      continue
    }
    const isRight = to > from
    const both = step.arrow === 'both' ? 1 : 0
    const start = centre[Math.min(from, to)]! + 1
    const end = centre[Math.max(from, to)]! - 1
    const reach = isRight ? end - 2 : end - both
    const tail = isRight ? start + both + 1 : start + 3
    const fits = (line: string) => line !== '' && tail + cellWidth(line) + (step.isDashed ? DASHES : 0) <= reach
    const spill = spills(step)
    const busy = stops.get(step)
    const stop = busy === undefined ? limit ?? 0 : centre[busy]! - 1
    const label = spill ? wrap(item.text, Math.max(1, stop - (start + (isRight ? 1 : 3)) - 1)) : labelOf(item, state)
    const shown = balanced(label, item.text, reach - tail - (step.isDashed ? DASHES : 0))
    rows += fits(shown.lines.at(-1) ?? '') ? shown.lines.length : shown.lines.length + 1
  }
  return { lanes, lane, centre, width, states, names: [...names], stacked: [...stacked], isBare, pads, creates, tight, rows, nested }
}

type Move = { apply: () => void; undo: () => void; size: number; owner?: Owner }

type Phase = 'soft' | 'wrap' | 'stack' | 'names' | 'pieces' | 'hard' | 'bare' | 'notes' | 'crush'

const LADDERS: Phase[][] = [
  ['soft', 'wrap', 'stack', 'bare', 'names', 'pieces', 'notes', 'hard', 'crush'],
  ['soft', 'wrap', 'stack', 'bare', 'notes', 'names', 'pieces', 'hard', 'crush'],
]

const rowsOf = (item: Item, state: State) => {
  if (state.isHidden) return 1
  if (item.step.kind === 'message' && state.inline) return labelOf(item, state).lines.length - 1
  return Math.max(1, labelOf(item, state).lines.length)
}

function fit(sequence: Sequence, lanes: Participant[], items: Item[], tree: Block[], width: number, ladder: Phase[]): Plan {
  const isSelf = (item: Item) => item.step.kind === 'message' && item.step.from === item.step.to
  const nested = nestedOf(tree)
  const startCap = (item: Item) => (isSelf(item) && !isSpilling(item.step, nested) ? Math.min(item.maxCap, Math.max(SELF_CAP, item.wordCap)) : item.maxCap)
  const states = new Map<Step, State>(items.map(item => [item.step, { inline: item.canInline, cap: startCap(item) }]))
  const fullNames = lanes.map(p => widest(p.label.split('\n').map(line => line.trim())))
  const names = lanes.map(nameFold)
  const stacked = lanes.map(() => false)
  let isBare = false
  work = 0
  const run = () => {
    work += items.length + lanes.length
    return measure(sequence, lanes, items, states, names, stacked, tree, isBare, undefined, width)
  }
  const isSpent = () => work > WORK_BUDGET
  const shown = (item: Item) => widest(labelOf(item, states.get(item.step)!).lines)

  let overshoot = 1
  const tighten = (phase: Phase): Move[] => {
    if (phase === 'bare') return isBare ? [] : [{ apply: () => (isBare = true), undo: () => (isBare = false), size: 0 }]
    if (phase === 'stack') {
      return lanes.flatMap<Move>((p, i) => (stacked[i] || !canStack(p) ? [] : [{ apply: () => (stacked[i] = true), undo: () => (stacked[i] = false), size: fullNames[i]!, owner: `lane:${i}` }]))
    }
    if (phase === 'notes') {
      return items.flatMap<Move>(item => {
        const state = states.get(item.step)!
        if (item.step.kind !== 'note' || state.isHidden) return []
        return [{ apply: () => (state.isHidden = true), undo: () => (state.isHidden = false), size: item.fullWidth, owner: item.step }]
      })
    }
    const nameMoves = (isHard: boolean) =>
      names.flatMap((cap, i) => {
        const now = Math.min(cap, fullNames[i]!)
        const floor = isHard ? NAME_MIN : nameFloor(lanes[i]!)
        if (fullNames[i]! <= NAME_KEEP || now <= floor) return []
        return [{ apply: () => (names[i] = Math.max(floor, now - overshoot)), undo: () => (names[i] = cap), size: now, owner: `lane:${i}` }]
      })
    if (phase === 'names') return nameMoves(false)
    if (phase === 'crush') return nameMoves(true)
    const floor = phase === 'soft' ? SOFT_CAP : phase === 'wrap' ? 1 : HARD_CAP
    return [...items.flatMap<Move>(item => {
      const state = states.get(item.step)!
      if (state.isHidden) return []
      if (state.inline && !state.tight) return [{ apply: () => (state.tight = true), undo: () => (state.tight = false), size: item.fullWidth + 3, owner: item.step }]
      if (state.inline) return [{ apply: () => (state.inline = false), undo: () => (state.inline = true), size: item.fullWidth + 2, owner: item.step }]
      const now = shown(item)
      const keep = phase === 'hard' ? 0 : phase === 'pieces' ? item.pieceCap : item.wordCap
      const target = Math.max(floor, item.minCap, keep)
      if (now <= target) return []
      const cap = state.cap
      const next = Math.min(cap, Math.max(target, now - overshoot))
      return [{ apply: () => (state.cap = next), undo: () => (state.cap = cap), size: now, owner: item.step }]
    })]
  }

  let plan = run()
  for (const phase of ladder) {
    while (plan.width > width) {
      overshoot = plan.width - width
      const moves = tighten(phase)
      if (moves.length === 0) break
      const binding = moves.filter(move => move.owner === undefined || plan.tight.has(move.owner)).sort((x, y) => y.size - x.size)
      if (binding.length === 0) break
      const first = binding[0]!
      first.apply()
      const alone = run()
      if (alone.width < plan.width || binding.length === 1) {
        plan = alone
        continue
      }
      binding.slice(1).forEach(move => move.apply())
      plan = run()
    }
  }

  // Spend the slack where it saves the most rows: restore lost information first, then
  // the move with the largest row saving per column it costs.
  type Loosen = { apply: () => void; undo: () => void; tier: number; saves: number }
  const candidates = (): Loosen[] => {
    const all: Loosen[] = []
    for (const item of items) {
      const state = states.get(item.step)!
      if (state.isHidden) {
        all.push({ apply: () => (state.isHidden = false), undo: () => (state.isHidden = true), tier: 0, saves: 0 })
        continue
      }
      const before = rowsOf(item, state)
      const { isCut } = labelOf(item, state)
      if (item.canInline && !state.inline) {
        const cap = state.cap
        all.push({
          apply: () => {
            state.inline = true
            state.tight = true
            state.cap = item.maxCap
          },
          undo: () => {
            state.inline = false
            state.tight = false
            state.cap = cap
          },
          tier: isCut ? 0 : 2,
          saves: before,
        })
      }
      if (state.cap < item.maxCap) {
        const cap = state.cap
        let target = item.maxCap
        for (let c = cap + 1; c <= item.maxCap; c++) {
          const tried = wrap(item.text, c)
          if (tried.lines.length < labelOf(item, state).lines.length || tried.isCut !== isCut) {
            target = c
            break
          }
        }
        const after = rowsOf(item, { ...state, cap: target })
        all.push({ apply: () => (state.cap = target), undo: () => (state.cap = cap), tier: isCut ? 0 : 2, saves: before - after })
      }
    }
    for (const item of items) {
      const state = states.get(item.step)!
      if (state.inline && state.tight) all.push({ apply: () => (state.tight = false), undo: () => (state.tight = true), tier: 3, saves: 0 })
    }
    const heights = lanes.map((p, i) => boxHeight(p, names[i]!, stacked[i]))
    const tallest = Math.max(0, ...heights)
    // One tall box is never the only tall one for long: widening names together is what shortens the header.
    const widened = lanes.map((p, i) => Math.max(names[i]!, nameFold(p)))
    const folded = Math.max(0, ...lanes.map((p, i) => boxHeight(p, widened[i]!, stacked[i])))
    if (folded < tallest) {
      const before = [...names]
      all.push({ apply: () => names.splice(0, names.length, ...widened), undo: () => names.splice(0, names.length, ...before), tier: 2, saves: tallest - folded })
    }
    names.forEach((cap, i) => {
      if (cap >= fullNames[i]!) return
      if (nameCut(lanes[i]!, cap)) {
        all.push({ apply: () => (names[i] = cap + 1), undo: () => (names[i] = cap), tier: 1, saves: 0 })
        return
      }
      let target = cap + 1
      while (target < fullNames[i]! && boxHeight(lanes[i]!, target, stacked[i]) >= heights[i]!) target++
      const others = Math.max(0, ...heights.filter((_, k) => k !== i))
      const saves = tallest - Math.max(others, boxHeight(lanes[i]!, target, stacked[i]))
      all.push({ apply: () => (names[i] = target), undo: () => (names[i] = cap), tier: saves > 0 ? 2 : 3, saves })
    })
    stacked.forEach((isStacked, i) => {
      if (isStacked) all.push({ apply: () => (stacked[i] = false), undo: () => (stacked[i] = true), tier: 2, saves: 1 })
    })
    if (isBare) all.push({ apply: () => (isBare = false), undo: () => (isBare = true), tier: 3, saves: 0 })
    return all
  }
  // Restoring lost text one column or one note at a time costs a layout pass per step, so
  // first try every move of the leading tier together, and widen cut names by bisection.
  const widenNames = (): boolean => {
    let isWidened = false
    names.forEach((cap, i) => {
      let lo = cap
      let hi = fullNames[i]!
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        names[i] = mid
        const tried = run()
        if (tried.width <= width) {
          lo = mid
          plan = tried
        } else hi = mid - 1
      }
      names[i] = lo
      isWidened ||= lo > cap
    })
    return isWidened
  }
  const together = (moves: Loosen[]): boolean => {
    if (moves.length < 2) return false
    moves.forEach(move => move.apply())
    const tried = run()
    if (tried.width <= width) {
      plan = tried
      return true
    }
    moves.forEach(move => move.undo())
    return false
  }
  const loosen = () => {
    while (!isSpent()) {
      let best: { move: Loosen; plan: Plan; score: number } | undefined
      const hope = (move: Loosen) => move.tier * 1000 - move.saves * 100
      const ranked = candidates().filter(move => !(move.tier === 2 && move.saves <= 0)).sort((x, y) => hope(x) - hope(y))
      const lead = ranked[0]?.tier
      if (lead === 0 && together(ranked.filter(move => move.tier === 0))) continue
      if (lead === 1 && widenNames()) continue
      let tries = 0
      for (const move of ranked) {
        if (tries >= LOOSEN_TRIES || (best && (hope(move) >= best.score || best.move.tier < 2))) break
        tries++
        move.apply()
        const tried = run()
        move.undo()
        if (tried.width > width) continue
        const cost = Math.max(0, tried.width - plan.width)
        if (move.tier === 2 && cost > COLS_PER_ROW * move.saves) continue
        const score = move.tier * 1000 - (move.saves * 100) / (1 + cost)
        if (!best || score < best.score) best = { move, plan: tried, score }
      }
      if (!best) break
      if (best.move.tier === 1 && widenNames()) continue
      best.move.apply()
      plan = best.plan
    }
  }
  loosen()

  const snapshot = () => {
    const saved = { states: new Map([...states].map(([step, one]) => [step, { ...one }])), names: [...names], stacked: [...stacked], isBare, plan }
    return () => {
      for (const [step, one] of saved.states) Object.assign(states.get(step)!, { tight: undefined, isHidden: undefined }, one)
      names.splice(0, names.length, ...saved.names)
      stacked.splice(0, stacked.length, ...saved.stacked)
      isBare = saved.isBare
      plan = saved.plan
    }
  }

  // A side note's margin is slack too: narrowing it is worth it when the width it frees
  // lets other labels save more rows than the note costs.
  const narrowMargins = () => {
    for (const item of items) {
      if (isSpent()) return
      if (item.step.kind !== 'note' || item.step.side === 'over') continue
      const state = states.get(item.step)!
      const floor = Math.max(item.wordCap, item.minCap)
      if (state.isHidden || state.cap <= floor) continue
      const before = plan.rows
      const restore = snapshot()
      state.cap = floor
      plan = run()
      loosen()
      if (plan.width <= width && plan.rows < before) continue
      restore()
    }
  }
  narrowMargins()

  // Tightening from the full layout can strand width in the wrong gaps. Build the layout a
  // second way, from every label at its narrowest, spending columns where they save the most
  // rows, and keep whichever needs fewer rows.
  const cost = () => {
    const lost = names.filter((cap, i) => nameCut(lanes[i]!, cap)).length + items.filter(item => states.get(item.step)!.isHidden || labelOf(item, states.get(item.step)!).isCut).length
    return lost * 1000 + plan.rows
  }
  if (isSpent()) return best(settle())
  const fromTopCost = cost()
  const fromTop = snapshot()
  const narrowest = () => {
    for (const item of items) {
      const state = states.get(item.step)!
      if (state.isHidden) continue
      state.inline = false
      state.tight = false
      state.cap = Math.min(state.cap, Math.max(item.pieceCap, item.minCap))
    }
    plan = run()
  }
  names.splice(0, names.length, ...lanes.map(nameFold))
  narrowest()
  if (plan.width > width) {
    fromTop()
    narrowest()
  }
  if (plan.width <= width) {
    loosen()
    narrowMargins()
  }
  if (plan.width > width || cost() >= fromTopCost) fromTop()
  return best(settle())

  function best(found: Plan): Plan {
    const folded = lanes.map((p, i) => Math.max(found.names[i]!, nameFold(p)))
    const variants = [found.names, folded].filter((one, k, all) => all.findIndex(other => other.join() === one.join()) === k)
    const allocated = variants
      .map(one => allocate(sequence, lanes, items, tree, width, { ...found, names: one }))
      .reduce<Plan | undefined>((most, plan) => (plan && (!most || costOf(items, plan) < costOf(items, most)) ? plan : most), undefined)
    const chosen = allocated && costOf(items, allocated) < costOf(items, found) ? allocated : found
    return evenHeader(chosen)
  }

  // Boxes of one height read as a row; a single wide box beside tall ones wastes both width and
  // rows. Fold every name to the same number of lines and keep the height that costs fewest rows.
  function evenHeader(found: Plan): Plan {
    let kept = found
    for (let height = 1; height <= HEADER_MOST; height++) {
      const folded = lanes.map((p, i) => {
        for (let cap = nameFloor(p); cap < fullNames[i]!; cap++) if (!nameCut(p, cap) && fullHeader(p, cap).length <= height) return cap
        return fullNames[i]!
      })
      const tried = measure(sequence, lanes, items, found.states, folded, found.stacked, tree, found.isBare, undefined, width)
      if (tried.width <= width && costOf(items, tried) < costOf(items, kept)) kept = tried
    }
    return kept
  }

  // Whatever width is left after the search goes back to cut names, then to labels wrapped
  // narrower than their room, largest first. Each step is a bisection over one cap, so it
  // stays cheap even after the work budget is spent.
  function settle(): Plan {
    let runs = 0
    const widen = (get: () => number, set: (cap: number) => void, most: number, isWorse: (tried: Plan) => boolean) => {
      let lo = get()
      let hi = most
      while (lo < hi && runs < SETTLE_RUNS) {
        runs++
        const mid = Math.ceil((lo + hi) / 2)
        set(mid)
        const tried = measure(sequence, lanes, items, states, names, stacked, tree, isBare, undefined, width)
        if (tried.width <= width && !isWorse(tried)) {
          lo = mid
          plan = tried
        } else hi = mid - 1
      }
      set(lo)
    }
    names.forEach((_, i) => {
      if (nameCut(lanes[i]!, names[i]!)) widen(() => names[i]!, cap => (names[i] = cap), fullNames[i]!, tried => tried.rows > plan.rows)
    })
    // spare width also goes to a box whose name folds inside an identifier (`offerset_` /
    // `generation`), as long as no row is spent on it
    names.forEach((_, i) => {
      if (breaksInside(lanes[i]!, names[i]!)) widen(() => names[i]!, cap => (names[i] = cap), fullNames[i]!, tried => tried.rows > plan.rows)
    })
    const narrow = items
      .filter(item => !states.get(item.step)!.isHidden && !states.get(item.step)!.inline && states.get(item.step)!.cap < item.maxCap)
      .sort((x, y) => rowsOf(y, states.get(y.step)!) - rowsOf(x, states.get(x.step)!))
    for (const item of narrow) {
      const state = states.get(item.step)!
      widen(() => state.cap, cap => (state.cap = cap), Math.max(state.cap, startCap(item)), tried => tried.rows > plan.rows)
    }
    return measure(sequence, lanes, items, states, names, stacked, tree, isBare, undefined, width)
  }
}

const costOf = (items: Item[], plan: Plan) =>
  (plan.lanes.filter((p, i) => nameCut(p, plan.names[i]!)).length +
    items.filter(item => {
      const state = plan.states.get(item.step)
      return state !== undefined && (state.isHidden || labelOf(item, state).isCut)
    }).length) *
    1000 +
  plan.rows

// A claim's room grows with the gaps lo..hi-1; a self label spilling right instead loses room to every
// gap left of its lane (`against`), since it can only run to the right edge.
type Claim = { item: Item; lo: number; hi: number; against?: number; memo: Map<number, number> }

// Width goes where it saves the most rows. Every label starts at the narrowest width it wraps to
// whole; then columns go one batch at a time to whichever gap buys the most rows per column, and
// a few columns at a time move between gaps while that saves rows. A label's room is the sum of
// the gaps its arrow spans, so a long arrow is paid for by every gap it crosses.
function allocate(sequence: Sequence, lanes: Participant[], items: Item[], tree: Block[], width: number, from: Plan): Plan | undefined {
  const n = lanes.length
  if (n < 2) return undefined
  const { lane, names, stacked, isBare, nested } = from
  const creates = createsOf(sequence.steps)
  const states = new Map([...from.states].map(([step, state]) => [step, { ...state }]))
  const isFree = (item: Item): boolean => {
    const step = item.step
    if (states.get(step)?.isHidden) return false
    if (step.kind === 'message') return lane.has(step.from) && lane.has(step.to) && !creates.has(step)
    return step.kind === 'note' && step.side === 'over' && new Set(step.over.filter(id => lane.has(id))).size > 1
  }
  const free = items.filter(isFree)
  if (free.length === 0) return undefined
  for (const item of free) Object.assign(states.get(item.step)!, { inline: false, tight: false, cap: Math.max(item.pieceCap, item.minCap, 1) })
  const floor = measure(sequence, lanes, items, states, names, stacked, tree, isBare, undefined, width)
  if (floor.width > width) return undefined
  const gaps = floor.centre.slice(1).map((c, i) => c - floor.centre[i]!)
  const lastWidth = boxWidth(lanes[n - 1]!, names[n - 1]!, isBare, stacked[n - 1])
  const right = floor.width - 1 - floor.centre[n - 1]!
  const budget = width - floor.width
  const attempt = (spend: number): Plan => {
  const resources = [...gaps, right]
  let slack = spend
  const most = width + 8

  // rows a label needs given `room` columns between its ends (or to the right edge), and how the
  // room maps back to the label's cap
  const capOf = (item: Item, room: number): number => {
    const step = item.step
    if (step.kind === 'note') return room + 1
    if (step.kind !== 'message') return room
    const a = lane.get(step.from)!
    const b = lane.get(step.to)!
    if (a === b) return a === n - 1 ? room - 4 : isSpilling(step, nested) ? room : room - 5
    return room - (b > a ? 3 : 5)
  }
  // A label that spills wraps against the right edge, whatever its gap; its gap only decides
  // whether the last line can sit on the arrow.
  const spillRoom = (item: Item): number | undefined => {
    const step = item.step
    if (!canSpill(step, nested, creates)) return undefined
    const lo = Math.min(lane.get(step.from)!, lane.get(step.to)!)
    return Math.max(1, width - floor.centre[lo]! - (lane.get(step.to)! > lane.get(step.from)! ? 2 : 4) - 2)
  }
  const spilled = (item: Item, room: number): number => {
    const step = item.step as Message
    const wrapped = wrap(item.text, spillRoom(item)!)
    if (wrapped.isCut) return 1e6
    const extra = (step.arrow === 'both' ? 1 : 0) + (step.isDashed ? DASHES : 0) + 5
    const shown = balanced(wrapped, item.text, room - extra)
    const last = shown.lines.at(-1) ?? ''
    return last !== '' && cellWidth(last) + extra <= room ? shown.lines.length : shown.lines.length + 1
  }
  const rowsAt = (item: Item, room: number): number => {
    const step = item.step
    if (spillRoom(item) !== undefined) return spilled(item, room)
    const cap = capOf(item, room)
    if (cap < Math.max(item.pieceCap, 1)) return 1e6
    const wrapped = wrap(item.text, cap)
    if (wrapped.isCut) return 1e6
    if (step.kind !== 'message') return Math.max(1, wrapped.lines.length)
    if (step.from === step.to) return Math.max(2, wrapped.lines.length)
    const extra = (step.arrow === 'both' ? 1 : 0) + (step.isDashed ? DASHES : 0) + 5
    const fits = (line: string) => line !== '' && cellWidth(line) + extra <= room
    const shown = balanced(wrapped, item.text, room - extra)
    return fits(shown.lines.at(-1) ?? '') ? shown.lines.length : shown.lines.length + 1
  }
  const roomOf = (lo: number, hi: number) => {
    let room = 0
    for (let i = lo; i < hi; i++) room += resources[i]!
    return room
  }
  const left = floor.centre[0]!
  const claims: Claim[] = free.map(item => {
    const step = item.step
    let lo = 0
    let hi = 0
    let against: number | undefined
    if (step.kind === 'message') {
      const a = lane.get(step.from)!
      const b = lane.get(step.to)!
      if (a === b && a === n - 1) [lo, hi] = [n - 1, n]
      else if (a === b && isSpilling(step, nested)) against = a
      else if (a === b) [lo, hi] = [a, a + 1]
      else [lo, hi] = [Math.min(a, b), Math.max(a, b)]
    } else if (step.kind === 'note') {
      const over = step.over.flatMap(id => lane.get(id) ?? []).sort((x, y) => x - y)
      ;[lo, hi] = [over[0]!, over.at(-1)!]
    }
    return { item, lo, hi, against, memo: new Map() }
  })
  const sign = (claim: Claim, r: number) => (claim.against !== undefined ? (r < claim.against ? -1 : 0) : claim.lo <= r && r < claim.hi ? 1 : 0)
  const rowsFor = (claim: Claim, room: number) => {
    const hit = claim.memo.get(room)
    if (hit !== undefined) return hit
    const rows = rowsAt(claim.item, Math.min(room, most))
    claim.memo.set(room, rows)
    return rows
  }
  const current = claims.map(claim => (claim.against !== undefined ? width - left - roomOf(0, claim.against) - 6 : roomOf(claim.lo, claim.hi)))
  const touching = resources.map((_, r) => claims.flatMap((claim, k) => (sign(claim, r) !== 0 ? [k] : [])))
  while (slack > 0) {
    let pick: { r: number; k: number; score: number } | undefined
    for (let r = 0; r < resources.length; r++) {
      const touched = touching[r]!
      if (!touched.some(k => sign(claims[k]!, r) > 0)) continue
      const now = touched.reduce((sum, k) => sum + rowsFor(claims[k]!, current[k]!), 0)
      for (let k = 1; k <= Math.min(slack, STEP_MOST); k++) {
        const then = touched.reduce((sum, c) => sum + rowsFor(claims[c]!, current[c]! + sign(claims[c]!, r) * k), 0)
        const saved = now - then
        if (saved <= 0) continue
        const score = saved / k
        if (!pick || score > pick.score) pick = { r, k, score }
      }
    }
    if (!pick) break
    resources[pick.r]! += pick.k
    slack -= pick.k
    for (const k of touching[pick.r]!) current[k]! += sign(claims[k]!, pick.r) * pick.k
  }

  // Greedy growth never takes width back. Moving a few columns from one gap to another often
  // finds rows the growth order missed.
  const floorOf = [...gaps, right]
  const shift = (from: number, to: number, k: number) => {
    resources[from]! -= k
    resources[to]! += k
    for (const c of new Set([...touching[from]!, ...touching[to]!])) current[c]! += (sign(claims[c]!, to) - sign(claims[c]!, from)) * k
  }
  for (let pass = 0; pass < 12; pass++) {
    let best: { from: number; to: number; k: number; saved: number } | undefined
    for (let a = 0; a < resources.length; a++) {
      for (let b = 0; b < resources.length; b++) {
        if (a === b || touching[b]!.length === 0) continue
        const both = [...new Set([...touching[a]!, ...touching[b]!])]
        const deltas = both.map(c => sign(claims[c]!, b) - sign(claims[c]!, a))
        const now = both.reduce((sum, c) => sum + rowsFor(claims[c]!, current[c]!), 0)
        for (let k = 1; k <= 8 && resources[a]! - k >= floorOf[a]!; k++) {
          const then = both.reduce((sum, c, i) => sum + rowsFor(claims[c]!, current[c]! + deltas[i]! * k), 0)
          const saved = now - then
          if (saved > 0 && (!best || saved > best.saved)) best = { from: a, to: b, k, saved }
        }
      }
    }
    if (!best) break
    shift(best.from, best.to, best.k)
  }

  claims.forEach((claim, k) => {
    const { item } = claim
    const state = states.get(item.step)!
    const room = current[k]!
    const cap = capOf(item, room)
    state.cap = Math.max(cap, item.pieceCap, item.minCap, 1)
    const step = item.step
    if (step.kind !== 'message' || step.from === step.to) return
    const extra = (step.arrow === 'both' ? 1 : 0) + (step.isDashed ? DASHES : 0) + 5
    if (spillRoom(item) !== undefined) {
      const isOne = !item.text.includes('\n') && item.fullWidth + extra <= room
      Object.assign(state, { inline: isOne && item.canInline, tight: isOne && item.canInline, cap: item.maxCap })
      return
    }
    const wrapped = wrap(item.text, state.cap)
    const fits = (line: string) => line !== '' && cellWidth(line) + extra <= room
    const shown = balanced(wrapped, item.text, room - extra)
    if (item.canInline && fits(shown.lines.at(-1) ?? '') && widest(shown.lines) <= state.cap) {
      state.cap = Math.max(widest(shown.lines), item.pieceCap)
      state.inline = true
      state.tight = true
    }
  })
  const plan = measure(sequence, lanes, items, states, names, stacked, tree, isBare, resources.slice(0, -1), width)
  return plan
  }
  let spend = budget
  for (let tries = 0; tries < 4 && spend >= 0; tries++) {
    const plan = attempt(spend)
    if (plan.width <= width) return plan
    spend -= plan.width - width
  }
  return undefined
}

function choose(sequence: Sequence, width: number): { plan: Plan; items: Item[]; numbers: Map<Message, string>; blocks: Block[] } | undefined {
  const { items, numbers } = itemsOf(sequence)
  const { blocks } = blocksOf(sequence.steps)
  const all = sequence.participants
  const cutNames = (plan: Plan) => plan.lanes.filter((p, i) => nameCut(p, plan.names[i]!)).length
  const fits = (n: number) => {
    const lanes = all.slice(0, n)
    const states = new Map<Step, State>(items.map(item => [item.step, { inline: false, cap: Math.max(HARD_CAP, item.minCap), isHidden: item.step.kind === 'note' }]))
    // a diagram is only worth drawing while every name stays whole; past that the list reads better
    const names = lanes.map(nameFloor)
    return measure(sequence, lanes, items, states, names, lanes.map(canStack), blocks, true, undefined, width).width <= width
  }
  const attempt = (n: number): Plan | undefined => {
    let found: Plan | undefined
    for (const ladder of LADDERS) {
      const plan = fit(sequence, all.slice(0, n), items, blocks, width, ladder)
      if (plan.width > width) continue
      if (!found || cutNames(plan) < cutNames(found)) found = plan
      if (cutNames(found) === 0) break
    }
    return found
  }
  let lo = 1
  let hi = all.length
  let most = 0
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid)) {
      most = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (most < all.length) return undefined
  const whole = attempt(all.length)
  return whole ? { plan: whole, items, numbers, blocks } : undefined
}

function isSurelyLost(sequence: Sequence, plan: Plan, itemOf: Map<Step, Item>): boolean {
  const messages = sequence.steps.filter((s): s is Message => s.kind === 'message')
  const lost = messages.filter(m => {
    const from = plan.lane.has(m.from)
    const to = plan.lane.has(m.to)
    if (!from && !to) return true
    const item = itemOf.get(m)
    const state = plan.states.get(m)
    return from && to && item !== undefined && state !== undefined && labelOf(item, state).isCut
  }).length
  return messages.length > 0 && lost > messages.length * COMPACT_SHARE
}

function isMostlyLost(sequence: Sequence, lanes: Participant[]): boolean {
  const shown = new Set(lanes.map(p => p.id))
  const messages = sequence.steps.filter((s): s is Message => s.kind === 'message')
  const lost = messages.filter(m => !shown.has(m.from) || !shown.has(m.to)).length
  return messages.length > 0 && lost > messages.length * COMPACT_SHARE * 2
}

class Canvas {
  readonly rows: Cell[][] = []
  readonly depth: number[]
  readonly alive: boolean[]
  readonly frames: Frame[] = []
  readonly marks = new Map<string, string>()
  readonly rails: number[] = []
  // stamped on every cell put while it is set
  paint: Paint = {}
  // participants that send at least one message, numbered in the order they first send; only
  // they carry a colour, so a hue always means "this one is talking"
  rank = new Map<number, number>()
  boxedNotes = false
  stub?: number

  constructor(readonly width: number, readonly plan: Plan, created: Set<string>) {
    this.depth = plan.lanes.map(() => 0)
    this.alive = plan.lanes.map(p => !created.has(p.id))
  }

  offset(i: number) {
    return this.depth[i]! >= 2 ? 1 : 0
  }

  laneAt(x: number): number {
    return this.plan.centre.findIndex((c, i) => this.alive[i] && (x === c || (x === c + 1 && this.offset(i) === 1)))
  }

  // a stroke cuts straight through an idle lifeline when labels sit above, so a crossing never
  // reads as a stop on the way
  crossing(x: number, fallback: string, cuts = false): string {
    const i = this.laneAt(x)
    if (i < 0) return fallback
    return this.depth[i]! > 0 ? '╂' : cuts ? fallback : '┼'
  }

  blank(): number {
    this.rows.push(Array.from({ length: this.width }, (): Cell => ({ char: ' ', ink: 'text' })))
    return this.rows.length - 1
  }

  row(): number {
    const y = this.blank()
    const paint = this.paint
    this.plan.centre.forEach((x, i) => {
      if (!this.alive[i]) return
      this.paint = { lane: this.rank.get(i) }
      const glyph: Cell = this.depth[i]! > 0 ? { char: '┃', ink: 'line' } : { char: '│', ink: 'frame' }
      this.put(y, x, glyph.char, glyph.ink)
      if (this.offset(i)) this.put(y, x + 1, '┃', 'line')
    })
    this.paint = paint
    for (const { left, right, isRect } of this.frames) {
      if (isRect) for (let x = left; x <= right; x++) this.shadeAt(y, x)
      else {
        this.put(y, left, '│', 'block')
        this.put(y, right, '│', 'block')
      }
    }
    if (this.stub !== undefined) this.put(y, this.stub, '┆', 'frame')
    this.railsOn(y)
    return y
  }

  // box groups run a dim rail down each outer side, under anything drawn later on that row
  railsOn(y: number) {
    for (const x of this.rails) if (this.rows[y]?.[x]?.char === ' ') this.put(y, x, '┆', 'frame')
  }

  put(y: number, x: number, char: string, ink: Ink) {
    const row = this.rows[y]
    if (!row || x < 0 || x >= this.width) return
    const keep = (cell: Cell, next: Cell): Cell => (cell.shade ? { ...next, shade: true } : next)
    if (row[x]!.char === '' && x > 0) row[x - 1] = keep(row[x - 1]!, { char: ' ', ink: 'text' })
    if (x + 1 < this.width && row[x + 1]!.char === '') row[x + 1] = keep(row[x + 1]!, { char: ' ', ink: 'text' })
    row[x] = keep(row[x]!, { char, ink, ...this.paint })
  }

  shadeAt(y: number, x: number) {
    const cell = this.rows[y]?.[x]
    if (cell && x >= 0 && x < this.width) cell.shade = true
  }

  write(y: number, x: number, text: string, ink: Ink): number {
    let at = x
    for (const g of graphemes(text)) {
      const w = cellWidth(g)
      if (w === 0) continue
      if (at + w > this.width) break
      this.put(y, at, g, ink)
      if (w === 2) this.rows[y]![at + 1] = { char: '', ink, ...(this.rows[y]![at + 1]!.shade ? { shade: true } : {}) }
      at += w
    }
    return at
  }

  runs(): Run[][] {
    return this.rows.map(cells => {
      const runs = cells.reduce<Run[]>((all, { char, ink, shade, lane, reply }) => {
        if (char === '') return all
        const last = all.at(-1)
        const isLoose = char === ' ' && ink !== 'note' && last?.ink !== 'note'
        const isSame = last !== undefined && last.ink === ink && last.lane === lane && Boolean(last.reply) === Boolean(reply)
        if (last && Boolean(last.shade) === Boolean(shade) && (isSame || isLoose)) last.text += char
        else all.push({ text: char, ink, ...(shade ? { shade } : {}), ...(lane === undefined ? {} : { lane }), ...(reply ? { reply } : {}) })
        return all
      }, [])
      const last = runs.at(-1)
      if (last && last.ink !== 'note' && !last.shade) last.text = last.text.trimEnd()
      return runs.filter(run => run.text.length > 0)
    })
  }
}

function drawBox(canvas: Canvas, y: number, p: Participant, x: number, cap: number, isBare: boolean, stacked: boolean, height?: number) {
  const paint = canvas.paint
  canvas.paint = { lane: canvas.rank.get(canvas.plan.centre.indexOf(x)) }
  drawBoxPainted(canvas, y, p, x, cap, isBare, stacked, height)
  canvas.paint = paint
}

function drawBoxPainted(canvas: Canvas, y: number, p: Participant, x: number, cap: number, isBare: boolean, stacked: boolean, height?: number) {
  const lines = headerLines(p, cap, stacked, isBare)
  const w = boxWidth(p, cap, isBare, stacked)
  const start = x - leftOf(w)
  const across = '─'.repeat(w - 2)
  const inner = Math.max(lines.length, (height ?? 0) - 2)
  const bottom = y + inner + 1
  const pad = Math.floor((inner - lines.length) / 2)
  for (let row = y + 1; row < bottom; row++) {
    canvas.put(row, start, '│', 'frame')
    canvas.put(row, start + w - 1, '│', 'frame')
    for (let at = start + 1; at < start + w - 1; at++) canvas.put(row, at, ' ', 'text')
  }
  canvas.write(y, start, `╭${across}╮`, 'frame')
  const mark = canvas.marks.get(p.id)
  if (mark && cellWidth(mark) <= w - 2) canvas.write(y, start + 1, mark, 'number')
  canvas.write(bottom, start, `╰${across}╯`, 'frame')
  canvas.put(bottom, x, '┬', 'frame')
  lines.forEach((text, i) => canvas.write(y + 1 + pad + i, start + 1 + Math.floor((w - 2 - cellWidth(text)) / 2), text, 'name'))
}

function drawGroups(canvas: Canvas, sequence: Sequence, plan: Plan, notes: string[]) {
  const groups = sequence.boxes.flatMap((group, k) => {
    const members = plan.lanes.flatMap((p, i) => (p.box === k ? [i] : []))
    return members.length > 0 && group.label !== '' ? [{ group, members }] : []
  })
  if (groups.length === 0) return
  const y = canvas.blank()
  for (const { group, members } of groups) {
    const first = members[0]!
    const lastLane = members.at(-1)!
    const start = plan.centre[first]! - leftOf(boxWidth(plan.lanes[first]!, plan.names[first]!, plan.isBare, plan.stacked[first]))
    const end = Math.min(canvas.width - 1, Math.max(plan.centre[lastLane]! + rightOf(boxWidth(plan.lanes[lastLane]!, plan.names[lastLane]!, plan.isBare, plan.stacked[lastLane])), start + cellWidth(group.label) + 5))
    canvas.write(y, start, `╭${'─'.repeat(Math.max(0, end - start - 1))}╮`, 'block')
    canvas.rails.push(start, end)
    const shown = cut(group.label, end - start - 5)
    if (shown.isCut) notes.push(`Box: ${group.label}`)
    canvas.write(y, start + 2, ` ${shown.text} `, 'name')
  }
}

type Frame = { left: number; right: number; lane: number; isRect?: boolean }

const labelStart = (canvas: Canvas, frame: Frame) => canvas.plan.centre[frame.lane]! + canvas.offset(frame.lane) + 3

function labelRoom(canvas: Canvas, frame: Frame): number {
  const x = labelStart(canvas, frame)
  const stop = canvas.plan.centre.reduce((most, c, i) => (canvas.alive[i] && c >= x && c < most ? c : most), frame.right)
  return stop - 1 - x
}

function frameRow(canvas: Canvas, y: number, frame: Frame, ends: [string, string], fill: string, opening?: Opening, label?: string) {
  for (let x = frame.left + 1; x < frame.right; x++) canvas.put(y, x, canvas.crossing(x, fill), 'block')
  canvas.put(y, frame.left, ends[0], 'block')
  canvas.put(y, frame.right, ends[1], 'block')
  if (!opening || !label) return
  const x = labelStart(canvas, frame)
  label = cut(label, Math.max(1, labelRoom(canvas, frame))).text
  canvas.put(y, x - 1, ' ', 'text')
  const keyword = opening.keyword
  const isKeyed = label.startsWith(keyword)
  const after = isKeyed ? canvas.write(y, x, keyword, 'name') : x
  const end = canvas.write(y, after, isKeyed ? label.slice(keyword.length) : label, 'text')
  if (end < frame.right - 1) canvas.put(y, end, ' ', 'text')
}

type Arrival = { lightsLane?: number; born?: number }

function writeLabel(canvas: Canvas, y: number, x: number, line: string, number: string | undefined): number {
  if (number && (line === number || line.startsWith(`${number}${GLUE}`))) {
    const at = canvas.write(y, x, number, 'number')
    if (line === number) return at
    canvas.put(y, at, ' ', 'text')
    return canvas.write(y, at + 1, plain(line.slice(number.length + 1)), 'text')
  }
  return canvas.write(y, x, plain(line), 'text')
}

function drawMessage(canvas: Canvas, plan: Plan, step: Message, text: string, wrapped: Wrapped, inline: boolean, tight: boolean, number: string | undefined, arrival: Arrival, footnote: () => string) {
  const paint = canvas.paint
  const lane = plan.lane.get(step.from)
  canvas.paint = { lane: lane === undefined ? undefined : canvas.rank.get(lane), reply: step.isDashed }
  drawMessagePainted(canvas, plan, step, text, wrapped, inline, tight, number, arrival, footnote)
  canvas.paint = paint
}

function drawMessagePainted(canvas: Canvas, plan: Plan, step: Message, text: string, wrapped: Wrapped, inline: boolean, tight: boolean, number: string | undefined, arrival: Arrival, footnote: () => string) {
  const from = plan.lane.get(step.from)!
  const to = plan.lane.get(step.to)!
  const c = plan.centre
  const stroke = step.isDashed ? '╌' : '─'
  const heads = HEADS[step.arrow]

  if (from === to) {
    // a call to itself is one `↺` row, its label beside it and any wrapped lines hanging under the
    // label text; a call that activates its own lane lights the nested bar on that same row
    if (arrival.lightsLane === from) canvas.depth[from]! += 1
    const at = c[from]! + canvas.offset(from)
    const start = at + 3
    const isSpill = isSpilling(step, plan.nested)
    const stop = isSpill
      ? c.reduce((most, lane, i) => (i !== from && canvas.alive[i] && canvas.depth[i]! > 0 && lane > start && lane < most ? lane - 1 : most), canvas.width)
      : from < plan.lanes.length - 1 ? c[from + 1]! - 1 : canvas.width
    // later lines hang under the label text, past the number, so they wrap to the room left there
    const indent = number ? cellWidth(number) + 1 : 0
    const room = Math.max(1, stop - start - indent)
    const lines = wrap(text, room).lines
    lines.forEach((line, i) => {
      const y = canvas.row()
      if (i === 0) canvas.put(y, at + 1, '↺', 'line')
      canvas.put(y, writeLabel(canvas, y, i === 0 ? start : start + indent, line, i === 0 ? number : undefined), ' ', 'text')
    })
    // with labels above, the next message's label would read as this call's second line
    if (labelsAbove) canvas.row()
    return
  }

  const isRight = to > from
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const born = arrival.born
  const bornWidth = born === undefined ? 0 : boxWidth(plan.lanes[born]!, plan.names[born]!, plan.isBare, plan.stacked[born]!)
  const edgeAt = (offsetLo: number) => ({
    start: born === lo ? c[lo]! + rightOf(bornWidth) + 1 : c[lo]! + offsetLo + 1,
    end: born === hi ? c[hi]! - leftOf(bornWidth) - 1 : c[hi]! - 1,
  })
  const both = step.arrow === 'both' ? 1 : 0
  const planned = edgeAt(canvas.offset(lo))
  const limit = isRight ? planned.end - 2 : planned.end - both - 1
  // a label on an arrow that crosses other lifelines always starts with a stub from its sender
  const lead = (isTight: boolean) => (!isRight || (isTight && hi - lo <= 1) ? 0 : LEADER)
  const tailAt = (start: number, isTight: boolean) => (isRight ? start + both + lead(isTight) + 1 : start + 3)
  const reach = (isTight: boolean) => (isRight ? limit : planned.end - lead(isTight))
  const last = wrapped.lines.at(-1) ?? ''
  const dashes = step.isDashed ? DASHES : 0
  const isInline = inline && last !== '' && tailAt(planned.start, tight) + cellWidth(last) + dashes + 1 <= reach(tight)
  let tail: { text: string; number?: string; isTight: boolean } | undefined
  let above = wrapped.lines

  if (isInline) {
    tail = { text: last, number: wrapped.lines.length === 1 ? number : undefined, isTight: tight }
    above = wrapped.lines.slice(0, -1)
  }
  const x = (born === lo ? c[lo]! + rightOf(bornWidth) : c[lo]! + canvas.offset(lo)) + (isRight ? LEADER + 2 : 4)
  if (!isInline) {
    const spill = born === undefined && !plan.nested.has(step)
    const busy = spill ? c.findIndex((at, i) => i > lo && canvas.alive[i] && canvas.depth[i]! > 0) : -1
    const stop = !spill ? (born === hi ? c[hi]! - leftOf(bornWidth) : c[hi]!) : busy >= 0 ? c[busy]! - 1 : canvas.width
    const room = stop - x - 1
    if (spill || wrapped.lines.some(line => cellWidth(line) > room)) {
      const fitted = wrap(wrapped.isCut ? wrapped.lines.join(' ') : text, Math.max(1, room))
      above = fitted.lines
      if (fitted.isCut) {
        const mark = footnote()
        const last = above.at(-1) ?? ''
        above = cellWidth(`${last} ${mark}`) <= room ? [...above.slice(0, -1), `${last} ${mark}`] : [...above, mark]
      }
    } else above = wrapped.lines
    const fits = (line: string) => line !== '' && tailAt(planned.start, true) + cellWidth(line) + Math.max(dashes, ARROW_MIN) <= reach(true)
    if (born === undefined && !wrapped.isCut && above.every(line => cellWidth(line) <= room)) {
      const fitted = balanced({ lines: above, isCut: false }, text, reach(true) - tailAt(planned.start, true) - dashes)
      if (fitted.lines.every(line => cellWidth(line) <= room)) above = fitted.lines
    }
    const end = above.at(-1)
    if (!labelsAbove && born === undefined && end !== undefined && fits(end)) {
      tail = { text: end, number: above.length === 1 ? number : undefined, isTight: true }
      above = above.slice(0, -1)
    }
  }
  // every label line starts at the same gutter, whether or not its arrow shares the row
  const isTail = tail?.isTight ?? true
  const hang = number ? cellWidth(number) + 1 : 0
  above.forEach((line, i) => {
    const y = canvas.row()
    const gutter = tail === undefined ? planned.start + 1 : tailAt(planned.start, isTail)
    const at =
      born !== undefined ? x : isRight || labelsAbove ? gutter + (i > 0 ? hang : 0) : Math.max(planned.start + 1, planned.end - lead(isTail) - cellWidth(line))
    canvas.put(y, writeLabel(canvas, y, at, line, i === 0 ? number : undefined), ' ', 'text')
  })

  let y: number
  if (born !== undefined) {
    const p = plan.lanes[born]!
    const height = boxHeight(p, plan.names[born]!, plan.stacked[born]!)
    const top = canvas.row()
    for (let k = 1; k < height; k++) canvas.row()
    y = top + Math.floor(height / 2)
    drawBox(canvas, top, p, c[born]!, plan.names[born]!, plan.isBare, plan.stacked[born]!)
    canvas.alive[born] = true
  } else {
    if (arrival.lightsLane !== undefined) canvas.depth[arrival.lightsLane]! += 1
    y = canvas.row()
  }
  const { start, end } = edgeAt(canvas.offset(lo))
  for (let at = start; at <= end; at++) canvas.put(y, at, canvas.crossing(at, stroke, labelsAbove), 'line')
  if (isRight && heads.right) canvas.put(y, end, heads.right, 'line')
  if (!isRight && heads.left) canvas.put(y, start, heads.left, 'line')
  if (step.arrow === 'both') canvas.put(y, isRight ? start : end, isRight ? heads.left : heads.right, 'line')
  if (tail === undefined) return
  // the label sits at the sending end, LEADER stroke cells from its lifeline, mirrored for arrows
  // that point left
  const first = tailAt(start, tail.isTight)
  const width = cellWidth(tail.text)
  const at = isRight ? first : Math.max(first, end - lead(tail.isTight) - width)
  canvas.put(y, at - 1, ' ', 'text')
  canvas.put(y, writeLabel(canvas, y, at, tail.text, tail.number), ' ', 'text')
}

type Placed = { x: number; bw: number; lines: string[]; side: 'left' | 'right' | 'over' }

function placeNote(canvas: Canvas, plan: Plan, step: Note, over: number[], wrapped: Wrapped): Placed {
  const c = plan.centre
  const a = over[0]!
  const b = over.at(-1)!
  const isWide = step.side === 'over' && a !== b
  const span = c[b]! - c[a]! + 3
  // a note over two lanes widens past them but stops short of the next lifeline either side, so it
  // never reads as covering a participant it doesn't name; past that room it wraps
  const left = a > 0 ? c[a - 1]! + canvas.offset(a - 1) + 2 : 0
  const right = b < plan.lanes.length - 1 ? c[b + 1]! - 1 : canvas.width
  const room = Math.max(span, right - left)
  const source = step.text.split('\n')
  const lines =
    isWide && widest(source) + 2 <= room ? source
    : isWide && widest(wrapped.lines) + 2 > room ? wrap(wrapped.lines.join('\n'), Math.max(1, room - 2)).lines
    : wrapped.lines
  const text = widest(lines)
  const bw = isWide ? Math.max(span, text + 2) : noteWidth(step, text)
  const x =
    step.side === 'left' ? c[a]! - 1 - bw
    : step.side === 'right' ? c[b]! + canvas.offset(b) + 2
    : isWide ? Math.max(left, Math.min(c[a]! - 1 - Math.floor((bw - span) / 2), right - bw))
    : c[a]! - half(bw)
  return { x, bw, lines: lines.length > 0 ? lines : [''], side: step.side }
}

function paintNote(canvas: Canvas, y: number, { x, bw }: Placed, line: string) {
  for (let i = 0; i < bw; i++) canvas.put(y, x + i, ' ', 'note')
  const shown = cut(line, bw - 2).text
  canvas.write(y, x + 1 + Math.floor((bw - 2 - cellWidth(shown)) / 2), shown, 'note')
}

function drawNotes(canvas: Canvas, given: Placed[]) {
  let placed = given
  const height = Math.max(...placed.map(p => p.lines.length))
  if (canvas.boxedNotes) {
    // the border takes a column each side, so the box is two wider than the tinted note; a side
    // note grows away from its lifeline so the lifeline keeps its gap
    placed = placed.map(note => {
      const x = note.side === 'left' ? note.x - 2 : note.side === 'right' ? note.x : note.x - 1
      return { ...note, x: Math.max(0, x), bw: note.bw + 2 }
    })
    const edge = (left: string, right: string) => {
      const y = canvas.row()
      for (const { x, bw } of placed) canvas.write(y, x, `${left}${'─'.repeat(Math.max(0, bw - 2))}${right}`, 'frame')
    }
    edge('╭', '╮')
    for (let k = 0; k < height; k++) {
      const y = canvas.row()
      for (const note of placed) {
        for (let i = 0; i < note.bw; i++) canvas.put(y, note.x + i, ' ', 'text')
        canvas.put(y, note.x, '│', 'frame')
        canvas.put(y, note.x + note.bw - 1, '│', 'frame')
        const line = note.lines[k]
        if (line === undefined) continue
        const shown = cut(line, note.bw - 4).text
        canvas.write(y, note.x + 2 + Math.floor((note.bw - 4 - cellWidth(shown)) / 2), shown, 'note')
      }
    }
    edge('╰', '╯')
    return
  }
  for (let k = 0; k < height; k++) {
    const y = canvas.row()
    for (const note of placed) if (k < note.lines.length) paintNote(canvas, y, note, note.lines[k]!)
  }
}

const numbered = (text: string) => plain(text).replace(/\n/g, ' ')

function drawHidden(canvas: Canvas, plan: Plan, step: Message, text: string, number: string | undefined, nameOf: (id: string) => string, footnote: (full: string, step: Step) => string) {
  const from = plan.lane.get(step.from)
  const to = plan.lane.get(step.to)
  const visible = from ?? to
  const stub = canvas.stub
  if (visible === undefined || stub === undefined) return
  const x = plan.centre[visible]! + canvas.offset(visible)
  const stroke = step.isDashed ? '╌' : '─'
  const room = stub - x - 3
  const wrapped = wrap(text, room)
  const isFootnoted = wrapped.isCut || wrapped.lines.length > 2
  const lines = isFootnoted ? [footnote(numbered(text), step)] : wrapped.lines
  lines.forEach((line, i) => writeLabel(canvas, canvas.row(), x + 2, line, i === 0 && !isFootnoted ? number : undefined))
  const y = canvas.row()
  for (let at = x + 1; at < stub; at++) canvas.put(y, at, canvas.crossing(at, stroke), 'line')
  if (from !== undefined) canvas.put(y, stub - 1, HEADS[step.arrow].right || stroke, 'line')
  else canvas.put(y, x + 1, HEADS[step.arrow].left || stroke, 'line')
  const away = plan.lanes.length > 0 ? (from === undefined ? step.from : step.to) : ''
  canvas.write(y, stub + 2, cut(nameOf(away), canvas.width - stub - 2).text, 'frame')
}

// read by draw() while a call to drawSequence is under way
let boxed = false
// every label sits above a stroke that runs the whole way from sender to receiver
let labelsAbove = false

const cache = new Map<string, { rows: Run[][]; notes: string[] }>()

export type DrawOptions = { boxedNotes?: boolean; labelsAbove?: boolean }

export function drawSequence(sequence: Sequence, width: number, options: DrawOptions = {}): { rows: Run[][]; notes: string[] } {
  const key = `${width}\u0000${options.boxedNotes ? 1 : 0}${options.labelsAbove ? 1 : 0}\u0000${JSON.stringify(sequence)}`
  const hit = cache.get(key)
  if (hit) return hit
  boxed = options.boxedNotes === true
  labelsAbove = options.labelsAbove === true
  const drawn = draw(sequence, width)
  if (cache.size > 64) cache.delete(cache.keys().next().value!)
  cache.set(key, drawn)
  return drawn
}

// True when a box at this width folds its name inside a word: after `_` or `::`, or at a
// CamelCase hump the label has no space at. A fold after `/` or at a space is fine.
function breaksInside(p: Participant, cap: number): boolean {
  const lines = fullHeader(p, cap)
  const label = p.label.replace(/\s*\n\s*/g, ' ')
  return lines.some((line, i) => {
    const next = lines[i + 1]
    if (next === undefined || line.endsWith('/')) return false
    return /(_|::)$/.test(line) || (label.includes(line + next) && !label.includes(`${line} ${next}`))
  })
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const superscript = (n: number) => [...String(n)].map(digit => SUPERSCRIPT[Number(digit)]).join('')

// A name's trailing `(…)` is detail too: `Rater (in-process gem)` keeps `Rater` in its box once the
// whole name would wrap.
const TRAILING = /^(.+?)\s+(\([^()]*\))$/

function split(p: Participant): { name: string; details: string[] } {
  const [first = '', ...rest] = p.label.split('\n').map(line => line.trim())
  const trailing = TRAILING.exec(first)
  return trailing ? { name: trailing[1]!, details: [trailing[2]!, ...rest] } : { name: first, details: rest }
}

const detailsFold = (p: Participant, cap: number) => {
  const [first = '', ...details] = p.label.split('\n').map(line => line.trim())
  const wraps = wrap(first, cap, true).lines.length
  return (
    (details.length > 0 && (breaksInside(p, cap) || details.some(line => cellWidth(line) > cap) || wraps > 2)) ||
    (TRAILING.test(first) && wraps > 1)
  )
}

// a box whose `<br/>` detail lines don't fit whole, each on one line, keeps just its name; the full
// name goes to the legend under the diagram, so nothing is lost and no box towers. Folding frees
// width, which can make other names fit or fail differently, so the folded set only grows and one
// numbering covers it
function draw(given: Sequence, width: number, fold: ReadonlySet<string> = new Set()): { rows: Run[][]; notes: string[] } {
  const legend = given.participants.filter(p => fold.has(p.id))
  const mark = new Map(legend.map((p, k) => [p.id, superscript(k + 1)]))
  const sequence = {
    ...given,
    participants: given.participants.map(p =>
      mark.has(p.id) ? { ...p, label: `${split(p).name}\u00a0${mark.get(p.id)}` } : p.label.trim() === '' ? { ...p, label: p.id } : p,
    ),
  }
  const notes = legend.map(p => `${mark.get(p.id)} ${split(p).details.join(' · ')}`)
  const all = sequence.participants
  if (all.length === 0) return { rows: [], notes }
  const chosen = choose(sequence, width)
  if (!chosen) {
    const drawn = compact(sequence, width)
    return { rows: drawn.rows, notes: [...notes, ...drawn.notes] }
  }
  const more = chosen.plan.lanes.filter((p, i) => !fold.has(p.id) && detailsFold(p, chosen.plan.names[i]!))
  if (more.length > 0) return draw(given, width, new Set([...fold, ...more.map(p => p.id)]))
  const { plan, items, numbers, blocks } = chosen
  const itemOf = new Map(items.map(item => [item.step, item]))
  const created = new Set(sequence.steps.flatMap(step => (step.kind === 'create' ? [step.id] : [])))
  const canvas = new Canvas(width, plan, created)
  canvas.boxedNotes = boxed
  for (const step of sequence.steps) {
    const lane = step.kind === 'message' ? plan.lane.get(step.from) : undefined
    if (lane !== undefined && !canvas.rank.has(lane)) canvas.rank.set(lane, canvas.rank.size)
  }
  const nameOf = (id: string) => all.find(p => p.id === id)?.label ?? id
  let refs = 0
  const lost = new Set<Step>()
  const footnote = (full: string, step?: Step) => {
    if (step?.kind === 'message') lost.add(step)
    refs++
    notes.push(`[${refs}] ${plain(full).replace(/\n/g, ' ')}`)
    return `[${refs}]`
  }
  const frameLabel = (step: Opening, frame: Frame): string[] => {
    const shown = frameText(step)
    if (shown === '') return []
    const room = labelRoom(canvas, frame)
    const bare = bareText(step)
    for (const one of [shown, bare]) if (cellWidth(one) <= room) return [one]
    for (const one of [shown, bare]) {
      const lines = wrap(one, room)
      if (!lines.isCut && lines.lines.length <= 2) return lines.lines
    }
    const text = bare
    const mark = `[${refs + 1}]`
    const words = text.split(' ')
    let first = ''
    while (words.length > 0 && cellWidth(first === '' ? words[0]! : `${first} ${words[0]}`) <= room) first = first === '' ? words.shift()! : `${first} ${words.shift()}`
    footnote(text, step)
    if (first === '') return [`${cut(text, Math.max(1, room - cellWidth(mark) - 1)).text} ${mark}`]
    return [first, `${cut(words.join(' '), Math.max(1, room - cellWidth(mark) - 1)).text} ${mark}`]
  }
  const labelRow = (frame: Frame, line: string) => {
    const y = canvas.row()
    const x = labelStart(canvas, frame)
    canvas.put(y, x - 1, ' ', 'text')
    canvas.put(y, canvas.write(y, x, line, 'block'), ' ', 'text')
  }
  const labelled = (step: Step): Wrapped => {
    const item = itemOf.get(step)
    if (!item) return { lines: [], isCut: false }
    const state = plan.states.get(step)!
    const wrapped = labelOf(item, state)
    const isFrame = step.kind === 'open' || step.kind === 'branch'
    if (isFrame && wrapped.isCut) {
      const mark = footnote(item.text, step)
      return { lines: [`${cut(item.text, Math.max(cellWidth(step.keyword) + 1, state.cap - cellWidth(mark) - 1)).text} ${mark}`], isCut: true }
    }
    if (!wrapped.isCut) return wrapped
    const mark = footnote(step.kind === 'message' ? numbered(item.text) : item.text, step)
    const last = wrapped.lines.at(-1) ?? ''
    const lines = cellWidth(`${last} ${mark}`) <= state.cap ? [...wrapped.lines.slice(0, -1), `${last} ${mark}`] : [...wrapped.lines, mark]
    return { lines, isCut: true }
  }

  plan.lanes.forEach((p, i) => {
    if (nameCut(p, plan.names[i]!)) canvas.marks.set(p.id, footnote(p.label.replace(/\s+/g, ' ').trim()))
  })
  const across = Math.min(canvas.width, Math.max(plan.width, cellWidth(sequence.title ?? '')))
  if (sequence.title) for (const line of wrap(sequence.title, across).lines) canvas.write(canvas.blank(), Math.max(0, Math.floor((across - cellWidth(line)) / 2)), line, 'name')
  drawGroups(canvas, sequence, plan, notes)
  const tallest = Math.max(...plan.lanes.flatMap((p, i) => (canvas.alive[i] ? [boxHeight(p, plan.names[i]!, plan.stacked[i])] : [])), 3)
  const top = canvas.blank()
  for (let i = 1; i < tallest; i++) canvas.blank()
  plan.lanes.forEach((p, i) => {
    if (canvas.alive[i]) drawBox(canvas, top, p, plan.centre[i]!, plan.names[i]!, plan.isBare, plan.stacked[i]!, tallest)
  })
  for (let y = top; y < top + tallest; y++) canvas.railsOn(y)

  const hidden = all.filter(p => !plan.lane.has(p.id))
  if (hidden.length > 0) {
    const tag = `+${hidden.length}`
    canvas.stub = canvas.width - cellWidth(tag) - 2
    canvas.write(top + tallest - 2, canvas.stub, `┆ ${tag}`, 'frame')
    canvas.put(top + tallest - 1, canvas.stub, '┆', 'frame')
    notes.push(`${tag} = ${hidden.map(p => p.label).join(', ')}`)
  }

  const opened: Block[] = []
  const queue = [...blocks]
  const blockFor = new Map<Step, Block>()
  while (queue.length > 0) {
    const block = queue.shift()!
    blockFor.set(block.open, block)
    queue.push(...block.children)
  }
  const frameOf = (block: Block) => {
    const pad = plan.pads.get(block)!
    return { left: plan.centre[pad.lo]! - pad.left, right: Math.min(canvas.width - 1, plan.centre[pad.hi]! + pad.right), lane: pad.lo }
  }

  let messageRows = 0
  let leastRows = 0
  const isTight = items.some(item => {
    const state = plan.states.get(item.step)
    return item.canInline && state !== undefined && !state.isHidden && (state.tight || !state.inline)
  })
  const pendingBirths = new Set(plan.creates.values())
  const consumed = new Set<Step>()
  sequence.steps.forEach((step, k) => {
    if (consumed.has(step)) return
    drawStep(step, sequence.steps[k + 1])
  })
  function drawStep(step: Step, after: Step | undefined) {
    if (step.kind === 'open') {
      const block = blockFor.get(step)!
      const frame = frameOf(block)
      if (step.keyword === 'rect') {
        canvas.frames.push({ ...frame, isRect: true })
        opened.push(block)
        return
      }
      const lines = frameLabel(step, frame)
      frameRow(canvas, canvas.row(), frame, ['┌', '┐'], '─', step, lines[0])
      canvas.frames.push(frame)
      opened.push(block)
      if (lines[1] !== undefined) labelRow(frame, lines[1])
      return
    }
    if (step.kind === 'branch') {
      const frame = canvas.frames.at(-1)
      if (!frame) return
      const lines = frameLabel(step, frame)
      frameRow(canvas, canvas.row(), frame, ['├', '┤'], '╌', step, lines[0])
      if (lines[1] !== undefined) labelRow(frame, lines[1])
      return
    }
    if (step.kind === 'close') {
      const frame = canvas.frames.pop()
      opened.pop()
      if (frame && !frame.isRect) frameRow(canvas, canvas.row(), frame, ['└', '┘'], '─')
      return
    }
    if (step.kind === 'activate') {
      const i = plan.lane.get(step.id)
      if (i !== undefined) canvas.depth[i] = Math.max(0, canvas.depth[i]! + (step.isOn ? 1 : -1))
      return
    }
    if (step.kind === 'create') {
      const i = plan.lane.get(step.id)
      if (i === undefined || canvas.alive[i] || pendingBirths.has(step.id)) return
      const y = canvas.row()
      for (let row = 1; row < boxHeight(plan.lanes[i]!, plan.names[i]!, plan.stacked[i]); row++) canvas.row()
      drawBox(canvas, y, plan.lanes[i]!, plan.centre[i]!, plan.names[i]!, plan.isBare, plan.stacked[i]!)
      canvas.alive[i] = true
      return
    }
    if (step.kind === 'destroy') {
      // mermaid ends a destroyed lifeline in the participant's box
      const i = plan.lane.get(step.id)
      if (i === undefined || !canvas.alive[i]) return
      const p = plan.lanes[i]!
      const height = boxHeight(p, plan.names[i]!, plan.stacked[i])
      const y = canvas.row()
      for (let row = 1; row < height; row++) canvas.row()
      drawBox(canvas, y, p, plan.centre[i]!, plan.names[i]!, plan.isBare, plan.stacked[i]!)
      canvas.put(y, plan.centre[i]!, '┴', 'frame')
      canvas.put(y + height - 1, plan.centre[i]!, '─', 'frame')
      canvas.alive[i] = false
      return
    }
    if (step.kind === 'note') {
      const over = step.over.flatMap(id => plan.lane.get(id) ?? []).sort((a, b) => a - b)
      if (over.length === 0) notes.push(fullText(step, step.text, nameOf))
      else if (plan.states.get(step)?.isHidden) {
        const mark = footnote(step.text, step)
        const a = plan.centre[over[0]!]!
        const b = plan.centre[over.at(-1)!]! + canvas.offset(over.at(-1)!)
        const x = step.side === 'left' && a >= cellWidth(mark) + 1 ? a - 1 - cellWidth(mark) : step.side === 'right' ? b + 2 : a + 2
        const y = canvas.row()
        canvas.put(y, x - 1, ' ', 'text')
        canvas.write(y, x, mark, 'number')
      } else {
        drawNotes(canvas, [placeNote(canvas, plan, step, over, labelled(step))])
      }
      return
    }
    const number = numbers.get(step)
    const before = canvas.rows.length
    const bornId = plan.creates.get(step)
    const bornLane = bornId === undefined ? undefined : plan.lane.get(bornId)
    const boxRows = bornLane !== undefined && pendingBirths.has(bornId!) && !canvas.alive[bornLane] ? boxHeight(plan.lanes[bornLane]!, plan.names[bornLane]!, plan.stacked[bornLane]) - 1 : 0
    drawLink(step, after, number)
    const used = canvas.rows.length - before
    if (used === 0) return
    messageRows += used - boxRows
    const breaks = (itemOf.get(step)?.text ?? step.text).split('\n').length
    leastRows += Math.max(step.from === step.to || !plan.lane.has(step.from) || !plan.lane.has(step.to) ? 2 : 1, breaks)
  }
  function drawLink(step: Message, after: Step | undefined, number: string | undefined) {
    if (plan.lane.has(step.from) && plan.lane.has(step.to)) {
      const lights = after?.kind === 'activate' && after.isOn && after.id === step.to ? plan.lane.get(after.id) : undefined
      if (lights !== undefined) consumed.add(after!)
      const bornId = plan.creates.get(step)
      const born = bornId !== undefined && pendingBirths.has(bornId) && !canvas.alive[plan.lane.get(bornId)!] ? plan.lane.get(bornId) : undefined
      if (bornId !== undefined) pendingBirths.delete(bornId)
      const inline = (plan.states.get(step)?.inline ?? false) && !isSpill(step, plan.states, items, plan.nested, plan.creates)
      drawMessage(canvas, plan, step, itemOf.get(step)?.text ?? step.text, labelled(step), inline, isTight || (plan.states.get(step)?.tight ?? false), number, { lightsLane: lights, born }, () => footnote(numbered(itemOf.get(step)?.text ?? step.text), step))
      return
    }
    const text = itemOf.get(step)?.text ?? step.text
    if (!plan.lane.has(step.from) && !plan.lane.has(step.to)) {
      lost.add(step)
      notes.push(fullText(step, numbered(text), nameOf))
    }
    else drawHidden(canvas, plan, step, text, number, nameOf, footnote)
  }
  while (canvas.frames.length > 0) {
    const frame = canvas.frames.pop()!
    if (!frame.isRect) frameRow(canvas, canvas.row(), frame, ['└', '┘'], '─')
  }

  return { rows: canvas.runs(), notes: [...new Set(notes)] }
}

function fullText(step: Step, text: string, nameOf: (id: string) => string): string {
  const flat = plain(text).replace(/\n/g, ' ')
  if (step.kind === 'message') return `${nameOf(step.from)} → ${nameOf(step.to)}: ${flat}`
  if (step.kind === 'note') return `${step.side === 'over' ? '' : `${step.side} of `}${step.over.map(nameOf).join(', ')} ▸ ${flat}`
  return flat
}

export function plainRows(rows: Run[][]): string[] {
  return rows.map(row => row.map(run => run.text).join('').trimEnd())
}

const COMPACT_SHARE = 0.25
const COMPACT_ROWS = 1.6
const COMPACT_LEAST = 3
const COMPACT_SAVING = 0.8
const COMPACT_PAIR = 0.35
const COMPACT_NAME = 16

function shortNames(participants: Participant[], most: number): { short: Map<string, string>; legend: string[] } {
  const full = (p: Participant) => p.label.replace(/\n/g, ' ').trim() || p.id
  const firstLine = (p: Participant) => cut((p.label.split('\n')[0] ?? '').trim() || p.id, most - cellWidth(markerOf(p))).text
  const counts = new Map<string, number>()
  for (const p of participants) counts.set(firstLine(p), (counts.get(firstLine(p)) ?? 0) + 1)
  const short = new Map<string, string>()
  const legend: string[] = []
  for (const p of participants) {
    const line = firstLine(p)
    const name = (counts.get(line) ?? 0) > 1 ? p.id : line
    short.set(p.id, `${markerOf(p)}${name}`)
    if (name !== full(p)) legend.push(`${name} = ${full(p)}`)
  }
  return { short, legend }
}

function compact(sequence: Sequence, width: number): { rows: Run[][]; notes: string[] } {
  const rows: Run[][] = []
  const notes: string[] = []
  const pairCap = Math.min(Math.max(COMPACT_NAME, Math.floor(width * COMPACT_PAIR)), Math.max(1, Math.floor(width / 2)))
  const { short, legend } = shortNames(sequence.participants, Math.max(Math.floor((pairCap - 3) / 2), Math.min(COMPACT_NAME, width - 4)))
  const nameOf = (id: string) => short.get(id) ?? id
  for (const part of sequence.title ? wrap(sequence.title, width).lines : []) rows.push([{ text: part, ink: 'name' }])
  const packed = legend.reduce<string[]>((lines, entry) => {
    const last = lines.at(-1)
    if (last !== undefined && cellWidth(`${last} · ${entry}`) <= width) lines[lines.length - 1] = `${last} · ${entry}`
    else lines.push(entry)
    return lines
  }, [])
  for (const line of packed) for (const part of wrap(line, width).lines) rows.push([{ text: part, ink: 'frame' }])
  const groups = sequence.boxes.flatMap((box, b) => {
    const members = sequence.participants.filter(one => one.box === b).map(one => nameOf(one.id))
    return members.length === 0 ? [] : [`${box.label || 'group'}: ${members.join(', ')}`]
  })
  const joined = groups.reduce<string[]>((lines, group) => {
    const last = lines.at(-1)
    if (last !== undefined && cellWidth(`${last} · ${group}`) <= width) lines[lines.length - 1] = `${last} · ${group}`
    else lines.push(group)
    return lines
  }, [])
  for (const line of joined) for (const part of wrap(line, width).lines) rows.push([{ text: part, ink: 'frame' }])
  const pairOf = (step: Step): Run[] => {
    if (step.kind !== 'message') return []
    if (step.from === step.to) return [{ text: nameOf(step.from), ink: 'name' }, { text: ' ↺', ink: 'line' }]
    const arrow = step.isDashed ? ' ⇢ ' : ' → '
    return [{ text: nameOf(step.from), ink: 'name' }, { text: arrow, ink: 'line' }, { text: nameOf(step.to), ink: 'name' }]
  }
  const textOf = (runs: Run[]) => runs.map(run => run.text).join('')
  const numberOf = new Map<Step, string>(sequence.steps.flatMap(step => (step.kind === 'message' && step.number !== undefined ? [[step, String(step.number)] as const] : [])))
  const numberWidth = numberOf.size > 0 ? Math.max(...[...numberOf.values()].map(cellWidth)) + 1 : 0
  const depthMost = sequence.steps.reduce((d, step) => (step.kind === 'open' ? d + 1 : d), 0)
  const messages = sequence.steps.filter((step): step is Message => step.kind === 'message')
  const pairs = messages.map(step => cellWidth(textOf(pairOf(step))))
  const widestPair = Math.max(0, ...pairs)
  const flat = (text: string) => text.replace(/\n/g, ' ')
  const counted = new Map<number, number>()
  const rowsAt = (pw: number) => {
    const known = counted.get(pw)
    if (known !== undefined) return known
    const total = messages.reduce((sum, step, i) => sum + (pairs[i]! > pw ? 1 : 0) + Math.max(1, wrap(flat(step.text), Math.max(1, width - numberWidth - 2 * depthMost - pw - 2)).lines.length), 0)
    counted.set(pw, total)
    return total
  }
  let pairWidth = Math.min(widestPair, pairCap)
  for (let pw = 1; pw < pairWidth; pw++) if (pairs.some(p => p === pw) && rowsAt(pw) < rowsAt(pairWidth)) pairWidth = pw
  let depth = 0
  const pad = (n: number): Run[] => (n > 0 ? [{ text: ' '.repeat(n), ink: 'text' }] : [])
  const linesOf = (text: string, room: number): string[] => {
    const whole = wrap(text, room)
    if (!whole.isCut) return whole.lines
    const mark = `[${notes.length + 1}]`
    notes.push(`${mark} ${plain(text).replace(/\n/g, ' ')}`)
    const lines = wrap(text, Math.max(1, room - cellWidth(mark) - 1)).lines
    return [...lines.slice(0, -1), `${lines.at(-1) ?? ''} ${mark}`.trimStart()]
  }
  const entry = (step: Step, text: string, ink: Ink, number?: string) => {
    const indent = 2 * depth
    const labelColumn = indent + numberWidth + pairWidth + 2
    const pair = pairOf(step)
    const head: Run[] = [...pad(indent), ...(number ? [{ text: number.padEnd(numberWidth), ink: 'number' as Ink }] : pad(numberWidth))]
    const pairFits = cellWidth(textOf(pair)) <= pairWidth
    const lines = linesOf(text, Math.max(1, width - labelColumn))
    if (!pairFits) rows.push([...head, ...pair])
    lines.forEach((line, i) => {
      const lead = i === 0 && pairFits ? [...head, ...pair, ...pad(labelColumn - indent - numberWidth - cellWidth(textOf(pair)))] : pad(labelColumn)
      rows.push([...lead, { text: plain(line), ink }])
    })
    if (lines.length === 0 && pairFits) rows.push([...head, ...pair])
  }
  const note = (step: Note) => {
    const indent = 2 * depth + numberWidth
    const where = `(${step.side === 'over' ? '' : `${step.side} of `}${step.over.map(nameOf).join('–')})`
    const room = Math.max(1, width - indent - 2)
    const lines = linesOf(step.text, room)
    const fitsAfter = cellWidth(lines.at(-1) ?? '') + 2 + cellWidth(where) <= room
    lines.forEach((line, i) => {
      const tail: Run[] = i === lines.length - 1 && fitsAfter ? [{ text: `  ${where}`, ink: 'frame' }] : []
      rows.push([...pad(indent), i === 0 ? { text: '┆ ', ink: 'block' } : { text: '  ', ink: 'text' }, { text: plain(line), ink: 'note' }, ...tail])
    })
    if (!fitsAfter) rows.push([...pad(indent + 2), { text: where, ink: 'frame' }])
  }
  for (const step of sequence.steps) {
    if (step.kind === 'message') entry(step, flat(step.text), 'text', numberOf.get(step))
    else if (step.kind === 'note') note(step)
    else if (step.kind === 'open' || step.kind === 'branch') {
      if (step.kind === 'branch') depth = Math.max(0, depth - 1)
      rows.push([...pad(2 * depth), { text: `${step.kind === 'open' ? '┌' : '├'} ${frameText(step)}`.trimEnd(), ink: 'block' }])
      depth++
    } else if (step.kind === 'close') {
      depth = Math.max(0, depth - 1)
      rows.push([...pad(2 * depth), { text: '└', ink: 'block' }])
    }
  }
  return { rows, notes }
}
