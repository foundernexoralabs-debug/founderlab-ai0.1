// A browser final result already represents a meaningful pause. Keep only a
// short guard window so FounderLab feels responsive without sending a phrase
// while the caller is still correcting a very short fragment.
export const LIVE_CALL_TURN_DELAY_MS = 450
export const LIVE_CALL_SHORT_TURN_DELAY_MS = 700
export const LIVE_CALL_MAX_SPOKEN_LENGTH = 280
export const LIVE_CALL_RECAP_TURN_LIMIT = 4
export const LIVE_CALL_HISTORY_MESSAGE_LIMIT = 6
export const LIVE_CALL_TURN_CONTEXT_LIMIT = 8
export const LIVE_CALL_CONTEXT_CHARACTER_LIMIT = 9000
export const LIVE_CALL_MAX_OUTPUT_TOKENS = 160

/**
 * A Live Call is a focused state machine, separate from text-chat composing.
 * Explicit states keep microphone, model, and playback feedback from
 * competing for the same visible state.
 */
export const LIVE_CALL_PHASES = Object.freeze([
  'idle',
  'connecting',
  'ready',
  'listening',
  'thinking',
  'speaking',
  'interrupted',
  'muted',
  'reconnecting',
  'error',
  'ended',
])

export const EMPTY_LIVE_CALL = Object.freeze({
  phase: 'idle',
  transcript: '',
  note: '',
  error: '',
  muted: false,
  providerId: '',
  modelId: '',
  turns: Object.freeze([]),
})

export const LIVE_CALL_COPY = Object.freeze({
  connecting: Object.freeze({ title: 'Connecting', detail: 'Preparing your microphone.' }),
  ready: Object.freeze({ title: 'Ready', detail: 'Your live call is ready when you are.' }),
  listening: Object.freeze({ title: 'Listening', detail: 'Speak naturally. FounderLab will take the next turn after a short pause.' }),
  thinking: Object.freeze({ title: 'Thinking', detail: 'Preparing a concise answer.' }),
  speaking: Object.freeze({ title: 'Responding', detail: 'Speak to interrupt, or stop the response at any time.' }),
  interrupted: Object.freeze({ title: 'I’m listening', detail: 'FounderLab paused so you can continue.' }),
  muted: Object.freeze({ title: 'Mic muted', detail: 'Unmute when you are ready to continue.' }),
  reconnecting: Object.freeze({ title: 'Reconnecting', detail: 'Restoring your microphone for the next turn.' }),
  error: Object.freeze({ title: 'Call needs attention', detail: 'Your conversation is safe. Resume when ready.' }),
  ended: Object.freeze({ title: 'Call ended', detail: 'Your recap is ready in this conversation.' }),
})

export function getLiveCallProviderSupport(provider) {
  if (!provider?.id) {
    return Object.freeze({ supported: false, label: 'Choose an AI provider before starting a live call.' })
  }
  if (provider.local) {
    return Object.freeze({
      supported: true,
      local: true,
      label: `Private local call · ${provider.model || 'Local Ollama model'}`,
    })
  }
  return Object.freeze({
    supported: true,
    local: false,
    label: `${provider.name || 'Cloud AI'} · ${provider.model || 'Selected model'}`,
  })
}

/** A final speech result starts the short, controlled end-of-turn window. */
export function shouldQueueLiveCallTurn({ active = false, muted = false, isFinal = false, transcript = '' } = {}) {
  return active === true && muted !== true && isFinal === true && typeof transcript === 'string' && transcript.trim().length > 0
}

/**
 * Final speech results arrive after the browser has already detected a pause.
 * Substantive turns can therefore move quickly; a tiny unfinished fragment
 * gets a little more room for a natural correction.
 */
export function getLiveCallTurnDelay(transcript = '') {
  const text = typeof transcript === 'string' ? transcript.trim() : ''
  const wordCount = text ? text.split(/\s+/).length : 0
  const soundsComplete = /[.!?…]$/.test(text)
  return wordCount <= 2 && !soundsComplete
    ? LIVE_CALL_SHORT_TURN_DELAY_MS
    : LIVE_CALL_TURN_DELAY_MS
}

export function getLiveCallCopy(phase) {
  return LIVE_CALL_COPY[phase] || LIVE_CALL_COPY.error
}

/** A caller can take back the floor only while FounderLab is speaking. */
export function canInterruptLiveCall({ active = false, muted = false, phase = '' } = {}) {
  return active === true && muted !== true && phase === 'speaking'
}

/** The call UI needs a compact caption, never a duplicate message thread. */
export function getLiveCallTranscriptPreview(value) {
  return truncateLiveCallText(value, 140)
}

function normalizeLiveCallContextMessage(message) {
  if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return null
  const content = message.content.trim()
  if (!content) return null
  return {
    role: message.role,
    content: content.length > 3000 ? `${content.slice(0, 2999).trim()}…` : content,
    ...(message.role === 'user' && message.source === 'voice' ? { source: 'voice' } : {}),
  }
}

/**
 * Live Call needs continuity, not an ever-growing text-chat payload. Bound
 * historical context keeps provider work and first-word latency predictable
 * while retaining the current call’s most recent exchanges.
 */
export function buildLiveCallRequestContext(conversationMessages = [], liveTurns = []) {
  const history = (Array.isArray(conversationMessages) ? conversationMessages : [])
    .slice(-LIVE_CALL_HISTORY_MESSAGE_LIMIT)
    .map(normalizeLiveCallContextMessage)
    .filter(Boolean)
  const callTurns = (Array.isArray(liveTurns) ? liveTurns : [])
    .slice(-LIVE_CALL_TURN_CONTEXT_LIMIT)
    .map(normalizeLiveCallContextMessage)
    .filter(Boolean)
  const candidates = [...history, ...callTurns]
  const kept = []
  let characters = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]
    // Always retain the newest turn; older context yields first.
    if (kept.length && characters + message.content.length > LIVE_CALL_CONTEXT_CHARACTER_LIMIT) continue
    kept.unshift(message)
    characters += message.content.length
  }
  return kept
}

export function truncateLiveCallText(value, limit = LIVE_CALL_MAX_SPOKEN_LENGTH) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text || text.length <= limit) return text
  const clipped = text.slice(0, limit + 1)
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '))
  return `${(boundary > Math.floor(limit * .5) ? clipped.slice(0, boundary + 1) : clipped.slice(0, limit)).trim()}…`
}

/** Only a compact, end-of-call recap is written into normal Chat history. */
export function createLiveCallRecap(turns = []) {
  const safeTurns = Array.isArray(turns)
    ? turns.filter((turn) => ['user', 'assistant'].includes(turn?.role) && typeof turn.content === 'string' && turn.content.trim())
    : []
  const finalAssistantIndex = safeTurns.map((turn) => turn.role).lastIndexOf('assistant')
  if (finalAssistantIndex < 0) return ''
  const latestTurns = safeTurns.slice(0, finalAssistantIndex + 1).slice(-LIVE_CALL_RECAP_TURN_LIMIT)
  const items = latestTurns.map((turn) => {
    const label = turn.role === 'user' ? 'You' : 'FounderLab'
    return `- **${label}:** ${truncateLiveCallText(turn.content, 220)}`
  })
  return `## Live call recap\n\n${items.join('\n')}`
}
