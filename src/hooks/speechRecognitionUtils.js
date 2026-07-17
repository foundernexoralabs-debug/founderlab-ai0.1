import {
  getExplicitSelfCorrection,
  isLikelyRestartExtension,
  isLikelySingleWordRevision,
  normalizeFinalSpokenPhrase,
} from '../lib/conversationLanguage.js'

// A browser recognition session can end after a quiet beat even when
// `continuous` is enabled. This short handoff keeps dictation live without
// forcing the user to restart after every natural pause.
export const VOICE_INPUT_RESTART_DELAY_MS = 150

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

function comparableSpeech(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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
  const cleanPhrase = normalizeFinalSpokenPhrase(phrase)
  if (!cleanPhrase) return safeSegments
  const correction = getExplicitSelfCorrection(cleanPhrase)
  const canReplaceLastSpokenSegment = safeSegments.length > protectedSegmentCount
  if (correction && canReplaceLastSpokenSegment) return [...safeSegments.slice(0, -1), correction]
  if (correction) return [...safeSegments, correction]

  // Recognition engines can finalise a brief restart separately: “Draft the
  // launch…” followed by “Draft the launch email.” If the later final phrase
  // safely extends the last dictated segment, keep the more complete phrase
  // instead of making the assistant infer through duplicated wording.
  const lastSegment = safeSegments.at(-1) || ''
  const previous = comparableSpeech(lastSegment)
  const next = comparableSpeech(cleanPhrase)
  if (canReplaceLastSpokenSegment && previous && previous === next) return safeSegments
  const previousWordCount = previous ? previous.split(' ').length : 0
  if (canReplaceLastSpokenSegment && previousWordCount >= 2 && (isLikelyRestartExtension(lastSegment, cleanPhrase) || isLikelySingleWordRevision(lastSegment, cleanPhrase))) {
    return [...safeSegments.slice(0, -1), cleanPhrase]
  }
  return [...safeSegments, cleanPhrase]
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
    starting: 'Starting voice input — you can begin speaking as soon as the mic is ready.',
    listening: 'Listening — pause naturally; I’ll keep your place.',
    resuming: 'Keeping your place — continue when you are ready.',
    error: 'Voice input needs attention. Your typed draft is still here.',
    idle: '',
  }
  return copy[state] || ''
}
