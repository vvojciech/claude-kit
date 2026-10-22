import type { EngineInterface } from 'claude-code'

import { NOT_OUTERMOST } from './notices'
import { hinted, session } from './session'

export const NOTICE_MS = 4000
const WRAPPED_CHECK_MS = 1500

export function wrappedWarning(): string | undefined {
  return session.interactive && session.settledOnce && !session.reached ? NOT_OUTERMOST : undefined
}

function warnIfWrapped($: EngineInterface): void {
  const warning = wrappedWarning()
  if (warning === undefined || session.warned) return
  session.warned = true
  void $.ui.status(warning)
}

export function checkWrappedLater($: EngineInterface): void {
  session.settledOnce = true
  setTimeout(() => warnIfWrapped($), WRAPPED_CHECK_MS)
}

export function hintOnce($: EngineInterface, hint: 'firstRun' | 'noFullscreen', text: string): void {
  if (!session.interactive || hinted.has(hint)) return
  hinted.add(hint)
  $.ui.toast(text)
}
