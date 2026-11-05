import type { Block, Span } from './markdown'

const PROSE_KINDS = new Set<Span['kind']>(['plain', 'footnote'])

const QUOTED = /"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g

const CLAUSE_BREAK = /[,;:()—–]|\.\s/g

const CONDITIONAL = /\b(?:if|when|whenever|unless|whether|in case)\b/

const SENTENCE_END = /(?<=[.!?])\s+/

const CLOSERS = /[\s)"'’”*_]+$/

const ADDRESSED = /\b(?:you|your|yours|me|shall i|should i|i'll|want me)\b/

const ASKING_PHRASES: RegExp[] = [
  /\blet me know\b/,
  /(?<=^|[.!?;:,] |\band |\bor |\bjust |\bplease )tell me\b/,
  /\bi need to know\b/,
  /\bwaiting (?:on|for) (?:you|your)\b/,
  /\bblocked (?:on|by|until) (?:you|your)\b/,
  /\b(?:i|we) need you to\b/,
  /\b(?:needs?|requires?) (?:you|your)\b/,
  /\b(?:requires?|needs?) (?:a )?(?:sign|log)[- ]?in\b/,
  /\byou(?:'ll| will)? (?:need|have) to\b/,
  /\b(?:can|could|would) you\b/,
  /\bplease (?:run|sign|log|confirm|approve|check|restart|review|install|start|grant|enable|provide|share|paste|send|try|re-?run|reload|open|add|set|update|let|merge|push|pick|choose|decide)\b/,
  /\bonce you(?:'ve| have)\b/,
  /\bonce you (?:sign|log|run|restart|approve|confirm|install|start|enable|grant|reply|decide|answer|pick|choose|share|send|merge|push|unlock)\b/,
  /\buntil you\b/,
  /\bwhen you(?:'re| are) ready\b/,
  /\b(?:over|up) to you\b/,
  /\byour call\b/,
]

export function proseOf(spans: Span[]): string {
  return spans
    .map(span => (PROSE_KINDS.has(span.kind) ? span.text : 'x'))
    .join('')
    .replace(QUOTED, 'x')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isConditional(prose: string, at: number): boolean {
  let clauseStart = 0
  for (const found of prose.slice(0, at).matchAll(CLAUSE_BREAK)) clauseStart = (found.index ?? 0) + found[0].length
  return CONDITIONAL.test(prose.slice(clauseStart, at))
}

const SCANS = ASKING_PHRASES.map(phrase => new RegExp(phrase.source, 'g'))

const phrased = new WeakMap<Block, boolean>()

export function hasAskingPhrase(prose: string): boolean {
  return SCANS.some(scan => {
    for (const found of prose.matchAll(scan)) if (!isConditional(prose, found.index ?? 0)) return true
    return false
  })
}

function asksByPhrase(b: Block): boolean {
  if (b.kind !== 'paragraph') return false
  const known = phrased.get(b)
  if (known !== undefined) return known
  const asking = hasAskingPhrase(proseOf(b.spans))
  phrased.set(b, asking)
  return asking
}

function sentencesOf(prose: string): string[] {
  return prose
    .split(SENTENCE_END)
    .map(sentence => sentence.replace(CLOSERS, ''))
    .filter(sentence => sentence !== '')
}

export function endsAsking(prose: string): boolean {
  const sentences = sentencesOf(prose)
  if (sentences.at(-1)?.endsWith('?')) return true
  return sentences.some(sentence => sentence.endsWith('?') && ADDRESSED.test(sentence))
}

function isQuestionList(b: Block): boolean {
  if (b.kind !== 'list') return false
  return b.items.every(item => item.blocks.some(child => child.kind === 'paragraph' && proseOf(child.spans).endsWith('?')))
}

function trailingAsks(blocks: Block[]): Block[] {
  const asks: Block[] = []
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b === undefined || b.kind === 'heading' || b.kind === 'rule' || b.kind === 'quote') break
    if (b.kind === 'paragraph') {
      if (!endsAsking(proseOf(b.spans))) break
      asks.push(b)
    } else if (isQuestionList(b)) asks.push(b)
  }
  return asks
}

export function asksOf(blocks: Block[], endsTurn: boolean): Set<Block> {
  const asks = new Set<Block>(blocks.filter(asksByPhrase))
  if (endsTurn) for (const b of trailingAsks(blocks)) asks.add(b)
  return asks
}
