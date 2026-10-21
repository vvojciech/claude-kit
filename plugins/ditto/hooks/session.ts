import type { Reply } from '../types'
import type { Flash } from './row'
import type { Written } from './turns'

const DRAWN_ROWS = 1000

export class Session {
  interactive = false
  reached = false
  warned = false
  settledOnce = false
  notice: string | undefined
  turn: Written[] = []
  turnOpen = false
  turnRows: string[] = []
  shownBeforeTurn = new Set<string>()
  readonly liveRows = new Set<string>()
  seeded: Promise<Reply[]> | undefined
  reading: Promise<Reply[]> | undefined
  readonly drawn = new Map<string, string>()
  readonly flashes = new Map<string, Flash>()

  remember(requestId: string, text: string): void {
    this.drawn.delete(requestId)
    this.drawn.set(requestId, text)
    if (this.drawn.size > DRAWN_ROWS) this.drawn.delete(this.drawn.keys().next().value ?? '')
  }

  writing(requestId: string): boolean {
    return this.turn.some(block => block.uuid === requestId) || this.turnRows.includes(requestId)
  }

  openTurn(): void {
    this.turnOpen = true
    this.turnRows = []
    this.shownBeforeTurn = new Set(this.drawn.keys())
  }

  mayBelongToTurn(requestId: string): boolean {
    return this.turnOpen && !this.liveRows.has(requestId) && (this.writing(requestId) || !this.shownBeforeTurn.has(requestId))
  }

  drawnInTurn(requestId: string): void {
    if (!this.mayBelongToTurn(requestId)) return
    this.liveRows.add(requestId)
    this.turnRows.push(requestId)
  }

  closeTurn(isAborted: boolean): Written[] {
    const written = this.turn
    const unwritten = isAborted ? this.turnRows.filter(id => !written.some(block => block.uuid === id)) : []
    const drawnOnly = unwritten.flatMap(uuid => {
      const text = this.drawn.get(uuid)
      return text === undefined ? [] : [{ uuid, text }]
    })
    this.turn = []
    this.turnRows = []
    this.turnOpen = false
    this.shownBeforeTurn = new Set()
    return [...written, ...drawnOnly]
  }
}

export const hinted = new Set<string>()

export let session = new Session()

export function freshSession(): Session {
  session = new Session()
  return session
}
