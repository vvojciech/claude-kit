import { describe, expect, test } from 'claude-code/testing'

import { parseSequence } from '../hooks/parse'
import { drawSequence, plainRows, wrap } from '../hooks/render'
import { cellWidth } from '../hooks/width'

const draw = (source: string, width = 80) => {
  const { rows, notes } = drawSequence(parseSequence(`sequenceDiagram\n${source}`), width)
  return { lines: plainRows(rows), rows, notes }
}

const columnsOf = (line: string, char: string) => [...line].flatMap((c, i) => (c === char ? [i] : []))

const OFFERSET = `autonumber
participant J as Bazaar journey<br/>(QuotingService::Common)
participant QA as Bazaar GateAdapter<br/>(offerset_generation/gate_adapter.rb)
participant QG as Gate API<br/>(offerset_generation v1)
participant GQ as Gate GenerateOfferset
participant RP as Risk Profiler
participant RO as Contact (ACCT)
participant R as Tarif (in-process gem)<br/>Tarif::Rating
participant K as Kafka
participant S3 as Gate persistence (S3)
J->>J: rate → generate_offerset
J->>QA: generate_offerset(req_identity, risk_profile_attributes,<br/>for_insurers, vertical)
QA->>QA: build contract, restrict insurer panel,<br/>pick endpoint by quoting_operation
QA->>QG: POST generate_quote_set_for_new_business<br/>(GateSlowVerticalFailFast timeout)
QG->>GQ: NewBusiness::GenerateOfferset<br/>(rating_type = full_rating)
GQ->>GQ: TransformRiskProfileAttributes
GQ->>RP: enriched risk factors, first-party data,<br/>rating questionnaire id (by req_reference, request-cached)
GQ->>RO: FetchCustomerDetails(customer_account_id)
GQ->>GQ: BuildTarifRiskProfile
GQ->>R: generate_quote_set_for_risk_profile(profile, for_insurers)
R->>R: OfferSetBuilder: pipeline route by<br/>business_unit/quoting_operation/vertical/rating_type
R->>R: enrichment → quoting → Oracle overlay → BazaarFiltering
R-->>GQ: tarif offerset (quotes + enriched REQ)
GQ->>K: enriched_req_built (configured BUs only)
GQ->>GQ: HandleOracleError
GQ->>S3: PersistOfferset → offerset_id
GQ-->>QG: Offerset
QG-->>QA: 200 offerset
Note over QA,QG: 400 → GateContractValidationError<br/>422 → EmptyOffersetError / InvalidOffersetError
QA-->>J: Dto::Offerset
J->>QG: warm offerset cache (read API by offerset_id)
J->>RO: link_customer_account
J->>J: write_quote (REQ + quotes to Mongo, one commit)`

describe('drawSequence', () => {
  test('puts short labels on the arrow, centred in both directions, a dashed one with dashes either side', async () => {
    const { lines, notes } = draw('participant B as Browser\nparticipant C as Bazaar\nB->>C: GET /quote\nC-->>B: 200 html')

    expect(lines).toEqual([
      '╭─────────╮      ╭────────╮',
      '│ Browser │      │ Bazaar │',
      '╰────┬────╯      ╰────┬───╯',
      '     │─ GET /quote ──▶│',
      '     │◀╌╌╌╌ 200 html ╌│',
    ])
    expect(notes).toEqual([])
  })

  test('centres every lifeline under its box', async () => {
    const { lines } = draw('participant A as Alice\nparticipant B as Bob\nparticipant C as Christopher\nA->>B: hi\nB->>C: hi')
    const [top, , bottom] = lines

    for (const x of columnsOf(bottom!, '┬')) {
      const start = top!.lastIndexOf('╭', x)
      const end = top!.indexOf('╮', x)
      expect(x - start).toBe(end - x)
    }
  })

  test('spreads a long label across the whole span it travels', async () => {
    const { lines } = draw('A->>B: one\nB->>C: two\nA->>C: spans both lanes with a long label')

    expect(lines.at(-1)).toBe('  │─ spans both lanes with a long label ─▶│')
    expect(lines.filter(line => line.includes('spans both'))).toHaveLength(1)
  })

  test('never writes a label over the lifelines at either end', async () => {
    const { lines } = draw('A->>B: a label long enough to need its own row\nB->>C: next\nC-->>A: a reply that crosses B on the way back', 60)
    const [a, , c] = columnsOf(lines[2]!, '┬')

    for (const line of lines.slice(3)) {
      for (const x of [a!, c!]) expect('│┃▶◀▷◁×─╌'.includes([...line][x] ?? '│')).toBe(true)
    }
  })

  test('draws a self-message with a one-line label on one row', async () => {
    const { lines } = draw('A->>B: hi\nB->>B: think')

    expect(lines.at(-1)).toBe('  │       │↺ think')
  })

  test('draws a self-message with a multi-line label as a loop with its label beside it', async () => {
    const { lines } = draw('A->>B: hi\nB->>B: think<br/>it over')

    expect(lines.slice(-2)).toEqual(['  │       │─╮ think', '  │       │◀╯ it over'])
  })

  test('draws a one-line note as one tinted row covering the lifelines it spans', async () => {
    const { lines, rows } = draw('A->>B: hi\nNote over A,B: shared')

    expect(lines.slice(-1)).toEqual(['   shared'])
    expect(rows.at(-1)).toEqual([{ text: ' ', ink: 'text' }, { text: '  shared   ', ink: 'note' }])
  })

  test('gives every line of a note its own tinted row, all the same width', async () => {
    const { rows } = draw('A->>B: hi\nNote over A,B: two<br/>lines')

    expect(rows.slice(-2).map(row => row.filter(run => run.ink === 'note'))).toEqual([[{ text: '    two    ', ink: 'note' }], [{ text: '   lines   ', ink: 'note' }]])
  })

  test('keeps a left note left of its lifeline and a right note right of it, each on its own row', async () => {
    const { lines } = draw('A->>B: hi\nNote left of A: before\nNote right of B: after')

    expect(lines.slice(4)).toEqual([' before  │       │', '         │       │  after'])
  })

  test('gives consecutive notes their own rows when they would touch', async () => {
    const { lines } = draw('A->>B: hi\nNote over A,B: first\nNote over A,B: second')

    expect(lines.slice(4).map(line => line.trim())).toEqual(['first', 'second'])
  })

  test('sends a left note to the footer rather than mirroring it when it has no room', async () => {
    const { lines, notes } = draw('participant A as Alice\nparticipant B as Bobby\nA->>B: hi\nNote left of A: unquestionably', 24)

    expect(lines.some(line => line.includes('unquestionably'))).toBe(false)
    expect(notes).toContain('[1] unquestionably')
  })

  test('never mirrors a left note onto the right of its lifeline', async () => {
    const { lines } = draw('participant A as Alice\nparticipant B as Bobby\nA->>B: hi\nNote left of A: a note that would need a very wide gutter', 30)
    const a = columnsOf(lines[2]!, '┬')[0]!

    for (const line of lines.filter(line => /note|gutter|wide/.test(line))) expect(line.search(/\S/)).toBeLessThan(a)
  })

  test('frames blocks around the lanes they use, conditions in brackets, nested ones inset', async () => {
    const { lines } = draw('A->>B: hi\nB->>C: ho\nloop every minute\nB-)C: ping\nalt ok\nC-->>B: pong\nelse fail\nC--xB: boom\nend\nend')

    expect(lines.slice(5)).toEqual([
      '  │   ┌───┼─ loop [every minute] ─┼───┐',
      '  │   │   │─ ping ───────────────▷│   │',
      '  │   │ ┌─┼─ alt [ok] ────────────┼─┐ │',
      '  │   │ │ │◀╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ pong ╌│ │ │',
      '  │   │ ├╌┼╌ else [fail] ╌╌╌╌╌╌╌╌╌┼╌┤ │',
      '  │   │ │ │×╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ boom ╌│ │ │',
      '  │   │ └─┼───────────────────────┼─┘ │',
      '  │   └───┼───────────────────────┼───┘',
    ])
  })

  test('never paints a frame label over a lifeline crossing', async () => {
    const { lines } = draw('participant U as User\nparticipant S as Service\nparticipant C as Cache\nU->>S: go\nloop every 5s\nS->>C: poll\nalt hit\nC-->>S: v\nelse miss\nC--)S: refresh later\nend\nend', 37)
    const lanes = columnsOf(lines[2]!, '┬')

    for (const line of lines.filter(line => /[┌├]/.test(line))) for (const x of lanes.slice(1)) expect('┼╂'.includes([...line][x]!)).toBe(true)
  })

  test('closes a block the source left open', async () => {
    const { lines } = draw('loop forever\nA->>B: ping')

    expect(lines.at(-1)).toMatch(/^└.*┘$/)
  })

  test('shades a rect block instead of framing it', async () => {
    const sequence = parseSequence('sequenceDiagram\nrect rgb(0,0,255)\nA->>B: hi\nend')
    const { rows } = drawSequence(sequence, 40)

    expect(plainRows(rows).slice(3)).toEqual(['  │─ hi ─▶│'])
    expect(rows[3]!.some(run => run.shade)).toBe(true)
    expect(rows[0]!.some(run => run.shade)).toBe(false)
  })

  test('thickens the lifeline from the arrow that activates it', async () => {
    const { lines } = draw('A->>+B: go\nB-->>-A: back\nA->>B: again')

    expect(lines.slice(3)).toEqual(['  │─ go ──────▶┃', '  │◀╌╌╌╌ back ╌┃', '  │─ again ───▶│'])
  })

  test('starts a nested activation on the head of the self-call that opens it', async () => {
    const { lines } = draw('A->>+B: go\nB->>+B: recurse\nB-->>-A: back\nB-->>-A: done')

    expect(lines.slice(4, 6)).toEqual(['  │            ┃┃↺ recurse', '  │◀╌╌╌╌ back ╌┃┃'])
  })

  test('frames a block from just left of its first lane, the condition running along the top edge', async () => {
    const { lines } = draw('participant A\nparticipant B\nA->>B: hi\nalt the customer has an active policy\nB-->>A: ok\nend')

    expect(lines[4]!.indexOf('┌')).toBe(0)
    expect(lines[4]).toContain('alt [the customer has an active policy]')
  })

  test('centres names with even padding on both sides', async () => {
    const { lines } = draw('participant Q as Gate\nparticipant C as Bazaar\nQ->>C: hi')

    expect(lines[1]).toBe('│ Gate │ │ Bazaar │')
  })

  test('offsets a nested activation', async () => {
    const { lines } = draw('A->>+B: go\nB->>+B: again\nB-->>-A: back\nB-->>-A: done')

    expect(lines.some(line => line.includes('┃┃'))).toBe(true)
  })

  test('marks actors with a figure in the same box style', async () => {
    const { lines } = draw('actor U as User\nU->>S: hi')

    expect(lines[0]!.startsWith('╭')).toBe(true)
    expect(lines[1]).toContain('☺ User')
  })

  test('draws async, cross, open and two-way arrows with their own heads', async () => {
    const { lines } = draw('A-)B: a\nA-xB: b\nA->B: c\nA<<->>B: d')

    expect(lines.slice(3)).toEqual(['  │─ a ──▷│', '  │─ b ──×│', '  │─ c ───│', '  │◀─ d ─▶│'])
  })

  test('puts the autonumber beside its label on every arrow', async () => {
    const { lines, rows } = draw('autonumber\nA->>B: one\nB->>A: two')

    expect(lines.slice(3)).toEqual(['  │─ 1 one ─▶│', '  │◀─ 2 two ─│'])
    expect(rows[3]?.find(run => run.text.trim() === '1')?.ink).toBe('number')
  })

  test('starts a created participant at its create row and ends a destroyed one in its box', async () => {
    const { lines } = draw('A->>B: hi\ncreate participant C\nB->>C: spawn\ndestroy C\nB->>C: stop')

    expect(lines.slice(3)).toEqual([
      '  │─ hi ─▶│',
      '  │       │          ╭───╮',
      '  │       │─ spawn ─▶│ C │',
      '  │       │          ╰─┬─╯',
      '  │       │─ stop ────▶│',
      '  │       │          ╭─┴─╮',
      '  │       │          │ C │',
      '  │       │          ╰───╯',
    ])
  })

  test('labels box groups above their participants, rails their sides and breaks lines at <br/>', async () => {
    const { lines } = draw('box Team\nparticipant A\nparticipant B\nend\nA->>B: hi<br/>there')

    expect(lines).toEqual(['╭─ Team ──────╮', '╭───╮     ╭───╮', '│ A │     │ B │', '╰─┬─╯     ╰─┬─╯', '┆ │ hi      │ ┆', '┆ │ there ─▶│ ┆'])
  })

  test('measures wide characters by terminal cells', async () => {
    const { lines } = draw('participant Z as Zürich\nparticipant T as 東京\nZ->>T: こんにちは')
    const lane = cellWidth(lines[2]!.slice(0, lines[2]!.lastIndexOf('┬')))

    expect(lines[3]).toBe('     │─ こんにちは ─▶│')
    expect(cellWidth(lines[3]!.slice(0, lines[3]!.lastIndexOf('│')))).toBe(lane)
  })

  test('drops box padding before cutting names, and both before dropping anyone', async () => {
    const source = [
      'participant C as Customer',
      'participant Ch as Bazaar',
      'participant Q as Gate',
      'participant R as Tarif',
      'C->>Ch: ok',
      'Ch->>Q: ok',
      'Q->>R: ok',
    ].join('\n')
    const { lines, notes } = draw(source, 34)

    expect(lines[1]).toBe('│Customer│ │Bazaar│ │Gate│ │Tarif│')
    expect(notes).toEqual([])
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(34)
  })

  test('switches to one line per message when more than a quarter would be footnoted', async () => {
    const { lines, notes } = draw('participant C as Customer\nparticipant Ch as Bazaar\nparticipant Q as Gate\nparticipant R as Tarif\nC->>Ch: submit answers\nCh->>Q: rate REQ\nQ-->>R: price per scheme', 32)

    expect(lines).toEqual(['Customer → Bazaar', '               submit answers', 'Bazaar → Gate  rate REQ', 'Gate ⇢ Tarif   price per scheme'])
    expect(notes).toEqual([])
  })

  test('keeps every row inside a 40-column width without losing text', async () => {
    const { lines, notes } = draw(
      'title A rather long title that goes past forty columns\nA->>B: one\nB->>B: a self message with a long label\nB->>C: averyveryverylongwordthatcannotwrap\nNote over A,C: a note that is far too long to fit in the room',
      40,
    )
    const shown = [...lines, ...notes].join(' ').replace(/\s/g, '')

    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(40)
    for (const text of ['Aratherlongtitlethatgoespastfortycolumns', 'averyveryverylongwordthatcannotwrap', 'anotethatisfartoolongtofitintheroom']) expect(shown).toContain(text)
  })

  test('falls back to the list rather than hiding a participant it could not fit', async () => {
    const { lines } = draw('A->>B: one\nB->>C: two\nC->>A: three\nA->>B: four\nB->>C: five\nC->>A: six\nA->>B: seven\nB->>C: eight\nC->>D: nine\nD->>E: ten', 30)

    expect(lines[0]).toMatch(/^A → B +one$/)
    expect(lines.some(line => line.includes('┆'))).toBe(false)
    expect(lines.some(line => /^D → E +ten$/.test(line))).toBe(true)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(30)
  })

  test('ends a wrapped label with its arrow on the last line when the arrow fits', async () => {
    const { lines } = draw('participant A as Alice\nparticipant B as Bob\nparticipant C as Carol\nA->>B: one\nC->>A: three is long\nB-->>A: a reply<br/>on two lines', 40)

    expect(lines.slice(-2)).toEqual(['    │           a reply │        │', '    │◀╌╌╌╌ on two lines │        │'])
  })

  test('never puts two notes on one row', async () => {
    const { lines } = draw('A->>B: hi\nNote left of A: l\nNote right of B: r')

    expect(lines.filter(line => /\bl\b/.test(line) && /\br\b/.test(line))).toEqual([])
  })

  test('keeps the autonumber with its first word however narrow the gap', async () => {
    const { lines } = draw('autonumber\nA->>B: unquestionably long\nB->>C: x', 24)

    expect(lines.some(line => /\b1 unquest/.test(line) || /^1 /.test(line.trim()))).toBe(true)
    expect(lines.some(line => line.trim() === '1')).toBe(false)
  })

  test('draws forty long messages with notes quickly on a wide terminal', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `participant P${i} as Service number ${i} with a long name`)
    const lines = ['autonumber', ...names]
    for (let i = 0; i < 40; i++) {
      if (i % 10 === 0) lines.push(`alt branch ${i} with a fairly long condition text here`)
      lines.push(`P${i % 8}->>+P${(i * 3 + 1) % 8}: message ${i} carrying a payload description that wraps`)
      lines.push(`Note over P${i % 8},P${(i + 2) % 8}: note ${i} replica lag`)
      if (i % 10 === 9) lines.push('else other', 'P0-->>-P1: back', 'end')
    }
    const sequence = parseSequence(`sequenceDiagram\n${lines.join('\n')}`)

    for (const width of [97, 150, 200]) {
      const started = performance.now()
      drawSequence({ ...sequence, title: `wide budget ${width}` }, width)
      expect(performance.now() - started).toBeLessThan(150)
    }
  })

  test('draws a forty-message diagram quickly at any width', async () => {
    const lanes = Array.from({ length: 8 }, (_, i) => `P${i}`)
    const lines = ['autonumber']
    for (let k = 0; k < 40; k++) {
      if (k === 10) lines.push('loop retry')
      if (k === 20) lines.push('end')
      if (k % 9 === 4) lines.push(`Note over ${lanes[k % 8]},${lanes[(k + 2) % 8]}: note number ${k} a few words long`)
      lines.push(`${lanes[k % 8]}${k % 3 ? '-->>' : '->>'}${lanes[(k * 3 + 1) % 8]}: message number ${k} with some words`)
    }
    const sequence = parseSequence(`sequenceDiagram\n${lines.join('\n')}`)

    for (const width of [37, 57, 97, 150]) {
      const started = performance.now()
      drawSequence({ ...sequence, title: `budget ${width}` }, width)
      expect(performance.now() - started).toBeLessThan(150)
    }
  })
})

describe('wrap', () => {
  test('balances lines', async () => {
    expect(wrap('price per scheme', 12).lines).toEqual(['price per', 'scheme'])
  })

  test('never cuts a word of six characters or fewer', async () => {
    expect(wrap('cancel the quote', 6)).toEqual({ lines: ['cancel', 'the', 'quote'], isCut: false })
  })

  test('never starts a line with a free-standing arrow or slash', async () => {
    const lines = [...wrap('enrichment → quoting → Oracle overlay', 14).lines, ...wrap('422 → EmptyOffersetError / InvalidOffersetError', 26).lines]

    expect(lines.filter(line => /^[→⇢/|]/.test(line))).toEqual([])
  })
})

describe('participant shapes and half arrows', () => {
  test('marks a queue and a database by their shape and draws half heads', () => {
    const sequence = parseSequence('sequenceDiagram\nparticipant Q@{ "type": "queue" }\nparticipant D@{ "type": "database" }\nQ-|\\D: push\nD/|-Q: pull')
    const lines = plainRows(drawSequence(sequence, 60).rows)
    expect(lines.some(line => line.includes('≋ Q'))).toBe(true)
    expect(lines.some(line => line.includes('◫ D'))).toBe(true)
    expect(lines.some(line => line.includes('⇀'))).toBe(true)
  })
})

describe('spending spare columns', () => {
  const QUOTE = 'actor C as Customer\nparticipant Ch as Bazaar\nparticipant Q as Gate\nC->>Ch: submit answers\nCh->>Q: rate REQ\nQ-->>Ch: quotes'

  test('puts a label back on its arrow once the width allows it', async () => {
    const { lines } = draw(QUOTE, 60)

    expect(lines.some(line => line.includes('─ submit answers ─▶'))).toBe(true)
  })

  test('stacks a label above its arrow rather than cutting it when the width is short', async () => {
    const { lines, notes } = draw(QUOTE, 36)

    expect(lines.some(line => line.includes('submit'))).toBe(true)
    expect(notes.some(note => note.includes('submit answers'))).toBe(false)
  })

  test('wraps a long frame title onto one more row, then cuts and footnotes the rest', async () => {
    const { lines, notes } = draw('A->>B: hi\nloop every five seconds until the cache warms\nA->>B: poll\nend', 34)

    expect(notes).toEqual([])
    expect(lines.filter(line => /every|until|cache|warms/.test(line))).toHaveLength(2)

    const long = draw('A->>B: hi\nloop every five seconds until the cache warms up again after each deploy\nA->>B: poll\nend', 34)

    expect(long.notes).toEqual(['[1] loop every five seconds until the cache warms up again after each deploy'])
    expect(long.lines.filter(line => /every|until|deploy|\[1\]/.test(line))).toHaveLength(2)
  })

  test('leaves a marker where a note it could not fit belonged', async () => {
    const { lines, notes } = draw('participant A as Alice\nparticipant B as Bob\nA->>B: hi\nNote left of A: unquestionably', 14)

    expect(lines.some(line => line.includes('[1]'))).toBe(true)
    expect(notes).toContain('[1] unquestionably')
  })

  test('splits a long name over two lines before cutting it', async () => {
    const { lines, notes } = draw('participant A as Payment service\nparticipant B as Ledger\nA->>B: post', 24)

    expect(lines.some(line => line.includes('Payment'))).toBe(true)
    expect(lines.some(line => line.includes('service'))).toBe(true)
    expect(notes.some(note => note.includes('='))).toBe(false)
  })

  test('drops the leading stub on every message once one short label needs it', async () => {
    const { lines } = draw('A->>B: one\nB->>C: two', 22)

    expect(lines.slice(3)).toEqual(['  │ one ─▶│        │', '  │       │ two ──▶│'])
  })

  test('wraps a self message rather than letting it stretch the gap to the next lane', async () => {
    const { lines } = draw('participant W as Worker\nparticipant Q as Queue\nW->>W: retry with exponential backoff and jitter\nW->>Q: ack', 97)
    const lanes = columnsOf(lines[2]!, '┬')

    expect(lanes[1]! - lanes[0]!).toBeLessThanOrEqual(30)
    expect(lines.join(' ')).toContain('backoff and jitter')
  })

  test('keeps a note over two participants on one row rather than wrap it', async () => {
    const { lines } = draw('participant A\nparticipant B\nparticipant C\nA->>C: go\nNote over A,B: across both lanes', 60)

    expect(lines.filter(line => /across|lanes/.test(line))).toEqual([expect.stringContaining('across both lanes')])
  })

  test('wraps a section label onto one more row before cutting it', async () => {
    const { lines, notes } = draw('participant A\nparticipant B\nA->>B: x\nalt ok\nB->>A: y\nelse the request timed out\nB->>A: z\nend', 30)

    expect(notes).toEqual([])
    expect(lines.some(line => line.includes('├') && /else \[?the request/.test(line))).toBe(true)
    expect(lines.some(line => line.includes('timed out') && !line.includes('├'))).toBe(true)
  })

  test('never cuts a frame label when the cut and its marker are no shorter', async () => {
    const { lines, notes } = draw('participant A\nparticipant B\nalt hit\nB->>A: v\nelse miss\nB->>A: r\nend', 17)

    expect(notes).toEqual([])
    expect(lines.some(line => line.includes('├') && line.includes('else'))).toBe(true)
    expect(lines.some(line => line.includes('miss'))).toBe(true)
  })

  test('draws no header row for a box without a label', async () => {
    const { lines } = draw('box Aqua\nparticipant A\nparticipant B\nend\nA->>B: hi')

    expect(lines[0]).toBe('╭───╮   ╭───╮')
  })

  test('starts the compact list with the number and hangs every continuation at one label column', async () => {
    const { lines } = draw('autonumber\nparticipant C as Customer\nparticipant Ch as Bazaar\nparticipant Q as Gate\nparticipant R as Tarif\nC->>Ch: submit answers\nCh->>Q: rate REQ\nQ-->>R: price per scheme\nNote over Ch,Q: filter rules applied', 26)

    expect(lines).toEqual([
      '1 Customer → Bazaar',
      '                 submit',
      '                 answers',
      '2 Bazaar → Gate  rate REQ',
      '3 Gate ⇢ Tarif   price per',
      '                 scheme',
      '  ┆ filter rules applied',
      '    (Bazaar–Gate)',
    ])
  })

  test('puts a label crossing several lanes on its arrow when it fits there', async () => {
    const { lines } = draw('A->>B: one\nB->>C: two\nC->>D: three\nA->>D: a label that crosses the middle lanes')

    expect(lines.at(-1)).toMatch(/^ {2}│─ a label that crosses the middle lanes ─+▶│$/)
  })

  test('keeps every label whole beside a left note', async () => {
    const { lines, notes } = draw('participant A as Browser\nparticipant B as API gateway\nparticipant D as Database\nA->>B: GET /policy/123\nB-->>A: 200 from cache\nB->>D: SELECT policy\nNote left of A: user waits', 54)

    expect(lines.some(line => line.includes('GET /policy/123'))).toBe(true)
    expect(lines.some(line => line.includes('200 from cache'))).toBe(true)
    expect(lines.some(line => /^ *user waits +│/.test(line))).toBe(true)
    expect(notes).toEqual([])
  })

  test('lets a note over two lanes spread past them rather than wrap again', async () => {
    const { lines } = draw('A->>B: x\nB->>C: y\nC->>D: z\nNote over B,C: idempotency key travels with the request', 30)

    expect(lines.filter(line => /idempotency|request/.test(line))).toHaveLength(2)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(30)
  })

  test('keeps a space between a margin footnote marker and its lifeline', async () => {
    const source = 'actor U as User\nparticipant S as Service\nparticipant C as Cache\nNote left of U: on call\nU->>+S: request\nloop every 5s\nS->>C: poll\nalt hit\nC-->>S: value\nelse miss\nC--)S: refresh later\nend\nend\nS-->>-U: done\nNote right of C: TTL 30s'
    const { lines, notes } = draw(source, 34)

    expect(notes).toContain('[1] on call')
    expect(lines.find(line => line.includes('[1]'))).toMatch(/│ \[1\]|\[1\] │/)
  })

  test('marks a cut participant name with a numbered footnote', async () => {
    const { lines, notes } = draw('participant C as Customerservicesdesk\nparticipant Q as Gate\nC->>Q: ok', 24)

    expect(lines[0]).toContain('[1]')
    expect(notes).toEqual(['[1] Customerservicesdesk'])
  })

  test('shows the id for a participant declared with an empty label, in a centred box', async () => {
    const { lines } = draw('participant A as\nA->>B: x')
    const [top, name, bottom] = lines

    expect(name).toContain('│ A │')
    const x = bottom!.indexOf('┬')
    expect(x - top!.indexOf('╭')).toBe(top!.indexOf('╮') - x)
  })
})

describe('round 11', () => {
  test('draws the diagram while every participant fits, even when a list would be shorter', async () => {
    const { lines } = draw('A->>B: one\nB->>C: two\nC->>D: three\nD->>E: four\nE->>F: five\nF->>G: six\nG->>H: seven\nA->>H: a very long message label that crosses everything in the middle', 57)

    expect(lines[1]).toContain('│ A │')
    expect(lines[1]).toContain('│ H │')
    expect(lines.join(' ')).toContain('crosses everything in the middle')
  })

  test('keeps a short diagram whose label breaks on purpose', async () => {
    const { lines } = draw('A->>B: hi<br/>there', 40)

    expect(lines[1]).toContain('│ A │')
  })

  test('keeps the diagram when the list would save almost nothing', async () => {
    const source = 'participant A as Browser\nparticipant B as API gateway\nparticipant D as Database\nA->>B: GET /policy/123\nalt cached\nB-->>A: 200 from cache\nelse miss\nB->>D: SELECT policy\nD-->>B: row\nB-->>A: 200\nend\nB-)D: async audit log\nA-xB: cancel\nNote right of D: replica lag ~2s\nNote left of A: user waits'
    const { lines } = draw(source, 37)

    expect(lines[1]).toContain('Browser')
    expect(lines[1]).toContain('│')
  })

  test('leaves room for a nested activation bar beside a self message', async () => {
    const { lines, notes } = draw('A->>+B: a\nB->>+B: self\nB-->>-B: s\nB-->>-A: d', 50)

    expect(lines.some(line => line.includes('self'))).toBe(true)
    expect(lines.some(line => line.includes('se…'))).toBe(false)
    expect(notes).toEqual([])
  })

  test('keeps full names over keeping a short label on its arrow', async () => {
    const { lines } = draw('participant C as Customer\nparticipant Ch as Bazaar\nparticipant Q as Gate\nparticipant R as Tarif\nC->>Ch: submit\nCh->>Q: rate\nQ->>R: price', 36)

    expect(lines.join('\n')).toContain('Customer')
    expect(lines.join('\n')).not.toContain('Custom…')
  })

  test('keeps mermaid activation syntax out of the list arrows, and keeps the actor mark', async () => {
    const { lines } = draw('actor C as Customer\nparticipant Ch as Bazaar\nparticipant Q as Gate\nparticipant R as Tarif\nC->>Ch: submit answers\nCh->>+Q: rate REQ\nQ->>R: price per scheme\nR-->>Q: premiums\nQ-->>-Ch: quotes\nCh-->>C: QCP', 37)

    expect(lines.some(line => line.includes('Bazaar → Gate'))).toBe(true)
    expect(lines.some(line => line.includes('Gate ⇢ Bazaar'))).toBe(true)
    expect(lines.some(line => /[→⇢][+-]/.test(line))).toBe(false)
    expect(lines.some(line => line.includes('☺ Customer'))).toBe(true)
  })

  test('names the box groups in one dim row above the list', async () => {
    const { rows } = drawSequence(
      parseSequence('sequenceDiagram\nbox Frontend\nparticipant U as User\nparticipant W as Web app\nend\nbox Backend\nparticipant A as API\nparticipant P as Postgres\nend\nU->>W: click buy\nW->>A: POST /policy<br/>with card token\nA->>P: insert\nNote over W,A: idempotency key travels with the request\nP-->>A: id'),
      24,
    )
    const shown = plainRows(rows)

    expect(shown.slice(0, 2)).toEqual(['Frontend: User, Web app', 'Backend: API, Postgres'])
    expect(rows[0]!.every(run => run.ink === 'frame')).toBe(true)
  })

  test('puts a footnoted left-of note marker left of the first lifeline', async () => {
    const { lines } = draw('actor U as User\nparticipant S as Service\nparticipant C as Cache\nNote left of U: on call\nU->>+S: request\nloop every 5s\nS->>C: poll\nalt hit\nC-->>S: value\nelse miss\nC--)S: refresh later\nend\nend\nS-->>-U: done\nNote right of C: TTL 30s', 34)

    expect(lines.some(line => /^\[1\] │/.test(line))).toBe(true)
    expect(lines.some(line => /│ \[1\]/.test(line))).toBe(false)
  })

  test('cuts a word too long for the list and footnotes the whole label', async () => {
    const { rows, notes } = drawSequence(parseSequence('sequenceDiagram\nA->>B: one supercalifragilisticexpialidocious two\nB->>C: x\nC->>D: y\nD->>E: z\nE->>F: w'), 24)
    const shown = plainRows(rows)

    expect(shown.some(line => line.includes('…'))).toBe(true)
    expect(shown.some(line => line.includes('[1]'))).toBe(true)
    expect(notes).toEqual(['[1] one supercalifragilisticexpialidocious two'])
  })

  test('draws a real many-participant reply as a diagram while every participant fits', async () => {
    for (const width of [127, 165, 200]) {
      const { lines, notes } = draw(OFFERSET, width)
      const shown = lines.join('\n')

      expect(lines.slice(0, 9).some(line => line.includes('╭'))).toBe(true)
      for (const name of ['Bazaar', 'Gate', 'Risk', 'Contact', 'Tarif', 'Kafka']) expect(shown).toContain(name)
      for (let n = 1; n <= 22; n++) expect(shown).toMatch(new RegExp(`(^|[^\\d])${n} [^\\[\\s]`, 'm'))
      for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width)
      if (width >= 165) expect(notes).toEqual([])
    }
  })

  test('lists a real many-participant reply once its participants no longer fit', async () => {
    const { lines } = draw(OFFERSET, 90)
    const entries = lines.filter(line => /^\d+ /.test(line))

    expect(entries).toHaveLength(22)
    expect(entries[0]).toMatch(/^1 +Bazaar journey ↺ +rate → generate_offerset$/)
  })
})

describe('label-driven layout', () => {
  test('runs a self message label over the idle lanes to its right instead of wrapping it', async () => {
    const { lines } = draw('A->>B: hi\nB->>C: go\nA->>A: think about the request before sending it on', 60)

    expect(lines.at(-1)).toBe('  │↺ think about the request before sending it on')
  })

  test('draws every participant box the same height, top-aligned, under a centred title', async () => {
    const { lines } = draw('title Checkout\nparticipant A as Web<br/>app\nparticipant B as API\nA->>B: hi', 40)

    expect(lines.slice(0, 5)).toEqual(['   Checkout', '╭─────╮ ╭─────╮', '│ Web │ │ API │', '│ app │ │     │', '╰──┬──╯ ╰──┬──╯'])
  })

  test('gives width to the gaps whose labels need it, so a real many-participant reply stays short', async () => {
    const rows = [124, 162, 197].map(width => draw(OFFERSET, width))

    expect(rows.map(({ notes }) => notes)).toEqual([[], [], []])
    expect(rows[0]!.lines.length).toBeLessThanOrEqual(80)
    expect(rows[1]!.lines.length).toBeLessThanOrEqual(62)
    expect(rows[2]!.lines.length).toBeLessThanOrEqual(52)
  })

  test('lists a reply whose participants cannot all fit with their names whole', async () => {
    const { lines } = draw(OFFERSET, 87)

    expect(lines.filter(line => /^\d+ /.test(line))).toHaveLength(22)
  })
})

describe('labels over idle lanes', () => {
  test('runs a long call label right over idle lanes instead of wrapping it in its gap', async () => {
    const { lines } = draw('A->>B: generate the quote set for the risk profile\nB->>C: ok\nC->>D: ok', 70)

    expect(lines.some(line => line.includes('generate the quote set for the risk profile'))).toBe(true)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(70)
  })

  test('breaks identifiers only at their seams, never inside a CamelCase word', async () => {
    expect(wrap('GateSlowVerticalFailFast timeout', 30).lines).toEqual(['GateSlowVerticalFailFast', 'timeout'])
    expect(wrap('generate_quote_set_for_new_business', 20).lines).toEqual(['generate_quote_set_', 'for_new_business'])
  })

  test('keeps a participant box to four lines of name', async () => {
    const { lines } = draw('participant Q as Bazaar GateAdapter<br/>(offerset_generation/gate_adapter.rb)\nparticipant B\nQ->>B: hi', 40)
    const header = lines.slice(0, lines.findIndex(line => line.includes('┬')) + 1)

    expect(header.length).toBeLessThanOrEqual(HEADER_ROWS)
  })
})

const HEADER_ROWS = 6
