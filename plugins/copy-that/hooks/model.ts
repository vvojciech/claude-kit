import type { EngineInterface } from 'claude-code'

import { blocksOf } from './lexer'

type BlockKind = 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'quote' | 'rule'

export type Block = { kind: BlockKind; source: string; depth: number; lang?: string; text?: string }

declare module 'claude-code' {
  interface EngineInterface {
    lucid: { blocks: (args: { text: string }) => Promise<unknown>; tone: () => Promise<unknown> }
  }
}

async function lucidBlocks($: EngineInterface, text: string): Promise<unknown> {
  try {
    return await $.lucid.blocks({ text })
  } catch {
    return undefined
  }
}

function isBlock(value: unknown): value is Block {
  if (typeof value !== 'object' || value === null) return false
  const { kind, source } = value as Partial<Block>
  return typeof kind === 'string' && typeof source === 'string'
}

function wellFormed(blocks: unknown): blocks is Block[] {
  return Array.isArray(blocks) && blocks.every(isBlock)
}

export async function drawnBlocks($: EngineInterface, text: string): Promise<Block[]> {
  const blocks = await lucidBlocks($, text)
  return wellFormed(blocks) ? blocks : blocksOf(text)
}

export async function replyBlocks($: EngineInterface, texts: string[]): Promise<Block[]> {
  const lists = await Promise.all(texts.map(text => drawnBlocks($, text)))
  return lists.flat()
}
