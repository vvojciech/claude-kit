export type CodeRole = 'plain' | 'keyword' | 'string' | 'comment'

export type CodeToken = { text: string; role: CodeRole }

type Grammar = {
  lineComments: readonly string[]
  blockComment?: readonly [string, string]
  quotes: readonly string[]
  multilineQuotes: readonly string[]
  keywords: boolean
}

type Open = { role: 'comment' | 'string'; closer: string } | undefined

const C_LIKE: Grammar = { lineComments: ['//'], blockComment: ['/*', '*/'], quotes: ['"', "'", '`'], multilineQuotes: ['`'], keywords: true }

const HASH: Grammar = { lineComments: ['#'], quotes: ['"""', "'''", '"', "'"], multilineQuotes: ['"""', "'''"], keywords: true }

const SQL_LIKE: Grammar = { lineComments: ['--'], blockComment: ['/*', '*/'], quotes: ["'", '"'], multilineQuotes: [], keywords: true }

const CSS: Grammar = { lineComments: [], blockComment: ['/*', '*/'], quotes: ['"', "'"], multilineQuotes: [], keywords: false }

const DATA: Grammar = { lineComments: [], quotes: ['"'], multilineQuotes: [], keywords: true }

const GRAMMARS: Record<string, Grammar> = {
  ...Object.fromEntries(
    ['js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript', 'mjs', 'cjs', 'java', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'csharp', 'go', 'kotlin', 'kt', 'swift', 'scala', 'php', 'dart', 'groovy', 'scss', 'less', 'proto'].map(id => [id, C_LIKE]),
  ),
  ...Object.fromEntries(['py', 'python', 'rb', 'ruby', 'rake', 'gemspec', 'yaml', 'yml', 'toml', 'r', 'perl', 'pl', 'elixir', 'ex', 'exs', 'dockerfile', 'make', 'makefile', 'nim', 'coffee', 'ini', 'conf', 'graphql', 'gql'].map(id => [id, HASH])),
  ...Object.fromEntries(['sql', 'psql', 'plsql', 'lua', 'haskell', 'hs'].map(id => [id, SQL_LIKE])),
  rust: { ...C_LIKE, quotes: ['"'], multilineQuotes: [] },
  rs: { ...C_LIKE, quotes: ['"'], multilineQuotes: [] },
  css: CSS,
  json: DATA,
  jsonc: { ...DATA, lineComments: ['//'], blockComment: ['/*', '*/'] },
}

const KEYWORDS = new Set([
  'abstract', 'and', 'as', 'async', 'await', 'begin', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default', 'defer', 'del', 'do', 'elif',
  'else', 'elsif', 'end', 'ensure', 'enum', 'except', 'export', 'extends', 'false', 'False', 'finally', 'fn', 'for', 'from', 'func', 'function', 'go', 'if',
  'impl', 'implements', 'import', 'in', 'include', 'interface', 'is', 'lambda', 'let', 'match', 'module', 'mut', 'new', 'nil', 'None', 'not', 'null', 'of',
  'or', 'package', 'pass', 'private', 'protected', 'pub', 'public', 'raise', 'require', 'rescue', 'return', 'select', 'self', 'static', 'struct', 'super',
  'switch', 'then', 'this', 'throw', 'trait', 'true', 'True', 'try', 'type', 'typeof', 'undefined', 'unless', 'until', 'use', 'val', 'var', 'when', 'where',
  'while', 'with', 'yield', 'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'INNER', 'ON', 'GROUP', 'ORDER', 'BY', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'LIMIT', 'HAVING', 'UNION', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT',
])

const WORD = /^[A-Za-z_$][\w$]*/

export function grammarOf(language: string): Grammar | undefined {
  return GRAMMARS[language]
}

function startsAny(line: string, at: number, candidates: readonly string[]): string | undefined {
  return candidates.find(candidate => line.startsWith(candidate, at))
}

function closingIndex(line: string, from: number, closer: string, escapable: boolean): number {
  for (let i = from; i < line.length; i++) {
    if (escapable && line[i] === '\\') {
      i++
      continue
    }
    if (line.startsWith(closer, i)) return i + closer.length
  }
  return -1
}

function push(tokens: CodeToken[], text: string, role: CodeRole): void {
  if (text === '') return
  const previous = tokens.at(-1)
  if (previous && (previous.role === role || /^\s+$/.test(text))) previous.text += text
  else tokens.push({ text, role })
}

function resume(line: string, open: NonNullable<Open>, tokens: CodeToken[]): { at: number; open: Open } {
  const end = closingIndex(line, 0, open.closer, open.role === 'string')
  if (end === -1) {
    push(tokens, line, open.role)
    return { at: line.length, open }
  }
  push(tokens, line.slice(0, end), open.role)
  return { at: end, open: undefined }
}

function scanLine(line: string, grammar: Grammar, carried: Open): { tokens: CodeToken[]; open: Open } {
  const tokens: CodeToken[] = []
  let { at, open } = carried ? resume(line, carried, tokens) : { at: 0, open: undefined as Open }
  while (at < line.length) {
    const block = grammar.blockComment && line.startsWith(grammar.blockComment[0], at) ? grammar.blockComment : undefined
    if (block) {
      const end = closingIndex(line, at + block[0].length, block[1], false)
      push(tokens, line.slice(at, end === -1 ? line.length : end), 'comment')
      if (end === -1) return { tokens, open: { role: 'comment', closer: block[1] } }
      at = end
      continue
    }
    if (startsAny(line, at, grammar.lineComments)) {
      push(tokens, line.slice(at), 'comment')
      break
    }
    const quote = startsAny(line, at, grammar.quotes)
    if (quote) {
      const end = closingIndex(line, at + quote.length, quote, true)
      push(tokens, line.slice(at, end === -1 ? line.length : end), 'string')
      if (end === -1 && grammar.multilineQuotes.includes(quote)) open = { role: 'string', closer: quote }
      at = end === -1 ? line.length : end
      continue
    }
    const word = WORD.exec(line.slice(at))?.[0]
    if (word) {
      push(tokens, word, grammar.keywords && KEYWORDS.has(word) ? 'keyword' : 'plain')
      at += word.length
      continue
    }
    push(tokens, line[at] ?? '', 'plain')
    at++
  }
  return { tokens, open }
}

export function highlight(language: string, lines: readonly string[]): CodeToken[][] {
  const grammar = grammarOf(language)
  if (!grammar) return lines.map(line => (line === '' ? [] : [{ text: line, role: 'plain' }]))
  let open: Open
  return lines.map(line => {
    const scanned = scanLine(line, grammar, open)
    open = scanned.open
    return scanned.tokens
  })
}
