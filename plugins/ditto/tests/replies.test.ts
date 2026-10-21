import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { joinBlocks, repliesEndingWith, repliesFrom, replyText, trimBlankLines } from '../hooks/replies'

const prompt = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const said = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })
const called = (): SessionMessage => ({ role: 'assistant', text: '', toolUses: [] })
const answered = (text = ''): SessionMessage => ({ role: 'user', text, toolUses: [], toolResults: [{ tool_use_id: 't', text: 'ok', isError: false, result: undefined }] })
const texts = (messages: SessionMessage[]) => repliesFrom(messages).map(replyText)

describe('repliesFrom', () => {
  test('keeps the text written before and after tool calls as one reply, block by block', async () => {
    const messages = [prompt('go'), said('Checking first.'), called(), answered(), said('Found it:\n\n```sh\nls\n```')]
    expect(repliesFrom(messages)).toEqual([{ texts: ['Checking first.', 'Found it:\n\n```sh\nls\n```'], partial: false }])
    expect(texts(messages)).toEqual(['Checking first.\n\nFound it:\n\n```sh\nls\n```'])
  })

  test('starts a reply at each prompt and not at a tool result that carries text', async () => {
    const messages = [prompt('one'), said('first'), prompt('two'), said('second'), called(), answered('<system-reminder>x</system-reminder>'), said('third')]
    expect(texts(messages)).toEqual(['first', 'second\n\nthird'])
  })

  test('drops prompts that drew no text and blank assistant rows', async () => {
    expect(repliesFrom([prompt('a'), called(), answered(), prompt('b'), said('  '), prompt('c'), said('kept')])).toEqual([{ texts: ['kept'], partial: false }])
  })

  test('keeps text written before any prompt, as a resumed transcript may open', async () => {
    expect(texts([said('summary'), prompt('next'), said('answer')])).toEqual(['summary', 'answer'])
  })

  test('marks a reply the person interrupted partial, without starting a new one', async () => {
    const messages = [prompt('go'), said('Half of it'), prompt('[Request interrupted by user]'), prompt('again'), said('Whole')]
    expect(repliesFrom(messages)).toEqual([
      { texts: ['Half of it'], partial: true },
      { texts: ['Whole'], partial: false },
    ])
  })

  test('reads an empty transcript as no replies', async () => {
    expect(repliesFrom([])).toEqual([])
    expect(repliesFrom([prompt('hi')])).toEqual([])
  })

  test('keeps the indent of a reply that opens with indented code', async () => {
    expect(texts([prompt('a'), said('\n    indented code\n    more\n')])[0]).toBe('    indented code\n    more')
  })
})

describe('trimBlankLines and joinBlocks', () => {
  test('drop blank lines at the edges and nothing else', async () => {
    expect(trimBlankLines('  \n\n    x\n  y  \n\n')).toBe('    x\n  y')
    expect(joinBlocks(['  a', '', '\n\n    b'])).toBe('  a\n\n    b')
  })
})

describe('repliesEndingWith', () => {
  const reply = (...blocks: string[]) => ({ texts: blocks, partial: false })

  test('finds the one reply whose last block is the one drawn', async () => {
    expect(repliesEndingWith([reply('a', 'first'), reply('second')], '  first\n')).toEqual([0])
  })

  test('finds every reply that shares the last block, so the caller can say so', async () => {
    expect(repliesEndingWith([reply('a', 'same'), reply('x'), reply('b', 'same')], 'same')).toEqual([0, 2])
  })

  test('finds nothing for a block mid-reply or a blank one', async () => {
    expect(repliesEndingWith([reply('a', 'b')], 'a')).toEqual([])
    expect(repliesEndingWith([reply('')], '  ')).toEqual([])
  })
})
