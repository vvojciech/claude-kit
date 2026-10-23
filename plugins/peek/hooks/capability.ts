import type { EngineInterface, ImageSource } from 'claude-code'

export const ITERM_FROM = '2.1.305'

export type Verdict = 'unknown' | 'pictures' | 'line'

export type Terminal = { program?: string; term?: string; tmux?: string; screen?: string; forced?: string; version: string }

let verdict: Verdict = 'unknown'

let probing = false

export function resetCapability(start: Verdict = 'unknown'): void {
  verdict = start
  probing = false
}

export function currentVerdict(): Verdict {
  return verdict
}

export function atLeast(version: string, floor: string): boolean {
  const a = version.split(/[.-]/).slice(0, 3).map(Number)
  const b = floor.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return true
}

export function mayDraw(t: Terminal): boolean {
  if (t.tmux || t.screen) return false
  if (t.forced === '1') return true
  if (t.program === 'iTerm.app') return atLeast(t.version, ITERM_FROM)
  return t.program === 'ghostty' || /kitty|ghostty/.test(t.term ?? '')
}

async function terminalOf($: EngineInterface): Promise<Terminal> {
  const none = () => undefined
  const [program, term, tmux, screen, forced, version] = await Promise.all([
    $.env.get('TERM_PROGRAM').catch(none),
    $.env.get('TERM').catch(none),
    $.env.get('TMUX').catch(none),
    $.env.get('STY').catch(none),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES').catch(none),
    $.session.version().then(v => v.version).catch(() => '0.0.0'),
  ])
  return { program, term, tmux, screen, forced, version }
}

export async function settleCapability($: EngineInterface): Promise<void> {
  resetCapability(mayDraw(await terminalOf($)) ? 'unknown' : 'line')
}

export function drawsPictures(isFullscreen: boolean | undefined): boolean {
  return isFullscreen === true && verdict !== 'line'
}

export function probe($: EngineInterface, requestId: string, key: string, source: ImageSource): void {
  if (verdict !== 'unknown' || probing) return
  probing = true
  $.clock.after(400, async () => {
    const result = await $.ui.blit({ requestId, key, source }).catch(() => ({ deny: 'blit failed' }))
    probing = false
    if (result.deny !== undefined && /alt/i.test(result.deny)) {
      verdict = 'line'
      $.ui.log(`peek: pictures off, ${result.deny}`, { to: 'debug' })
      $.ui.invalidate('ui.render')
    } else if (result.deny === undefined) {
      verdict = 'pictures'
      $.ui.log('peek: pictures on', { to: 'debug' })
    }
  })
}
