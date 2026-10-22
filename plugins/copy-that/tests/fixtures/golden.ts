import type { Block } from '../../hooks/model'

export function shape(blocks: readonly Block[]): Block[] {
  return blocks.map(({ kind, source, depth, lang, text }) => {
    const code = kind === 'code' ? { lang, text } : {}
    return { kind, source: source.trimEnd(), depth, ...code }
  })
}
