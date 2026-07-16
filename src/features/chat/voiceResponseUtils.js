import { cleanTextForSpeech } from '../../lib/speechTextUtils.js'

const MAX_CONVERSATIONAL_SPEECH_LENGTH = 620

function shortenAtSentence(text, limit = MAX_CONVERSATIONAL_SPEECH_LENGTH) {
  if (text.length <= limit) return text
  const clipped = text.slice(0, limit + 1)
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '))
  return `${(boundary > Math.floor(limit * .48) ? clipped.slice(0, boundary + 1) : clipped.slice(0, limit)).trim()}…`
}

/**
 * Voice sessions should sound conversational without hiding the complete
 * result. Code and dense long-form details remain in the chat while the
 * spoken layer gives a truthful, short orientation to what FounderLab made.
 */
export function createVoiceResponsePlan(content = '') {
  const source = typeof content === 'string' ? content.trim() : ''
  if (!source) return { spokenText: '', mode: 'none', note: '' }

  const hasCode = /```[\s\S]*?```/.test(source)
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ').trim()
  const spokenBase = cleanTextForSpeech(withoutCode)
  if (!spokenBase) {
    return {
      spokenText: 'I’ve added the full technical result in the chat for you to review.',
      mode: 'code-summary',
      note: 'Full code remains in the conversation.',
    }
  }

  if (!hasCode && spokenBase.length <= MAX_CONVERSATIONAL_SPEECH_LENGTH) {
    return { spokenText: spokenBase, mode: 'conversational', note: '' }
  }

  const suffix = hasCode
    ? ' I’ve kept the full code and details in the chat for you.'
    : ' I’ve kept the full breakdown in the chat for you.'
  const summaryLimit = Math.max(180, MAX_CONVERSATIONAL_SPEECH_LENGTH - suffix.length)
  return {
    spokenText: `${shortenAtSentence(spokenBase, summaryLimit)}${suffix}`,
    mode: hasCode ? 'code-summary' : 'summary',
    note: hasCode ? 'A concise voice overview is playing; full code remains in the chat.' : 'A concise voice overview is playing; full details remain in the chat.',
  }
}
