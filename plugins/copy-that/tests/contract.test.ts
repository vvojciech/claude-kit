import { describe, expect, test } from 'claude-code/testing'

import { blocksOf } from '../hooks/lexer'
import { shape } from './fixtures/golden'
import { REGENERATE, TERMINALS, THEMES, copyThatTones, toneKey } from './fixtures/tones'
import { CORPUS } from './fixtures/blocks'
import { LUCID_BLOCKS } from './fixtures/lucid-blocks'
import { LUCID_TONES } from './fixtures/lucid-palette'

describe(`copy-that without lucid sees the blocks and tones lucid draws (goldens from live lucid: ${REGENERATE}; drift check: dev/check.sh)`, () => {
  test('the golden file covers the whole corpus', async () => {
    expect(Object.keys(LUCID_BLOCKS).sort()).toEqual(Object.keys(CORPUS).sort())
  })

  test('the golden tones cover every theme on every terminal ground, dark-ansi and custom names included', async () => {
    expect(Object.keys(LUCID_TONES).sort()).toEqual(THEMES.flatMap(theme => TERMINALS.map(terminal => toneKey(theme, terminal))).sort())
  })

  test('copy-that resolves the ground, muted, text and accent lucid does for each', async () => {
    expect(copyThatTones()).toEqual(LUCID_TONES)
  })

  test('the contract compares sources trimmed of trailing newlines, as copy-that copies them', async () => {
    const block = { kind: 'table', source: '| a |\n|---|\n', depth: 0 } as const
    expect(shape([block])).toEqual(shape([{ ...block, source: '| a |\n|---|' }]))
    expect(shape([block])).not.toEqual(shape([{ ...block, source: '| b |\n|---|' }]))
  })

  for (const [name, text] of Object.entries(CORPUS)) {
    test(`golden: ${name}`, async () => {
      expect(shape(blocksOf(text))).toEqual(LUCID_BLOCKS[name])
    })
  }
})
