function createProviderError({ provider, status, code, message }) {
  const error = new Error(message || code || 'Provider request failed')
  error.provider = provider
  error.status = status
  error.code = code
  return error
}

function requireProviderKey(env, keyName, provider) {
  const value = env?.[keyName]
  if (value) return value
  throw createProviderError({
    provider,
    status: 503,
    code: 'MISSING_CONFIGURATION',
    message: keyName + ' is not configured.',
  })
}

async function readProviderJson(response, provider) {
  try {
    return await response.json()
  } catch {
    throw createProviderError({
      provider,
      status: response.status || 502,
      code: 'MALFORMED_RESPONSE',
      message: 'Provider returned invalid JSON.',
    })
  }
}

function providerMessage(payload) {
  return payload?.error?.message || payload?.error || payload?.message || ''
}

function assertProviderResponse(response, payload, provider) {
  if (response.ok) return
  const status = response.status || 502
  const code = status === 429
    ? 'RATE_LIMITED'
    : [401, 403].includes(status)
      ? 'AUTHENTICATION_FAILED'
      : status === 404
        ? 'INVALID_MODEL'
        : 'PROVIDER_UNAVAILABLE'
  throw createProviderError({
    provider,
    status,
    code,
    message: providerMessage(payload),
  })
}

module.exports = {
  assertProviderResponse,
  createProviderError,
  providerMessage,
  readProviderJson,
  requireProviderKey,
}
