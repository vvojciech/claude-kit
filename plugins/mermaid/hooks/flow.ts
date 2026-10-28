// Mermaid `flowchart` / `graph` source into nodes, edges and subgraphs. Styling lines (classDef,
// style, class, click, linkStyle) are read and skipped; anything else that doesn't parse is kept as
// a problem so the caller can show the source instead of a wrong drawing.

import { decodeEntities, endsInEntity, withoutControls } from './entities'
import { must } from './must'
import { kindOf } from './parse'

export type Direction = 'TD' | 'LR' | 'BT' | 'RL'
export type Shape = 'box' | 'round' | 'stadium' | 'diamond' | 'circle' | 'database' | 'hexagon' | 'flag' | 'subroutine'
export type FlowNode = { id: string; label: string; shape: Shape; group?: string }
export type Stroke = 'solid' | 'dotted' | 'thick' | 'invisible'
export type FlowEdge = { from: string; to: string; label: string; stroke: Stroke; head: boolean; tail: boolean }
export type Group = { id: string; label: string; parent?: string }
export type Flow = { title?: string; direction: Direction; nodes: FlowNode[]; edges: FlowEdge[]; groups: Group[]; problems: string[] }

const HEADER = /^(flowchart|graph)(?:\s+(TD|TB|LR|RL|BT))?\s*;?$/i
const SKIPPED = /^(classDef|class|style|click|linkStyle|accTitle|accDescr)\b/
// `a & b & … --> c & d & …` makes an edge for every pair; past this many the chart can't fit anyway
const MOST_EDGES = 500

// opening and closing marks of each node shape, longest first so `((` wins over `(`
const SHAPES: Array<[string, string, Shape | 'slanted']> = [
  ['(((', ')))', 'circle'],
  ['((', '))', 'circle'],
  ['([', '])', 'stadium'],
  ['[(', ')]', 'database'],
  ['[[', ']]', 'subroutine'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'slanted'],
  ['[\\', '\\]', 'slanted'],
  ['[/', '\\]', 'slanted'],
  ['[\\', '/]', 'slanted'],
  ['[', ']', 'box'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
  ['>', ']', 'flag'],
]

// a hyphen or dot belongs to the id unless it starts a link such as `-->`, `---` or `-.->`
const ID = /^[A-Za-z0-9_](?:\w|-(?![-.>])|\.(?![-.]))*/

// `;` ends a statement except inside a quoted label or as the end of an entity like `#35;`
function statements(line: string): string[] {
  const parts: string[] = []
  let quoted = false
  let start = 0
  for (let at = 0; at < line.length; at++) {
    const char = line[at]
    if (char === '"') quoted = !quoted
    if (char !== ';' || quoted || endsInEntity(line.slice(start, at))) continue
    parts.push(line.slice(start, at))
    start = at + 1
  }
  parts.push(line.slice(start))
  return parts.map(part => part.trim()).filter(part => part !== '')
}

// `%%` starts a comment only outside a quoted label
function uncommented(line: string): string {
  let quoted = false
  for (let at = 0; at < line.length; at++) {
    if (line[at] === '"') quoted = !quoted
    else if (!quoted && line.startsWith('%%', at)) return line.slice(0, at)
  }
  return line
}

const isWordChar = (char: string) => (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_'

export function isFlow(source: string): boolean {
  const kind = kindOf(source).toLowerCase()
  return ['flowchart', 'graph'].some(name => kind.startsWith(name) && !isWordChar(kind.charAt(name.length)))
}

const clean = (text: string) =>
  withoutControls(decodeEntities(text.replace(/^"(.*)"$/s, '$1').replace(/<br\s*\/?>/gi, '\n')))
    .replace(/`/g, '')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim()

type Cursor = { text: string; at: number }
type Named = { id: string; label?: string; shape?: Shape; isSlanted?: boolean }

function skipSpace(c: Cursor) {
  while (c.at < c.text.length && /\s/.test(c.text.charAt(c.at))) c.at++
}

// reads `id`, `id[label]`, `id(label)` and the like; the label may be quoted and hold any brackets
function readNode(c: Cursor): Named | undefined {
  skipSpace(c)
  const found = ID.exec(c.text.slice(c.at))
  if (!found) return undefined
  const id = found[0]
  c.at += id.length
  const rest = c.text.slice(c.at)
  for (const [open, close, shape] of SHAPES) {
    if (!rest.startsWith(open)) continue
    const start = c.at + open.length
    let end: number
    if (c.text[start] === '"') {
      const quote = c.text.indexOf('"', start + 1)
      if (quote < 0) return undefined
      end = c.text.indexOf(close, quote + 1)
    } else end = c.text.indexOf(close, start)
    if (end < 0) continue
    const label = clean(c.text.slice(start, end))
    c.at = end + close.length
    return shape === 'slanted' ? { id, label, shape: 'box', isSlanted: true } : { id, label, shape }
  }
  return { id }
}

type Link = { label: string; stroke: Stroke; head: boolean; tail: boolean; isMarked: boolean }

const isMark = (end: string | undefined) => end === 'o' || end === 'x'

// `-->`, `---`, `-.->`, `==>`, `<-->`, `~~~`, with an optional `|label|` after or `-- label -->` text
// inside; a circle or cross end such as `--o` or `x--x` is marked, as it isn't drawn
function readLink(c: Cursor): Link | undefined {
  skipSpace(c)
  const rest = c.text.slice(c.at)
  const inline = /^(<?)(--|==|-\.)\s+([^|]*?)\s+(-{2,}|={2,}|\.-+|-\.+-?)([>ox]?)/.exec(rest)
  const plain = /^(<|o|x)?(-{2,}|={2,}|-\.+-|~{3,}|-+\.-+)([>ox]?)/.exec(rest)
  let label = ''
  let stroke: Stroke
  let head: boolean
  let tail: boolean
  let isMarked: boolean
  if (inline && !plain?.[0].endsWith('>')) {
    c.at += inline[0].length
    label = clean(must(inline[3], 'link label'))
    stroke = inline[2] === '==' ? 'thick' : inline[2] === '-.' ? 'dotted' : 'solid'
    head = inline[5] !== ''
    tail = inline[1] === '<'
    isMarked = isMark(inline[5])
  } else if (plain) {
    c.at += plain[0].length
    const body = must(plain[2], 'link body')
    stroke = body.startsWith('~') ? 'invisible' : body.startsWith('=') ? 'thick' : body.includes('.') ? 'dotted' : 'solid'
    head = plain[3] !== ''
    tail = plain[1] !== undefined
    isMarked = isMark(plain[1]) || isMark(plain[3])
  } else return undefined
  skipSpace(c)
  if (c.text[c.at] === '|') {
    const end = c.text.indexOf('|', c.at + 1)
    if (end > c.at) {
      label = clean(c.text.slice(c.at + 1, end))
      c.at = end + 1
    }
  }
  return { label, stroke, head, tail, isMarked }
}

// `a & b` on either side of a link
function readGroup(c: Cursor): Named[] | undefined {
  const first = readNode(c)
  if (!first) return undefined
  const all = [first]
  for (;;) {
    const keep = c.at
    skipSpace(c)
    if (c.text[c.at] !== '&') {
      c.at = keep
      return all
    }
    c.at++
    const next = readNode(c)
    if (!next) return undefined
    all.push(next)
  }
}

type Reading = { flow: Flow; stack: string[]; note: (node: Named) => void }

const directionOf = (text: string): Direction => {
  const dir = text.toUpperCase()
  return dir === 'TB' ? 'TD' : (dir as Direction)
}

export function parseFlow(source: string): Flow {
  const flow: Flow = { direction: 'TD', nodes: [], edges: [], groups: [], problems: [] }
  const byId = new Map<string, FlowNode>()
  const stack: string[] = []
  const note = (node: Named) => {
    if (node.isSlanted) flow.problems.push(`parallelogram and trapezoid shapes not drawn yet: ${node.id}`)
    const known = byId.get(node.id)
    if (known) {
      if (node.label !== undefined) Object.assign(known, { label: node.label, shape: node.shape ?? known.shape })
      // a node first seen outside any subgraph joins the first one that names it
      if (known.group === undefined && stack.length > 0) known.group = stack.at(-1)
      return
    }
    const made: FlowNode = { id: node.id, label: node.label ?? node.id, shape: node.shape ?? 'box', group: stack.at(-1) }
    byId.set(node.id, made)
    flow.nodes.push(made)
  }
  let seenHeader = false
  let inFront = false
  for (const raw of source.split('\n')) {
    const line = uncommented(withoutControls(raw)).trim()
    if (line === '---') {
      inFront = !inFront && !seenHeader
      continue
    }
    if (inFront) readFront(flow, line)
    if (inFront || line === '') continue
    const parts = statements(line)
    if (!seenHeader) {
      const header = HEADER.exec(parts.shift() ?? '')
      if (!header) {
        flow.problems.push(`line not read: ${line}`)
        continue
      }
      flow.direction = directionOf(header[2] ?? 'TD')
      seenHeader = true
    }
    for (const statement of parts) readStatement({ flow, stack, note }, statement)
  }
  if (stack.length > 0) flow.problems.push(`subgraph not closed: ${stack.join(', ')}`)
  const groups = new Set(flow.groups.map(group => group.id))
  const linked = flow.nodes.filter(node => groups.has(node.id)).map(node => node.id)
  if (linked.length > 0) flow.problems.push(`links to a subgraph not drawn yet: ${linked.join(', ')}`)
  return flow
}

function readStatement(r: Reading, statement: string) {
  const { flow, stack } = r
  const [word, value = ''] = statement.split(/\s+/)
  if (word === 'direction') {
    if (stack.length > 0 && directionOf(value) !== flow.direction) flow.problems.push(`subgraph direction not drawn yet: ${statement}`)
    return
  }
  if (SKIPPED.test(statement)) return
  const sub = /^subgraph\s+(.+)$/.exec(statement)
  if (sub) {
    const head = must(sub[1], 'subgraph').trim()
    const titled = /^([\w.-]+)\s*\[(.*)\]$/.exec(head)
    const id = titled ? must(titled[1], 'subgraph id') : head.replace(/\s+/g, '_')
    const label = clean(titled ? must(titled[2], 'subgraph title') : head)
    if (stack.length > 0) flow.problems.push(`subgraph inside a subgraph not drawn yet: ${id}`)
    flow.groups.push({ id, label, parent: stack.at(-1) })
    stack.push(id)
    return
  }
  if (statement === 'end') {
    if (stack.pop() === undefined) flow.problems.push('end with no subgraph open')
    return
  }
  readChain(r, statement)
}

// a `title:` line in the YAML front matter
function readFront(flow: Flow, line: string) {
  const colon = line.indexOf(':')
  if (colon > 0 && line.slice(0, colon).trim() === 'title') flow.title = clean(line.slice(colon + 1).trim())
}

// a chain of links such as `a --> b & c -.-> d`
function readChain({ flow, note }: Reading, statement: string) {
  const c: Cursor = { text: statement, at: 0 }
  let left = readGroup(c)
  if (!left) {
    flow.problems.push(`line not read: ${statement}`)
    return
  }
  left.forEach(note)
  for (;;) {
    skipSpace(c)
    if (c.at >= c.text.length) return
    const read = readLink(c)
    const right = read && readGroup(c)
    if (!read || !right) {
      flow.problems.push(`line not read: ${statement}`)
      return
    }
    const { isMarked, ...link } = read
    if (isMarked) flow.problems.push(`circle and cross ends not drawn yet: ${statement}`)
    if (flow.edges.length + left.length * right.length > MOST_EDGES) {
      flow.problems.push(`too many links to draw, over ${MOST_EDGES}`)
      return
    }
    right.forEach(note)
    for (const a of left) for (const b of right) flow.edges.push({ from: a.id, to: b.id, ...link })
    left = right
  }
}
