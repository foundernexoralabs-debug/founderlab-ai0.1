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
    voices: {
      male: 'nPczCjzI2devNBz1zQrb',
      female: 'OZ0L6eISlOejga3XjDFt',
    },
    voiceLabels: {
      male: 'Brian',
      female: 'Talia — Warm Soft Guide',
    },
    // Sarah is Talia's legacy predecessor and remains the closest safe
    // fallback while ElevenLabs continues the default-voice transition.
    voiceFallbacks: {
      female: {
        id: 'EXAVITQu4vr4xnSDxMaL',
        label: 'Sarah — Warm Friendly Guide',
      },
    },
  },
]

function freezeVoiceProvider(provider) {
  return Object.freeze({
    ...provider,
    capabilities: Object.freeze({ ...provider.capabilities }),
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
