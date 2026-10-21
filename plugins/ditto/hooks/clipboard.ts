import type { EngineInterface, RenderSurface } from 'claude-code'

export type Host = { os: string; wayland: boolean; x11: boolean }
export type ClipCommand = { argv: string[]; env?: Record<string, string> }
export type CopyOutcome = { ok: true; via: string } | { ok: false; error: string }

const UTF8 = { LANG: 'en_US.UTF-8', LC_CTYPE: 'UTF-8' }

const TERMINAL_REFUSED = 'the terminal did not take it either'

export function clipboardCommands(host: Host): ClipCommand[] {
  if (host.os === 'Darwin') return [{ argv: ['/usr/bin/pbcopy'], env: UTF8 }]
  if (host.os !== 'Linux') return []
  return [
    ...(host.wayland ? [{ argv: ['wl-copy'] }] : []),
    ...(host.x11 ? [{ argv: ['xclip', '-selection', 'clipboard', '-in'] }] : []),
  ]
}

export function missingToolHint(host: Host): string {
  if (host.os === 'Linux') return 'no clipboard tool found: install wl-clipboard (Wayland) or xclip (X11)'
  return `no clipboard command known for ${host.os === '' ? 'this system' : host.os}`
}

let hostOf: Promise<Host> | undefined

async function detectHost($: EngineInterface): Promise<Host> {
  const uname = await $.process.run(['uname', '-s'], { timeoutMs: 2000 }).catch(() => undefined)
  return {
    os: uname?.stdout.trim() ?? '',
    wayland: Boolean(await $.env.get('WAYLAND_DISPLAY')),
    x11: Boolean(await $.env.get('DISPLAY')),
  }
}

export function host($: EngineInterface): Promise<Host> {
  hostOf ??= detectHost($).catch((error: unknown) => {
    hostOf = undefined
    throw error
  })
  return hostOf
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runCopy($: EngineInterface, command: ClipCommand, text: string): Promise<string | undefined> {
  const name = command.argv[0] ?? ''
  try {
    const result = await $.process.run(command.argv, { stdin: text, env: command.env, timeoutMs: 5000 })
    if (result.exitCode === 0) return undefined
    const detail = result.stderr.trim()
    return `${name} exited ${result.exitCode}${detail === '' ? '' : `: ${detail}`}`
  } catch (error) {
    return `${name} did not run: ${messageOf(error)}`
  }
}

async function terminalCopy($: EngineInterface, text: string, surface?: RenderSurface): Promise<boolean> {
  const result = await $.ui.copy({ text, surface }).catch(() => undefined)
  return result?.isCopied === true
}

export async function copyText($: EngineInterface, text: string, surface?: RenderSurface): Promise<CopyOutcome> {
  const machine = await host($)
  const failures: string[] = []
  for (const command of clipboardCommands(machine)) {
    const failure = await runCopy($, command, text)
    if (failure === undefined) return { ok: true, via: command.argv[0] ?? '' }
    failures.push(failure)
  }
  if (await terminalCopy($, text, surface)) return { ok: true, via: 'terminal' }
  const reasons = failures.length > 0 ? failures : [missingToolHint(machine)]
  return { ok: false, error: `${reasons.join('; ')}, and ${TERMINAL_REFUSED}` }
}
