import { cleanTextForSpeech, getSpeechContentProfile } from '../../lib/speechTextUtils.js'

const MAX_CONVERSATIONAL_SPEECH_LENGTH = 620
export const MAX_LIVE_CALL_SPEECH_LENGTH = 280

function shortenAtSentence(text, limit = MAX_CONVERSATIONAL_SPEECH_LENGTH) {
  if (text.length <= limit) return text
  const clipped = text.slice(0, limit + 1)
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '))
  return `${(boundary > Math.floor(limit * .48) ? clipped.slice(0, boundary + 1) : clipped.slice(0, limit)).trim()}…`
}

function getListHighlights(source) {
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ')
  return withoutCode
    .split('\n')
    .map((line) => line.match(/^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/)?.[1] || '')
    .map((item) => cleanTextForSpeech(item))
    .filter(Boolean)
    .slice(0, 3)
}

function createStructuredOverview(source, spokenBase, limit) {
  const highlights = getListHighlights(source)
  if (!highlights.length) return shortenAtSentence(spokenBase, limit)
  const naturalHighlights = highlights.map((item, index) => {
    const lead = index === 0 ? 'First' : index === highlights.length - 1 ? 'Finally' : 'Next'
    return `${lead}, ${item}`
  }).join('. ')
  return shortenAtSentence(`Here’s the short version. ${naturalHighlights}.`, limit)
}

/**
 * Voice sessions should sound conversational without hiding the complete
 * result. Code and dense long-form details remain in the chat while the
 * spoken layer gives a truthful, short orientation to what FounderLab made.
 */
export function createVoiceResponsePlan(content = '') {
  const source = typeof content === 'string' ? content.trim() : ''
  if (!source) return { spokenText: '', mode: 'none', note: '' }

  const profile = getSpeechContentProfile(source)
  const { hasCode, hasStructuredContent, hasReferences } = profile
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ').trim()
  const spokenBase = cleanTextForSpeech(withoutCode)
  if (!spokenBase) {
    return {
      spokenText: hasCode
        ? 'I’ve added the full technical result in the chat for you to review.'
        : 'I’ve added the full structured result in the chat for you to review.',
      mode: hasCode ? 'code-summary' : 'structured-summary',
      note: hasCode ? 'Full code remains in the conversation.' : 'Full details remain in the conversation.',
    }
  }

  const needsOverview = hasCode || hasStructuredContent || hasReferences || spokenBase.length > MAX_CONVERSATIONAL_SPEECH_LENGTH
  if (!needsOverview) {
    return { spokenText: spokenBase, mode: 'conversational', note: '' }
  }

  const suffix = hasCode
    ? ' I’ve kept the full code and details in the chat for you.'
    : ' I’ve kept the full breakdown in the chat for you.'
  const summaryLimit = Math.max(180, MAX_CONVERSATIONAL_SPEECH_LENGTH - suffix.length)
  const overview = hasStructuredContent
    ? createStructuredOverview(source, spokenBase, summaryLimit)
    : shortenAtSentence(spokenBase, summaryLimit)
  return {
    spokenText: `${overview}${suffix}`,
    mode: hasCode ? 'code-summary' : hasStructuredContent ? 'structured-summary' : 'summary',
    note: hasCode ? 'A concise voice overview is playing; full code remains in the chat.' : 'A concise voice overview is playing; full details remain in the chat.',
  }
}

/**
 * A live call needs a much tighter spoken turn than a read-aloud message.
 * The original response stays available to the session recap, while this
 * plan protects the caller from an essay being read back to them.
 */
export function createLiveCallResponsePlan(content = '') {
  const source = typeof content === 'string' ? content.trim() : ''
  if (!source) return { spokenText: '', mode: 'none', note: '' }

  const profile = getSpeechContentProfile(source)
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ').trim()
  const spokenBase = cleanTextForSpeech(withoutCode)
  if (!spokenBase) {
    return {
      spokenText: 'I have the technical detail ready. I can walk you through it after the call.',
      mode: 'call-summary',
      note: 'A concise call summary is playing.',
    }
  }

  const needsSummary = profile.hasCode || profile.hasStructuredContent || profile.hasReferences || spokenBase.length > MAX_LIVE_CALL_SPEECH_LENGTH
  const suffix = needsSummary ? ' I can expand on that after the call.' : ''
  const limit = Math.max(150, MAX_LIVE_CALL_SPEECH_LENGTH - suffix.length)
  const overview = profile.hasStructuredContent
    ? createStructuredOverview(source, spokenBase, limit)
    : shortenAtSentence(spokenBase, limit)
  return {
    spokenText: `${overview}${suffix}`.trim(),
    mode: needsSummary ? 'call-summary' : 'call-conversational',
    note: needsSummary ? 'A concise live-call answer is playing.' : '',
  }
}
