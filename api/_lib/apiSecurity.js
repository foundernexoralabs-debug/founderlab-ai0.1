const rateBuckets = new Map()
let responseModulePromise = null

const RATE_LIMITS = Object.freeze({
  ai: { limit: 30, windowSeconds: 60 },
  youtube: { limit: 10, windowSeconds: 60 },
  tts: { limit: 20, windowSeconds: 60 },
})

function getResponseModule() {
  if (!responseModulePromise) {
    responseModulePromise = import('../../src/ai/normalizeResponse.js')
  }
  return responseModulePromise
}

function getHeader(req, name) {
  const headers = req?.headers || {}
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || ''
}

function isDevelopmentEnvironment(env = process.env) {
  return env.NODE_ENV === 'development' || env.VERCEL_ENV === 'development'
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function configuredOrigins(env = process.env) {
  const configured = [
    ...splitList(env.FOUNDERLAB_ALLOWED_ORIGINS),
    env.FOUNDERLAB_PRODUCTION_ORIGIN,
    env.VERCEL_URL ? 'https://' + env.VERCEL_URL : '',
  ].map(normalizeOrigin).filter(Boolean)
  return new Set(configured)
}

function isAllowedCorsOrigin(origin, env = process.env) {
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  if (configuredOrigins(env).has(normalized)) return true

  let url
  try {
    url = new URL(normalized)
  } catch {
    return false
  }

  if (isDevelopmentEnvironment(env) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return ['http:', 'https:'].includes(url.protocol)
  }

  if (url.protocol !== 'https:') return false
  const previewSuffixes = splitList(env.FOUNDERLAB_VERCEL_PREVIEW_HOST_SUFFIXES)
  const previewPrefixes = splitList(env.FOUNDERLAB_VERCEL_PREVIEW_HOST_PREFIXES)
  if (!previewSuffixes.length && !previewPrefixes.length) return false

  // A suffix scopes a Vercel team and a prefix scopes this project. When both
  // are configured, require both so a project-like hostname on another team
  // (or another project in the team) cannot call the expensive endpoints.
  const suffixMatches = !previewSuffixes.length || previewSuffixes.some((suffix) => url.hostname.endsWith(suffix))
  const prefixMatches = !previewPrefixes.length || previewPrefixes.some((prefix) => (
    url.hostname.startsWith(prefix) && url.hostname.endsWith('.vercel.app')
  ))
  return suffixMatches && prefixMatches
}

function applyCorsHeaders(req, res, env = process.env) {
  const origin = getHeader(req, 'origin')
  const allowed = isAllowedCorsOrigin(origin, env)
  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin))
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '600')
    res.setHeader('Vary', 'Origin')
  }
  return { allowed, origin }
}

async function createNormalizedError(input) {
  const { createAIErrorResult } = await getResponseModule()
  return createAIErrorResult(input)
}

async function sendNormalizedError(res, input) {
  const result = await createNormalizedError(input)
  return res.status(result.error.status).json(result)
}

async function handleCors(req, res, { env = process.env, provider, model } = {}) {
  const cors = applyCorsHeaders(req, res, env)
  if (req.method !== 'OPTIONS') {
    if (!cors.allowed) {
      await sendNormalizedError(res, { provider, model, status: 403, code: 'CORS_ORIGIN_DENIED' })
      return { handled: true, allowed: false }
    }
    return { handled: false, allowed: true }
  }

  if (!cors.allowed) {
    await sendNormalizedError(res, { provider, model, status: 403, code: 'CORS_ORIGIN_DENIED' })
    return { handled: true, allowed: false }
  }
  res.status(204).end()
  return { handled: true, allowed: true }
}

function getSupabaseConfig(env = process.env) {
  return {
    url: String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
  }
}

function getBearerToken(req) {
  const header = getHeader(req, 'authorization')
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || ''
}

async function authenticateRequest(req, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const bypassEnabled = isDevelopmentEnvironment(env) && env.FOUNDERLAB_DEV_AUTH_BYPASS === 'true'
  if (bypassEnabled) return { ok: true, user: { id: 'development-bypass' }, bypassed: true }

  const accessToken = getBearerToken(req)
  if (!accessToken) return { ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' }

  const { url, anonKey } = getSupabaseConfig(env)
  if (!url || !anonKey || typeof fetchImpl !== 'function') {
    return { ok: false, status: 503, code: 'AUTHENTICATION_UNAVAILABLE' }
  }

  try {
    const response = await fetchImpl(url + '/auth/v1/user', {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + accessToken,
      },
    })
    if (!response.ok) return { ok: false, status: 401, code: 'AUTHENTICATION_INVALID' }
    const user = await response.json().catch(() => null)
    if (!user?.id) return { ok: false, status: 401, code: 'AUTHENTICATION_INVALID' }
    return { ok: true, user: { id: user.id, email: user.email || null } }
  } catch {
    return { ok: false, status: 503, code: 'AUTHENTICATION_UNAVAILABLE' }
  }
}

function getRateLimitPolicy(scope, env = process.env) {
  const defaults = RATE_LIMITS[scope] || RATE_LIMITS.ai
  const prefix = 'FOUNDERLAB_RATE_LIMIT_' + scope.toUpperCase() + '_'
  const limit = Number(env[prefix + 'LIMIT'])
  const windowSeconds = Number(env[prefix + 'WINDOW_SECONDS'])
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : defaults.limit,
    windowSeconds: Number.isInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds : defaults.windowSeconds,
  }
}

function enforceInMemoryRateLimit({ userId, scope, policy, now = Date.now() }) {
  const key = scope + ':' + userId
  const windowMs = policy.windowSeconds * 1000
  const existing = rateBuckets.get(key)
  const bucket = !existing || now >= existing.resetAt
    ? { count: 0, resetAt: now + windowMs }
    : existing
  bucket.count += 1
  rateBuckets.set(key, bucket)

  if (bucket.count <= policy.limit) {
    return { allowed: true, retryAfter: 0, durable: false }
  }
  return {
    allowed: false,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    durable: false,
  }
}

async function callDurableRateLimiter({ userId, scope, policy, env, fetchImpl }) {
  const response = await fetchImpl(env.FOUNDERLAB_RATE_LIMITER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.FOUNDERLAB_RATE_LIMITER_TOKEN ? { Authorization: 'Bearer ' + env.FOUNDERLAB_RATE_LIMITER_TOKEN } : {}),
    },
    body: JSON.stringify({ subject: userId, scope, limit: policy.limit, windowSeconds: policy.windowSeconds }),
  })
  if (!response.ok) throw new Error('Rate limiter rejected the request.')
  const result = await response.json()
  if (typeof result?.allowed !== 'boolean') throw new Error('Rate limiter returned an invalid response.')
  return {
    allowed: result.allowed,
    retryAfter: Math.max(0, Number(result.retryAfterSeconds) || 0),
    durable: true,
  }
}

async function enforceRequestLimit({ userId, scope, env = process.env, fetchImpl = globalThis.fetch, limiter, now } = {}) {
  const policy = getRateLimitPolicy(scope, env)
  try {
    if (limiter) return await limiter({ userId, scope, policy })
    if (env.FOUNDERLAB_RATE_LIMITER_URL && typeof fetchImpl === 'function') {
      return await callDurableRateLimiter({ userId, scope, policy, env, fetchImpl })
    }
    if (!isDevelopmentEnvironment(env)) {
      return { allowed: false, status: 503, code: 'RATE_LIMIT_BACKEND_UNAVAILABLE', retryAfter: 0, durable: false }
    }
    return enforceInMemoryRateLimit({ userId, scope, policy, now })
  } catch {
    return { allowed: false, status: 503, code: 'RATE_LIMIT_BACKEND_UNAVAILABLE', retryAfter: 0, durable: false }
  }
}

async function requireAuthenticatedUser(req, res, { provider, model, env, fetchImpl } = {}) {
  const authentication = await authenticateRequest(req, { env, fetchImpl })
  if (authentication.ok) return authentication.user
  await sendNormalizedError(res, { provider, model, status: authentication.status, code: authentication.code })
  return null
}

async function requireRateLimit(req, res, { user, scope, provider, model, env, fetchImpl, limiter } = {}) {
  const limit = await enforceRequestLimit({ userId: user.id, scope, env, fetchImpl, limiter })
  if (limit.allowed) return true
  if (limit.retryAfter > 0) res.setHeader('Retry-After', String(limit.retryAfter))
  await sendNormalizedError(res, {
    provider,
    model,
    status: limit.status || 429,
    code: limit.code || 'RATE_LIMITED',
  })
  return false
}

function resetInMemoryRateLimits() {
  rateBuckets.clear()
}

module.exports = {
  applyCorsHeaders,
  authenticateRequest,
  enforceRequestLimit,
  getSupabaseConfig,
  getRateLimitPolicy,
  handleCors,
  isAllowedCorsOrigin,
  requireAuthenticatedUser,
  requireRateLimit,
  resetInMemoryRateLimits,
  sendNormalizedError,
}
