export const LIVE_CALL_TURN_DELAY_MS = 950
export const LIVE_CALL_MAX_SPOKEN_LENGTH = 340
export const LIVE_CALL_RECAP_TURN_LIMIT = 4

export const EMPTY_LIVE_CALL = Object.freeze({
  phase: 'idle',
  transcript: '',
  note: '',
  error: '',
  muted: false,
  turns: Object.freeze([]),
})

export const LIVE_CALL_COPY = Object.freeze({
  connecting: Object.freeze({ title: 'Connecting', detail: 'Preparing your microphone.' }),
  listening: Object.freeze({ title: 'Listening', detail: 'Speak naturally. FounderLab will take the next turn after a short pause.' }),
  thinking: Object.freeze({ title: 'Thinking', detail: 'Working on a response.' }),
  speaking: Object.freeze({ title: 'Speaking', detail: 'You can stop the response or mute your mic at any time.' }),
  muted: Object.freeze({ title: 'Mic muted', detail: 'Unmute when you are ready to continue.' }),
  error: Object.freeze({ title: 'Call needs attention', detail: 'Your conversation is safe. Resume when ready.' }),
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

export function getLiveCallCopy(phase) {
  return LIVE_CALL_COPY[phase] || LIVE_CALL_COPY.error
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
