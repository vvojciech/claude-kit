const WIDE_CLASSES = [
  'ᄀ-ᅟ⌚⌛〈〉⏩-⏬⏰⏳◽◾☔☕♈-♓♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔',
  '⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓-❕❗➕-➗➰➿⬛⬜⭐⭕⺀-〾',
  'ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠',
  '￠-￦',
]

const WIDE = new RegExp(`[${WIDE_CLASSES.join('')}]|[\\u{1f000}-\\u{1faff}\\u{20000}-\\u{3fffd}]`, 'u')

const ZERO = /^(?:\p{Mn}|\p{Me}|\p{Cf}|\p{Cc})+$/u

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemeWidth(grapheme: string): number {
  if (ZERO.test(grapheme)) return 0
  return WIDE.test(grapheme) || grapheme.includes('️') ? 2 : 1
}

export function cellWidth(text: string): number {
  let width = 0
  for (const { segment } of segmenter.segment(text)) width += graphemeWidth(segment)
  return width
}
