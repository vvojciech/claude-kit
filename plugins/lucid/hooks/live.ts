const REMEMBERED = 20_000

export class ReplyStream {
  private live = false
  private readonly seenWhileLive = new Set<string>()
  private readonly finished = new Set<string>()

  turnStarted(): void {
    this.live = true
  }

  turnEnded(): void {
    this.live = false
    for (const id of this.seenWhileLive) this.finish(id)
    this.seenWhileLive.clear()
  }

  stored(id: string): void {
    this.finish(id)
  }

  isStreaming(id: string): boolean {
    if (this.finished.has(id)) return false
    if (!this.live) {
      this.finish(id)
      return false
    }
    this.seenWhileLive.add(id)
    return true
  }

  private finish(id: string): void {
    this.finished.delete(id)
    this.finished.add(id)
    if (this.finished.size > REMEMBERED) this.finished.delete(this.finished.values().next().value ?? '')
  }
}
