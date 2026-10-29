import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { fitMenu, holdsCall, holdsText, menuCap, menuLine, menuRows, menuWidth, opening, rowsBefore, wrappedRows } from '../hooks/menu'
import { replyTargets } from '../hooks/targets'
import { cellWidth } from '../hooks/width'
import { resolved } from './support'

const targets = replyTargets(resolved('```\na\n```\n\n```\nb\n```\n\n```\nc\n```'))

const message = (role: 'user' | 'assistant', text: string, ids: string[] = []): SessionMessage => ({
  role,
  text,
  toolUses: ids.map(id => ({ tool_use_id: id, tool: 'Bash', input: {} })) as never,
})

describe('menu width', () => {
  test('is the longest label plus a cell of padding each side, so every row lines up', async () => {
    expect(menuWidth(['⧉ reply', '⧉ code 1', '+2'], 100)).toBe('⧉ code 1'.length + 2)
  })

  test('measures labels in terminal cells, so a wide language name cannot overrun', async () => {
    expect(menuWidth(['⧉ 日本語'], 100)).toBe(2 + 6 + 2)
  })

  test('never exceeds the pane, and a long name is cut rather than pushing the list off the left edge', async () => {
    expect(menuWidth([`⧉ ${'x'.repeat(80)}`], 38)).toBe(38)
  })

  test('pads every line to the same width, with one cell before the label', async () => {
    const width = menuWidth(['⧉ reply', '⧉ table'], 40)
    expect(menuLine('+1', width)).toBe(' +1      ')
    expect(cellWidth(menuLine('⧉ reply', width))).toBe(width)
  })
})

describe('fitMenu', () => {
  test('keeps every chip, with no +N, when the list has rows for them all', async () => {
    expect(fitMenu(targets, 20, 0)).toEqual({ shown: targets, hidden: [] })
  })

  test('caps the rows and keeps the last for +N when there are more chips than rows', async () => {
    const row = fitMenu(targets, 3, 0)
    expect(row.shown.map(t => t.label)).toEqual(['⧉ reply', '⧉ code 1'])
    expect(row.hidden.map(t => t.name)).toEqual(['code 2', 'code 3'])
    expect(menuRows(row, 0)).toBe(3)
  })

  test('counts the partial and note rows against the cap', async () => {
    const row = fitMenu(targets, 3, 1)
    expect(menuRows(row, 1)).toBe(3)
    expect(row.shown.map(t => t.label)).toEqual(['⧉ reply'])
  })

  test('leaves only +N when the cap holds a single row', async () => {
    expect(fitMenu(targets, 1, 0)).toEqual({ shown: [], hidden: targets })
  })
})

describe('which way the list opens', () => {
  test('opens upward when the rows above the marker hold it, downward when they do not', async () => {
    expect(opening(4, 4)).toBe('up')
    expect(opening(5, 4)).toBe('down')
    expect(opening(1, 0)).toBe('down')
  })

  test('caps the list at the room above or half the screen, whichever is more', async () => {
    expect(menuCap(30, 40)).toBe(30)
    expect(menuCap(2, 40)).toBe(20)
    expect(menuCap(0, 0)).toBe(1)
  })
})

describe('rows above the marker', () => {
  test('counts wrapped rows of text in cells', async () => {
    expect(wrappedRows(`abc\n\n${'x'.repeat(25)}`, 10)).toBe(1 + 1 + 3)
  })

  test('counts the transcript drawn before the message that holds the row, a margin each', async () => {
    const messages = [message('user', 'plan it'), message('assistant', '', ['a']), message('user', ''), message('assistant', 'one\ntwo', ['b'])]
    expect(rowsBefore(messages, holdsCall(['b']), 80)).toBe(2 + 2)
    expect(rowsBefore(messages, holdsText('two'), 80)).toBe(2 + 2)
  })

  test('counts the whole transcript when the row is not stored yet, as it is drawn below all of it', async () => {
    const messages = [message('user', 'plan it'), message('assistant', 'done')]
    expect(rowsBefore(messages, holdsCall(['later']), 80)).toBe(4)
    expect(rowsBefore([], holdsCall([undefined]), 80)).toBe(0)
  })

  test('measures the same transcript again when the pane width changes', async () => {
    const messages = [message('user', 'x'.repeat(25)), message('assistant', 'done')]
    expect(rowsBefore(messages, holdsText('done'), 10)).toBe(3 + 1)
    expect(rowsBefore(messages, holdsText('done'), 100)).toBe(1 + 1)
    expect(rowsBefore(messages, holdsText('done'), 10)).toBe(3 + 1)
  })

  test('never matches a reply on blank text', async () => {
    expect(holdsText('  ')(message('assistant', 'anything'))).toBe(false)
  })
})
