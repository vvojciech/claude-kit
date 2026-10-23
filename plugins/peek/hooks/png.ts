const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export const MAX_PNG_BYTES = 2 * 1024 * 1024

export type Size = { width: number; height: number }

export function decodeHead(base64: string, bytes: number): number[] {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of base64) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
      buffer &= (1 << bits) - 1
      if (out.length === bytes) return out
    }
  }
  return out
}

function uint32(bytes: number[], at: number): number {
  return (((bytes[at] ?? 0) << 24) >>> 0) + ((bytes[at + 1] ?? 0) << 16) + ((bytes[at + 2] ?? 0) << 8) + (bytes[at + 3] ?? 0)
}

export function pngSize(base64: string): Size | undefined {
  const head = decodeHead(base64.slice(0, 32), 24)
  if (!SIGNATURE.every((byte, i) => head[i] === byte)) return undefined
  const size = { width: uint32(head, 16), height: uint32(head, 20) }
  return size.width > 0 && size.height > 0 ? size : undefined
}

export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}
