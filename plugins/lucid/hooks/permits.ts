export type Verdict = 'allow' | 'ask' | 'deny'

const MAIN_LOOP = 'main'

type Call = { loop: string; verdict?: Verdict }

export class CallLedger {
  private readonly calls = new Map<string, Call>()

  started(id: string | undefined, agentId?: string): void {
    if (id !== undefined) this.calls.set(id, { loop: agentId ?? MAIN_LOOP })
  }

  settled(id: string | undefined): void {
    if (id !== undefined) this.calls.delete(id)
  }

  decided(id: string | undefined, verdict: Verdict): string[] {
    const call = id === undefined ? undefined : this.calls.get(id)
    if (call === undefined) return []
    call.verdict = verdict
    const batch = this.batchOf(call.loop)
    if (batch.some(([, sibling]) => sibling.verdict === undefined || sibling.verdict === 'ask')) return []
    return allowedIds(batch)
  }

  sharingProgress(id: string): string[] {
    const call = this.calls.get(id)
    const siblings = call === undefined ? [] : allowedIds(this.batchOf(call.loop))
    return [id, ...siblings.filter(sibling => sibling !== id)]
  }

  private batchOf(loop: string): Array<[string, Call]> {
    return [...this.calls].filter(([, call]) => call.loop === loop)
  }
}

function allowedIds(batch: ReadonlyArray<[string, Call]>): string[] {
  return batch.filter(([, call]) => call.verdict === 'allow').map(([id]) => id)
}
