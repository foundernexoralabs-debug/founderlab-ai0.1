function stripCodeBlocks(value = '') {
  let containedCode = false
  const text = String(value).replace(/```[\s\S]*?```/g, () => {
    containedCode = true
    return ' '
  })
  return { text, containedCode }
}

function addNaturalListTransitions(value = '') {
  let itemIndex = 0
  return String(value).split('\n').map((line) => {
    const match = line.match(/^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/)
    if (!match) {
      if (line.trim()) itemIndex = 0
      return line
    }
    const lead = itemIndex === 0 ? 'First, ' : itemIndex === 1 ? 'Next, ' : itemIndex === 2 ? 'Then, ' : 'Also, '
    itemIndex += 1
    return `${lead}${match[1]}`
  }).join('\n')
}

// ElevenLabs and browser speech engines are more reliable with sentence-sized
// requests. Keep every character in the audible answer while avoiding a
// single oversized payload being silently truncated by a provider or engine.
// Keep normal prose in fewer provider requests. This remains below the
// server-side ElevenLabs limit (2,500 characters) while reducing hand-offs
// that can make a medium-length read feel chopped into separate clips.
export const MAX_SPEECH_PLAYBACK_CHUNK_LENGTH = 2200

function splitLongSpeechSegment(value, limit) {
  const chunks = []
  let remaining = value.trim()
  while (remaining.length > limit) {
    const boundary = Math.max(
      remaining.lastIndexOf(' ', limit),
      remaining.lastIndexOf(',', limit),
      remaining.lastIndexOf(';', limit),
    )
    const end = boundary > Math.floor(limit * 0.55) ? boundary : limit
    chunks.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

/**
 * Split natural narration without dropping its tail. The returned chunks are
 * independently safe for the server TTS request and browser synthesis.
 */
export function splitSpeechForPlayback(value = '', limit = MAX_SPEECH_PLAYBACK_CHUNK_LENGTH) {
  const text = typeof value === 'string' ? value.trim() : ''
  const safeLimit = Number.isFinite(limit) ? Math.max(240, Math.floor(limit)) : MAX_SPEECH_PLAYBACK_CHUNK_LENGTH
  if (!text) return []
  if (text.length <= safeLimit) return [text]

  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]
  const chunks = []
  let current = ''
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim()
    if (!sentence) continue
    if (sentence.length > safeLimit) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      chunks.push(...splitLongSpeechSegment(sentence, safeLimit))
      continue
    }
    const next = current ? `${current} ${sentence}` : sentence
    if (next.length > safeLimit && current) {
      chunks.push(current)
      current = sentence
      continue
    }
    current = next
  }
  if (current) chunks.push(current)
  return chunks
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
  const headingCount = (text.match(/^\s*#{1,6}\s+.+$/gm) || []).length
  const referenceCount = (text.match(/(?:https?:\/\/|\[[^\]]+\]\([^)]+\)|\[\^?\d+\])/gi) || []).length
  return {
    // Inline code often represents a short command or product term that can
    // be spoken naturally. Only a fenced block needs the separate full-code
    // narration path.
    hasCode: containedCode,
    hasInlineCode: /`[^`]+`/.test(text),
    hasStructuredContent: listItemCount >= 2 || tableLineCount >= 2 || headingCount >= 2,
    hasReferences: referenceCount > 0,
    listItemCount,
    headingCount,
    tableLineCount,
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

  const { text: withoutCode, containedCode } = stripCodeBlocks(addNaturalListTransitions(source))
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
    // Keep meaningful punctuation for natural pacing. Collapsing every
    // comma, colon, and semicolon into the same pause made otherwise fluent
    // prose sound flat even though the narration content was correct.
    .replace(/[—–]+/g, ', ')
    .replace(/;+/g, '. ')
    .replace(/,{2,}/g, ',')
    .replace(/:{2,}/g, ': ')
    .replace(/[!?]{2,}|\.{2,}|…+/g, '.')
    .replace(/\n+/g, '. ')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim()

  if (!cleaned) return containedCode ? 'The detailed code is available in the chat.' : ''
  return containedCode ? `${cleaned} The detailed code is available in the chat.` : cleaned
}
