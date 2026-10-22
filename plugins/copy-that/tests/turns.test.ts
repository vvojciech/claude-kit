import { describe, expect, test } from 'claude-code/testing'

import { ownersOf, writtenText } from '../hooks/turns'

describe('writtenText', () => {
  test('joins the text blocks of a row and ignores the rest', async () => {
    expect(writtenText([{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'a' }, { type: 'tool_use', id: 't' }, { type: 'text', text: 'b' }])).toBe('a\n\nb')
    expect(writtenText([{ type: 'tool_use', id: 't' }])).toBe('')
  })
})

describe('ownersOf', () => {
  test('gives the reply, block by block, to its last block and marks the others as its own', async () => {
    expect(ownersOf([{ uuid: 'a', text: 'Looking.' }, { uuid: 't', text: '' }, { uuid: 'b', text: 'Done.' }], false)).toEqual({ a: null, b: { texts: ['Looking.', 'Done.'], partial: false } })
  })

  test('marks an aborted turn partial', async () => {
    expect(ownersOf([{ uuid: 'a', text: 'Half' }], true)).toEqual({ a: { texts: ['Half'], partial: true } })
  })

  test('owns nothing for a turn that wrote no text', async () => {
    expect(ownersOf([], false)).toEqual({})
    expect(ownersOf([{ uuid: 't', text: '  ' }], false)).toEqual({})
  })
})
