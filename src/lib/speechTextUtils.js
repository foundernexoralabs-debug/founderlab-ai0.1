/**
 * Produces natural narration from assistant content without altering the
 * preserved Chat message. This is deliberately conservative: it removes
 * presentation artifacts and code, but never tries to rewrite the answer.
 */
export function cleanTextForSpeech(value = '') {
  const source = typeof value === 'string' ? value : ''
  if (!source.trim()) return ''

  let containedCode = false
  const cleaned = source
    .replace(/```[\s\S]*?```/g, () => {
      containedCode = true
      return ' '
    })
    .replace(/https?:\/\/[^\s)\]]+/gi, 'the linked resource')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\*{1,3}|_{1,3}|~{1,2}|\|/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/[()[\]{}<>]/g, '')
    .replace(/[,:;]+/g, ',')
    .replace(/[!?]{2,}|\.{2,}/g, '.')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim()

  if (!cleaned) return containedCode ? 'The detailed code is available in the chat.' : ''
  return containedCode ? `${cleaned} The detailed code is available in the chat.` : cleaned
}
