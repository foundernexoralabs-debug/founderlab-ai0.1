const anthropic = require('./providers/anthropic')
const gemini = require('./providers/gemini')
const groq = require('./providers/groq')
const ollama = require('./providers/ollama')
const { createProviderError } = require('./providerUtils')

const providers = {
  anthropic,
  gemini,
  groq,
  ollama,
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 60 * 1000

function getProviderTimeoutMs(env = process.env) {
  const requested = Number(env.FOUNDERLAB_PROVIDER_TIMEOUT_MS)
  if (!Number.isFinite(requested)) return DEFAULT_PROVIDER_TIMEOUT_MS
  return Math.min(Math.max(Math.floor(requested), 5 * 1000), 120 * 1000)
}

/**
 * Provider adapters receive one bounded fetch implementation. This protects
 * all cloud/provider execution paths consistently without making client-side
 * cancellation or individual adapters responsible for timeout policy.
 */
function createTimedFetch(fetchImpl, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS) {
  return async (url, options = {}) => {
    const controller = new AbortController()
    const sourceSignal = options.signal
    const abortFromSource = () => controller.abort()
    if (sourceSignal?.aborted) controller.abort()
    else sourceSignal?.addEventListener?.('abort', abortFromSource, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw createProviderError({
          status: 504,
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Provider request timed out.',
        })
      }
      throw error
    } finally {
      clearTimeout(timer)
      sourceSignal?.removeEventListener?.('abort', abortFromSource)
    }
  }
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
  return provider.execute({ request, env, fetchImpl: createTimedFetch(fetchImpl, getProviderTimeoutMs(env)) })
}

module.exports = { createTimedFetch, getProviderTimeoutMs, runProvider }
