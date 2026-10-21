import { fencesOf } from './segments'

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

const ARROW = /<<-->>|<<->>|--\|\\|--\|\/|-\|\\|-\|\/|\/\|--|\\\|--|\/\|-|\\\|-|--\\\\|--\/\/|-\\\\|-\/\/|\/\/--|\\\\--|\/\/-|\\\\-|-->>|->>|--x|-x|--\)|-\)|-->|->/g
const PARTICIPANT = /^(create\s+)?(participant|actor)\s+(.+?)(?:\s+as(?:\s+(.*))?)?$/i
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i
const OPEN = /^(loop|alt|opt|par_over|par|critical|break|rect)\b\s*(.*)$/i
const BRANCH = /^(else|and|option)\b\s*(.*)$/i
const ACTIVATE = /^(activate|deactivate)\s+(.+)$/i
const DESTROY = /^destroy\s+(.+)$/i
const AUTONUMBER = /^autonumber\b\s*(.*)$/i
const IGNORED = /^(links?\b|properties\b|details\b|acctitle\s*:|accdescr\s*:)/i
const DESCRIPTION_BLOCK = /^accdescr\s*\{/i
const WRAP = /^\s*(?:no)?wrap:/i
const ENTITY = /#(\d+|[a-z][a-z0-9]*);/gi
const ENTITY_MARK = '\u0000'
const MAX_EXAMPLE = 30
const BRANCH_OF: Record<string, string> = { else: 'alt', and: 'par', option: 'critical' }
const BLOCK_LINE = /^(loop|alt|opt|par_over|par|critical|break|rect|else|and|option)\s/i
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

const NAMED: Record<string, string> = {
  quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'", infin: '∞', rarr: '→', larr: '←', uarr: '↑',
  darr: '↓', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔', hellip: '…', mdash: '—', ndash: '–', copy: '©',
  reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷', le: '≤', ge: '≥', ne: '≠',
  middot: '·', bull: '•', laquo: '«', raquo: '»', euro: '€', pound: '£', check: '✓', cross: '✗',
  colon: ':', semi: ';', num: '#', excl: '!', quest: '?', lpar: '(', rpar: ')', lsqb: '[', rsqb: ']', lbrack: '[',
  rbrack: ']', lcub: '{', rcub: '}', lbrace: '{', rbrace: '}', ast: '*', plus: '+', comma: ',', period: '.', sol: '/',
  bsol: '\\', verbar: '|', vert: '|', equals: '=', percnt: '%', dollar: '$', commat: '@', Hat: '^', lowbar: '_',
  grave: '`', tilde: '~', sect: '§', para: '¶', micro: 'µ', cent: '¢', yen: '¥', frac12: '½', frac14: '¼', frac34: '¾',
  sup1: '¹', sup2: '²', sup3: '³', iexcl: '¡', iquest: '¿', ensp: ' ', emsp: ' ', thinsp: ' ', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″', larrhk: '↩', crarr: '↵',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ',
  phi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  sum: '∑', prod: '∏', radic: '√', int: '∫', part: '∂', nabla: '∇', isin: '∈', notin: '∉', cap: '∩', cup: '∪',
  sub: '⊂', sup: '⊃', and: '∧', or: '∨', not: '¬', forall: '∀', exist: '∃', empty: '∅', equiv: '≡', asymp: '≈',
  prop: '∝', minus: '−', lowast: '∗', sdot: '⋅', loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
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
  text.replace(/\u0000(\d+|[a-z][a-z0-9]*)\u0000/gi, (whole, code: string) =>
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

export function mermaidBlocks(markdown: string): string[] {
  return fencesOf(markdown).map(fence => fence.source)
}

export function isSequence(source: string): boolean {
  return kindOf(source) === 'sequenceDiagram'
}

export function kindOf(source: string): string {
  return body(source).header.split(/\s+/)[0] ?? ''
}

function isComment(line: string): boolean {
  return line.startsWith('%%')
}

type Line = { text: string; line: number }

function body(source: string): { title?: string; header: string; lines: Line[] } {
  const lines = source.split('\n').map((text, i) => ({ text: text.trim(), line: i + 1 }))
  let title: string | undefined
  let at = lines.findIndex(line => line.text !== '')
  if (lines[at]?.text === '---') {
    const close = lines.findIndex((line, i) => i > at && line.text === '---')
    if (close > at) {
      for (const { text } of lines.slice(at + 1, close)) {
        const found = /^title\s*:\s*(.+)$/.exec(text)
        if (found) title = unquote(found[1]!)
      }
      at = close + 1
    }
  }
  const rest = lines.slice(Math.max(0, at))
  const start = rest.findIndex(line => line.text !== '' && !isComment(line.text))
  const first = rest[start]
  const inline = first && /^sequenceDiagram\s+(\S.*)$/.exec(first.text)
  if (first && inline) return { title, header: 'sequenceDiagram', lines: [{ text: inline[1]!, line: first.line }, ...rest.slice(start + 1)] }

  return { title, header: first?.text ?? '', lines: start < 0 ? [] : rest.slice(start + 1) }
}

function statements(lines: Line[]): Line[] {
  return lines.flatMap(({ text, line }) => {
    if (isComment(text)) return []
    const marked = text.replace(ENTITY, (_, code: string) => `${ENTITY_MARK}${code}${ENTITY_MARK}`)
    const uncommented = /^box\b/i.test(marked) ? marked : marked.replace(/#.*$/, '')
    return uncommented
      .split(';')
      .map(part => part.trim())
      .filter(part => part !== '' && !isComment(part))
      .map(part => ({ text: part, line }))
  })
}

type Found = { from: string; to: string; arrow: string; mark: string; text: string; hasColon: boolean; isInsideName: boolean; isCentral: boolean; isMalformed: boolean }

function message(statement: string, known: Map<string, Participant>): Found | undefined {
  const colon = statement.indexOf(':')
  const head = colon < 0 ? statement : statement.slice(0, colon)
  const text = colon < 0 ? '' : statement.slice(colon + 1)
  const candidates = [...head.matchAll(ARROW)].flatMap(match => {
    const from = head.slice(0, match.index).trim().replace(/\(\)$/, '').trim()
    const tail = head.slice(match.index + match[0].length)
    const mark = /^\s*(?:\(\))?\s*([+-])/.exec(tail)?.[1] ?? ''
    const to = tail.replace(/^\s*(?:\(\))?\s*[+-]?\s*(?:\(\))?/, '').trim()
    const isInsideName = match[0].endsWith('x') && /^\w/.test(tail) && /\w$/.test(from)
    const isCentral = /\(\)\s*$/.test(head.slice(0, match.index)) || /^\s*[+-]?\s*\(\)/.test(tail)
    const isMalformed = !isEndpoint(from, SENDER_KEYWORDS) || !isEndpoint(to)
    return from !== '' && to !== '' ? [{ from, to, arrow: match[0], mark, text, hasColon: colon >= 0, isInsideName, isCentral, isMalformed }] : []
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
  const [start = NaN, step = NaN] = args === '' ? [] : args.split(/\s+/).map(Number)
  if (Number.isFinite(start) && start !== 0) counter.next = start
  if (Number.isFinite(step) && step !== 0) counter.step = step
  counter.isVisible = true
}

const unwrapped = (text: string) => text.replace(WRAP, '')

function metadataOf(declared: string, id: string, at: number, problems: string[]): { type?: string; alias?: string } {
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

const FLOW_ENTRY = /^\s*(?:"([^"]*)"|'([^']*)'|([^"':,][^:,]*?))\s*(?::(?:\s+|$)|(?<=["'])\s*:)(.*)$/

// A YAML flow mapping: `key: value` pairs split on commas outside quotes. An unquoted key needs a
// space after its colon, as in YAML, so `type:queue` is a key with no value.
function flowMapping(inner: string): Record<string, unknown> | undefined {
  const parts = inner.match(/(?:"[^"]*"|'[^']*'|[^,])+/g) ?? []
  const fields: Record<string, unknown> = {}
  for (const part of parts.filter(part => part.trim() !== '')) {
    const entry = FLOW_ENTRY.exec(part)
    if (!entry) return undefined
    const key = (entry[1] ?? entry[2] ?? entry[3] ?? '').trim()
    const value = entry[4]!.trim()
    if (value !== '') fields[key] = unquote(value.replace(/^'(.*)'$/, '"$1"'))
  }

  return fields
}

export function parseSequence(source: string): Sequence {
  const participants: Participant[] = []
  const steps: Step[] = []
  const boxes: { label: string }[] = []
  const known = new Map<string, Participant>()
  const blocks: { kind: 'box' | 'block'; keyword: string; line: number }[] = []
  const unknown: string[] = []
  let rejected = 0
  const lineProblems: string[] = []
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
    const { isReversed = false, ...arrow } = ARROWS[found.arrow]!
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

  for (const { text: line, line: at } of statements(lines)) {
    if (isDescribing) {
      isDescribing = !line.includes('}')
      continue
    }
    const beyond = [...line.matchAll(/\u0000(\d+)\u0000/g)].find(found => Number(found[1]) > 0x10ffff)
    if (beyond) {
      reject(at, `character code #${beyond[1]}; is out of range`)
      continue
    }
    if (DESCRIPTION_BLOCK.test(line)) {
      isDescribing = !line.includes('}')
      continue
    }
    const declaration = PARTICIPANT.exec(line)
    const isPlainDeclaration = declaration !== null && !new RegExp(ARROW.source).test(declaration[3]!)
    const found = isPlainDeclaration || BLOCK_LINE.test(line) ? undefined : message(line, known)
    if (found && !found.isInsideName) {
      sendMessage(found, at)
      continue
    }
    if (IGNORED.test(line)) continue
    const autonumber = AUTONUMBER.exec(line)
    if (autonumber) {
      renumber(counter, autonumber[1] ?? '')
      continue
    }
    if (/^title\b/i.test(line)) {
      title = clean(line.slice(5).replace(/^\s*:/, ''))
      continue
    }
    if (line.toLowerCase() === 'end') {
      const closed = blocks.pop()
      if (closed === undefined) extraEnds++
      else if (closed.kind === 'block') steps.push({ kind: 'close' })
      else box = undefined
      continue
    }
    const isDeclaration = PARTICIPANT.test(line)
    if (box !== undefined && !isDeclaration && !/^box\b/i.test(line)) {
      reject(at, 'only participants can be declared inside a box')
      continue
    }
    if (/^box\b/i.test(line)) {
      if (box !== undefined) {
        reject(at, 'box inside a box')
        continue
      }
      blocks.push({ kind: 'box', keyword: 'box', line: at })
      box = boxes.push({ label: boxLabel(line.slice(3)) }) - 1
      continue
    }
    const declared = PARTICIPANT.exec(line)
    if (declared) {
      const kind = declared[2]!.toLowerCase() === 'actor' ? 'actor' : 'participant'
      // A quoted name takes the rest of the line in mermaid, `as` included.
      const rest = line.replace(/^(?:create\s+)?(?:participant|actor)\s+/i, '')
      const isQuoted = rest.startsWith('"')
      const id = idOf(isQuoted ? rest : declared[3]!)
      const written = isQuoted ? undefined : (declared[4] ?? (/\sas$/i.test(rest) ? '' : undefined))
      if (!isName(id)) {
        reject(at, `participant \`${id.slice(0, MAX_EXAMPLE)}\` not understood`)
        continue
      }
      if (declared[1] && known.has(id)) {
        reject(at, `create ${id} after ${id} was already used`)
        continue
      }
      const metadata = metadataOf(isQuoted ? rest : declared[3]!, id, at, lineProblems)
      const isNew = !known.has(id)
      const participant = meet(id, written ?? id, kind)
      if (isNew) {
        participant.kind = metadata.type === 'actor' ? 'actor' : kind
        if (metadata.type !== undefined && metadata.type !== 'actor' && metadata.type !== 'participant') participant.shape = metadata.type
      }
      const alias = written ?? metadata.alias
      if (alias !== undefined) participant.label = cleanLines(alias)
      if (declared[1]) {
        steps.push({ kind: 'create', id })
        created = id
      }
      continue
    }
    const destroyed = DESTROY.exec(line)
    if (destroyed) {
      doomed.set(meet(idOf(destroyed[1]!)).id, steps.length)
      continue
    }
    const activation = ACTIVATE.exec(line)
    if (activation) {
      activate(idOf(activation[2]!), activation[1]!.toLowerCase() === 'activate', at)
      continue
    }
    const note = NOTE.exec(line)
    if (note) {
      const where = note[1]!.toLowerCase()
      const side = where.startsWith('left') ? 'left' : where.startsWith('right') ? 'right' : 'over'
      const names = [...new Set(note[2]!.split(',').map(name => idOf(name.trim())))]
      const keyword = names.find(name => !isEndpoint(name))
      if (keyword !== undefined) {
        reject(at, `note on \`${keyword.slice(0, MAX_EXAMPLE)}\` not understood`)
        continue
      }
      if (names.length > 2) {
        reject(at, 'note over takes at most two participants')
        continue
      }
      const over = names.map(name => meet(name).id)
      if (side !== 'over' && over.length > 1) {
        reject(at, `note ${where} takes one participant`)
        continue
      }
      steps.push({ kind: 'note', over, side, text: cleanLines(unwrapped(note[3] ?? '')) })
      continue
    }
    const opened = OPEN.exec(line)
    if (opened) {
      const keyword = opened[1]!.toLowerCase()
      blocks.push({ kind: 'block', keyword, line: at })
      steps.push({ kind: 'open', keyword, text: keyword === 'rect' ? '' : clean(opened[2] ?? '') })
      continue
    }
    const branch = BRANCH.exec(line)
    if (branch) {
      const keyword = branch[1]!.toLowerCase()
      const parent = BRANCH_OF[keyword]
      const inside = blocks.findLast(block => block.kind === 'block')?.keyword
      if (inside !== parent && !(keyword === 'and' && inside === 'par_over')) {
        reject(at, `${keyword} outside ${parent}`)
        continue
      }
      steps.push({ kind: 'branch', keyword, text: clean(branch[2] ?? '') })
      continue
    }
    if (found) {
      sendMessage(found, at)
      continue
    }
    unknown.push(decode(line))
  }

  for (const [id, index] of [...doomed].sort((a, b) => b[1] - a[1])) steps.splice(index, 0, { kind: 'destroy', id })
  const shown = steps.filter(step => step.kind !== 'activate' || known.has(step.id))

  const problems: string[] = []
  if (header === '') problems.push('no diagram type (mermaid.live rejects)')
  else if (participants.length === 0 && steps.length === 0 && rejected === 0 && unknown.length === 0) problems.push('empty diagram')
  if (unknown.length > 0) {
    const examples = unknown
      .slice(0, 2)
      .map(line => `\`${line.length > MAX_EXAMPLE ? `${line.slice(0, MAX_EXAMPLE - 1)}…` : line}\``)
      .join(', ')
    problems.push(`${plural(unknown.length, 'line')} not understood: ${examples}`)
  }
  problems.push(...lineProblems)
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
  return { title, participants, steps: shown, problems, boxes, ...(unread > 0 ? { unread } : {}) }
}
