const anthropic = require('./providers/anthropic')
const gemini = require('./providers/gemini')
const groq = require('./providers/groq')
const { createProviderError } = require('./providerUtils')

const providers = {
  anthropic,
  gemini,
  groq,
}

async function runProvider(request, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const provider = providers[request.provider]
  if (!provider) {
    throw createProviderError({
      provider: request.provider,
      status: 400,
      code: 'REQUEST_INVALID',
      message: 'Unsupported provider.',
    })
  }
  if (typeof fetchImpl !== 'function') {
    throw createProviderError({
      provider: request.provider,
      status: 503,
      code: 'NETWORK_FAILURE',
      message: 'Fetch is unavailable.',
    })
  }
  return provider.execute({ request, env, fetchImpl })
}

module.exports = { runProvider }
