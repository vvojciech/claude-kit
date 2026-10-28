const IMAGE_FILE = /\.(?:png|jpg|jpeg|gif|webp|heic)$/i

const URL = /^[a-z][a-z0-9+.-]*:/i


const IMAGE_TAG = /\[Image #(\d+)\]/g

const BARE_PATH = /(?:^|\s)((?:~|\/)(?:\\ |[^\s])+\.(?:png|jpg|jpeg|gif|webp|heic))(?=\s|$)/gi

const QUOTED_PATH = /(['"])((?:~|\/)[^'"]+\.(?:png|jpg|jpeg|gif|webp|heic))\1/gi

export type Linked = { alt: string; src: string }

export function isImagePath(path: string): boolean {
  return IMAGE_FILE.test(path)
}

export function isUrl(src: string): boolean {
  return URL.test(src) && !src.startsWith('file:')
}

export function nameOf(path: string): string {
  return path.split('/').pop() ?? path
}

export function extensionOf(path: string): string {
  return (path.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase()
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function fromFileUrl(src: string): string {
  if (!src.startsWith('file://')) return src
  const rest = src.slice('file://'.length)
  return decoded(rest.startsWith('localhost/') ? rest.slice('localhost'.length) : rest)
}

function destination(src: string): string {
  if (src.startsWith('file://')) return fromFileUrl(src)
  return isUrl(src) ? src : decoded(src)
}

function runAt(line: string, at: number, char = '`'): number {
  let end = at
  while (line.charAt(end) === char) end++
  return end - at
}

function fenceOf(line: string): string | undefined {
  const text = line.trimStart()
  const char = text.charAt(0)
  const run = char === '`' || char === '~' ? runAt(text, 0, char) : 0
  return run >= 3 ? text.slice(0, run) : undefined
}

function closes(line: string, open: string): boolean {
  const fence = fenceOf(line)
  return fence !== undefined && fence.charAt(0) === open.charAt(0) && fence.length >= open.length && line.trim() === fence
}

function closingTicks(line: string, from: number, run: number): number {
  for (let at = line.indexOf('`', from); at >= 0; at = line.indexOf('`', at + runAt(line, at))) {
    if (runAt(line, at) === run) return at
  }
  return -1
}

// a code span closes on the next run of exactly as many backticks; an unclosed run is literal
function withoutSpans(line: string): string {
  let out = ''
  let at = 0
  for (let tick = line.indexOf('`'); tick >= 0; tick = line.indexOf('`', at)) {
    const run = runAt(line, tick)
    const close = closingTicks(line, tick + run, run)
    out += close < 0 ? line.slice(at, tick + run) : `${line.slice(at, tick)} `
    at = close < 0 ? tick + run : close + run
  }
  return out + line.slice(at)
}

function outsideCode(text: string): string {
  let fence: string | undefined
  const kept: string[] = []
  for (const line of text.split('\n')) {
    if (fence === undefined) {
      fence = fenceOf(line)
      if (fence === undefined) kept.push(withoutSpans(line))
    } else if (closes(line, fence)) fence = undefined
  }
  return kept.join('\n')
}

const isSpace = (char: string) => char === ' ' || char === '\t' || char === '\n'

function skipSpaces(text: string, at: number): number {
  let next = at
  while (next < text.length && isSpace(text.charAt(next))) next++
  return next
}

// a destination runs to whitespace or to the `)` that balances its own parentheses; `\)` is a literal
function bareEnd(text: string, from: number): number {
  let depth = 0
  for (let at = from; at < text.length; at++) {
    const char = text.charAt(at)
    if (char === '\\') at++
    else if (isSpace(char) || (char === ')' && depth === 0)) return at
    else if (char === '(') depth++
    else if (char === ')') depth--
  }
  return text.length
}

function destinationAt(text: string, from: number): { raw: string; end: number } | undefined {
  if (text.charAt(from) === '<') {
    const close = text.indexOf('>', from + 1)
    return close > from + 1 ? { raw: text.slice(from + 1, close), end: close + 1 } : undefined
  }
  const end = bareEnd(text, from)
  return end > from ? { raw: unescaped(text.slice(from, end)), end } : undefined
}

function imageAt(text: string, start: number): Linked | undefined {
  if (text.charAt(start - 1) === '\\') return undefined
  const close = text.indexOf(']', start + 2)
  if (close < 0 || text.charAt(close + 1) !== '(') return undefined
  const dest = destinationAt(text, skipSpaces(text, close + 2))
  if (dest === undefined) return undefined
  let at = skipSpaces(text, dest.end)
  if (text.charAt(at) === '"') at = skipSpaces(text, text.indexOf('"', at + 1) + 1)
  return text.charAt(at) === ')' && at > 0 ? { alt: text.slice(start + 2, close), src: destination(dest.raw) } : undefined
}

export function markdownImages(text: string): Linked[] {
  const prose = outsideCode(text)
  const found: Linked[] = []
  for (let at = prose.indexOf('!['); at >= 0; at = prose.indexOf('![', at + 2)) {
    const image = imageAt(prose, at)
    if (image) found.push(image)
  }
  return found
}

export function localImages(text: string): Linked[] {
  return markdownImages(text).filter(link => !isUrl(link.src) && isImagePath(link.src))
}

export function resolvePath(path: string, cwd: string, home: string): string {
  if (path.startsWith('~/')) return `${home}${path.slice(1)}`
  if (path.startsWith('/')) return path
  const base = cwd.replace(/\/$/, '')
  return normalise(`${base}/${path.replace(/^\.\//, '')}`)
}

function normalise(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return `/${parts.join('/')}`
}

export function imageTags(text: string): number[] {
  return [...new Set([...text.matchAll(IMAGE_TAG)].map(m => Number(m[1])))]
}

export function unescaped(path: string): string {
  let out = ''
  for (let i = 0; i < path.length; i++) {
    if (path.charAt(i) === '\\' && i + 1 < path.length) i++
    out += path.charAt(i)
  }
  return out
}

function unquoted(token: string): string {
  const quoted = token.length > 1 && (token.startsWith('"') || token.startsWith("'")) && token.endsWith(token.charAt(0))
  return quoted ? token.slice(1, -1) : unescaped(token)
}

export function barePaths(text: string): string[] {
  const bare = [...text.matchAll(BARE_PATH)].map(m => unescaped(m[1] ?? ''))
  const quoted = [...text.matchAll(QUOTED_PATH)].map(m => m[2] ?? '')
  return [...new Set([...quoted, ...bare])]
}

function inputPath(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const CHANGES_DIRECTORY = new Set(['cd', 'pushd', 'popd'])

function commandPaths(command: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|(?:\\[\s\S]|[^\s;|&><\\])+/g) ?? []
  const moves = tokens.some(t => CHANGES_DIRECTORY.has(t))
  return tokens.map(unquoted).filter(t => isImagePath(t) && !isUrl(t) && (!moves || t.startsWith('/') || t.startsWith('~/')))
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

export function toolImagePaths(tool: string, input: unknown): string[] {
  if (FILE_TOOLS.has(tool)) {
    const path = inputPath(input, 'file_path')
    return path !== undefined && isImagePath(path) ? [path] : []
  }
  if (tool === 'Bash') return [...new Set(commandPaths(inputPath(input, 'command') ?? ''))]
  return []
}
