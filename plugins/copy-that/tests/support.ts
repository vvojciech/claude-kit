import { blocksOf } from '../hooks/lexer'
import type { Resolved } from '../hooks/targets'

export function resolved(text: string, partial = false): Resolved {
  return { text, partial, blocks: blocksOf(text) }
}

export function resolvedReply(texts: string[], partial = false): Resolved {
  return { text: texts.join('\n\n'), partial, blocks: texts.flatMap(blocksOf) }
}
