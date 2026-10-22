import type { EngineInterface } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { blocksOf } from '../hooks/lexer'
import { drawnBlocks, replyBlocks } from '../hooks/model'
import type { Block } from '../hooks/model'

const LUCID_TABLE: Block = { kind: 'table', source: '| a |\n|---|', depth: 0 }

function engine(blocks: (args: { text: string }) => Promise<unknown>): EngineInterface {
  return { lucid: { blocks } } as unknown as EngineInterface
}

const stock = {} as unknown as EngineInterface

describe('drawnBlocks', () => {
  test('takes the blocks lucid draws when lucid is loaded', async () => {
    const asked: string[] = []
    const $ = engine(async ({ text }) => {
      asked.push(text)
      return [LUCID_TABLE]
    })
    expect(await drawnBlocks($, 'anything')).toEqual([LUCID_TABLE])
    expect(asked).toEqual(['anything'])
  })

  test('lexes on its own on the stock renderer, where lucid is absent', async () => {
    expect(await drawnBlocks(stock, '```ruby\nx\n```')).toEqual(blocksOf('```ruby\nx\n```'))
  })

  test('lexes on its own when lucid fails or answers in a shape it does not know', async () => {
    const text = '# Title'
    expect(await drawnBlocks(engine(async () => Promise.reject(new Error('gone'))), text)).toEqual(blocksOf(text))
    expect(await drawnBlocks(engine(async () => [{ kind: 1 }]), text)).toEqual(blocksOf(text))
    expect(await drawnBlocks(engine(async () => null), text)).toEqual(blocksOf(text))
  })

  test('asks lucid once per written block, never for the joined reply', async () => {
    const asked: string[] = []
    const $ = engine(async ({ text }) => {
      asked.push(text)
      return []
    })
    await replyBlocks($, ['first', 'second'])
    expect(asked).toEqual(['first', 'second'])
  })
})
