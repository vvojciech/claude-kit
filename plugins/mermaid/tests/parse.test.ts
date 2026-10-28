import { describe, expect, test } from 'claude-code/testing'

import { isSequence, kindOf, mermaidBlocks, parseSequence } from '../hooks/parse'

const numbers = (body: string) =>
  parseSequence(`sequenceDiagram\n${body}`).steps.flatMap(step => (step.kind === 'message' ? [step.number] : []))

describe('mermaidBlocks', () => {
  test('finds a closed fence', async () => {
    expect(mermaidBlocks('Here:\n\n```mermaid\nsequenceDiagram\nA->>B: hi\n```\n\ndone')).toEqual(['sequenceDiagram\nA->>B: hi'])
  })

  test('skips a fence still streaming', async () => {
    expect(mermaidBlocks('```mermaid\nsequenceDiagram\nA->>B: hi')).toEqual([])
  })

  test('takes a tilde fence', async () => {
    expect(mermaidBlocks('~~~mermaid\nsequenceDiagram\nA->>B: hi\n~~~')).toEqual(['sequenceDiagram\nA->>B: hi'])
  })

  test('finds two blocks and ignores other languages', async () => {
    const text = '```mermaid\nsequenceDiagram\nA->>B: one\n```\n\n```ts\nx\n```\n\n```mermaid\nflowchart LR\nA-->B\n```'
    expect(mermaidBlocks(text)).toEqual(['sequenceDiagram\nA->>B: one', 'flowchart LR\nA-->B'])
  })
})

describe('kindOf', () => {
  test('names the diagram type past comments', async () => {
    expect(kindOf('%% a comment\nflowchart LR\nA-->B')).toBe('flowchart')
    expect(kindOf('sequenceDiagram\nA->>B: hi')).toBe('sequenceDiagram')
    expect(isSequence('\n  sequenceDiagram\n')).toBe(true)
    expect(isSequence('flowchart TD')).toBe(false)
  })
})

describe('parseSequence', () => {
  test('meets participants in order, declared or implicit, with aliases', async () => {
    const seq = parseSequence('sequenceDiagram\nparticipant C as Bazaar\nactor U as Customer\nU->>C: quote\nC->>Q: rate')
    expect(seq.participants).toEqual([
      { id: 'C', label: 'Bazaar', kind: 'participant' },
      { id: 'U', label: 'Customer', kind: 'actor' },
      { id: 'Q', label: 'Q', kind: 'participant' },
    ])
  })

  test('reads all eight arrows', async () => {
    const arrows = ['->>', '-->>', '->', '-->', '-x', '--x', '-)', '--)']
    const seq = parseSequence(['sequenceDiagram', ...arrows.map(a => `A${a}B: m`)].join('\n'))
    expect(seq.steps.map(s => (s.kind === 'message' ? [s.arrow, s.isDashed] : s.kind))).toEqual([
      ['filled', false],
      ['filled', true],
      ['open', false],
      ['open', true],
      ['cross', false],
      ['cross', true],
      ['async', false],
      ['async', true],
    ])
    expect(seq.participants.map(p => p.id)).toEqual(['A', 'B'])
  })

  test('turns activation marks into activate steps after the message', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>+B: start<br/>job\nB-->>-A: done\nactivate A\ndeactivate A')
    expect(seq.steps).toEqual([
      { kind: 'message', from: 'A', to: 'B', text: 'start\njob', isDashed: false, arrow: 'filled' },
      { kind: 'activate', id: 'B', isOn: true },
      { kind: 'message', from: 'B', to: 'A', text: 'done', isDashed: true, arrow: 'filled' },
      { kind: 'activate', id: 'B', isOn: false },
      { kind: 'activate', id: 'A', isOn: true },
      { kind: 'activate', id: 'A', isOn: false },
    ])
  })

  test('reads notes left of, right of and over two participants', async () => {
    const seq = parseSequence('sequenceDiagram\nNote left of A: l\nNote right of B: r\nnote over A,B: both')
    expect(seq.steps).toEqual([
      { kind: 'note', over: ['A'], side: 'left', text: 'l' },
      { kind: 'note', over: ['B'], side: 'right', text: 'r' },
      { kind: 'note', over: ['A', 'B'], side: 'over', text: 'both' },
    ])
  })

  test('reads loop, else and end as blocks', async () => {
    const seq = parseSequence('sequenceDiagram\nloop every minute\nA->>B: ping\nend\nalt ok\nB-->>A: pong\nelse failed\nB-->>A: error\nend')
    expect(seq.steps.map(s => (s.kind === 'open' || s.kind === 'branch' ? `${s.kind}:${s.keyword}:${s.text}` : s.kind))).toEqual([
      'open:loop:every minute',
      'message',
      'close',
      'open:alt:ok',
      'message',
      'branch:else:failed',
      'message',
      'close',
    ])
  })

  test('reads title and autonumber, skips comments and counts unknown lines', async () => {
    const seq = parseSequence('sequenceDiagram\ntitle: Quote flow\nautonumber\n%% comment\nA->>B: hi\nthis is not mermaid')
    expect(seq.title).toBe('Quote flow')
    expect(seq.steps).toEqual([{ kind: 'message', from: 'A', to: 'B', text: 'hi', isDashed: false, arrow: 'filled', number: 1 }])
    expect(seq.problems).toEqual(['1 line not understood: `this is not mermaid`'])
  })

  const messages = (source: string) =>
    parseSequence(`sequenceDiagram\n${source}`).steps.flatMap(s => (s.kind === 'message' ? [`${s.from}|${s.arrow}|${s.isDashed}|${s.to}|${s.text}`] : []))

  test('reads bidirectional arrows', async () => {
    expect(messages('A<<->>B: sync\nA<<-->>B: dashed')).toEqual(['A|both|false|B|sync', 'A|both|true|B|dashed'])
    expect(parseSequence('sequenceDiagram\nA<<->>B: x').participants.map(p => p.id)).toEqual(['A', 'B'])
  })

  test('splits statements on semicolons and strips trailing ones', async () => {
    const seq = parseSequence('sequenceDiagram\nparticipant Alice; participant Bob\nAlice->>Bob: x; Bob->>Alice: y\nloop Every 5s;\nAlice->>Bob: z\nend;')
    expect(seq.participants.map(p => p.id)).toEqual(['Alice', 'Bob'])
    expect(seq.steps.map(s => (s.kind === 'message' ? s.text : s.kind === 'open' ? `open:${s.text}` : s.kind))).toEqual(['x', 'y', 'open:Every 5s', 'z', 'close'])
    expect(seq.problems).toEqual([])
  })

  test('keeps entity-escaped semicolons in labels', async () => {
    expect(messages('A->>B: a#59; b')).toEqual(['A|filled|false|B|a; b'])
  })

  test('swallows the end of a box', async () => {
    const seq = parseSequence('sequenceDiagram\nbox Aqua Team\nparticipant A\nparticipant B\nend\nloop x\nA->>B: m\nend')
    expect(seq.steps.map(s => s.kind)).toEqual(['open', 'message', 'close'])
    expect(seq.problems).toEqual([])
    expect(seq.boxes).toEqual([{ label: 'Team' }])
    expect(seq.participants.map(p => p.box)).toEqual([0, 0])
  })

  test('keeps quotes in names and aliases, as mermaid does', async () => {
    const [bob] = parseSequence('sequenceDiagram\nactor Bob as "Bob the builder"').participants
    expect(bob).toEqual({ id: 'Bob', label: '"Bob the builder"', kind: 'actor' })
    const [api] = parseSequence('sequenceDiagram\nparticipant "My API"\n"My API"->>B: x').participants
    expect(api).toEqual({ id: '"My API"', label: '"My API"', kind: 'participant' })
  })

  test('keeps hyphenated names whole', async () => {
    expect(messages('Api-xray->>B: q')).toEqual(['Api-xray|filled|false|B|q'])
    expect(messages('A->>Box-xray: q')).toEqual(['A|filled|false|Box-xray|q'])
    expect(messages('A-xB: c\nA--xB: d')).toEqual(['A|cross|false|B|c', 'A|cross|true|B|d'])
  })

  test('reads YAML frontmatter and its title', async () => {
    const source = '---\ntitle: Renewal flow\n---\nsequenceDiagram\nA->>B: renew'
    expect(isSequence(source)).toBe(true)
    expect(kindOf(source)).toBe('sequenceDiagram')
    expect(parseSequence(source).title).toBe('Renewal flow')
    expect(parseSequence(`${source}\ntitle Override`).title).toBe('Override')
  })

  test('labels rect blocks without their colour', async () => {
    const [open] = parseSequence('sequenceDiagram\nrect rgb(0, 0, 255)\nA->>B: m\nend').steps
    expect(open).toEqual({ kind: 'open', keyword: 'rect', text: '' })
  })

  test('reports unknown lines and unbalanced blocks', async () => {
    const seq = parseSequence('sequenceDiagram\nA=>B\nloop x\nA->>B: m\nwhatever this is, it is a very long line indeed')
    expect(seq.problems).toEqual(['2 lines not understood: `A=>B`, `whatever this is, it is a ver…`', '1 block not closed, opened on line 3 (mermaid.live rejects)'])
    expect(seq.unread).toBe(3)
    const ends = parseSequence('sequenceDiagram\nA->>B: m\nend\nend')
    expect(ends.problems).toEqual(['2 extra ends (mermaid.live rejects)'])
    expect(ends.unread).toBe(2)
  })

  test('numbers messages from autonumber start and step, and leaves them bare without it', async () => {
    expect(numbers('autonumber 10 5\nA->>B: m\nB->>A: n')).toEqual([10, 15])
    expect(numbers('autonumber 3\nA->>B: m')).toEqual([3])
    expect(numbers('autonumber off\nA->>B: m')).toEqual([undefined])
    expect(numbers('A->>B: m')).toEqual([undefined])
  })

  test('counts every message from 1 and only shows numbers while autonumber is on', async () => {
    expect(numbers('A->>B: one\nautonumber\nB->>A: two\nautonumber off\nA->>B: three\nAUTONUMBER 7\nB->>A: four')).toEqual([
      undefined,
      2,
      undefined,
      7,
    ])
    expect(numbers('autonumber\nA->>B: a\nautonumber off\nA->>B: b\nautonumber\nA->>B: c')).toEqual([1, undefined, 3])
  })

  test('strips the () shorthand around arrow ends', async () => {
    expect(messages('A->>()B: hi\nA()->>B: yo\nA->>+()B: up')).toEqual(['A|filled|false|B|hi', 'A|filled|false|B|yo', 'A|filled|false|B|up'])
    expect(parseSequence('sequenceDiagram\nA->>()B: hi').participants.map(p => p.id)).toEqual(['A', 'B'])
  })

  test('groups participants into labelled boxes without their colour', async () => {
    const seq = parseSequence(
      'sequenceDiagram\nbox Purple Frontend\nparticipant W\nend\nbox rgb(33,66,99) Back end\nparticipant A\nparticipant D\nend\nbox Aqua\nparticipant Q\nend\nparticipant X\nW->>A: call',
    )
    expect(seq.boxes).toEqual([{ label: 'Frontend' }, { label: 'Back end' }, { label: '' }])
    expect(seq.participants.map(p => [p.id, p.box])).toEqual([['W', 0], ['A', 1], ['D', 1], ['Q', 2], ['X', undefined]])
    expect(parseSequence('sequenceDiagram\nbox Team Alpha\nparticipant A\nend').boxes).toEqual([{ label: 'Team Alpha' }])
  })

  test('emits create at its line and destroy after the next message touching it', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>B: hi\ncreate participant C\nA->>C: make\ndestroy C\nC-xA: bye\nA->>B: after')
    expect(seq.participants.map(p => p.id)).toEqual(['A', 'B', 'C'])
    expect(seq.steps.map(s => (s.kind === 'message' ? s.text : s.kind === 'create' || s.kind === 'destroy' ? `${s.kind}:${s.id}` : s.kind))).toEqual([
      'hi',
      'create:C',
      'make',
      'bye',
      'destroy:C',
      'after',
    ])
    expect(parseSequence('sequenceDiagram\ncreate actor U as User\nU->>A: hi').participants[0]).toEqual({ id: 'U', label: 'User', kind: 'actor' })
  })

  test('emits destroy at its line when no message follows', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>B: hi\ndestroy B\nNote over A: alone')
    expect(seq.steps.map(s => s.kind)).toEqual(['message', 'destroy', 'note'])
  })

  test('keeps <br/> as a line break in messages and notes', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>B: line1<br/>line2\nNote over A: a<br>b')
    expect(seq.steps).toEqual([
      { kind: 'message', from: 'A', to: 'B', text: 'line1\nline2', isDashed: false, arrow: 'filled' },
      { kind: 'note', over: ['A'], side: 'over', text: 'a\nb' },
    ])
  })

  test('reports branches outside their block and drops them', async () => {
    const seq = parseSequence('sequenceDiagram\nelse x\nA->>B: m\nloop l\nand y\nend\nalt a\noption z\nend\npar p\nand q\nend\ncritical c\noption o\nend')
    expect(seq.problems).toEqual([
      'line 2: else outside alt (mermaid.live rejects)',
      'line 5: and outside par (mermaid.live rejects)',
      'line 8: option outside critical (mermaid.live rejects)',
    ])
    expect(seq.unread).toBe(3)
    expect(seq.steps.filter(s => s.kind === 'branch').map(s => (s.kind === 'branch' ? s.keyword : ''))).toEqual(['and', 'option'])
  })

  test('reports deactivation while inactive and accepts activations left open', async () => {
    const underflow = parseSequence('sequenceDiagram\nA->>B: m\ndeactivate B\nB-->>-A: r')
    expect(underflow.problems).toEqual([
      'line 3: deactivate B while inactive (mermaid.live rejects)',
      'line 4: deactivate B while inactive (mermaid.live rejects)',
    ])
    expect(underflow.unread).toBe(2)
    expect(underflow.steps.map(s => s.kind)).toEqual(['message', 'message'])
    const open = parseSequence('sequenceDiagram\nA->>+B: m\nA->>+B: again\nactivate A')
    expect(open.problems).toEqual([])
    expect(open.unread).toBeUndefined()
  })

  test('draws a bar for an activate that names a participant before its first message', async () => {
    const seq = parseSequence('sequenceDiagram\nactivate A\nA->>B: x\ndeactivate A')
    expect(seq.participants.map(p => p.id)).toEqual(['A', 'B'])
    expect(seq.steps.map(s => (s.kind === 'activate' ? `${s.id}${s.isOn ? '+' : '-'}` : s.kind))).toEqual(['A+', 'message', 'A-'])
    const never = parseSequence('sequenceDiagram\nactivate Q\nA->>B: x\ndeactivate Q')
    expect(never.participants.map(p => p.id)).toEqual(['A', 'B'])
    expect(never.steps.map(s => s.kind)).toEqual(['message'])
  })

  test('rejects a numeric entity beyond Unicode, as mermaid does', async () => {
    for (const code of ['#9999999;', '#1114112;']) {
      const seq = parseSequence(`sequenceDiagram\nA->>B: ok\nA->>B: a${code}b`)
      expect(seq.unread).toBe(1)
      expect(seq.problems).toEqual([`line 3: character code ${code} is out of range (mermaid.live rejects)`])
    }
  })

  test('decodes numeric entities a terminal cannot show as the replacement character', async () => {
    for (const code of ['#0;', '#27;', '#55296;']) {
      const seq = parseSequence(`sequenceDiagram\nA->>B: a${code}b`)
      expect(seq.steps[0]).toMatchObject({ kind: 'message', text: 'a\uFFFDb' })
    }
    const fine = parseSequence('sequenceDiagram\nA->>B: #9731;')
    expect(fine.steps[0]).toMatchObject({ kind: 'message', text: '☃' })
  })

  test('reports a message without a colon but still draws it', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>B: ok\nA->>B')
    expect(seq.problems).toEqual(["line 3: message without ':' (mermaid.live rejects)"])
    expect(messages('A->>B')).toEqual(['A|filled|false|B|'])
  })

  test('rejects a left or right note over several participants', async () => {
    const seq = parseSequence('sequenceDiagram\nNote left of A,B: x')
    expect(seq.problems).toEqual(['line 2: note left of takes one participant (mermaid.live rejects)'])
    expect(seq.unread).toBe(1)
  })

  test('reads keywords in any case', async () => {
    const seq = parseSequence('sequenceDiagram\nParticipant A\nACTOR B as Bee\nLOOP every 5s\nA->>B: x\nElse\nEND\nActivate A\nDEACTIVATE A')
    expect(seq.participants).toEqual([
      { id: 'A', label: 'A', kind: 'participant' },
      { id: 'B', label: 'Bee', kind: 'actor' },
    ])
    expect(seq.steps.map(step => step.kind)).toEqual(['open', 'message', 'close', 'activate', 'activate'])
    expect(seq.steps[0]).toEqual({ kind: 'open', keyword: 'loop', text: 'every 5s' })
    expect(seq.problems).toEqual(['line 6: else outside alt (mermaid.live rejects)'])
  })

  test('ignores accessibility titles and descriptions, brace blocks included', async () => {
    const seq = parseSequence('sequenceDiagram\naccTitle: Quotes\naccDescr: How a quote is rated\naccDescr {\n  Several lines\n  of text\n}\nA->>B: hi')
    expect(seq.problems).toEqual([])
    expect(seq.steps.length).toBe(1)
    expect(parseSequence('sequenceDiagram\naccDescr { one line }\nA->>B: hi').problems).toEqual([])
  })

  test('drops the wrap: and nowrap: directives from labels', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>B: wrap: long text\nB->>A:nowrap:short\nNote over A: wrap: a note')
    expect(seq.steps.map(step => ('text' in step ? step.text : ''))).toEqual(['long text', 'short', 'a note'])
  })

  test('decodes common named and numeric entities', async () => {
    const seq = parseSequence('sequenceDiagram\nA->>B: 1 #rarr; #infin; #hellip; #mdash; #rArr; #9829; #deg;')
    expect(seq.steps[0]).toMatchObject({ text: '1 → ∞ … — ⇒ ♥ °' })
    expect(parseSequence('sequenceDiagram\nA->>B: #bogus;').steps[0]).toMatchObject({ text: '#bogus;' })
  })

  test('reports a message to a participant already destroyed', async () => {
    const seq = parseSequence('sequenceDiagram\ndestroy B\nA-xB: kill\nB->>A: zombie')
    expect(seq.problems).toEqual(['line 4: message touches B after destroy'])
    expect(seq.steps.map(step => step.kind)).toEqual(['message', 'destroy', 'message'])
  })

  test('keeps line breaks in a participant label', async () => {
    expect(parseSequence('sequenceDiagram\nparticipant A as Line one<br/>Line two').participants[0]).toMatchObject({ label: 'Line one\nLine two' })
  })

  test('rejects a message whose endpoint is exactly a keyword, as mermaid does', async () => {
    for (const line of ['Box->>Axe: hit', 'A->>Box: x', 'Loop->>B: x', 'Links->>B: y', 'Details->>B: z', 'End->>B: w', 'Note->>B: n', 'Else->>B: e']) {
      expect(parseSequence(`sequenceDiagram\n${line}`).unread).toBe(1)
    }
  })

  test('reads a message whose endpoint only starts with a keyword', async () => {
    const seq = parseSequence('sequenceDiagram\nLoopy->>Andy: x\nEnder->>Boxer: y')
    expect(seq.steps.map(step => (step.kind === 'message' ? `${step.from}>${step.to}` : step.kind))).toEqual(['Loopy>Andy', 'Ender>Boxer'])
    expect(seq.unread).toBeUndefined()
  })

  test('still reads keywords whose text holds an arrow after the colon', async () => {
    const seq = parseSequence('sequenceDiagram\nNote over A: A->>B later\nloop retry\nA->>B: go\nend')
    expect(seq.steps.map(step => step.kind)).toEqual(['note', 'open', 'message', 'close'])
  })

  test('reports a box left open', async () => {
    const seq = parseSequence('sequenceDiagram\nbox Team\nparticipant A\nA->>B: x')
    expect(seq.problems).toEqual(['line 4: only participants can be declared inside a box (mermaid.live rejects)', '1 box not closed, opened on line 2 (mermaid.live rejects)'])
    expect(seq.unread).toBe(2)
  })

  test('rejects a destroy whose next message does not involve it', async () => {
    const seq = parseSequence('sequenceDiagram\ndestroy Z\nA->>B: x')
    expect(seq.problems).toEqual(['line 3: the message after destroy Z must involve Z (mermaid.live rejects)'])
    expect(seq.unread).toBe(1)
    expect(parseSequence('sequenceDiagram\nA->>B: x\ndestroy B').unread).toBeUndefined()
  })

  test('reads mermaid v11 half arrows, reversed ones pointing back at the writer', async () => {
    const seq = parseSequence(
      'sequenceDiagram\nA-|\\B: top\nA--|/B: bottom\nA-\\\\B: stick\nA--//B: stick dashed\nA/|-B: back\nA\\\\--B: back dashed',
    )
    expect(seq.steps.map(step => (step.kind === 'message' ? `${step.from}>${step.to} ${step.arrow}${step.isDashed ? ' dashed' : ''}` : step.kind))).toEqual([
      'A>B half',
      'A>B half dashed',
      'A>B half',
      'A>B half dashed',
      'B>A half',
      'B>A half dashed',
    ])
    expect(seq.problems).toEqual([])
  })

  test('reads a participant type and alias from @{} metadata', async () => {
    const seq = parseSequence('sequenceDiagram\nparticipant Q@{ "type": "queue" }\nparticipant U@{ "type": "actor", "alias": "User" }\nparticipant D@{ type: \'database\' }\nQ->>U: x')
    expect(seq.participants).toEqual([
      { id: 'Q', label: 'Q', kind: 'participant', shape: 'queue' },
      { id: 'U', label: 'User', kind: 'actor' },
      { id: 'D', label: 'D', kind: 'participant', shape: 'database' },
    ])
    expect(seq.problems).toEqual([])
  })

  test('reads @{} metadata written as a YAML flow mapping', async () => {
    const seq = parseSequence("sequenceDiagram\nparticipant D@{ type: database, alias: Store }\nparticipant Q@{type: queue, alias: 'Job queue', }\nparticipant R@{type:queue}\nparticipant E@{ \"type\": }")
    expect(seq.participants.map(p => [p.id, p.label, p.shape])).toEqual([
      ['D', 'Store', 'database'],
      ['Q', 'Job queue', 'queue'],
      ['R', 'R', undefined],
      ['E', 'E', undefined],
    ])
  })

  test('rejects keywords as message ends and note targets but lets title start a message', async () => {
    for (const body of ['A->>title: x', 'A->>Actor: x', 'off->>B: x', 'Note over activate: x', 'participant box\nA->>box: x']) {
      expect(parseSequence(`sequenceDiagram\n${body}`).unread).toBeGreaterThan(0)
    }
    const sent = parseSequence('sequenceDiagram\ntitle->>B: x\nparticipant box')
    expect(sent.unread).toBeUndefined()
    expect(sent.participants.map(p => p.id)).toEqual(['title', 'B', 'box'])
  })

  test('names the line a block was left open on', async () => {
    const seq = parseSequence('sequenceDiagram\nloop a\nA->>B: x\nalt b\nB->>A: y')
    expect(seq.problems).toEqual(['2 blocks not closed, opened on lines 2, 4 (mermaid.live rejects)'])
  })

  test('reports metadata it cannot read and types it does not know', async () => {
    const seq = parseSequence('sequenceDiagram\nparticipant Q@{ type queue }\nparticipant R@{ "type": "blob" }')
    expect(seq.participants.map(p => p.shape)).toEqual([undefined, 'blob'])
    expect(seq.problems).toEqual(['line 2: metadata on Q not understood', 'line 3: participant type "blob" not known'])
  })

  test('reports an empty diagram', async () => {
    expect(parseSequence('sequenceDiagram\n').problems).toEqual(['empty diagram'])
    expect(parseSequence('sequenceDiagram\n%% nothing yet').problems).toEqual(['empty diagram'])
  })
})

describe('round 6 header and connections', () => {
  test('a header that is not exactly sequenceDiagram is unread', () => {
    const parsed = parseSequence('sequenceDiagramX\nA->>B: x')
    expect(parsed.unread).toBe(1)
    expect(parsed.problems.some(p => p.startsWith('not a sequenceDiagram'))).toBe(true)
    expect(isSequence('sequenceDiagramX\nA->>B: x')).toBe(false)
  })

  test('a central connection is reported, the message still drawn', () => {
    const parsed = parseSequence('sequenceDiagram\nA->>()B: hi')
    expect(parsed.steps).toEqual([{ kind: 'message', from: 'A', to: 'B', text: 'hi', isDashed: false, arrow: 'filled' }])
    expect(parsed.problems).toEqual(['line 2: central connection () not drawn'])
  })

  test('lines not understood count as unread', () => {
    expect(parseSequence('sequenceDiagram\nthis is not mermaid\n->>').unread).toBe(2)
    expect(parseSequence('sequenceDiagram\nA->>B: ok').unread).toBeUndefined()
  })

  test('a note over three participants is rejected', () => {
    const parsed = parseSequence('sequenceDiagram\nA->>B: x\nNote over A,B,C: three')
    expect(parsed.steps.some(step => step.kind === 'note')).toBe(false)
    expect(parsed.unread).toBe(1)
    expect(parsed.problems).toEqual(['line 3: note over takes at most two participants (mermaid.live rejects)'])
  })

  test('a note naming participants without a comma takes the whole name, as mermaid does', () => {
    const parsed = parseSequence('sequenceDiagram\nA->>B: x\nNote over A B: spaced')
    expect(parsed.participants.map(p => p.id)).toEqual(['A', 'B', 'A B'])
    expect(parsed.unread).toBeUndefined()
  })

  test('a note over the same participant twice is a note over one', () => {
    expect(parseSequence('sequenceDiagram\nNote over A,A: same').steps).toEqual([{ kind: 'note', over: ['A'], side: 'over', text: 'same' }])
  })

  test('a box inside an open box is rejected', () => {
    expect(parseSequence('sequenceDiagram\nbox X\nbox Y\nparticipant A\nend\nend').unread).toBeGreaterThan(0)
  })

  test('a bare trailing as gives an empty label, not a second participant', () => {
    const parsed = parseSequence('sequenceDiagram\nparticipant A as\nA->>B: x')
    expect(parsed.participants.map(p => [p.id, p.label])).toEqual([['A', ''], ['B', 'B']])
  })

  test('activate never creates a participant, but its bar draws once a message names it', () => {
    const parsed = parseSequence('sequenceDiagram\nactivate Q\nA->>Q: x\ndeactivate Q')
    expect(parsed.participants.map(p => p.id)).toEqual(['A', 'Q'])
    expect(parsed.steps.map(step => step.kind)).toEqual(['activate', 'message', 'activate'])
    expect(parsed.unread).toBeUndefined()
    expect(parseSequence('sequenceDiagram\nactivate A\nactivate A\ndeactivate A\ndeactivate A').participants).toEqual([])
  })

  test('the first declaration of a participant sets its kind', () => {
    const kinds = (src: string) => parseSequence(`sequenceDiagram\n${src}`).participants.map(p => p.kind)
    expect(kinds('participant A\nactor A')).toEqual(['participant'])
    expect(kinds('actor A\nparticipant A')).toEqual(['actor'])
    expect(kinds('A->>B: x\nactor A')).toEqual(['participant', 'participant'])
  })

  test('a quoted name takes the rest of the line, as included', () => {
    const parsed = parseSequence('sequenceDiagram\nparticipant "Other one" as O\nO->>B: x')
    expect(parsed.participants.map(p => p.id)).toEqual(['"Other one" as O', 'O', 'B'])
    expect(parseSequence('sequenceDiagram\nparticipant "A:B" as X\nX->>Y: q').unread).toBe(1)
  })

  test('a message on the header line is read', () => {
    const parsed = parseSequence('sequenceDiagram A->>B: x')
    expect(parsed.steps.map(step => step.kind)).toEqual(['message'])
    expect(parsed.unread).toBeUndefined()
  })

  test('source with no header is unread', () => {
    expect(parseSequence('%% nothing').unread).toBe(1)
  })

  test('a quoted note participant may hold a space', () => {
    const parsed = parseSequence('sequenceDiagram\nparticipant "Web app"\nNote over "Web app": hi')
    expect(parsed.unread).toBeUndefined()
    expect(parsed.steps).toEqual([{ kind: 'note', over: ['"Web app"'], side: 'over', text: 'hi' }])
  })

  test('a participant starting with a parenthesis is rejected', () => {
    const parsed = parseSequence('sequenceDiagram\nA->>)B: x')
    expect(parsed.participants).toEqual([])
    expect(parsed.unread).toBe(1)
    expect(parsed.problems).toContain('line 2: participant `)B` cannot start with a parenthesis (mermaid.live rejects)')
  })
})

// Expectations recorded from mermaid 11.16.1's own parser (decision 12): a rejected diagram shows its source.
const MERMAID_VERDICTS: [string, string, 'accept' | 'reject'][] = [
  ['extra end', 'A->>B: x\nend', 'reject'],
  ['unclosed alt', 'alt x\nA->>B: x', 'reject'],
  ['deactivate inactive', 'A->>B: x\ndeactivate B', 'reject'],
  ['minus on inactive sender', 'A->>-B: x', 'reject'],
  ['else outside alt', 'A->>B: x\nelse y\nA->>B: z', 'reject'],
  ['and inside alt', 'alt x\nA->>B: x\nand y\nA->>B: z\nend', 'reject'],
  ['message without colon', 'A->>B', 'reject'],
  ['destroy then other message', 'A->>B: x\ndestroy B\nA->>A: y', 'reject'],
  ['destroy then unrelated message', 'A->>B: x\nA->>C: w\ndestroy B\nA->>C: y\nA->>B: z', 'reject'],
  ['destroy of a participant never messaged next', 'A->>B: x\ndestroy Q\nA->>B: y', 'reject'],
  ['create after use', 'A->>B: x\ncreate participant B\nA->>B: y', 'reject'],
  ['create then other message', 'A->>B: x\ncreate participant C\nA->>B: y\nA->>C: z', 'reject'],
  ['create then message from it', 'A->>B: x\ncreate participant C\nC->>A: z', 'reject'],
  ['left note over two', 'Note left of A,B: x', 'reject'],
  ['note over three', 'Note over A,B,C: x', 'reject'],
  ['option outside critical', 'option x\nA->>B: y', 'reject'],
  ['else inside loop', 'loop x\nA->>B: x\nelse y\nend', 'reject'],
  ['message inside a box', 'box Team\nparticipant A\nA->>B: x', 'reject'],
  ['deactivate twice', 'activate A\ndeactivate A\ndeactivate A', 'reject'],
  ['create with nothing after', 'A->>B: x\ncreate participant C', 'accept'],
  ['destroy with nothing after', 'A->>B: x\ndestroy Z', 'accept'],
  ['destroy as the last line', 'A->>B: x\ndestroy B', 'accept'],
  ['destroy then a note only', 'A->>B: x\ndestroy B\nNote over A: n', 'accept'],
  ['destroy then message from it', 'A->>B: x\ndestroy B\nB->>A: bye', 'accept'],
  ['message after destroy', 'A->>B: x\ndestroy B\nA-xB: kill\nB->>A: zombie', 'accept'],
  ['create then message to it', 'A->>B: x\ncreate participant C\nA->>C: y', 'accept'],
  ['create actor with alias', 'A->>B: x\ncreate actor C as Carl\nA->>C: hi', 'accept'],
  ['activation left open', 'A->>+B: x', 'accept'],
  ['activated twice, deactivated once', 'activate A\nactivate A\nA->>B: x\ndeactivate A', 'accept'],
  ['hash comment in a label', 'A->>B: issue #42 fixed', 'accept'],
  ['hash comment eats the rest of the line', 'A->>B: a # b; B->>A: c', 'accept'],
  ['quoted participant', 'participant "My API"\n"My API"->>B: x', 'accept'],
  ['quoted alias', 'participant A as "My API"\nA->>B: x', 'accept'],
  ['autonumber off and on', 'autonumber\nA->>B: a\nautonumber off\nA->>B: b\nautonumber\nA->>B: c', 'accept'],
  ['and inside par_over', 'par_over x\nA->>B: x\nand y\nA->>B: z\nend', 'accept'],
  ['option inside critical', 'critical x\nA->>B: x\noption y\nA->>B: z\nend', 'accept'],
  ['central connection', 'A->>()B: x', 'accept'],
  ['unknown participant type', 'participant Q@{ "type": "blob" }\nQ->>B: x', 'accept'],
  ['percent signs mid-line', 'A->>B: x %% note', 'accept'],
  ['note right comma', 'participant A\nparticipant B\nNote right of A: hi, there', 'accept'],
  ['msg no text', 'A->>B:', 'accept'],
  ['msg empty text space', 'A->>B:   ', 'accept'],
  ['arrow in text', 'A->>B: a->>b', 'accept'],
  ['participant twice', 'participant A as One\nparticipant A as Two\nA->>A: x', 'accept'],
  ['actor after use', 'A->>B: x\nactor A', 'accept'],
  ['loop no text', 'loop\nA->>B: x\nend', 'accept'],
  ['else outside alt', 'loop x\nA->>B: y\nelse z\nA->>B: w\nend', 'reject'],
  ['and in alt', 'alt x\nA->>B: y\nand z\nA->>B: w\nend', 'reject'],
  ['option in par', 'par x\nA->>B: y\noption z\nA->>B: w\nend', 'reject'],
  ['case keywords', 'PARTICIPANT A\nA->>B: x\nNOTE OVER A: n\nLOOP l\nA->>B: y\nEND', 'accept'],
  ['box no end', 'box Blue\nparticipant A\nA->>B: x', 'reject'],
  ['box msg inside', 'box X\nparticipant A\nA->>B: x\nend', 'reject'],
  ['note no text', 'Note over A:', 'accept'],
  ['note missing', 'Note over A', 'reject'],
  ['autonumber start', 'autonumber 10 5\nA->>B: x\nA->>B: y', 'accept'],
  ['autonumber off', 'autonumber off\nA->>B: x', 'accept'],
  ['msg to self dash', 'A--)A: z', 'accept'],
  ['weird ids', 'participant A.B\nA.B->>C: x', 'accept'],
  ['id with space', 'Alice Smith->>Bob: hi', 'accept'],
  ['unicode id', 'Zürich->>東京: x', 'accept'],
  ['trailing w s', 'A->>B: x   \nend   ', 'reject'],
  ['percent in text', 'A->>B: 50% off', 'accept'],
  ['semi note', 'Note over A: a; b', 'reject'],
  ['semi participant', 'participant A; participant B', 'accept'],
  ['rect no colour', 'rect\nA->>B: x\nend', 'accept'],
  ['crit no text', 'critical\nA->>B: x\nend', 'accept'],
  ['break inside', 'loop l\nbreak b\nA->>B: x\nend\nend', 'accept'],
  ['par over', 'par_over x\nA->>B: y\nend', 'accept'],
  ['double colon', 'A->>B:: x', 'accept'],
  ['note over three', 'participant A\nparticipant B\nparticipant C\nNote over A,C: wide', 'accept'],
  ['dash alone', 'A-B: x', 'reject'],
  ['arrow typo', 'A->>>B: x', 'reject'],
  ['actor type', 'participant D as Db@{"type":"queue"}\nA->>D: q', 'accept'],
  ['A-->>>B: x', 'A-->>>B: x', 'reject'],
  ['A->>->B: x', 'A->>->B: x', 'reject'],
  ['A->->>B: x', 'A->->>B: x', 'reject'],
  ['A-x>B: x', 'A-x>B: x', 'reject'],
  ['A--xx B: x', 'A--xx B: x', 'accept'],
  ['A->>+-B: x', 'A->>+-B: x', 'reject'],
  ['A<<->>+B: x', 'A<<->>+B: x\nB-->>-A: y', 'accept'],
  ['A->> B: x', 'A->> B: x', 'accept'],
  ['A ->>B:x', 'A ->>B:x', 'accept'],
  ['A->>B :x', 'A->>B :x', 'accept'],
  ['A-->B-->C: x', 'A-->B-->C: x', 'reject'],
  ['A->>B->>C: x', 'A->>B->>C: x', 'reject'],
  ['A->>B: x', 'A->>B: x\nA->>+B: y\nA->>+B: z\ndeactivate B\ndeactivate B', 'accept'],
  ['A-|\\B: half', 'A-|\\B: half', 'accept'],
  ['A/|-B: rev', 'A/|-B: rev', 'accept'],
  ['A<<-->>A: self both', 'A<<-->>A: self both', 'accept'],
  ['A->>>>B: x', 'A->>>>B: x', 'reject'],
  ['A->B>C: x', 'A->B>C: x', 'reject'],
  ['A-B->>C: x', 'A-B->>C: x', 'accept'],
  ['A->>B: x', 'A->>B: x\nautonumber\nNote over A: n\nB->>A: y', 'accept'],
  ['participant A as A->>B', 'participant A as A->>B\nA->>B: x', 'accept'],
  ['participant A as "Quoted"', 'participant A as "Quoted"\nA->>B: x', 'accept'],
  ['A->>B: x', 'A->>B: x\n\n\nB->>A: y', 'accept'],
  ['  A->>B: x', '  A->>B: x', 'accept'],
  ['A->>B: <br>', 'A->>B: <br>', 'accept'],
  ['Note over A: line1<br/>line2', 'Note over A: line1<br/>line2\nA->>B: x', 'accept'],
  ['A->>B: x#colon;y', 'A->>B: x#colon;y', 'accept'],
  ['k2', 'Box->>A: x', 'reject'],
  ['k3', 'A->>Loopy: x', 'accept'],
  ['k4', 'Ender->>A: x', 'accept'],
  ['k5', 'participant Axe\nAxe->>B: x', 'accept'],
  ['k6', 'A->>Optimus: x', 'accept'],
  ['k7', 'Altitude->>B: x', 'accept'],
  ['k8', 'A->>Parker: x', 'accept'],
  ['k9', 'Notary->>B: x', 'accept'],
  ['k10', 'A->>Criticalpath: x', 'accept'],
  ['k11', 'Activator->>B: x', 'accept'],
  ['k12', 'Title->>B: x', 'accept'],
  ['k13', 'Destroyer->>B: x', 'accept'],
  ['k14', 'Rectangle->>B: x', 'accept'],
  ['k15', 'Else->>B: x', 'reject'],
  ['k16', 'Andy->>B: x', 'accept'],
  ['k17', 'Breaker->>B: x', 'accept'],
  ['k18', 'Created->>B: x', 'accept'],
  ['k19', 'Linked->>B: x', 'accept'],
  ['k20', 'Autonumbers->>B: x', 'accept'],
  ['k21', 'A->>B: x\nNote over A B: n', 'accept'],
  ['k22', 'Optional->>B: x', 'accept'],
  ['pctComment', 'A->>B: hello %% trailing comment', 'accept'],
  ['hashAlias', 'participant A as Foo #1\nA->>B: x', 'accept'],
  ['semiSplit', 'A->>B: x;y', 'reject'],
  ['semiTwo', 'A->>B: x; B->>A: y', 'accept'],
  ['keywordAsId', 'loop->>B: x', 'reject'],
  ['endAsId', 'end->>B: x', 'reject'],
  ['noteAsId', 'Note->>B: x', 'reject'],
  ['dashId', 'participant my-service\nmy-service->>B: x', 'accept'],
  ['dashIdUndeclared', 'my-service->>B: x', 'accept'],
  ['relabel', 'A->>B: x\nparticipant B as Bee', 'accept'],
  ['retype', 'participant A\nactor A\nA->>B: x', 'accept'],
  ['dbShape', 'participant D@{ "type": "database" }\nA->>D: q', 'accept'],
  ['dbAlias', 'participant D@{ "type": "database", "alias": "Store" }\nA->>D: q', 'accept'],
  ['autonumDecimal', 'autonumber 1.5 0.5\nA->>B: x', 'accept'],
  ['aliasEmpty', 'participant A as\nA->>B: x', 'accept'],
  ['colonInText', 'A->>B: x:y:z', 'accept'],
  ['noteReversed', 'participant A\nparticipant B\nNote over B,A: x', 'accept'],
  ['noteLeftUndeclared', 'Note left of Z: hi', 'accept'],
  ['optElse', 'opt x\nA->>B: y\nelse z\nA->>B: w\nend', 'reject'],
  ['breakElse', 'break x\nA->>B: y\nelse z\nend', 'reject'],
  ['parElse', 'par x\nA->>B: y\nelse z\nend', 'reject'],
  ['critAnd', 'critical x\nA->>B: y\nand z\nend', 'reject'],
  ['altInLoopElse', 'alt a\nloop l\nA->>B: y\nelse e\nA->>B: z\nend\nend', 'reject'],
  ['nestedOk', 'critical c\nA->>B: y\noption o\nloop l\nA->>B: z\nend\nend', 'accept'],
  ['rectText', 'rect rgb(0, 0, 0) shaded\nA->>B: x\nend', 'accept'],
  ['rectRgba', 'rect rgba(0,0,255,0.1)\nA->>B: x\nend', 'accept'],
  ['loopHash', 'loop every #5\nA->>B: x\nend', 'accept'],
  ['activateUndeclared', 'activate Q\nA->>Q: x\ndeactivate Q', 'accept'],
  ['createActor', 'A->>B: x\ncreate actor C as Carl\nB->>C: hi', 'accept'],
  ['createWrongTarget', 'A->>B: x\ncreate participant C\nB->>A: hi', 'reject'],
  ['destroyNext', 'A->>B: x\ndestroy B\nA-xB: bye', 'accept'],
  ['destroyWrong', 'A->>B: x\ndestroy B\nA->>C: bye', 'reject'],
  ['titleColon', 'title: Hello world\nA->>B: x', 'accept'],
  ['titlePlain', 'title Hello world\nA->>B: x', 'accept'],
  ['accDescrBlock', 'accDescr {\nmulti\nline\n}\nA->>B: x', 'accept'],
  ['accTitle', 'accTitle: t\naccDescr: d\nA->>B: x', 'accept'],
  ['links', 'participant A\nlinks A: {"Dash": "https://x"}\nlink A: Wiki @ https://y\nA->>B: x', 'accept'],
  ['tabIndent', '\tA->>B: x\n\t\tB-->>A: y', 'accept'],
  ['caseSensitive', 'A->>b: x\nB->>A: y', 'accept'],
  ['idAs', 'participant as\nas->>B: x', 'accept'],
  ['brInAlias', 'participant A as First<br/>Second\nA->>B: x', 'accept'],
  ['brNote', 'Note right of A: one<br>two<br/>three', 'accept'],
  ['wrapPrefix', 'A->>B: wrap: long text here', 'accept'],
  ['nowrapNote', 'Note over A: nowrap: keep', 'accept'],
  ['entityNum', 'A->>B: #9829; love', 'accept'],
  ['entityBad', 'A->>B: #notreal; x', 'accept'],
  ['spaceArrow', 'A - >> B: x', 'reject'],
  ['plusMinus', 'A->>+B: a\nB->>+C: b\nC-->>-B: c\nB-->>-A: d', 'accept'],
  ['boxColourOnly', 'box red\nparticipant A\nend\nA->>B: x', 'accept'],
  ['boxTransparent', 'box transparent Group\nparticipant A\nend\nA->>B: x', 'accept'],
  ['boxRgb', 'box rgb(1,2,3) G\nparticipant A\nend\nA->>B: x', 'accept'],
  ['boxNested', 'box X\nbox Y\nparticipant A\nend\nend', 'reject'],
  ['boxInLoop', 'loop l\nbox X\nparticipant A\nend\nend', 'accept'],
  ['participantInLoop', 'loop l\nparticipant A\nA->>B: x\nend', 'accept'],
  ['endLoopSpace', 'loop x\nA->>B: y\nend loop', 'reject'],
  ['elseNoText', 'alt\nA->>B: y\nelse\nA->>B: z\nend', 'accept'],
  ['msgSelfNote', 'A->>A: x\nNote over A: n', 'accept'],
  ['unicodeArrowText', 'A->>B: → ← ⇒', 'accept'],
  ['quoteIds', 'participant "A B"\n"A B"->>C: x', 'accept'],
  ['longChain', 'A->>B: 1\nB->>C: 2\nC->>D: 3\nD->>E: 4\nE->>F: 5\nF->>G: 6', 'accept'],
  ['noteComma3', 'Note over A, B, C: x', 'reject'],
  ['activateTwice', 'activate A\nactivate A\ndeactivate A', 'accept'],
  ['autonumOffOn', 'autonumber\nA->>B: x\nautonumber off\nA->>B: y\nautonumber\nA->>B: z', 'accept'],
  ['crossInName', 'Alex->>Bob: x\nBob-xAlex: y', 'accept'],
  ['xName', 'participant x\nA->>x: y\nx-xA: z', 'accept'],
  ['arrowSpaceText', 'A->>B : x', 'accept'],
  ['participantSemi', 'participant A as Al; A->>B: x', 'accept'],
  ['openArrowAlone', 'A-)B: async\nA--)B: dotted async', 'accept'],
  ['actOnly', 'activate A\nactivate A\ndeactivate A\ndeactivate A', 'accept'],
  ['activateQ', 'activate Q\nA->>B: x\ndeactivate Q', 'accept'],
  ['noteSame', 'Note over A,A: same', 'accept'],
  ['longId', 'Averyveryveryverylongparticipantnamewithoutspaces->>B: x\nB->>C: y', 'accept'],
  ['r11 pp1', 'participant participant', 'accept'],
  ['r11 aa1', 'actor actor', 'accept'],
  ['r11 pa', 'participant actor\nactor->>B: x', 'reject'],
  ['r11 ap', 'actor participant\nA->>participant: x', 'reject'],
  ['r11 pTitle', 'participant title\ntitle->>B: x', 'accept'],
  ['r11 pAuto', 'participant autonumber\nA->>B: x', 'accept'],
  ['r11 pBox', 'participant box', 'accept'],
  ['r11 pCreate', 'participant create\ncreate->>B: x', 'reject'],
  ['r11 pDestroy', 'participant destroy\nA->>destroy: x', 'reject'],
  ['r11 pActivate', 'A->>activate: x', 'reject'],
  ['r11 toLoop', 'A->>loop: x', 'reject'],
  ['r11 toEnd', 'A->>end: x', 'reject'],
  ['r11 toNote', 'A->>note: x', 'reject'],
  ['r11 toRect', 'A->>rect: x', 'reject'],
  ['r11 toOpt', 'A->>opt: x', 'reject'],
  ['r11 toAlt', 'A->>alt: x', 'reject'],
  ['r11 toPar', 'A->>par: x', 'reject'],
  ['r11 toElse', 'A->>else: x', 'reject'],
  ['r11 toAnd', 'A->>and: x', 'reject'],
  ['r11 toOption', 'A->>option: x', 'reject'],
  ['r11 toBreak', 'A->>break: x', 'reject'],
  ['r11 toCritical', 'A->>critical: x', 'reject'],
  ['r11 toLinks', 'A->>links: x', 'reject'],
  ['r11 toLink', 'A->>link: x', 'reject'],
  ['r11 toProps', 'A->>properties: x', 'reject'],
  ['r11 toDetails', 'A->>details: x', 'reject'],
  ['r11 toAs', 'A->>as: x', 'accept'],
  ['r11 toBoxU', 'A->>BOX: x', 'reject'],
  ['r11 toLoopU', 'A->>LOOP: x', 'reject'],
  ['r11 toTitle', 'A->>title: x', 'reject'],
  ['r11 toActor', 'A->>actor: x', 'reject'],
  ['r11 toParticipant', 'A->>participant: x', 'reject'],
  ['r11 toCreate', 'A->>create: x', 'reject'],
  ['r11 toDestroy', 'A->>destroy: x', 'reject'],
  ['r11 toAuto', 'A->>autonumber: x', 'reject'],
  ['r11 toOff', 'A->>off: x', 'reject'],
  ['r11 toLeft', 'A->>left: x', 'accept'],
  ['r11 toOver', 'A->>over: x', 'reject'],
  ['r11 toRight', 'A->>right: x', 'accept'],
  ['r11 toOf', 'A->>of: x', 'accept'],
  ['r11 fromAccTitle', 'accTitle->>B: x', 'accept'],
  ['r11 toWrap', 'A->>wrap: x', 'accept'],
  ['r11 yamlDb', 'participant D@{ type: database, alias: Store }\nA->>D: q', 'accept'],
  ['r11 yamlQ', 'participant D@{ \'type\': \'queue\' }\nA->>D: q', 'accept'],
  ['r11 metaActor', 'actor D@{ "type": "database" }\nA->>D: q', 'accept'],
  ['r11 metaBad', 'participant D@{ "type": }\nA->>D: q', 'accept'],
  ['r11 metaInMsg', 'A->>D@{ "type": "queue" }: q', 'accept'],
  ['r11 offline', 'A->>offline: x', 'accept'],
  ['r11 overload', 'A->>overload: x', 'accept'],
  ['r11 titles', 'A->>titles: x', 'accept'],
  ['r11 creator', 'A->>creator: x', 'accept'],
  ['r11 fromOff', 'off->>B: x', 'reject'],
  ['r11 fromOver', 'over->>B: x', 'reject'],
  ['r11 fromTitle', 'title->>B: x', 'accept'],
  ['r11 noteAct', 'Note over activate: x', 'reject'],
  ['r11 actAct', 'activate activate', 'accept'],
  ['r11 offMid', 'A->>B off: x', 'accept'],
  ['r11 pOff', 'participant off', 'accept'],
  ['r11 pOver', 'participant over\nA->>B: x', 'accept'],
  ['r11 overSp', 'A->>B: x\nNote over off: n', 'reject'],
  ['r11 mixedOFF', 'A->>OFF: x', 'reject'],
  ['r11 mixedTitle', 'A->>Title: x', 'reject'],
  ['r11 mixedActor', 'A->>Actor: x', 'reject'],
  ['r11 yamlBound', 'participant D@{ type: "control" }\nA->>D: q', 'accept'],
  ['r11 frag', 'A->>B: x\n```\nB->>A: y', 'reject'],
]

describe('agrees with mermaid on what it accepts', () => {
  for (const [name, body, verdict] of MERMAID_VERDICTS) {
    test(`${verdict}s: ${name}`, () => {
      const parsed = parseSequence(`sequenceDiagram\n${body}`)
      expect((parsed.unread ?? 0) > 0 ? 'reject' : 'accept').toBe(verdict)
    })
  }
})

describe('mermaid comments and counters', () => {
  const texts = (body: string) =>
    parseSequence(`sequenceDiagram\n${body}`).steps.flatMap(step => (step.kind === 'message' ? [step.text] : []))

  test('cuts a line at a # comment but keeps entities', () => {
    expect(texts('A->>B: issue #42 fixed')).toEqual(['issue'])
    expect(texts('A->>B: a # b; B->>A: c')).toEqual(['a'])
    expect(texts('A->>B: a #59; b #c d')).toEqual(['a ; b'])
    expect(parseSequence('sequenceDiagram\nparticipant A as Team #1').participants[0]?.label).toBe('Team')
  })

  test('keeps a hex colour on a box line', () => {
    expect(parseSequence('sequenceDiagram\nbox #ff0000 Team\nparticipant A\nend').boxes).toEqual([{ label: 'Team' }])
  })

  test('counts messages before autonumber is turned on', () => {
    expect(numbers('A->>B: a\nautonumber\nA->>B: b')).toEqual([undefined, 2])
  })
})

describe('malformed arrows and declarations', () => {
  test('an endpoint holding an arrow character is a malformed arrow, shown as source', () => {
    const parsed = parseSequence('sequenceDiagram\nA->>>B: typo')
    expect(parsed.participants.map(p => p.id)).toEqual([])
    expect(parsed.unread).toBe(1)
    expect(parsed.problems).toContain('line 2: arrow `A->>>B` not understood (mermaid.live rejects)')
  })

  test('a declaration whose alias looks like an arrow is still a declaration', () => {
    const parsed = parseSequence('sequenceDiagram\nparticipant A as A->>B\nA->>B: x')
    expect(parsed.participants.map(p => [p.id, p.label])).toEqual([['A', 'A->>B'], ['B', 'B']])
    expect(parsed.unread).toBeUndefined()
  })

  test('decodes named entities mermaid passes through, digits included', () => {
    const text = (label: string) => {
      const step = parseSequence(`sequenceDiagram\nA->>B: ${label}`).steps[0]
      return step?.kind === 'message' ? step.text : undefined
    }
    expect(text('x#colon;y')).toBe('x:y')
    expect(text('#semi; and #num;1')).toBe('; and #1')
    expect(text('half #frac12;')).toBe('half ½')
  })
})

describe('links', () => {
  test('notes link lines as not shown and still draws the diagram', async () => {
    const sequence = parseSequence('sequenceDiagram\nparticipant A\nlink A: Docs @ https://example.com\nA->>B: hi\nlinks B: {"x": "y"}')

    expect(sequence.problems).toEqual(['links not shown (lines 3, 5)'])
    expect(sequence.unread).toBeUndefined()
  })
})

describe('controls in the source', () => {
  test('never reach labels, problems or the diagram type', async () => {
    const sequence = parseSequence('sequenceDiagram\nparticipant A as Al\u001b[2Jice\nA->>B: hi\u001b[2J\tthere\n\u001b[31mgarbage')
    const shown = JSON.stringify(sequence)

    expect(shown.includes('\\u001b')).toBe(false)
    expect(sequence.steps).toContainEqual(expect.objectContaining({ kind: 'message', text: 'hi[2J there' }))
    expect(kindOf('\u001b[2Jpie\n"a": 1')).toBe('[2Jpie')
  })
})
