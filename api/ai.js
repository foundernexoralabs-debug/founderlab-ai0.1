const { runProvider } = require('./ai/providerRunner')
const {
  handleCors,
  requireAuthenticatedUser,
  requireRateLimit,
  sendNormalizedError,
} = require('./_lib/apiSecurity')

let enginePromise = null

function getEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('../src/ai/normalizeRequest.js'),
      import('../src/ai/normalizeResponse.js'),
      import('../src/ai/providerRegistry.js'),
    ]).then(([request, response, registry]) => ({
      normalizeServerAIRequest: request.normalizeServerAIRequest,
      createAIErrorResult: response.createAIErrorResult,
      createAIResult: response.createAIResult,
      listProviders: registry.listProviders,
    }))
  }
  return enginePromise
}

function hasConfiguredKey(env, keyName) {
  return !keyName || (typeof env?.[keyName] === 'string' && env[keyName].trim().length > 0)
}

function getProviderAvailability(listProviders, env) {
  return Object.fromEntries(listProviders().map((provider) => [provider.id, {
    configured: hasConfiguredKey(env, provider.keyEnv),
    local: provider.capabilities.local === true,
  }]))
}

async function handler(req, res, dependencies = {}) {
  const env = dependencies.env || process.env
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const provider = req.body?.provider
  const model = req.body?.model
  const cors = await handleCors(req, res, { env, provider, model })
  if (cors.handled) return

  let engine
  try {
    engine = await getEngine()
  } catch {
    return sendNormalizedError(res, { provider, model, status: 503, code: 'PROVIDER_UNAVAILABLE' })
  }

  if (req.method !== 'POST') {
    const result = engine.createAIErrorResult({ code: 'REQUEST_INVALID', message: 'Method not allowed', status: 405 })
    return res.status(result.error.status).json(result)
  }

  const user = await requireAuthenticatedUser(req, res, { provider, model, env, fetchImpl })
  if (!user) return

  if (req.body?.action === 'provider-status') {
    return res.status(200).json({ ok: true, providers: getProviderAvailability(engine.listProviders, env) })
  }

  const normalized = engine.normalizeServerAIRequest(req.body || {})
  if (!normalized.ok) {
    const result = engine.createAIErrorResult({
      provider: req.body?.provider,
      model: req.body?.model,
      status: normalized.error.status,
      code: normalized.error.code,
      message: normalized.error.message,
    })
    return res.status(result.error.status).json(result)
  }

  const request = normalized.value
  const allowed = await requireRateLimit(req, res, {
    user,
    scope: 'ai',
    provider: request.provider,
    model: request.model,
    env,
    fetchImpl,
    limiter: dependencies.rateLimiter,
  })
  if (!allowed) return

  try {
    const output = await runProvider(request, { env, fetchImpl })
    const result = engine.createAIResult({
      provider: request.provider,
      model: request.model,
      text: output.text,
      usage: output.usage,
      finishReason: output.finishReason,
    })
    return res.status(result.ok ? 200 : result.error.status).json(result)
  } catch (error) {
    const result = engine.createAIErrorResult({
      provider: request.provider,
      model: request.model,
      status: error?.status,
      code: error?.code,
      message: error?.message,
    })
    console.error('[ai handler]', {
      provider: request.provider,
      code: result.error.code,
      status: result.error.status,
    })
    return res.status(result.error.status).json(result)
  }
}

module.exports = handler
