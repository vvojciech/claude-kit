const WIDE = /[ᄀ-ᅟ⌚⌛〈〉⏩-⏬⏰⏳◽◾☔☕♈-♓♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓-❕❗➕-➗➰➿⬛⬜⭐⭕⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]|[\u{1f000}-\u{1faff}\u{20000}-\u{3fffd}]/u

const ZERO = /^(?:\p{Mn}|\p{Me}|\p{Cf}|\p{Cc})+$/u

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemeWidth(grapheme: string): number {
  if (ZERO.test(grapheme)) return 0
  return WIDE.test(grapheme) || grapheme.includes('️') ? 2 : 1
}

const NARROW = /^[\x20-\x7e\u00a0\u2026\u2190-\u21ff\u2500-\u25fc]*$/

const widths = new Map<string, number>()

export function cellWidth(text: string): number {
  if (NARROW.test(text)) return text.length
  const hit = widths.get(text)
  if (hit !== undefined) return hit
  let width = 0
  for (const { segment } of segmenter.segment(text)) width += graphemeWidth(segment)
  if (widths.size > 20000) widths.clear()
  widths.set(text, width)
  return width
}
