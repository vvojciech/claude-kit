import type { Reply } from '../types'
import type { Written } from './turns'

const DRAWN_ROWS = 1000

export class Session {
  interactive = false
  reached = false
  warned = false
  completedReplies = 0
  turn: Written[] = []
  seeded: Promise<Reply[]> | undefined
  reading: Promise<Reply[]> | undefined
  readonly drawn = new Map<string, string>()

  remember(requestId: string, text: string): void {
    this.drawn.delete(requestId)
    this.drawn.set(requestId, text)
    if (this.drawn.size > DRAWN_ROWS) this.drawn.delete(this.drawn.keys().next().value ?? '')
  }

  writing(requestId: string): boolean {
    return this.turn.some(block => block.uuid === requestId)
  }
}

export let session = new Session()

export function freshSession(): Session {
  session = new Session()
  return session
}
