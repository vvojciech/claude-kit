import { describe, expect, test } from 'claude-code/testing'

import { renderMarkdown } from '../hooks/blocks'
import { parseBlocks } from '../hooks/message'
import { dark } from '../hooks/palette'

const KIT = {
  Box: (props: Record<string, unknown>) => ({ type: 'Box', props, children: [] }),
  Text: (props: Record<string, unknown>) => ({ type: 'Text', props, children: [] }),
  Link: (props: Record<string, unknown>) => ({ type: 'Link', props, children: [] }),
} as never

const TOKENS = 8

const WARM_TOKENS = 2

const SLACK_MS = 2

const ATTEMPTS = 2

type Cost = { parse: number; draw: number }

function costPerToken(body: string, attempt = 0): Cost {
  const parses: number[] = []
  const draws: number[] = []
  for (let token = 0; token < TOKENS; token++) {
    const text = `${body}${attempt}${' tok'.repeat(token)}`
    const started = performance.now()
    parseBlocks(text, { streaming: true })
    const parsed = performance.now()
    renderMarkdown({ kit: KIT, palette: dark }, text, 100, true)
    parses.push(parsed - started)
    draws.push(performance.now() - parsed)
  }
  return { parse: steadyMean(parses), draw: steadyMean(draws) }
}

function steadyMean(spent: number[]): number {
  const steady = spent.slice(WARM_TOKENS)
  return steady.reduce((sum, ms) => sum + ms, 0) / steady.length
}

function drawPerToken(body: string, attempt = 0): number {
  return costPerToken(body, attempt).draw
}

function wholePerToken(body: string, attempt = 0): number {
  const { parse, draw } = costPerToken(body, attempt + ATTEMPTS)
  return parse + draw
}

function isFlat(near: number, far: number): boolean {
  return far < near * 3 + SLACK_MS
}

function bestOf(measure: (attempt: number) => number): number {
  return Math.min(...Array.from({ length: ATTEMPTS }, (_, attempt) => measure(attempt)))
}

function growingShape(lines: number): Record<string, string> {
  return {
    code: '```ts\n' + 'const a = 1 /* x */\n'.repeat(lines),
    shell: '```bash\n' + '$ git status --short | grep x\n'.repeat(lines),
    paragraph: 'word '.repeat(lines * 3),
    table: '| a | b |\n|---|---|\n' + Array.from({ length: lines }, (_, i) => `| r${i} | v${i} |`).join('\n') + '\n| last',
  }
}

describe('drawing a growing block', () => {
  test('draws a parsed block at about the same cost per token at ten times the size', { timeoutMs: 30_000 }, () => {
    const small = growingShape(200)
    const large = growingShape(2000)
    for (const shape of Object.keys(small)) {
      const near = bestOf(attempt => drawPerToken(small[shape] ?? '', attempt))
      const far = bestOf(attempt => drawPerToken(large[shape] ?? '', attempt))
      expect({ shape, bounded: isFlat(near, far) }).toEqual({ shape, bounded: true })
    }
  })

  test('parses and draws a growing code block at about the same cost per token at ten times the size', { timeoutMs: 30_000 }, () => {
    const small = growingShape(200)
    const large = growingShape(2000)
    for (const shape of ['code', 'shell']) {
      const near = bestOf(attempt => wholePerToken(small[shape] ?? '', attempt))
      const far = bestOf(attempt => wholePerToken(large[shape] ?? '', attempt))
      expect({ shape, bounded: isFlat(near, far) }).toEqual({ shape, bounded: true })
    }
  })

  test('draws the grown block exactly as a cold draw does, a comment opened in the reused head included', { timeoutMs: 30_000 }, () => {
    for (const head of ['```ts\n/* opened\n' + 'still comment\n'.repeat(70), '```diff\n' + '+added\n'.repeat(70), '```\n\tindented ' + 'word '.repeat(30) + '\n'.repeat(3)]) {
      drawPerToken(head)
      const grown = `${head}closed */ const after = 1\n`
      const warm = renderMarkdown({ kit: KIT, palette: dark }, grown, 100, true)
      const cold = renderMarkdown({ kit: KIT, palette: { ...dark } }, grown, 100, true)
      expect(JSON.stringify(warm)).toContain("after")
      expect(JSON.stringify(warm)).toBe(JSON.stringify(cold))
    }
  })
})
