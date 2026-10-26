// Mermaid `flowchart` / `graph` source into nodes, edges and subgraphs. Styling lines (classDef,
// style, class, click, linkStyle) are read and skipped; anything else that doesn't parse is kept as
// a problem so the caller can show the source instead of a wrong drawing.

export type Direction = 'TD' | 'LR' | 'BT' | 'RL'
export type Shape = 'box' | 'round' | 'stadium' | 'diamond' | 'circle' | 'database' | 'hexagon' | 'flag' | 'subroutine'
export type FlowNode = { id: string; label: string; shape: Shape; group?: string }
export type Stroke = 'solid' | 'dotted' | 'thick' | 'invisible'
export type FlowEdge = { from: string; to: string; label: string; stroke: Stroke; head: boolean; tail: boolean }
export type Group = { id: string; label: string; parent?: string }
export type Flow = { direction: Direction; nodes: FlowNode[]; edges: FlowEdge[]; groups: Group[]; problems: string[] }

const HEADER = /^(flowchart|graph)(?:\s+(TD|TB|LR|RL|BT))?\s*;?$/i
const SKIPPED = /^(classDef|class|style|click|linkStyle|direction|accTitle|accDescr)\b/

// opening and closing marks of each node shape, longest first so `((` wins over `(`
const SHAPES: Array<[string, string, Shape]> = [
  ['(((', ')))', 'circle'],
  ['((', '))', 'circle'],
  ['([', '])', 'stadium'],
  ['[(', ')]', 'database'],
  ['[[', ']]', 'subroutine'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'box'],
  ['[\\', '\\]', 'box'],
  ['[/', '\\]', 'box'],
  ['[\\', '/]', 'box'],
  ['[', ']', 'box'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
  ['>', ']', 'flag'],
]

const ID = /^[A-Za-z0-9_][\w.-]*/

export function isFlow(source: string): boolean {
  const first = source.split('\n').map(line => line.trim()).find(line => line !== '' && !line.startsWith('%%') && line !== '---')
  return first !== undefined && /^(flowchart|graph)\b/i.test(first)
}

const clean = (text: string) =>
  text
    .replace(/^"(.*)"$/s, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/`/g, '')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim()

type Cursor = { text: string; at: number }

function skipSpace(c: Cursor) {
  while (c.at < c.text.length && /\s/.test(c.text[c.at]!)) c.at++
}

// reads `id`, `id[label]`, `id(label)` and the like; the label may be quoted and hold any brackets
function readNode(c: Cursor): { id: string; label?: string; shape?: Shape } | undefined {
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
    return { id, label, shape }
  }
  return { id }
}

// `-->`, `---`, `-.->`, `==>`, `--o`, `--x`, `<-->`, `~~~`, with an optional `|label|` after or
// `-- label -->` text inside
function readLink(c: Cursor): { label: string; stroke: Stroke; head: boolean; tail: boolean } | undefined {
  skipSpace(c)
  const rest = c.text.slice(c.at)
  const inline = /^(<?)(--|==|-\.)\s+([^|]*?)\s+(-{2,}|={2,}|\.-+|-\.+-?)([>ox]?)/.exec(rest)
  const plain = /^(<|o|x)?(-{2,}|={2,}|-\.+-|~{3,}|-+\.-+)([>ox]?)/.exec(rest)
  let label = ''
  let stroke: Stroke
  let head: boolean
  let tail: boolean
  if (inline && !plain?.[0].endsWith('>')) {
    c.at += inline[0].length
    label = clean(inline[3]!)
    stroke = inline[2] === '==' ? 'thick' : inline[2] === '-.' ? 'dotted' : 'solid'
    head = inline[5] !== ''
    tail = inline[1] === '<'
  } else if (plain) {
    c.at += plain[0].length
    const body = plain[2]!
    stroke = body.startsWith('~') ? 'invisible' : body.startsWith('=') ? 'thick' : body.includes('.') ? 'dotted' : 'solid'
    head = plain[3] !== ''
    tail = plain[1] !== undefined
  } else return undefined
  skipSpace(c)
  if (c.text[c.at] === '|') {
    const end = c.text.indexOf('|', c.at + 1)
    if (end > c.at) {
      label = clean(c.text.slice(c.at + 1, end))
      c.at = end + 1
    }
  }
  return { label, stroke, head, tail }
}

// `a & b` on either side of a link
function readGroup(c: Cursor): Array<{ id: string; label?: string; shape?: Shape }> | undefined {
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

export function parseFlow(source: string): Flow {
  const flow: Flow = { direction: 'TD', nodes: [], edges: [], groups: [], problems: [] }
  const byId = new Map<string, FlowNode>()
  const stack: string[] = []
  const note = (node: { id: string; label?: string; shape?: Shape }) => {
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
    const line = raw.replace(/%%.*$/, '').trim()
    if (line === '---') {
      inFront = !inFront && !seenHeader
      continue
    }
    if (inFront || line === '') continue
    if (!seenHeader) {
      const header = HEADER.exec(line)
      if (!header) {
        flow.problems.push(`line not read: ${line}`)
        continue
      }
      const dir = (header[2] ?? 'TD').toUpperCase()
      flow.direction = dir === 'TB' ? 'TD' : (dir as Direction)
      seenHeader = true
      continue
    }
    for (const statement of line.split(/;\s*/).filter(part => part !== '')) {
      if (SKIPPED.test(statement)) continue
      const sub = /^subgraph\s+(.+)$/.exec(statement)
      if (sub) {
        const head = sub[1]!.trim()
        const titled = /^([\w.-]+)\s*\[(.*)\]$/.exec(head)
        const id = titled ? titled[1]! : head.replace(/\s+/g, '_')
        const label = clean(titled ? titled[2]! : head)
        flow.groups.push({ id, label, parent: stack.at(-1) })
        stack.push(id)
        continue
      }
      if (statement === 'end') {
        stack.pop()
        continue
      }
      const c: Cursor = { text: statement, at: 0 }
      let left = readGroup(c)
      if (!left) {
        flow.problems.push(`line not read: ${statement}`)
        continue
      }
      left.forEach(note)
      let isRead = true
      for (;;) {
        skipSpace(c)
        if (c.at >= c.text.length) break
        const link = readLink(c)
        const right = link && readGroup(c)
        if (!link || !right) {
          isRead = false
          break
        }
        right.forEach(note)
        for (const a of left) for (const b of right) flow.edges.push({ from: a.id, to: b.id, ...link })
        left = right
      }
      if (!isRead) flow.problems.push(`line not read: ${statement}`)
    }
  }
  return flow
}
