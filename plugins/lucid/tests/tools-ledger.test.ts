import { describe, expect, test } from 'claude-code/testing'
import { CallLedger } from '../hooks/permits'

function batch(...ids: string[]): CallLedger {
  const ledger = new CallLedger()
  for (const id of ids) ledger.started(id)
  return ledger
}

describe('CallLedger', () => {
  test('shows a lone allowed call ran as soon as its verdict lands', async () => {
    expect(batch('a').decided('a', 'allow')).toEqual(['a'])
  })

  test('waits until every call of the batch has a verdict', async () => {
    const ledger = batch('a', 'b')
    expect(ledger.decided('a', 'allow')).toEqual([])
    expect(ledger.decided('b', 'allow')).toEqual(['a', 'b'])
  })

  test('holds every sibling while one of them is put to a dialog', async () => {
    const ledger = batch('a', 'b')
    ledger.decided('a', 'allow')
    expect(ledger.decided('b', 'ask')).toEqual([])
  })

  test('lets a denied sibling through, since a refusal blocks nothing else', async () => {
    const ledger = batch('a', 'b')
    ledger.decided('a', 'allow')
    expect(ledger.decided('b', 'deny')).toEqual(['a'])
  })

  test('forgets a settled call so it never holds back a later one', async () => {
    const ledger = batch('a', 'b')
    ledger.decided('b', 'ask')
    ledger.settled('b')
    expect(ledger.decided('a', 'allow')).toEqual(['a'])
  })

  test('keeps each loop to itself, so a subagent dialog never holds the main loop', async () => {
    const ledger = new CallLedger()
    ledger.started('a')
    ledger.started('s', 'agent-1')
    ledger.decided('s', 'ask')
    expect(ledger.decided('a', 'allow')).toEqual(['a'])
  })

  test('ignores a verdict for a call it never saw start, or one without an id', async () => {
    const ledger = batch('a')
    expect(ledger.decided('ghost', 'allow')).toEqual([])
    expect(ledger.decided(undefined, 'allow')).toEqual([])
    ledger.started(undefined)
    ledger.settled(undefined)
    expect(ledger.decided('a', 'allow')).toEqual(['a'])
  })

  test('credits a shared progress pill to the call it names and every allowed sibling', async () => {
    const ledger = batch('a', 'b', 'c')
    ledger.decided('a', 'allow')
    ledger.decided('b', 'ask')
    ledger.decided('c', 'allow')
    expect(ledger.sharingProgress('b')).toEqual(['b', 'a', 'c'])
    expect(ledger.sharingProgress('a')).toEqual(['a', 'c'])
  })

  test('credits a pill for an unknown call to that call alone', async () => {
    expect(new CallLedger().sharingProgress('x')).toEqual(['x'])
  })
})
