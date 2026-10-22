import { describe, expect, test } from 'claude-code/testing'

import { ARGUMENT_HINT, USAGE, chooseBlock, parse } from '../hooks/commands'
import type { BlockRequest } from '../hooks/commands'
import { replyTargets } from '../hooks/targets'
import { resolved, resolvedReply } from './support'

const chips = (text: string) => replyTargets(resolved(text)).map(t => [t.label, t.text])
const labels = (text: string) => replyTargets(resolved(text)).map(t => t.label)
const copied = (text: string, args: string) => chooseBlock(resolved(text), parse(args) as BlockRequest)

const DRAFT = 'Draft:\n\n> Hi team,\n>\n> The **deploy** is done. See [the PR](https://x/1).\n\nBefore you send it, check the link.'

describe('quote chips', () => {
  test('a single quote copies its content without the > markers, blank lines kept', async () => {
    expect(chips(DRAFT)).toEqual([
      ['⧉ reply', DRAFT],
      ['⧉ quote', 'Hi team,\n\nThe **deploy** is done. See [the PR](https://x/1).'],
    ])
  })

  test('two quotes are numbered from the top', async () => {
    const text = 'Slack:\n\n> one\n\nPR:\n\n> two'
    expect(chips(text).slice(1)).toEqual([
      ['⧉ quote 1', 'one'],
      ['⧉ quote 2', 'two'],
    ])
  })

  test('a nested quote stays a quote one level shallower, with no chip of its own', async () => {
    expect(chips('> said:\n>\n> > inner\n> > more\n>\n> after').slice(1)).toEqual([['⧉ quote', 'said:\n\n> inner\n> more\n\nafter']])
  })

  test('an alert is named by its type and copies without the marker line', async () => {
    expect(chips('> [!NOTE]\n> Mind the gap.').slice(1)).toEqual([['⧉ note', 'Mind the gap.']])
    expect(labels('> [!Warning]\n> a\n\n> [!WARNING]\n> b\n\n> c')).toEqual(['⧉ reply', '⧉ warning 1', '⧉ warning 2', '⧉ quote'])
  })

  test('a quote holding a list and code keeps them verbatim, and the code keeps its own chip after the quote', async () => {
    const text = '> - **one**\n>   - `two`\n>\n> ```sh\n>     make\n> ```'
    expect(chips(text).slice(1)).toEqual([
      ['⧉ quote', '- **one**\n  - `two`\n\n```sh\n    make\n```'],
      ['⧉ sh', '    make'],
    ])
  })

  test('lazy continuation lines and > without a space', async () => {
    expect(chips('>first\nlazy line\n>\n>second').slice(1)).toEqual([['⧉ quote', 'first\nlazy line\n\nsecond']])
  })

  test('CRLF replies copy with plain newlines', async () => {
    expect(chips('> one\r\n>\r\n> two\r\n').slice(1)).toEqual([['⧉ quote', 'one\n\ntwo']])
  })

  test('a quote inside a list item gets a chip, since it sits in no other quote', async () => {
    expect(chips('1. Slack:\n\n   > hi\n   > there\n\n2. done').slice(1)).toEqual([['⧉ quote', 'hi\nthere']])
  })

  test('an empty quote gets no chip but still counts', async () => {
    expect(labels('>\n\n> real')).toEqual(['⧉ reply', '⧉ quote 2'])
  })

  test('a code block whose language is quote or an alert type is renamed', async () => {
    expect(labels('```quote\na\n```\n\n```note\nb\n```\n\n> c')).toEqual(['⧉ reply', '⧉ quote-code', '⧉ note-code', '⧉ quote'])
  })

  test('quotes in separately written parts of a reply are numbered across the reply', async () => {
    const reply = resolvedReply(['> a', 'then', '> b'])
    expect(replyTargets(reply).map(t => t.label)).toEqual(['⧉ reply', '⧉ quote 1', '⧉ quote 2'])
  })
})

describe('/copy-that quote', () => {
  const text = 'Slack:\n\n> one\n\nPR:\n\n> two\n\n> [!TIP]\n> three'

  test('quote, quote N, R quote and alert names copy the unquoted content', async () => {
    expect(copied(text, 'quote')).toEqual({ text: 'one', what: 'quote as markdown' })
    expect(copied(text, 'quote 2')).toEqual({ text: 'two', what: 'quote as markdown' })
    expect(copied(text, '1 quote 2')).toEqual({ text: 'two', what: 'quote as markdown' })
    expect(copied(text, 'TIP')).toEqual({ text: 'three', what: 'tip as markdown' })
    expect(parse('2 quote')).toEqual({ kind: 'block', reply: 2, name: 'quote' })
  })

  test('a missing quote names what the reply has', async () => {
    expect(copied('```sh\nls\n```', 'quote')).toEqual({ error: 'No "quote" in the last reply; it has reply, sh' })
  })

  test('help and the argument hint name quote', async () => {
    expect(ARGUMENT_HINT).toContain('| quote]')
    expect(USAGE).toContain('/copy-that quote [N]')
    expect(USAGE).toContain('/copy-that note')
  })
})
