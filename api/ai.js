const { runProvider, runProviderStream } = require('./ai/providerRunner')
const { startSSE, writeSSE } = require('./ai/streamUtils')
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
  // Local Ollama must execute in the user's browser against their loopback
  // service. A Vercel function's localhost is not the user's machine.
  if (request.provider === 'ollama') {
    const result = engine.createAIErrorResult({
      provider: request.provider,
      model: request.model,
      status: 400,
      code: 'OLLAMA_LOCAL_ONLY',
    })
    return res.status(result.error.status).json(result)
  }
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

  if (request.stream === true) {
    // Auth, CORS, and durable rate limiting have already completed before we
    // open the response. This keeps the streamed route as protected as the
    // existing JSON route while allowing real provider deltas to flow through.
    startSSE(res)
    writeSSE(res, 'started', { type: 'started', provider: request.provider, model: request.model })
    let receivedText = false
    let completion = { usage: null, finishReason: null }
    try {
      for await (const event of runProviderStream(request, { env, fetchImpl })) {
        if (event?.type === 'delta' && typeof event.text === 'string' && event.text) {
          receivedText = true
          writeSSE(res, 'delta', { type: 'delta', text: event.text })
        }
        if (event?.type === 'complete') {
          completion = {
            usage: event.usage || null,
            finishReason: event.finishReason || null,
          }
        }
      }
      if (!receivedText) {
        const empty = engine.createAIErrorResult({ provider: request.provider, model: request.model, code: 'EMPTY_RESPONSE' })
        writeSSE(res, 'error', { type: 'error', error: empty.error })
      } else {
        writeSSE(res, 'complete', {
          type: 'complete',
          provider: request.provider,
          model: request.model,
          meta: completion,
        })
      }
    } catch (error) {
      const result = engine.createAIErrorResult({
        provider: request.provider,
        model: request.model,
        status: error?.status,
        code: error?.code,
        message: error?.message,
      })
      console.error('[ai stream handler]', {
        provider: request.provider,
        code: result.error.code,
        status: result.error.status,
      })
      writeSSE(res, 'error', { type: 'error', error: result.error })
    }
    res.end()
    return
  }

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
