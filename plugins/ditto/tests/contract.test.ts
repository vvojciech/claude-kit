import { describe, expect, test } from 'claude-code/testing'

import { blocksOf } from '../hooks/lexer'
import type { Block } from '../hooks/model'
import { REGENERATE, TERMINALS, THEMES, dittoTones, toneKey } from '../dev/tones'
import { CORPUS } from './fixtures/blocks'
import { LUCID_BLOCKS } from './fixtures/lucid-blocks'
import { LUCID_TONES } from './fixtures/lucid-palette'

function shape(blocks: readonly Block[]): Block[] {
  return blocks.map(({ kind, source, depth, lang, text }) => ({ kind, source, depth, ...(kind === 'code' ? { lang, text } : {}) }))
}

describe(`ditto without lucid sees the blocks and tones lucid draws (goldens from live lucid: ${REGENERATE}; drift check: dev/check.sh)`, () => {
  test('the golden file covers the whole corpus', async () => {
    expect(Object.keys(LUCID_BLOCKS).sort()).toEqual(Object.keys(CORPUS).sort())
  })

  test('the golden tones cover every theme on every terminal ground, dark-ansi and custom names included', async () => {
    expect(Object.keys(LUCID_TONES).sort()).toEqual(THEMES.flatMap(theme => TERMINALS.map(terminal => toneKey(theme, terminal))).sort())
  })

  test('ditto resolves the ground, muted, text and accent lucid does for each', async () => {
    expect(dittoTones()).toEqual(LUCID_TONES)
  })

  for (const [name, text] of Object.entries(CORPUS)) {
    test(`golden: ${name}`, async () => {
      expect(shape(blocksOf(text))).toEqual(LUCID_BLOCKS[name])
    })
  }
})
