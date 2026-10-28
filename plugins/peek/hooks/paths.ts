import { Lexer, walkTokens } from './vendor/marked.js'

const IMAGE_FILE = /\.(?:png|jpg|jpeg|gif|webp|heic)$/i

const URL = /^[a-z][a-z0-9+.-]*:/i

const IMAGE_TAG = /\[Image #(\d+)\]/g

const BARE_PATH = /(?:^|\s)([~/](?:\\ |\S)+)/g

const QUOTED_PATH = /"([~/][^"]+)"|'([~/][^']+)'/g

export function isImagePath(path: string): boolean {
  return IMAGE_FILE.test(path)
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

export function fromFileUrl(src: string): string | undefined {
  if (!src.startsWith('file://')) return src
  const rest = src.slice('file://'.length)
  const slash = rest.indexOf('/')
  const authority = slash < 0 ? rest : rest.slice(0, slash)
  return authority === '' || authority.toLowerCase() === 'localhost' ? decoded(rest.slice(authority.length)) : undefined
}

function localPath(href: string): string | undefined {
  if (href.startsWith('file://')) return fromFileUrl(href)
  return URL.test(href) ? undefined : decoded(href)
}

function imageHrefs(text: string): string[] {
  if (!text.includes('![')) return []
  const hrefs: string[] = []
  walkTokens(Lexer.lex(text, { gfm: true }), token => {
    if (token.type === 'image') hrefs.push(token.href)
  })
  return hrefs
}

export function localImages(text: string): string[] {
  return imageHrefs(text).flatMap(href => {
    const path = localPath(href)
    return path !== undefined && isImagePath(path) ? [path] : []
  })
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

function unescaped(path: string): string {
  let out = ''
  for (let i = 0; i < path.length; i++) {
    if (path.charAt(i) === '\\' && i + 1 < path.length) i++
    out += path.charAt(i)
  }
  return out
}

export function unquoted(token: string): string {
  const quoted = token.length > 1 && (token.startsWith('"') || token.startsWith("'")) && token.endsWith(token.charAt(0))
  return quoted ? token.slice(1, -1) : unescaped(token)
}

export function barePaths(text: string): string[] {
  const bare = [...text.matchAll(BARE_PATH)].map(m => unescaped(m[1] ?? ''))
  const quoted = [...text.matchAll(QUOTED_PATH)].map(m => m[1] ?? m[2] ?? '')
  return [...new Set([...quoted, ...bare])].filter(isImagePath)
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
  return tokens.map(unquoted).filter(t => isImagePath(t) && !URL.test(t) && (!moves || t.startsWith('/') || t.startsWith('~/')))
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
