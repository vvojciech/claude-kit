import { NAMED_ENTITIES } from './vendor/entities'

const ENTITY = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][a-zA-Z\d]{1,31}));/g

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(ENTITY, (whole: string, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return Object.hasOwn(NAMED_ENTITIES, name) ? (NAMED_ENTITIES[name] ?? whole) : whole
    const code = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
  })
}
