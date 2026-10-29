import type { SessionMessage } from 'claude-code'

import { session } from './session'
import type { Row, Target } from './targets'
import { cellWidth } from './width'

export type Opening = 'up' | 'down'

const MENU_PAD = 1

const MARGIN = 1

export function menuWidth(labels: string[], columns: number): number {
  const widest = Math.max(0, ...labels.map(cellWidth)) + 2 * MENU_PAD
  return Math.max(1, Math.min(widest, columns))
}

export function menuLine(label: string, width: number): string {
  const line = `${' '.repeat(MENU_PAD)}${label}`
  return line + ' '.repeat(Math.max(0, width - cellWidth(line)))
}

export function menuCap(above: number, screenRows: number): number {
  return Math.max(1, above, Math.floor(screenRows / 2))
}

export function fitMenu(targets: Target[], cap: number, extras: number): Row {
  const room = cap - extras
  if (targets.length <= room) return { shown: targets, hidden: [] }
  const kept = Math.max(0, room - 1)
  return { shown: targets.slice(0, kept), hidden: targets.slice(kept) }
}

export function menuRows(row: Row, extras: number): number {
  return row.shown.length + (row.hidden.length > 0 ? 1 : 0) + extras
}

export function opening(rows: number, above: number): Opening {
  return rows <= above ? 'up' : 'down'
}

export function wrappedRows(text: string, columns: number): number {
  const width = Math.max(1, columns)
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(cellWidth(line) / width)), 0)
}

function measuredRows(text: string, columns: number): number {
  if (session.wrappedColumns !== columns) {
    session.wrapped.clear()
    session.wrappedColumns = columns
  }
  const known = session.wrapped.get(text)
  if (known !== undefined) return known
  const rows = wrappedRows(text, columns)
  session.wrapped.set(text, rows)
  return rows
}

function messageRows(message: SessionMessage, columns: number): number {
  const text = message.text.trim() === '' ? 0 : measuredRows(message.text, columns) + MARGIN
  return text + message.toolUses.length * (1 + MARGIN)
}

export function rowsBefore(messages: SessionMessage[], here: (message: SessionMessage) => boolean, columns: number): number {
  const found = messages.findIndex(here)
  const earlier = found === -1 ? messages : messages.slice(0, found)
  return earlier.reduce((sum, message) => sum + messageRows(message, columns), 0)
}

export function holdsText(text: string): (message: SessionMessage) => boolean {
  const drawn = text.trim()
  return message => message.role === 'assistant' && drawn !== '' && message.text.includes(drawn)
}

export function holdsCall(ids: (string | undefined)[]): (message: SessionMessage) => boolean {
  const wanted = new Set(ids.filter((id): id is string => id !== undefined))
  return message => message.toolUses.some(use => wanted.has(use.tool_use_id))
}
