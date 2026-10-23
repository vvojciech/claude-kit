import type { EngineInterface } from 'claude-code'

export type Ran = { exitCode: number; stdout: string; stderr: string }

export type Host = {
  run: (argv: string[], timeoutMs?: number) => Promise<Ran>
  stat: (path: string) => Promise<{ size: number; mtimeMs: number } | undefined>
  read: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  list: (dir: string) => Promise<Entry[]>
}

export type Entry = { name: string; mtimeMs: number }

const FAILED: Ran = { exitCode: -1, stdout: '', stderr: 'could not start' }

export function hostOf($: EngineInterface): Host {
  return {
    run: (argv, timeoutMs = 15000) => $.process.run(argv, { timeoutMs }).catch((error: unknown) => ({ ...FAILED, stderr: String(error) })),
    stat: path => $.fs.stat(path).then(s => (s.kind === 'file' ? { size: s.size, mtimeMs: s.mtimeMs } : undefined)).catch(() => undefined),
    read: path => $.fs.read(path, { as: 'bytes' }).then(b => b.base64),
    exists: path => $.fs.exists(path).catch(() => false),
    list: dir => $.fs.list(dir).then(all => all.filter(f => f.kind === 'file').map(f => ({ name: f.name, mtimeMs: f.mtimeMs }))).catch(() => []),
  }
}
