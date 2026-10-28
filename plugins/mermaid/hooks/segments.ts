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
// CommonMark HTML blocks of type 6 run to the next blank line, and a fence inside one is raw HTML.
const HTML_BLOCK =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$)/i

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
  let isComment = false
  let isHtml = false

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
    if (isComment || COMMENT_START.test(raw)) {
      const after: string = isComment ? raw : raw.slice(raw.indexOf('<!--') + 4)
      isComment = !after.includes('-->')
      continue
    }
    if (isHtml || HTML_BLOCK.test(raw)) {
      isHtml = raw.trim() !== ''
      continue
    }
    const { count: quotes, rest: line } = stripQuotes(raw)
    if (quotes > 0) {
      const inner = LIST_ITEM.exec(line)
      const width = inner ? inner[0].length : 0
      const found = opener(inner ? ' '.repeat(width) + line.slice(width) : line, width)
      if (found) open = { ...found, from: at, quotes }
      continue
    }
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
    const raw = fence.quotes > 0 ? fenceLines : fenceLines.map(line => dedent(line, fence.indent))
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
