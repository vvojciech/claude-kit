import type { Reply } from '../types'
import type { Flash } from './row'
import type { Target } from './targets'
import type { Written } from './turns'

const DRAWN_ROWS = 1000

export class Session {
  interactive = false
  reached = false
  warned = false
  settledOnce = false
  turn: Written[] = []
  turnOpen = false
  turnRows: string[] = []
  shownBeforeTurn = new Set<string>()
  readonly liveRows = new Set<string>()
  seeded: Promise<Reply[]> | undefined
  reading: Promise<Reply[]> | undefined
  readonly drawn = new Map<string, string>()
  readonly flashes = new Map<string, Flash>()
  readonly groupCalls = new Map<string, Target>()
  // interrupted replies drawn but never stored, with where each goes among the transcript's replies
  readonly unstored: Array<{ reply: Reply; storedStart: boolean; place?: { index: number; replaces: boolean } }> = []
  readonly wrapped = new Map<string, number>()
  wrappedColumns = 0

  rememberGroup(targets: Target[]): void {
    for (const call of targets) {
      if (call.callId === undefined) continue
      this.groupCalls.delete(call.callId)
      this.groupCalls.set(call.callId, call)
    }
    while (this.groupCalls.size > DRAWN_ROWS) this.groupCalls.delete(this.groupCalls.keys().next().value ?? '')
  }

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

  // the block cut mid-stream is the last row drawn; any other unstored row is an older reply scrolled back to
  inFlight(unwritten: string[]): string | undefined {
    return [...this.drawn.keys()].reverse().find(id => unwritten.includes(id))
  }

  closeTurn(isAborted: boolean): Written[] {
    const written = this.turn
    const unwritten = this.turnRows.filter(id => !written.some(block => block.uuid === id))
    const cut = isAborted ? this.inFlight(unwritten) : undefined
    for (const id of unwritten) if (id !== cut) this.liveRows.delete(id)
    const text = cut === undefined ? undefined : this.drawn.get(cut)
    const drawnOnly = cut === undefined || text === undefined ? [] : [{ uuid: cut, text }]
    this.turn = []
    this.turnRows = []
    this.turnOpen = false
    this.shownBeforeTurn = new Set()
    const texts = [...written, ...drawnOnly].map(block => block.text).filter(text => text.trim() !== '')
    const storedStart = written.some(block => block.text.trim() !== '')
    if (drawnOnly.length > 0 && texts.length > 0) this.unstored.push({ reply: { texts, partial: true }, storedStart })
    return [...written, ...drawnOnly]
  }
}

export const hinted = new Set<string>()

export let session = new Session()

export function freshSession(): Session {
  session = new Session()
  return session
}
