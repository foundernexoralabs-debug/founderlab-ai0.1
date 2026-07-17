import { cleanTextForSpeech, getSpeechContentProfile } from '../../lib/speechTextUtils.js'

// Normal read-aloud should be complete by default. These high limits are a
// deliberate product boundary: only genuinely long, code-heavy, or tabular
// content is summarized; ordinary prose, lists, and references are narrated.
export const MAX_FULL_READ_ALOUD_LENGTH = 8000
export const MAX_FULL_VOICE_RESPONSE_LENGTH = 6000
export const MAX_STRUCTURED_FULL_VOICE_RESPONSE_LENGTH = 5000
// This aligns with the live prompt's 55–125-word target. It is enough room
// for a direct answer, a concrete reason, and a next move without turning the
// call into normal read-aloud.
export const MAX_LIVE_CALL_SPEECH_LENGTH = 680

/** Keep the active call in the present instead of deferring useful help. */
export function normalizeLiveCallResponseText(value = '') {
  return String(value || '')
    .replace(/\b(?:after|once|when)\s+(?:this\s+|the\s+)?call\s+(?:ends|is over|is finished)\b/gi, 'now')
    .replace(/\bafter\s+(?:this\s+|the\s+)?call\b/gi, 'now')
    .trim()
}

function shortenAtSentence(text, limit = MAX_FULL_VOICE_RESPONSE_LENGTH) {
  if (text.length <= limit) return text
  const clipped = text.slice(0, limit + 1)
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '))
  return `${(boundary > Math.floor(limit * .48) ? clipped.slice(0, boundary + 1) : clipped.slice(0, limit)).trim()}…`
}

function getListHighlights(source, maximum = 3) {
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ')
  return withoutCode
    .split('\n')
    .map((line) => line.match(/^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/)?.[1] || '')
    .map((item) => cleanTextForSpeech(item))
    .filter(Boolean)
    .slice(0, maximum)
}

function createStructuredOverview(source, spokenBase, limit, maximumHighlights = 3) {
  const highlights = getListHighlights(source, maximumHighlights)
  if (!highlights.length) return shortenAtSentence(spokenBase, limit)
  const naturalHighlights = highlights.map((item, index) => {
    const lead = index === 0 ? 'First' : index === highlights.length - 1 ? 'Finally' : 'Next'
    return `${lead}, ${item}`
  }).join('. ')
  return shortenAtSentence(`Here’s the short version. ${naturalHighlights}.`, limit)
}

function createNormalNarrationPlan(content = '', {
  fullLimit,
  structuredLimit,
  fullMode,
  fullNote,
} = {}) {
  const source = typeof content === 'string' ? content.trim() : ''
  if (!source) return { spokenText: '', mode: 'none', note: '' }

  const profile = getSpeechContentProfile(source)
  const { hasCode, hasStructuredContent, tableLineCount, listItemCount } = profile
  const hasRawTable = tableLineCount >= 2
  // A normal response with a couple of dozen short steps is still useful to
  // hear. Reserve summary mode for genuinely large data rather than treating
  // ordinary medium-length planning output as something to cut short.
  const hasLargeStructuredData = listItemCount > 30
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ').trim()
  const spokenBase = cleanTextForSpeech(withoutCode)
  if (!spokenBase) {
    return {
      spokenText: hasCode
        ? 'I’ve added the full technical result in the chat for you to review.'
        : hasRawTable
          ? 'I’ve kept the full table in the chat. I can walk you through the important result.'
        : 'I’ve added the full structured result in the chat for you to review.',
      mode: hasCode ? 'code-summary' : hasRawTable ? 'data-summary' : 'structured-summary',
      note: hasCode ? 'Full code remains in the conversation.' : hasRawTable ? 'Full table remains in the conversation.' : 'Full details remain in the conversation.',
    }
  }

  const needsOverview = hasCode
    || hasRawTable
    || hasLargeStructuredData
    || spokenBase.length > fullLimit
    || (hasStructuredContent && spokenBase.length > structuredLimit)
  if (!needsOverview) {
    return { spokenText: spokenBase, mode: fullMode, note: fullNote }
  }

  const suffix = hasCode
    ? ' I’ve kept the full code and details in the chat for you.'
    : hasRawTable
      ? ' I’ve kept the full table in the chat for you.'
    : ' I’ve kept the full breakdown in the chat for you.'
  const summaryLimit = Math.max(360, Math.min(1000, fullLimit - suffix.length))
  const overview = hasStructuredContent && !hasRawTable
    ? createStructuredOverview(source, spokenBase, summaryLimit)
    : shortenAtSentence(spokenBase, summaryLimit)
  return {
    spokenText: `${overview}${suffix}`.trim(),
    mode: hasCode ? 'code-summary' : hasRawTable || hasLargeStructuredData ? 'data-summary' : hasStructuredContent ? 'structured-summary' : 'summary',
    note: hasCode
      ? 'A concise technical overview is playing; full code remains in the chat.'
      : hasRawTable || hasLargeStructuredData
        ? 'A concise data overview is playing; full details remain in the chat.'
        : 'A concise overview is playing; full details remain in the chat.',
  }
}

/**
 * The explicit message action is the highest-fidelity narration path. It
 * reads the full normal answer and only condenses material that is genuinely
 * unsuitable for natural speech, such as code or a raw data table.
 */
export function createReadAloudPlan(content = '') {
  return createNormalNarrationPlan(content, {
    fullLimit: MAX_FULL_READ_ALOUD_LENGTH,
    structuredLimit: MAX_FULL_READ_ALOUD_LENGTH,
    fullMode: 'full-read-aloud',
    fullNote: 'Reading the full response.',
  })
}

/**
 * A completed voice turn remains normal Chat, not a live-call shortcut. It
 * therefore follows the same full-narration principle with a bounded but
 * generous limit for comfortable day-to-day playback.
 */
export function createVoiceResponsePlan(content = '') {
  return createNormalNarrationPlan(content, {
    fullLimit: MAX_FULL_VOICE_RESPONSE_LENGTH,
    structuredLimit: MAX_STRUCTURED_FULL_VOICE_RESPONSE_LENGTH,
    fullMode: 'conversational',
    fullNote: '',
  })
}

/**
 * A live call needs a much tighter spoken turn than a read-aloud message.
 * The original response stays available to the session recap, while this
 * plan protects the caller from an essay being read back to them.
 */
export function createLiveCallResponsePlan(content = '') {
  const source = normalizeLiveCallResponseText(content)
  if (!source) return { spokenText: '', mode: 'none', note: '' }

  const profile = getSpeechContentProfile(source)
  const withoutCode = source.replace(/```[\s\S]*?```/g, ' ').trim()
  const spokenBase = cleanTextForSpeech(withoutCode)
  if (!spokenBase) {
    return {
      spokenText: 'I have the technical detail ready. I can walk you through the key change now.',
      mode: 'call-summary',
      note: 'A concise call summary is playing.',
    }
  }

  const needsSummary = profile.hasCode || spokenBase.length > MAX_LIVE_CALL_SPEECH_LENGTH
  // A short, structured reply is still a real answer. Reading it directly is
  // more useful than collapsing it into three generic highlights. Reserve an
  // overview for material that is genuinely unsuitable for a spoken turn.
  const overview = !needsSummary
    ? spokenBase
    : profile.hasStructuredContent
      ? createStructuredOverview(source, spokenBase, MAX_LIVE_CALL_SPEECH_LENGTH, 4)
      : shortenAtSentence(spokenBase, MAX_LIVE_CALL_SPEECH_LENGTH)
  return {
    spokenText: overview.trim(),
    mode: needsSummary ? 'call-summary' : 'call-conversational',
    note: needsSummary ? 'A concise live-call answer is playing.' : '',
  }
}
