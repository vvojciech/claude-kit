import type { Entry, Host, Ran } from '../hooks/host'

export const WIDE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJElEQVR4nGM4UWEzIIhh1OJRi0ctHrV41OJRi0ctHrV45FgMANL1o70iON74AAAAAElFTkSuQmCC'

export const TALL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAoCAIAAABxU02MAAAAJElEQVR4nGM4UWFDNmIY1TyqeVTzqOZRzaOaRzWPah7VTC4CADjKo71oxGI3AAAAAElFTkSuQmCC'

export type FakeFile = { base64: string; mtimeMs?: number; size?: number }

export type FakeHost = Host & { files: Map<string, FakeFile>; runs: string[][]; dirs: Map<string, Entry[]> }

export type Answer = (argv: string[], host: FakeHost) => Partial<Ran> | undefined

function ran(partial: Partial<Ran> | undefined): Ran {
  return { exitCode: 0, stdout: '', stderr: '', ...partial }
}

export function fakeHost(files: Record<string, FakeFile> = {}, answer: Answer = () => undefined): FakeHost {
  const host: FakeHost = {
    files: new Map(Object.entries(files)),
    runs: [],
    dirs: new Map(),
    run: async argv => {
      host.runs.push(argv)
      return ran(answer(argv, host))
    },
    stat: async path => {
      const file = host.files.get(path)
      return file === undefined ? undefined : { size: file.size ?? file.base64.length, mtimeMs: file.mtimeMs ?? 1 }
    },
    read: async path => {
      const file = host.files.get(path)
      if (file === undefined) throw new Error(`ENOENT ${path}`)
      return file.base64
    },
    exists: async path => host.files.has(path),
    list: async dir => host.dirs.get(dir) ?? [],
  }
  return host
}

export function sipsWrites(base64: string): Answer {
  return (argv, host) => {
    if (argv[0] !== '/usr/bin/sips') return undefined
    host.files.set(argv[argv.length - 1] ?? '', { base64 })
    return { exitCode: 0 }
  }
}
