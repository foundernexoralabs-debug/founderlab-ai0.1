const voiceProviderEntries = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs voice service',
    keyEnv: 'ELEVENLABS_API_KEY',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    defaultModel: 'eleven_multilingual_v2',
    defaultVoice: 'male',
    capabilities: { cloud: true, audioOutput: true, browserFallback: true },
    voices: {
      male: 'nPczCjzI2devNBz1zQrb',
      female: 'EST9Ui6982FZPSi7gCHi',
    },
    voiceLabels: {
      male: 'Brian',
      female: 'Custom Female',
    },
  },
]

function freezeVoiceProvider(provider) {
  return Object.freeze({
    ...provider,
    capabilities: Object.freeze({ ...provider.capabilities }),
    voices: Object.freeze({ ...provider.voices }),
    voiceLabels: Object.freeze({ ...provider.voiceLabels }),
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
  return provider.voices[voice] || provider.voices.male || ''
}
