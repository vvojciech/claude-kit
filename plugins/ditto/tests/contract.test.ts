import { describe, expect, test } from 'claude-code/testing'

import { blocksOf } from '../hooks/lexer'
import type { Block } from '../hooks/model'
import { CORPUS } from './fixtures/blocks'
import { LUCID_BLOCKS } from './fixtures/lucid-blocks'

function shape(blocks: readonly Block[]): Block[] {
  return blocks.map(({ kind, source, depth, lang, text }) => ({ kind, source, depth, ...(kind === 'code' ? { lang, text } : {}) }))
}

describe('ditto without lucid sees the blocks lucid draws', () => {
  test('the golden file covers the whole corpus', async () => {
    expect(Object.keys(LUCID_BLOCKS).sort()).toEqual(Object.keys(CORPUS).sort())
  })

  for (const [name, text] of Object.entries(CORPUS)) {
    test(name, async () => {
      expect(shape(blocksOf(text))).toEqual(LUCID_BLOCKS[name])
    })
  }
})
