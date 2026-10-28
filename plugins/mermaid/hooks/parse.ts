import { must } from './must'
import { NAMED, withoutControls } from './entities'

export type Arrow = 'filled' | 'open' | 'cross' | 'async' | 'both' | 'half'

export type Participant = { id: string; label: string; kind: 'participant' | 'actor'; box?: number; shape?: string }

export type Step =
  | { kind: 'message'; from: string; to: string; text: string; isDashed: boolean; arrow: Arrow; number?: number }
  | { kind: 'activate'; id: string; isOn: boolean }
  | { kind: 'note'; over: string[]; side: 'left' | 'right' | 'over'; text: string }
  | { kind: 'open'; keyword: string; text: string }
  | { kind: 'branch'; keyword: string; text: string }
  | { kind: 'close' }
  | { kind: 'create'; id: string }
  | { kind: 'destroy'; id: string }

export type Sequence = {
  title?: string
  participants: Participant[]
  steps: Step[]
  problems: string[]
  boxes: { label: string }[]
  unread?: number
}

// each spelling before any that is its prefix, so `-->>` wins over `-->`
const ARROWS_FIRST = ['<<-->>', '<<->>', '--|\\', '--|/', '-|\\', '-|/', '/|--', '\\|--', '/|-', '\\|-', '--\\\\', '--//', '-\\\\', '-//', '//--', '\\\\--', '//-', '\\\\-', '-->>', '->>', '--x', '-x', '--)', '-)', '-->', '->']

function arrowsIn(text: string): Array<{ index: number; arrow: string }> {
  const found: Array<{ index: number; arrow: string }> = []
  for (let index = 0; index < text.length; ) {
    const arrow = ARROWS_FIRST.find(candidate => text.startsWith(candidate, index))
    if (arrow === undefined) index++
    else {
      found.push({ index, arrow })
      index += arrow.length
    }
  }
  return found
}
const PARTICIPANT = /^(create\s+)?(participant|actor)\s+(.+?)(?:\s+as(?:\s+(.*))?)?$/i
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i
const OPEN = /^(loop|alt|opt|par_over|par|critical|break|rect)\b\s*(.*)$/i
const BRANCH = /^(else|and|option)\b\s*(.*)$/i
const ACTIVATE = /^(activate|deactivate)\s+(.+)$/i
const DESTROY = /^destroy\s+(.+)$/i
const AUTONUMBER = /^autonumber\b\s*(.*)$/i
const WRAP = /^\s*(?:no)?wrap:/i
const SPACES = /\s+/
const BOX = /^box\b/i
const HASH_COMMENT = /#.*$/
const ENTITY = /#(\d+|[a-z][a-z0-9]*);/gi
const ENTITY_MARK = '\ue000'
const MAX_EXAMPLE = 30
const BRANCH_OF: Record<string, string> = { else: 'alt', and: 'par', option: 'critical' }
const BLOCK_WORDS = new Set(['loop', 'alt', 'opt', 'par_over', 'par', 'critical', 'break', 'rect', 'else', 'and', 'option'])
const IGNORED_WORDS = new Set(['link', 'links', 'properties', 'details'])
// Mermaid's lexer reads these as keywords wherever an id could go; `title` and the acc* words only
// at the start of a line, so they still work as a sender. Derived from the 11.16 parser.
const SENDER_KEYWORDS = new Set(
  (
    'participant actor create destroy activate deactivate autonumber off over box loop alt opt par par_over critical ' +
    'break rect else and option end note links link details properties sequencediagram'
  ).split(' '),
)
const KEYWORDS = new Set([...SENDER_KEYWORDS, 'title', 'acctitle', 'accdescr'])
const COLOUR_FUNCTION = /^\s*(rgba?|hsla?)\([^)]*\)\s*/i
const COLOUR_HEX = /^\s*#[0-9a-f]{3,8}\b\s*/i
const COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue ' +
    'chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey ' +
    'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray ' +
    'darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen ' +
    'fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen ' +
    'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke ' +
    'yellow yellowgreen transparent'
  ).split(' '),
)

const SHAPES = new Set(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'])
const METADATA = /@\{(.*)\}\s*$/

const HALF = (isDashed: boolean, isReversed = false) => ({ isDashed, arrow: 'half' as const, ...(isReversed ? { isReversed } : {}) })

const ARROWS: Record<string, { isDashed: boolean; arrow: Arrow; isReversed?: boolean }> = {
  '-|\\': HALF(false),
  '--|\\': HALF(true),
  '-|/': HALF(false),
  '--|/': HALF(true),
  '-\\\\': HALF(false),
  '--\\\\': HALF(true),
  '-//': HALF(false),
  '--//': HALF(true),
  '/|-': HALF(false, true),
  '/|--': HALF(true, true),
  '\\|-': HALF(false, true),
  '\\|--': HALF(true, true),
  '//-': HALF(false, true),
  '//--': HALF(true, true),
  '\\\\-': HALF(false, true),
  '\\\\--': HALF(true, true),
  '->>': { isDashed: false, arrow: 'filled' },
  '-->>': { isDashed: true, arrow: 'filled' },
  '->': { isDashed: false, arrow: 'open' },
  '-->': { isDashed: true, arrow: 'open' },
  '-x': { isDashed: false, arrow: 'cross' },
  '--x': { isDashed: true, arrow: 'cross' },
  '-)': { isDashed: false, arrow: 'async' },
  '--)': { isDashed: true, arrow: 'async' },
  '<<->>': { isDashed: false, arrow: 'both' },
  '<<-->>': { isDashed: true, arrow: 'both' },
}


const BREAK = /<br\s*\/?>/gi

const REPLACEMENT = '�'

const isDrawable = (point: number) =>
  point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) && !(point < 0x20 || (point >= 0x7f && point < 0xa0))

const codePoint = (code: string) => {
  const point = Number(code)
  return isDrawable(point) ? String.fromCodePoint(point) : REPLACEMENT
}

const decode = (text: string) =>
  text.replace(/\ue000(\d+|[a-z][a-z0-9]*)\ue000/gi, (_whole, code: string) =>
    /^\d+$/.test(code) ? codePoint(code) : (NAMED[code] ?? NAMED[code.toLowerCase()] ?? `#${code};`),
  )

const clean = (text: string) => decode(text.replace(BREAK, ' ')).replace(/\s+/g, ' ').trim()

const cleanLines = (text: string) =>
  text
    .split(BREAK)
    .map(part => decode(part).replace(/\s+/g, ' ').trim())
    .filter(part => part !== '')
    .join('\n')

const unquote = (text: string) => text.trim().replace(/^"(.*)"$/, '$1')

const idOf = (text: string) => text.replace(/@\{.*\}$/, '').trim()

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

const lineList = (lines: number[]) => `${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}`

function boxLabel(text: string): string {
  const rest = text.replace(COLOUR_FUNCTION, '').replace(COLOUR_HEX, '')
  if (rest !== text) return clean(rest)
  const [first = '', ...others] = text.trim().split(/\s+/)
  return COLOURS.has(first.toLowerCase()) ? clean(others.join(' ')) : clean(text)
}

export function isSequence(source: string): boolean {
  return kindOf(source) === 'sequenceDiagram'
}

export function kindOf(source: string): string {
  return body(source).header.split(SPACES)[0] ?? ''
}

function isComment(line: string): boolean {
  return line.startsWith('%%')
}

type Line = { text: string; line: number }

type Body = { title?: string; header: string; lines: Line[] }

function body(source: string): Body {
  const lines = withoutControls(source).split('\n').map((text, i) => ({ text: text.trim(), line: i + 1 }))
  let title: string | undefined
  let at = lines.findIndex(line => line.text !== '')
  if (lines[at]?.text === '---') {
    const close = lines.findIndex((line, i) => i > at && line.text === '---')
    if (close > at) {
      for (const { text } of lines.slice(at + 1, close)) {
        const found = /^title\s*:\s*(.+)$/.exec(text)
        if (found) title = unquote(must(found[1], 'title'))
      }
      at = close + 1
    }
  }
  const rest = lines.slice(Math.max(0, at))
  const start = rest.findIndex(line => line.text !== '' && !isComment(line.text))
  const first = rest[start]
  const inline = first && /^sequenceDiagram\s+(\S.*)$/.exec(first.text)
  if (first && inline) return { title, header: 'sequenceDiagram', lines: [{ text: must(inline[1], 'inline statement'), line: first.line }, ...rest.slice(start + 1)] }

  return { title, header: first?.text ?? '', lines: start >= 0 ? rest.slice(start + 1) : [] }
}

function statements(lines: Line[]): Line[] {
  return lines.flatMap(({ text, line }) => {
    if (isComment(text)) return []
    const marked = text.replace(ENTITY, (_, code: string) => `${ENTITY_MARK}${code}${ENTITY_MARK}`)
    const uncommented = BOX.test(marked) ? marked : marked.replace(HASH_COMMENT, '')
    return uncommented
      .split(';')
      .map(part => part.trim())
      .filter(part => part !== '' && !isComment(part))
      .map(part => ({ text: part, line }))
  })
}

const isSpace = (char: string | undefined) => char !== undefined && char.trim() === ''
const isWordChar = (char: string | undefined) => char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char === '_')

// the word a statement opens with at `from`, lowercased
function wordAt(line: string, from = 0): string {
  let end = from
  while (isWordChar(line[end])) end++
  return line.slice(from, end).toLowerCase()
}

const isIgnored = (line: string) => {
  const word = wordAt(line)
  return IGNORED_WORDS.has(word) || ((word === 'acctitle' || word === 'accdescr') && line[skipSpaces(line, word.length)] === ':')
}

const isDescriptionBlock = (line: string) => wordAt(line) === 'accdescr' && line[skipSpaces(line, 'accdescr'.length)] === '{'

const isBlockLine = (line: string) => {
  const word = wordAt(line)
  return BLOCK_WORDS.has(word) && isSpace(line[word.length])
}

// where a `participant` or `actor` declaration, `create` or not, ends its keyword
function participantKeywordEnd(line: string): number | undefined {
  let at = 0
  let word = wordAt(line)
  if (word === 'create' && isSpace(line[word.length])) {
    at = skipSpaces(line, word.length)
    word = wordAt(line, at)
  }
  if (word !== 'participant' && word !== 'actor') return undefined
  return isSpace(line[at + word.length]) ? at + word.length : undefined
}

const endsWithAs = (text: string) => isSpace(text.at(-3)) && text.slice(-2).toLowerCase() === 'as'

// a space after the keyword and at least one character after that, as a declaration needs
const declaresParticipant = (line: string) => {
  const end = participantKeywordEnd(line)
  return end !== undefined && line.length >= end + 2
}

function skipSpaces(text: string, at: number): number {
  let next = at
  while (isSpace(text[next])) next++
  return next
}

// what follows an arrow: `()` and a `+`/`-` activation mark, either order, before the receiver
type AfterArrow = { mark: string; to: string; isCentral: boolean }

function afterArrow(tail: string): AfterArrow {
  let at = skipSpaces(tail, 0)
  const opensCentral = tail.startsWith('()', at)
  if (opensCentral) at = skipSpaces(tail, at + 2)
  const char = tail[at]
  const mark = char === '+' || char === '-' ? char : ''
  if (mark !== '') at = skipSpaces(tail, at + 1)
  const closesCentral = tail.startsWith('()', at)
  if (closesCentral) at += 2
  return { mark, to: tail.slice(at).trim(), isCentral: opensCentral || closesCentral }
}

function sender(before: string): string {
  const trimmed = before.trim()
  return (trimmed.endsWith('()') ? trimmed.slice(0, -2) : trimmed).trim()
}

type Found = { from: string; to: string; arrow: string; mark: string; text: string; hasColon: boolean; isInsideName: boolean; isCentral: boolean; isMalformed: boolean }

function message(statement: string, known: Map<string, Participant>): Found | undefined {
  const colon = statement.indexOf(':')
  const head = colon < 0 ? statement : statement.slice(0, colon)
  const text = colon < 0 ? '' : statement.slice(colon + 1)
  const candidates = arrowsIn(head).flatMap(match => {
    const before = head.slice(0, match.index)
    const from = sender(before)
    const tail = head.slice(match.index + match.arrow.length)
    const { mark, to, isCentral: isCentralAfter } = afterArrow(tail)
    const isInsideName = match.arrow.endsWith('x') && isWordChar(tail[0]) && isWordChar(from.at(-1))
    const isCentral = before.trimEnd().endsWith('()') || isCentralAfter
    const isMalformed = !isEndpoint(from, SENDER_KEYWORDS) || !isEndpoint(to)
    return from !== '' && to !== '' ? [{ from, to, arrow: match.arrow, mark, text, hasColon: colon >= 0, isInsideName, isCentral, isMalformed }] : []
  })
  const wellFormed = candidates.filter(c => !c.isMalformed)
  if (wellFormed.length === 0) return candidates[0]
  const ranked = [...wellFormed.filter(c => !c.isInsideName), ...wellFormed.filter(c => c.isInsideName)]
  return ranked.find(c => known.has(c.from) && known.has(c.to)) ?? ranked.find(c => known.has(c.from)) ?? ranked[0]
}

// Mermaid's actor token stops at these, so an endpoint holding one is a malformed arrow, not a name.
const isName = (id: string) => !/[<>:,]/.test(idOf(id)) && !/^[-+]|[-+]$/.test(idOf(id))
const isEndpoint = (id: string, keywords = KEYWORDS) => isName(id) && !keywords.has(idOf(id).toLowerCase())

type Counter = { next: number; step: number; isVisible: boolean }

// Mermaid counts every message from 1 whether or not numbers show; `autonumber` only moves the
// counter when it names a start, and `off` hides numbers without stopping the count.
function renumber(counter: Counter, args: string): void {
  if (/^off\b/i.test(args)) {
    counter.isVisible = false
    return
  }
  const [start = NaN, step = NaN] = args === '' ? [] : args.split(SPACES).map(Number)
  if (Number.isFinite(start) && start !== 0) counter.next = start
  if (Number.isFinite(step) && step !== 0) counter.step = step
  counter.isVisible = true
}

const unwrapped = (text: string) => text.replace(WRAP, '')

type Metadata = { type?: string; alias?: string }

function metadataOf(declared: string, id: string, at: number, problems: string[]): Metadata {
  const inner = METADATA.exec(declared)?.[1]
  if (inner === undefined) return {}
  const fields = fieldsOf(inner)
  if (fields === undefined) {
    problems.push(`line ${at}: metadata on ${id} not understood`)
    return {}
  }
  const type = typeof fields.type === 'string' ? fields.type.toLowerCase() : undefined
  if (type !== undefined && !SHAPES.has(type)) problems.push(`line ${at}: participant type "${fields.type}" not known`)
  const alias = typeof fields.alias === 'string' ? fields.alias : undefined

  return { ...(type === undefined ? {} : { type }), ...(alias === undefined ? {} : { alias }) }
}

function fieldsOf(inner: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(`{${inner}}`)
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
  } catch {
    // Mermaid reads the braces as a YAML flow mapping; fall through to that.
  }

  return flowMapping(inner)
}

const FLOW_PART = /(?:"[^"]*"|'[^']*'|[^,])+/g
const FLOW_ENTRY = /^\s*(?:"([^"]*)"|'([^']*)'|([^"':,][^:,]*?))\s*(?::(?:\s+|$)|(?<=["'])\s*:)(.*)$/

// A YAML flow mapping: `key: value` pairs split on commas outside quotes. An unquoted key needs a
// space after its colon, as in YAML, so `type:queue` is a key with no value.
function flowMapping(inner: string): Record<string, unknown> | undefined {
  const parts = inner.match(FLOW_PART) ?? []
  const fields: Record<string, unknown> = {}
  for (const part of parts.filter(part => part.trim() !== '')) {
    const entry = FLOW_ENTRY.exec(part)
    if (!entry) return undefined
    const key = (entry[1] ?? entry[2] ?? entry[3] ?? '').trim()
    const value = must(entry[4], 'flow mapping value').trim()
    if (value !== '') fields[key] = unquote(value.replace(/^'(.*)'$/, '"$1"'))
  }

  return fields
}

type Opened = { kind: 'box' | 'block'; keyword: string; line: number }

type Tally = { header: string; isEmpty: boolean; rejected: number; unknown: string[]; lineProblems: string[]; links: number[]; blocks: Opened[]; extraEnds: number }

type Summary = { problems: string[]; unread: number }

function summary(tally: Tally): Summary {
  const { header, rejected, unknown, links, blocks, extraEnds } = tally
  const problems: string[] = []
  if (header === '') problems.push('no diagram type (mermaid.live rejects)')
  else if (tally.isEmpty && rejected === 0 && unknown.length === 0) problems.push('empty diagram')
  if (unknown.length > 0) {
    const examples = unknown
      .slice(0, 2)
      .map(line => `\`${line.length > MAX_EXAMPLE ? `${line.slice(0, MAX_EXAMPLE - 1)}…` : line}\``)
      .join(', ')
    problems.push(`${plural(unknown.length, 'line')} not understood: ${examples}`)
  }
  problems.push(...tally.lineProblems)
  if (links.length > 0) problems.push(`links not shown (${lineList(links)})`)
  const openedOn = (kind: 'box' | 'block') => blocks.filter(block => block.kind === kind).map(block => block.line)
  const unclosed = openedOn('block').length
  if (unclosed > 0) problems.push(`${plural(unclosed, 'block')} not closed, opened on ${lineList(openedOn('block'))} (mermaid.live rejects)`)
  const unclosedBoxes = openedOn('box').length
  if (unclosedBoxes > 0) {
    problems.push(`${plural(unclosedBoxes, 'box', 'boxes')} not closed, opened on ${lineList(openedOn('box'))} (mermaid.live rejects)`)
  }
  if (extraEnds > 0) problems.push(`${plural(extraEnds, 'extra end')} (mermaid.live rejects)`)

  const unread =
    unknown.length + rejected + unclosed + unclosedBoxes + extraEnds + (header !== 'sequenceDiagram' ? 1 : 0)
  return { problems, unread }
}

function applyType(participant: Participant, kind: Participant['kind'], type: string | undefined): void {
  participant.kind = type === 'actor' ? 'actor' : kind
  if (type !== undefined && type !== 'actor' && type !== 'participant') participant.shape = type
}

export function parseSequence(source: string): Sequence {
  const participants: Participant[] = []
  const steps: Step[] = []
  const boxes: { label: string }[] = []
  const known = new Map<string, Participant>()
  const blocks: Opened[] = []
  const unknown: string[] = []
  let rejected = 0
  const lineProblems: string[] = []
  const links: number[] = []
  const active = new Map<string, number>()
  const doomed = new Map<string, number>()
  const gone = new Set<string>()
  const { title: frontTitle, header, lines } = body(source)
  if (header !== '' && header !== 'sequenceDiagram') lineProblems.push(`not a sequenceDiagram: \`${header.slice(0, MAX_EXAMPLE)}\``)
  let title = frontTitle
  const counter: Counter = { next: 1, step: 1, isVisible: false }
  let created: string | undefined
  let isDescribing = false
  let box: number | undefined
  let extraEnds = 0

  const meet = (id: string, label = id, kind: Participant['kind'] = 'participant') => {
    const existing = known.get(id)
    if (existing) return existing
    const participant: Participant = { id, label: clean(label) || id, kind, ...(box === undefined ? {} : { box }) }
    known.set(id, participant)
    participants.push(participant)
    return participant
  }

  const reject = (at: number, problem: string) => {
    lineProblems.push(`line ${at}: ${problem} (mermaid.live rejects)`)
    rejected++
  }

  // Mermaid tracks activation on any id and draws it once that id is a participant, even one first
  // named by a later message; bars for ids that never become participants are dropped at the end.
  const activate = (id: string, isOn: boolean, line: number) => {
    const depth = active.get(id) ?? 0
    if (!isOn && depth === 0) {
      reject(line, `deactivate ${id} while inactive`)
      return
    }
    active.set(id, depth + (isOn ? 1 : -1))
    steps.push({ kind: 'activate', id, isOn })
  }

  const settleDoomed = (ids: string[], at: number) => {
    for (const id of [...doomed.keys()]) {
      doomed.delete(id)
      if (!ids.includes(id)) {
        reject(at, `the message after destroy ${id} must involve ${id}`)
        continue
      }
      steps.push({ kind: 'destroy', id })
      gone.add(id)
    }
  }

  const sendMessage = (found: Found, at: number) => {
    if (found.isMalformed) {
      reject(at, `arrow \`${`${found.from}${found.arrow}${found.to}`.slice(0, MAX_EXAMPLE)}\` not understood`)
      return
    }
    const bad = [found.from, found.to].map(idOf).find(id => /^[()]/.test(id))
    if (bad !== undefined) {
      reject(at, `participant \`${bad.slice(0, MAX_EXAMPLE)}\` cannot start with a parenthesis`)
      return
    }
    if (box !== undefined) {
      reject(at, 'only participants can be declared inside a box')
      return
    }
    const written = { from: meet(idOf(found.from)).id, to: meet(idOf(found.to)).id }
    const { isReversed = false, ...arrow } = must(ARROWS[found.arrow], `arrow ${found.arrow}`)
    const [from, to] = isReversed ? [written.to, written.from] : [written.from, written.to]
    if (!found.hasColon) reject(at, "message without ':'")
    if (created !== undefined && written.to !== created) reject(at, `the message after create ${created} must go to ${created}`)
    created = undefined
    if (found.isCentral) lineProblems.push(`line ${at}: central connection () not drawn`)
    for (const id of [...new Set([from, to])].filter(id => gone.has(id))) {
      lineProblems.push(`line ${at}: message touches ${id} after destroy`)
    }
    const number = counter.isVisible ? counter.next : undefined
    counter.next = Math.round((counter.next + counter.step) * 100) / 100
    steps.push({
      kind: 'message',
      from,
      to,
      text: cleanLines(unwrapped(found.text)),
      ...arrow,
      ...(number === undefined ? {} : { number }),
    })
    if (found.mark === '+') activate(written.to, true, at)
    if (found.mark === '-') activate(written.from, false, at)
    settleDoomed([from, to], at)
  }

  const closeBlock = () => {
    const closed = blocks.pop()
    if (closed === undefined) extraEnds++
    else if (closed.kind === 'block') steps.push({ kind: 'close' })
    else box = undefined
  }

  const openBox = (line: string, at: number) => {
    if (box !== undefined) {
      reject(at, 'box inside a box')
      return
    }
    blocks.push({ kind: 'box', keyword: 'box', line: at })
    box = boxes.push({ label: boxLabel(line.slice(3)) }) - 1
  }

  const readFrame = (line: string, at: number): boolean => {
    if (isIgnored(line)) {
      const word = wordAt(line)
      if (word === 'link' || word === 'links') links.push(at)
      return true
    }
    const autonumber = AUTONUMBER.exec(line)
    if (autonumber) {
      renumber(counter, autonumber[1] ?? '')
      return true
    }
    if (wordAt(line) === 'title') {
      title = clean(line.slice(5).replace(/^\s*:/, ''))
      return true
    }
    if (line.toLowerCase() === 'end') {
      closeBlock()
      return true
    }
    const isBox = wordAt(line) === 'box'
    if (box !== undefined && !declaresParticipant(line) && !isBox) {
      reject(at, 'only participants can be declared inside a box')
      return true
    }
    if (isBox) openBox(line, at)
    return isBox
  }

  const declareParticipant = (line: string, at: number, declared: RegExpExecArray) => {
    const [, create, keyword, named, label] = declared
    const kind = must(keyword, 'participant keyword').toLowerCase() === 'actor' ? 'actor' : 'participant'
    // A quoted name takes the rest of the line in mermaid, `as` included.
    const rest = line.slice(skipSpaces(line, must(participantKeywordEnd(line), 'participant keyword')))
    const isQuoted = rest.startsWith('"')
    const name = isQuoted ? rest : must(named, 'participant name')
    const id = idOf(name)
    const written = isQuoted ? undefined : (label ?? (endsWithAs(rest) ? '' : undefined))
    if (!isName(id)) {
      reject(at, `participant \`${id.slice(0, MAX_EXAMPLE)}\` not understood`)
      return
    }
    if (create && known.has(id)) {
      reject(at, `create ${id} after ${id} was already used`)
      return
    }
    const metadata = metadataOf(name, id, at, lineProblems)
    const isNew = !known.has(id)
    const participant = meet(id, written ?? id, kind)
    if (isNew) applyType(participant, kind, metadata.type)
    const alias = written ?? metadata.alias
    if (alias !== undefined) participant.label = cleanLines(alias)
    if (create) {
      steps.push({ kind: 'create', id })
      created = id
    }
  }

  const annotate = (at: number, note: RegExpExecArray) => {
    const [, place, named, text] = note
    const where = must(place, 'note side').toLowerCase()
    const side = where.startsWith('left') ? 'left' : where.startsWith('right') ? 'right' : 'over'
    const names = [...new Set(must(named, 'note participants').split(',').map(name => idOf(name.trim())))]
    const keyword = names.find(name => !isEndpoint(name))
    if (keyword !== undefined) {
      reject(at, `note on \`${keyword.slice(0, MAX_EXAMPLE)}\` not understood`)
      return
    }
    if (names.length > 2) {
      reject(at, 'note over takes at most two participants')
      return
    }
    const over = names.map(name => meet(name).id)
    if (side !== 'over' && over.length > 1) {
      reject(at, `note ${where} takes one participant`)
      return
    }
    steps.push({ kind: 'note', over, side, text: cleanLines(unwrapped(text ?? '')) })
  }

  const branchOff = (at: number, branch: RegExpExecArray) => {
    const keyword = must(branch[1], 'branch keyword').toLowerCase()
    const parent = BRANCH_OF[keyword]
    const inside = blocks.findLast(block => block.kind === 'block')?.keyword
    if (inside !== parent && !(keyword === 'and' && inside === 'par_over')) {
      reject(at, `${keyword} outside ${parent}`)
      return
    }
    steps.push({ kind: 'branch', keyword, text: clean(branch[2] ?? '') })
  }

  const readStep = (line: string, at: number): boolean => {
    const declared = PARTICIPANT.exec(line)
    if (declared) {
      declareParticipant(line, at, declared)
      return true
    }
    const destroyed = DESTROY.exec(line)
    if (destroyed) {
      doomed.set(meet(idOf(must(destroyed[1], 'destroyed participant'))).id, steps.length)
      return true
    }
    const activation = ACTIVATE.exec(line)
    if (activation) {
      const [, toggle, id] = activation
      activate(idOf(must(id, 'activated participant')), must(toggle, 'activation').toLowerCase() === 'activate', at)
      return true
    }
    const note = NOTE.exec(line)
    if (note) {
      annotate(at, note)
      return true
    }
    const opened = OPEN.exec(line)
    if (opened) {
      const keyword = must(opened[1], 'block keyword').toLowerCase()
      blocks.push({ kind: 'block', keyword, line: at })
      steps.push({ kind: 'open', keyword, text: keyword === 'rect' ? '' : clean(opened[2] ?? '') })
      return true
    }
    const branch = BRANCH.exec(line)
    if (branch) branchOff(at, branch)
    return branch !== null
  }

  const read = (line: string, at: number) => {
    if (isDescribing) {
      isDescribing = !line.includes('}')
      return
    }
    const beyond = [...line.matchAll(/(\d+)/g)].find(found => Number(found[1]) > 0x10ffff)
    if (beyond) {
      reject(at, `character code #${beyond[1]}; is out of range`)
      return
    }
    if (isDescriptionBlock(line)) {
      isDescribing = !line.includes('}')
      return
    }
    const declaration = PARTICIPANT.exec(line)
    const isPlainDeclaration = declaration !== null && arrowsIn(must(declaration[3], 'participant name')).length === 0
    const found = isPlainDeclaration || isBlockLine(line) ? undefined : message(line, known)
    if (found && !found.isInsideName) {
      sendMessage(found, at)
      return
    }
    if (readFrame(line, at) || readStep(line, at)) return
    if (found) sendMessage(found, at)
    else unknown.push(decode(line))
  }

  for (const { text: line, line: at } of statements(lines)) read(line, at)

  for (const [id, index] of [...doomed].sort((a, b) => b[1] - a[1])) steps.splice(index, 0, { kind: 'destroy', id })
  const shown = steps.filter(step => step.kind !== 'activate' || known.has(step.id))
  const isEmpty = participants.length === 0 && steps.length === 0
  const { problems, unread } = summary({ header, isEmpty, rejected, unknown, lineProblems, links, blocks, extraEnds })
  return { title, participants, steps: shown, problems, boxes, ...(unread > 0 ? { unread } : {}) }
}
