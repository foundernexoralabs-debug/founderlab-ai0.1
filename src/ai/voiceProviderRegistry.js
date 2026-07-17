const voiceProviderEntries = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs voice service',
    keyEnv: 'ELEVENLABS_API_KEY',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    defaultModel: 'eleven_multilingual_v2',
    // New, unconfigured Chat sessions begin with Talia. Existing saved voice
    // choices stay intact in voicePreferences rather than being overwritten.
    defaultVoice: 'female',
    capabilities: { cloud: true, audioOutput: true, browserFallback: true },
    // Tuned for calm, direct assistant conversation. Keep style at zero so
    // either voice stays conversational rather than drifting toward a
    // storyteller performance; the slightly measured default is easier to
    // follow over a longer chat or live-call session.
    conversationSettings: {
      stability: 0.48,
      similarity_boost: 0.78,
      style: 0,
      use_speaker_boost: true,
      speed: 0.98,
    },
    voices: {
      male: 'l7kNoIfnJKPg7779LI2t',
      female: 'OZ0L6eISlOejga3XjDFt',
    },
    voiceLabels: {
      male: 'Eddie — Helpful and Comforting',
      female: 'Talia — Warm Soft Guide',
    },
    // Fallbacks are intentionally assistant-oriented. Sarah and Caleb keep
    // the selected tone warm and helpful if a newer default voice is missing.
    voiceFallbacks: {
      female: {
        id: 'EXAVITQu4vr4xnSDxMaL',
        label: 'Sarah — Warm Friendly Guide',
      },
      male: {
        id: 'AaOhDHYJ1XLZk74lXhdE',
        label: 'Caleb — Trusted Guide',
      },
    },
  },
]

function freezeVoiceProvider(provider) {
  return Object.freeze({
    ...provider,
    capabilities: Object.freeze({ ...provider.capabilities }),
    conversationSettings: Object.freeze({ ...provider.conversationSettings }),
    voices: Object.freeze({ ...provider.voices }),
    voiceLabels: Object.freeze({ ...provider.voiceLabels }),
    voiceFallbacks: Object.freeze(Object.fromEntries(Object.entries(provider.voiceFallbacks || {}).map(([voice, fallback]) => [voice, Object.freeze({ ...fallback })]))),
  })
}

export const VOICE_PROVIDERS = Object.freeze(Object.fromEntries(
  voiceProviderEntries.map((provider) => [provider.id, freezeVoiceProvider(provider)])
))

export function getVoiceProvider(providerId = 'elevenlabs') {
  return VOICE_PROVIDERS[providerId] || null
}

export function getVoiceId(providerId, voice) {
  const provider = getVoiceProvider(providerId)
  if (!provider) return ''
  const voiceKey = provider.voices[voice] ? voice : provider.defaultVoice
  return provider.voices[voiceKey] || ''
}

/**
 * The first entry is always the selected voice. A fallback exists only for a
 * known unavailable-voice response; quota and authentication failures must
 * never silently switch the caller to another voice.
 */
export function getVoiceCandidates(providerId, voice) {
  const provider = getVoiceProvider(providerId)
  if (!provider) return []
  const voiceKey = provider.voices[voice] ? voice : provider.defaultVoice
  const primaryId = provider.voices[voiceKey]
  const candidates = primaryId
    ? [{ id: primaryId, label: provider.voiceLabels[voiceKey] || 'Premium voice', fallback: false }]
    : []
  const fallback = provider.voiceFallbacks?.[voiceKey]
  if (fallback?.id && fallback.id !== primaryId) candidates.push({ ...fallback, fallback: true })
  return candidates
}
