import { describe, expect, test } from 'claude-code/testing'

import { blocksOf } from '../hooks/lexer'
import type { Block } from '../hooks/model'
import { CORPUS } from './fixtures/blocks'
import { LUCID_BLOCKS } from './fixtures/lucid-blocks'
import { LUCID_MUTED } from './fixtures/lucid-palette'

const THEMES = ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi', 'auto', 'solarized-light-custom', 'highlighter']

function shape(blocks: readonly Block[]): Block[] {
  return blocks.map(({ kind, source, depth, lang, text }) => ({ kind, source, depth, ...(kind === 'code' ? { lang, text } : {}) }))
}

describe('ditto without lucid sees the blocks lucid draws', () => {
  test('the golden file covers the whole corpus', async () => {
    expect(Object.keys(LUCID_BLOCKS).sort()).toEqual(Object.keys(CORPUS).sort())
  })

  test('the golden palette covers every theme, dark-ansi and custom names included', async () => {
    expect(Object.keys(LUCID_MUTED).sort()).toEqual([...THEMES].sort())
  })

  for (const [name, text] of Object.entries(CORPUS)) {
    test(`golden: ${name}`, async () => {
      expect(shape(blocksOf(text))).toEqual(LUCID_BLOCKS[name])
    })
  }
})
