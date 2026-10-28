const IMAGE_FILE = /\.(?:png|jpg|jpeg|gif|webp|heic)$/i

const URL = /^[a-z][a-z0-9+.-]*:/i

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g

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

function unwrap(src: string): string {
  return src.startsWith('<') && src.endsWith('>') ? src.slice(1, -1) : src
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function fromFileUrl(src: string): string {
  return src.startsWith('file://') ? decoded(src.slice('file://'.length)) : src
}

export function markdownImages(text: string): Linked[] {
  return [...text.matchAll(MARKDOWN_IMAGE)].map(m => ({ alt: m[1] ?? '', src: fromFileUrl(unwrap(m[2] ?? '')) }))
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

function unescapeSpaces(path: string): string {
  return path.replace(/\\ /g, ' ')
}

export function barePaths(text: string): string[] {
  const bare = [...text.matchAll(BARE_PATH)].map(m => unescapeSpaces(m[1] ?? ''))
  const quoted = [...text.matchAll(QUOTED_PATH)].map(m => m[2] ?? '')
  return [...new Set([...quoted, ...bare])]
}

function inputPath(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function commandPaths(command: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|(?:\\ |[^\s;|&><])+/g) ?? []
  return tokens.map(t => unescapeSpaces(t.replace(/^['"]|['"]$/g, ''))).filter(t => isImagePath(t) && !isUrl(t))
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
