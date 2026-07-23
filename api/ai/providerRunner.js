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

/**
 * Provider-neutral real-stream entry point. Every yielded delta originated
 * from the selected provider; callers must not invent interim text when a
 * provider cannot stream.
 */
async function* runProviderStream(request, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
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
  if (typeof provider.stream !== 'function') {
    throw createProviderError({
      provider: request.provider,
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'This provider does not support streaming.',
    })
  }
  yield* provider.stream({ request, env, fetchImpl })
}

module.exports = { runProvider, runProviderStream }
