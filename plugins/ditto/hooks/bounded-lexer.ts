import { Lexer, Tokenizer } from './vendor/marked.js'
import type { Token, Tokens, TokensList } from './vendor/marked.js'

const DELIMITER_BUDGET_PER_CHAR = 32

const DELIMITER_BUDGET_FLOOR = 4096

const NESTING_LIMIT = 24

const INLINE_LIMIT = 20_000

const TABLE_WITH_CODE = /^[^\n]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-[^\n]*\n[\s\S]*?`/

class BoundedTokenizer extends Tokenizer {
  budget = 0

  override emStrong(src: string, maskedSrc: string, prevChar?: string): Tokens.Em | Tokens.Strong | undefined {
    if (this.budget <= 0) return undefined
    return this.spend(src, super.emStrong(src, maskedSrc, prevChar))
  }

  override del(src: string, maskedSrc: string, prevChar?: string): Tokens.Del | undefined {
    if (this.budget <= 0) return undefined
    return this.spend(src, super.del(src, maskedSrc, prevChar))
  }

  override table(src: string): Tokens.Table | undefined {
    if (!TABLE_WITH_CODE.test(src)) return super.table(src)
    const token = super.table(protectCodePipes(src))
    if (token) token.raw = originalPrefix(src, token.raw)
    return token
  }

  private spend<T extends { raw: string }>(src: string, token: T | undefined): T | undefined {
    this.budget -= token ? token.raw.length : src.length
    return token
  }
}

class BoundedLexer extends Lexer {
  private inlineDepth = 0
  private blockDepth = 0
  private readonly bounded: BoundedTokenizer

  constructor(bounded: BoundedTokenizer) {
    super({ gfm: true, tokenizer: bounded })
    this.bounded = bounded
  }

  override blockTokens(src: string, tokens?: Token[], lastParagraphClipped?: boolean): Token[]
  override blockTokens(src: string, tokens?: TokensList, lastParagraphClipped?: boolean): TokensList
  override blockTokens(src: string, tokens: Token[] = [], lastParagraphClipped?: boolean): Token[] {
    if (this.blockDepth >= NESTING_LIMIT) return appended(tokens, verbatimBlock(src))
    this.blockDepth++
    try {
      return super.blockTokens(src, tokens, lastParagraphClipped)
    } finally {
      this.blockDepth--
    }
  }

  override inlineTokens(src: string, tokens: Token[] = []): Token[] {
    if (this.inlineDepth === 0) this.bounded.budget = DELIMITER_BUDGET_FLOOR + DELIMITER_BUDGET_PER_CHAR * src.length
    if (this.inlineDepth >= NESTING_LIMIT || src.length > INLINE_LIMIT) return appended(tokens, verbatimText(src))
    this.inlineDepth++
    try {
      return super.inlineTokens(src, tokens)
    } finally {
      this.inlineDepth--
    }
  }
}

function appended<T extends Token[]>(tokens: T, token: Token): T {
  tokens.push(token)
  return tokens
}

function verbatimBlock(src: string): Token {
  return { type: 'code', raw: src, text: src.replace(/\n+$/, ''), lang: '', codeBlockStyle: 'indented' } as Tokens.Code
}

function verbatimText(src: string): Token {
  return { type: 'text', raw: src, text: src, escaped: false } as Tokens.Text
}

function lexer(): BoundedLexer {
  return new BoundedLexer(new BoundedTokenizer())
}

export function lexBlocks(markdown: string): Token[] {
  return lexer().lex(markdown)
}

export function lexInline(markdown: string): Token[] {
  return lexer().inlineTokens(markdown)
}

function protectCodePipes(src: string): string {
  const end = src.search(/\n[ \t]*(?:\n|$)/)
  const table = end === -1 ? src : src.slice(0, end)
  return table.split('\n').map(escapePipesInCode).join('\n') + (end === -1 ? '' : src.slice(end))
}

function escapePipesInCode(line: string): string {
  if (!line.includes('`')) return line
  let out = ''
  let fence = ''
  for (let i = 0; i < line.length; i++) {
    const char = line[i] ?? ''
    if (char === '\\') {
      out += char + (line[i + 1] ?? '')
      i++
    } else if (char === '`') {
      const run = /^`+/.exec(line.slice(i))?.[0] ?? '`'
      if (fence === '') fence = line.indexOf(run, i + run.length) === -1 ? '' : run
      else if (fence === run) fence = ''
      out += run
      i += run.length - 1
    } else {
      out += fence !== '' && char === '|' ? '\\|' : char
    }
  }
  return out
}

function originalPrefix(src: string, raw: string): string {
  const newlines = raw.split('\n').length - 1
  let index = 0
  for (let n = 0; n < newlines; n++) index = src.indexOf('\n', index) + 1
  if (raw.endsWith('\n')) return src.slice(0, index)
  const next = src.indexOf('\n', index)
  return next === -1 ? src : src.slice(0, next)
}
