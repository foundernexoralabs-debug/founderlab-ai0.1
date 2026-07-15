const { createProviderError } = require('../ai/providerUtils')

let voiceProviderPromise = null

function getVoiceProvider() {
  if (!voiceProviderPromise) {
    voiceProviderPromise = import('../../src/ai/voiceProviderRegistry.js')
      .then((registry) => registry.getVoiceProvider('elevenlabs'))
  }
  return voiceProviderPromise
}

async function synthesizeVoice({ text, gender = 'male', env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const provider = await getVoiceProvider()
  const apiKey = env[provider.keyEnv]
  if (!apiKey) {
    throw createProviderError({
      provider: provider.id,
      status: 503,
      code: 'MISSING_CONFIGURATION',
      message: 'Voice provider is not configured.',
    })
  }
  if (typeof fetchImpl !== 'function') {
    throw createProviderError({ provider: provider.id, status: 503, code: 'NETWORK_FAILURE', message: 'Fetch is unavailable.' })
  }

  const voiceId = provider.voices[gender] || provider.voices.male
  const response = await fetchImpl('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: String(text || '').slice(0, 2500),
      model_id: provider.defaultModel,
      voice_settings: { stability: 0.5, similarity_boost: 0.82, style: 0.3, use_speaker_boost: true },
    }),
  })

  if (!response.ok) {
    const code = response.status === 429
      ? 'RATE_LIMITED'
      : [401, 403].includes(response.status)
        ? 'AUTHENTICATION_FAILED'
        : 'PROVIDER_UNAVAILABLE'
    throw createProviderError({ provider: provider.id, status: response.status || 502, code, message: 'Voice provider request failed.' })
  }

  return Buffer.from(await response.arrayBuffer())
}

module.exports = { getVoiceProvider, synthesizeVoice }
