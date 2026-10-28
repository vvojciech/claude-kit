export type Segment = { kind: 'text'; text: string } | { kind: 'sequence' | 'flow'; source: string; fence: string } | { kind: 'other'; type: string }

export type Fence = { from: number; to: number; source: string; indent: number; quotes: number }

type Open = { char: string; length: number; indent: number; container: number; isMermaid: boolean; from: number; quotes: number; lead: number }

const OPENER = /^( *)(`{3,}|~{3,})(.*)$/
const LIST_ITEM = /^( *)(?:[-*+]|\d{1,9}[.)])( +|$)/
const MERMAID_INFO = /^mermaid(?:[ \t]|$)/

// length of a blockquote marker opening text: up to 3 spaces, `>`, then an optional space
function quoteMark(text: string): number | undefined {
  let at = 0
  while (at < 3 && text[at] === ' ') at++
  if (text[at] !== '>') return undefined
  return text[at + 1] === ' ' ? at + 2 : at + 1
}
const COMMENT_START = /^ {0,3}<!--/
// CommonMark HTML blocks of type 1 hold raw text, blank lines included, up to the first closing tag of any of the four.
const RAW_START = /^ {0,3}<(?:pre|script|style|textarea)(?:[\s>]|$)/i
const RAW_ENDS = ['</pre>', '</script>', '</style>', '</textarea>']
// CommonMark HTML blocks of type 6 run to the next blank line, and a fence inside one is raw HTML.
const HTML_BLOCK =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$)/i

type Place = { quotes: number; lead: number }
type Html = Place & { kind: 'raw' | 'comment' | 'block' }

// HTML opened in a blockquote or list item ends with it: on a line with fewer quote marks, or less indented than the item
function leaves(raw: string, html: Html): boolean {
  const { count, rest } = stripQuotes(raw)
  return count < html.quotes || (html.lead > 0 && rest.trim() !== '' && indentOf(rest) < html.lead)
}

// whether a line belongs to HTML, either the block still open or one it starts, and the block left open after it
function htmlThrough(raw: string, content: string, open: Html | undefined, starts: Html | undefined): { isHtml: boolean; open?: Html } {
  const html = open && !leaves(raw, open) ? open : starts
  if (!html) return { isHtml: false }
  const text = html === open ? raw : content
  if (html.kind === 'raw') return { isHtml: true, open: RAW_ENDS.some(end => text.toLowerCase().includes(end)) ? undefined : html }
  if (html.kind === 'comment') return { isHtml: true, open: (html === open ? text : text.slice(text.indexOf('<!--') + 4)).includes('-->') ? undefined : html }
  return { isHtml: true, open: content.trim() === '' ? undefined : html }
}

function stripQuotes(line: string): { count: number; rest: string } {
  let count = 0
  let rest = line
  for (let mark = quoteMark(rest); mark !== undefined; mark = quoteMark(rest)) {
    rest = rest.slice(mark)
    count++
  }
  return { count, rest }
}

function unquoted(line: string, levels: number, lead = 0): string | undefined {
  if (lead > 0 && indentOf(line) < lead && line.trim() !== '') return undefined
  let rest = dedent(line, lead)
  for (let i = 0; i < levels; i++) {
    const mark = quoteMark(rest)
    if (mark === undefined) return undefined
    rest = rest.slice(mark)
  }
  return rest
}

const indentOf = (line: string) => line.length - line.trimStart().length

const trimBlankLines = (text: string) => text.replace(/^[ \t\n]*\n/, '').replace(/\n[ \t\n]*$/, '')

function dedent(line: string, by: number): string {
  let cut = 0
  while (cut < by && line[cut] === ' ') cut++
  return line.slice(cut)
}

function opener(line: string, container: number): Open | undefined {
  const found = OPENER.exec(line)
  if (!found) return undefined
  const [, spaces = '', marker = '', rest = ''] = found
  const indent = spaces.length
  const [char, info] = [marker.charAt(0), rest.trim()]
  if (indent - container > 3 || indent < container) return undefined
  if (char === '`' && info.includes('`')) return undefined
  return { char, length: marker.length, indent, container, isMermaid: MERMAID_INFO.test(info), from: 0, quotes: 0, lead: 0 }
}

function closes(line: string, open: Open): boolean {
  const indent = indentOf(line)
  const rest = line.trim()
  if (indent - open.container > 3 || rest.length < open.length) return false
  return [...rest].every(char => char === open.char)
}

export function fencesOf(markdown: string): Fence[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const fences: Fence[] = []
  let open: Open | undefined
  let list = 0
  let quotedList = 0
  let html: Html | undefined

  const finish = (at: number, end: number) => {
    if (open?.isMermaid) {
      const { quotes: levels, indent, lead } = open
      const body = lines.slice(open.from + 1, end).map(inner => dedent(unquoted(inner, levels, lead) ?? '', indent))
      fences.push({ from: open.from, to: at, source: body.join('\n'), indent, quotes: levels })
    }
    open = undefined
  }

  for (const [at, raw] of lines.entries()) {
    if (open) {
      const line = unquoted(raw, open.quotes, open.lead)
      if (line === undefined) {
        finish(at - 1, at)
      } else if (open.container > 0 && line.trim() !== '' && indentOf(line) < open.container) {
        finish(at - 1, at)
        list = 0
      } else {
        if (closes(line, open)) finish(at, at)
        continue
      }
    }
    const { count: depth, rest: quoted } = stripQuotes(raw)
    const marker = LIST_ITEM.exec(quoted)
    const content = marker ? quoted.slice(marker[0].length) : quoted
    const inList = depth > 0 ? quotedList : list
    const place: Place = { quotes: depth, lead: marker ? marker[0].length : indentOf(quoted) >= inList ? inList : 0 }
    const kind = RAW_START.test(content) ? 'raw' : COMMENT_START.test(content) ? 'comment' : HTML_BLOCK.test(content) ? 'block' : undefined
    const step = htmlThrough(raw, content, html, kind && { ...place, kind })
    html = step.open
    if (step.isHtml) continue
    const { count: quotes, rest: line } = stripQuotes(raw)
    if (quotes > 0) {
      const inner = LIST_ITEM.exec(line)
      if (inner) quotedList = inner[0].length
      else if (line.trim() !== '' && indentOf(line) < quotedList) quotedList = 0
      const container = inner || indentOf(line) >= quotedList ? quotedList : 0
      const found = opener(inner ? ' '.repeat(quotedList) + line.slice(quotedList) : line, container)
      if (found) open = { ...found, from: at, quotes }
      continue
    }
    quotedList = 0
    const item = LIST_ITEM.exec(line)
    const itemQuotes = item ? stripQuotes(line.slice(item[0].length)) : undefined
    if (item && itemQuotes && itemQuotes.count > 0) {
      list = item[0].length
      const found = opener(itemQuotes.rest, 0)
      if (found) open = { ...found, from: at, quotes: itemQuotes.count, lead: list }
      continue
    }
    if (item) list = item[0].length
    else if (line.trim() !== '' && indentOf(line) < list) list = 0
    const container = item || indentOf(line) >= list ? list : 0
    const found = opener(item ? ' '.repeat(list) + line.slice(list) : line, container)
    if (found) open = { ...found, from: at }
  }

  return fences
}

// Each piece is drawn by its own next(), so a diagram inside a list restarts the list after it.
export function segmentsOf(markdown: string, typeOf: (source: string) => string): Segment[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const parts: Segment[] = []
  let pending: string[] = []
  let at = 0
  const flush = () => {
    const text = trimBlankLines(pending.join('\n'))
    if (text.trim() !== '') parts.push({ kind: 'text', text })
    pending = []
  }
  for (const fence of fencesOf(markdown)) {
    const fenceLines = lines.slice(fence.from, fence.to + 1)
    const raw = fence.quotes > 0 ? fenceLines : fenceLines.map((line, i) => (i === 0 ? line.slice(fence.indent) : dedent(line, fence.indent)))
    pending.push(...lines.slice(at, fence.from))
    at = fence.to + 1
    const type = typeOf(fence.source)
    if (type === 'sequence' || type === 'flow') {
      flush()
      parts.push({ kind: type, source: fence.source, fence: raw.join('\n') })
    } else {
      pending.push(...raw)
      flush()
      parts.push({ kind: 'other', type })
    }
  }
  pending.push(...lines.slice(at))
  flush()
  return parts
}

function isDefinition(line: string): boolean {
  const text = line.trimStart()
  const close = text.indexOf(']:')
  return line.length - text.length < 4 && text.startsWith('[') && close > 1 && !text.slice(1, close).includes(']') && text.slice(close + 2).trim() !== ''
}

// link reference definitions in the prose, for the pieces cut away from them by a diagram
export const definitionsOf = (parts: Segment[]) => parts.flatMap(part => (part.kind === 'text' ? part.text.split('\n').filter(isDefinition).map(line => line.trim()) : []))
