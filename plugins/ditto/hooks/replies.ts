import type { SessionMessage } from 'claude-code'

import type { Reply } from '../types'

const BLOCK_SEPARATOR = '\n\n'

const INTERRUPTED = /^\[Request interrupted by user/

export function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
}

export function joinBlocks(blocks: string[]): string {
  return blocks.map(trimBlankLines).filter(b => b !== '').join(BLOCK_SEPARATOR)
}

export function replyText(reply: Reply): string {
  return joinBlocks(reply.texts)
}

function isPrompt(message: SessionMessage): boolean {
  return message.role === 'user' && (message.toolResults?.length ?? 0) === 0 && message.text.trim() !== ''
}

function isInterruption(message: SessionMessage): boolean {
  return message.role === 'user' && INTERRUPTED.test(message.text.trim())
}

export function repliesFrom(messages: SessionMessage[]): Reply[] {
  const replies: Reply[] = [{ texts: [], partial: false }]
  for (const message of messages) {
    const current = replies[replies.length - 1]
    if (current === undefined) continue
    if (isInterruption(message)) current.partial = true
    else if (isPrompt(message)) replies.push({ texts: [], partial: false })
    else if (message.role === 'assistant' && message.text.trim() !== '') current.texts.push(message.text)
  }
  return replies.filter(reply => reply.texts.length > 0)
}

export function repliesEndingWith(replies: Reply[], block: string): number[] {
  const wanted = block.trim()
  if (wanted === '') return []
  return replies.flatMap((reply, index) => ((reply.texts.at(-1) ?? '').trim() === wanted ? [index] : []))
}
