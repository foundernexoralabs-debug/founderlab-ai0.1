const { createProviderError } = require('../ai/providerUtils')

let voiceRegistryPromise = null

function getVoiceRegistry() {
  if (!voiceRegistryPromise) {
    voiceRegistryPromise = import('../../src/ai/voiceProviderRegistry.js')
  }
  return voiceRegistryPromise
}

async function getVoiceProvider() {
  return (await getVoiceRegistry()).getVoiceProvider('elevenlabs')
}

async function synthesizeVoice({ text, gender, env = process.env, fetchImpl = globalThis.fetch } = {}) {
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

  const registry = await getVoiceRegistry()
  const candidates = registry.getVoiceCandidates(provider.id, gender)
  let failedResponse = null
  for (const candidate of candidates) {
    const response = await fetchImpl('https://api.elevenlabs.io/v1/text-to-speech/' + candidate.id, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: String(text || '').slice(0, 2500),
        model_id: provider.defaultModel,
        voice_settings: provider.conversationSettings,
      }),
    })
    if (response.ok) return Buffer.from(await response.arrayBuffer())
    failedResponse = response
    // Only an unavailable voice is eligible for the registry fallback. Do not
    // hide quota, authorization, or upstream availability problems by retrying.
    if (response.status !== 404) break
  }
  const code = failedResponse?.status === 429
    ? 'RATE_LIMITED'
    : [401, 403].includes(failedResponse?.status)
      ? 'AUTHENTICATION_FAILED'
      : 'PROVIDER_UNAVAILABLE'
  throw createProviderError({ provider: provider.id, status: failedResponse?.status || 502, code, message: 'Voice provider request failed.' })
}

module.exports = { getVoiceProvider, synthesizeVoice }
