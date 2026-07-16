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
    listening: 'Listening — brief pauses are okay.',
    resuming: 'Still listening — ready when you are.',
    error: 'Voice input needs attention. Your typed draft is still here.',
    idle: '',
  }
  return copy[state] || ''
}
