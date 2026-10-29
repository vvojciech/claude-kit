// Mermaid's `#35;` and `#quot;` entities, and their HTML spellings `&#35;` and `&quot;`. A code
// point that would reach the terminal as a control or a lone surrogate becomes �; one past U+10FFFF
// throws, so the caller shows the source.

export const NAMED: Record<string, string> = {
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

const REPLACEMENT = '�'

const isControl = (point: number) => point < 0x20 || (point >= 0x7f && point < 0xa0)

const isHidden = (point: number) => (point >= 0xd800 && point <= 0xdfff) || isControl(point)

const isDigit = (char: string) => char >= '0' && char <= '9'

const isWord = (char: string) => isDigit(char) || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_'

// the entity `text` ends with, `;` not included: where it starts and its name
function entityAt(text: string): { start: number; name: string } | undefined {
  const at = Math.max(text.lastIndexOf('#'), text.lastIndexOf('&'))
  const name = text.slice(at + 1)
  if (at < 0 || name === '' || ![...name].every(isWord)) return undefined
  // `&C` past a node is a fan-out such as `B&C`, not an entity
  if (text[at] === '&' && NAMED[name] === undefined && NAMED[name.toLowerCase()] === undefined) return undefined
  return { start: text[at] === '#' && text[at - 1] === '&' ? at - 1 : at, name }
}

export const endsInEntity = (text: string) => entityAt(text) !== undefined

function decoded(name: string): string | undefined {
  if (![...name].every(isDigit)) return NAMED[name] ?? NAMED[name.toLowerCase()]
  const point = Number(name)
  return isHidden(point) ? REPLACEMENT : String.fromCodePoint(point)
}

export function decodeEntities(text: string): string {
  const parts = text.split(';')
  const last = parts.pop() ?? ''
  const shown = parts.map(part => {
    const entity = entityAt(part)
    const char = entity && decoded(entity.name)
    return entity && char !== undefined ? part.slice(0, entity.start) + char : `${part};`
  })
  return shown.join('') + last
}

// controls typed straight into a label never reach the terminal; a tab reads as a space
export const withoutControls = (text: string) =>
  [...text].map(char => (char === '\t' ? ' ' : char)).filter(char => char === '\n' || !isControl(char.codePointAt(0) ?? 0)).join('')
