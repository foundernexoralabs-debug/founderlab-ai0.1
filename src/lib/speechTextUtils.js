function stripCodeBlocks(value = '') {
  let containedCode = false
  const text = String(value).replace(/```[\s\S]*?```/g, () => {
    containedCode = true
    return ' '
  })
  return { text, containedCode }
}

/**
 * Identify content that should be presented as a compact spoken overview.
 * The saved message is never changed: this profile only guides narration.
 */
export function getSpeechContentProfile(value = '') {
  const source = typeof value === 'string' ? value : ''
  const { text, containedCode } = stripCodeBlocks(source)
  const listItemCount = (text.match(/^\s*(?:[-*+•]|\d+[.)])\s+/gm) || []).length
  const tableLineCount = (text.match(/^\s*\|.+\|\s*$/gm) || []).length
  const referenceCount = (text.match(/(?:https?:\/\/|\[[^\]]+\]\([^)]+\)|\[\^?\d+\])/gi) || []).length
  return {
    // Inline code often represents a short command or product term that can
    // be spoken naturally. Only a fenced block needs the separate full-code
    // narration path.
    hasCode: containedCode,
    hasInlineCode: /`[^`]+`/.test(text),
    hasStructuredContent: listItemCount >= 2 || tableLineCount >= 2,
    hasReferences: referenceCount > 0,
    listItemCount,
  }
}

/**
 * Produces natural narration from assistant content without altering the
 * preserved Chat message. Presentation marks, citation syntax, raw URLs,
 * tables, and code do not belong in a spoken response.
 */
export function cleanTextForSpeech(value = '') {
  const source = typeof value === 'string' ? value : ''
  if (!source.trim()) return ''

  const { text: withoutCode, containedCode } = stripCodeBlocks(source)
  const cleaned = withoutCode
    .replace(/^\s*(?:---+|___+|\*\*\*+)\s*$/gm, ' ')
    .replace(/^\s*\|.+\|\s*$/gm, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/\[\^?\d+\]/g, '')
    .replace(/https?:\/\/[^\s)\]]+/gi, 'the linked resource')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,3}|_{1,3}|~{1,2}|\|/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/&/g, ' and ')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/[()[\]{}]/g, '')
    .replace(/[—–]+/g, ', ')
    .replace(/[,:;]+/g, ',')
    .replace(/[!?]{2,}|\.{2,}|…+/g, '.')
    .replace(/\n+/g, '. ')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim()

  if (!cleaned) return containedCode ? 'The detailed code is available in the chat.' : ''
  return containedCode ? `${cleaned} The detailed code is available in the chat.` : cleaned
}
