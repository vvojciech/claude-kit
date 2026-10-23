import type { Elements, EngineInterface, RenderNode } from 'claude-code'

import type { Block, Span } from './markdown'
import type { Palette } from './palette'

export type Picture = { source: { png: string }; columns: number; rows: number; alt: string; path: string; name: string; caption: string; open: string; key: string }

export type Placed = { kind: 'picture'; picture: Picture }

export type Pictures = { found: ReadonlyMap<string, Picture>; node: (picture: Picture, key: string) => RenderNode }

export type Asking = { requestId?: string; columns: number; isFullscreen?: boolean }

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Image' | 'Button'>

declare module 'claude-code' {
  interface EngineInterface {
    peek: { picture: (args: { path: string } & Asking) => Promise<unknown>; open: (args: { path: string }) => Promise<unknown> }
  }
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function isLocalImage(src: string): boolean {
  return !SCHEME.test(src) || src.toLowerCase().startsWith('file:')
}

function localSources(spans: Span[]): string[] {
  return spans.flatMap(span => (span.kind === 'image' && span.src !== undefined && isLocalImage(span.src) ? [span.src] : []))
}

export function imageSources(blocks: Block[]): string[] {
  return [...new Set(blocks.flatMap(b => (b.kind === 'paragraph' ? localSources(b.spans) : [])))]
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

export function isPicture(value: unknown): value is Picture {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<Picture>
  const strings = [p.alt, p.path, p.name, p.caption, p.open, p.key, p.source?.png]
  return strings.every(isText) && Number.isInteger(p.columns) && Number.isInteger(p.rows)
}

async function asked($: EngineInterface, path: string, asking: Asking): Promise<Picture | undefined> {
  try {
    const answer = await $.peek.picture({ path, ...asking })
    return isPicture(answer) ? answer : undefined
  } catch {
    return undefined
  }
}

export async function picturesOf($: EngineInterface, sources: string[], asking: Asking): Promise<Map<string, Picture>> {
  const answers = await Promise.all(sources.map(async src => [src, await asked($, src, asking)] as const))
  return new Map(answers.flatMap(([src, picture]) => (picture === undefined ? [] : [[src, picture] as const])))
}

function trimmed(spans: Span[], side: 'start' | 'end'): Span[] {
  const edge = side === 'start' ? 0 : spans.length - 1
  const span = spans[edge]
  if (span === undefined || span.kind === 'image') return spans
  const text = side === 'start' ? span.text.trimStart() : span.text.trimEnd()
  const rest = side === 'start' ? spans.slice(1) : spans.slice(0, -1)
  if (text === '') return trimmed(rest, side)
  return side === 'start' ? [{ ...span, text }, ...rest] : [...rest, { ...span, text }]
}

function paragraphOf(spans: Span[], hang: number | undefined): Block[] {
  const kept = trimmed(trimmed(spans, 'start'), 'end')
  if (kept.length === 0) return []
  return [hang === undefined ? { kind: 'paragraph', spans: kept } : { kind: 'paragraph', spans: kept, hang }]
}

function splitParagraph(b: Extract<Block, { kind: 'paragraph' }>, found: ReadonlyMap<string, Picture>): (Block | Placed)[] {
  const laid: (Block | Placed)[] = []
  let run: Span[] = []
  for (const span of b.spans) {
    const picture = span.kind === 'image' && span.src !== undefined ? found.get(span.src) : undefined
    if (picture === undefined) run.push(span)
    else {
      laid.push(...paragraphOf(run, b.hang), { kind: 'picture', picture })
      run = []
    }
  }
  return [...laid, ...paragraphOf(run, b.hang)]
}

export function laidOut(blocks: Block[], found: ReadonlyMap<string, Picture>): (Block | Placed)[] {
  if (found.size === 0) return blocks
  return blocks.flatMap(b => (b.kind === 'paragraph' && localSources(b.spans).some(src => found.has(src)) ? splitParagraph(b, found) : [b]))
}

function openButton(kit: Kit, palette: Palette, picture: Picture, key: string, open: () => void): RenderNode {
  return (
    <kit.Button key={`lucid-open-${key}`} plain label={picture.open} onPress={open}>
      <kit.Text color={palette.muted} hover={{ color: palette.text, underline: true }}>
        {picture.open}
      </kit.Text>
    </kit.Button>
  )
}

export function thumbnail(kit: Kit, palette: Palette, picture: Picture, key: string, open: () => void): RenderNode {
  return (
    <kit.Box key={`picture-${key}`} flexDirection="row">
      <kit.Image key={key} source={picture.source} columns={picture.columns} rows={picture.rows} alt={picture.alt} />
      <kit.Box key="side" flexDirection="column" paddingLeft={1} flexShrink={1}>
        <kit.Text color={palette.muted} wrap="truncate-end">
          {picture.name}
        </kit.Text>
        <kit.Text color={palette.muted}>{picture.caption}</kit.Text>
        <kit.Box height={1}>{openButton(kit, palette, picture, key, open)}</kit.Box>
      </kit.Box>
    </kit.Box>
  )
}
