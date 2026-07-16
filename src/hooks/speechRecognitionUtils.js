// A browser recognition session can end after a quiet beat even when
// `continuous` is enabled. This short handoff keeps dictation live without
// forcing the user to restart after every natural pause.
export const VOICE_INPUT_RESTART_DELAY_MS = 250

export function appendVoiceTranscript(existing = '', addition = '') {
  const prefix = typeof existing === 'string' ? existing.trim() : ''
  const next = typeof addition === 'string' ? addition.trim() : ''
  if (!next) return prefix
  if (!prefix) return next
  return `${prefix}${/[\s.!?]$/.test(prefix) ? ' ' : ' '}${next}`.trim()
}

export function commitInterimTranscript(confirmed = '', interim = '') {
  return appendVoiceTranscript(confirmed, interim)
}

const SPOKEN_CORRECTION = /^(?:(?:no|sorry|actually)[,;]?\s*)?(?:i\s+(?:mean|meant)|let me rephrase|correction)[:,;]?\s+(.+)$/i

/**
 * Browser-final recognition results are normally the source of truth. When a
 * user clearly corrects their immediately preceding dictated phrase, preserve
 * the replacement rather than making them manually repair a harmless slip.
 * Typed text before dictation is protected from this replacement behavior.
 */
export function applyFinalSpeechPhrase(segments = [], phrase = '', protectedSegmentCount = 0) {
  const safeSegments = Array.isArray(segments)
    ? segments.map((segment) => typeof segment === 'string' ? segment.trim() : '').filter(Boolean)
    : []
  const cleanPhrase = typeof phrase === 'string' ? phrase.trim() : ''
  if (!cleanPhrase) return safeSegments
  const correction = cleanPhrase.match(SPOKEN_CORRECTION)?.[1]?.trim()
  if (!correction) return [...safeSegments, cleanPhrase]
  if (safeSegments.length > protectedSegmentCount) return [...safeSegments.slice(0, -1), correction]
  return [...safeSegments, correction]
}

/**
 * Keep live recognition from clobbering a user who starts typing while
 * dictation is still active. Appended typed text stays appended; if the user
 * edits the dictated portion itself, preserve that edit and only append a
 * safely identifiable new spoken delta.
 */
export function mergeLiveTranscript(current = '', previousTranscript = '', nextTranscript = '') {
  const currentText = typeof current === 'string' ? current : ''
  const previous = typeof previousTranscript === 'string' ? previousTranscript : ''
  const next = typeof nextTranscript === 'string' ? nextTranscript : ''
  if (!next) return currentText
  if (currentText === previous) return next
  if (previous && currentText.startsWith(previous)) {
    return `${next}${currentText.slice(previous.length)}`
  }
  if (!previous) return appendVoiceTranscript(next, currentText)
  if (next.startsWith(previous)) {
    const spokenDelta = next.slice(previous.length).trim()
    return spokenDelta ? appendVoiceTranscript(currentText, spokenDelta) : currentText
  }
  return currentText
}

/**
 * Browser speech recognition often emits `no-speech` after a natural pause.
 * That is not a user decision to finish dictating, so a live session should
 * quietly resume while explicit stops and meaningful errors must not restart.
 */
export function shouldResumeVoiceInput({ desired = false, error = '' } = {}) {
  if (!desired) return false
  return !['aborted', 'not-allowed', 'audio-capture', 'network', 'service-not-allowed'].includes(error)
}

export function voiceInputStatusCopy(state) {
  const copy = {
    listening: 'Listening — pause naturally; I’ll keep your place.',
    resuming: 'Keeping your place — continue when you are ready.',
    error: 'Voice input needs attention. Your typed draft is still here.',
    idle: '',
  }
  return copy[state] || ''
}
