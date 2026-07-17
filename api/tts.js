/**
 * FounderLab voice proxy. The browser falls back to Web Speech when this
 * authenticated endpoint returns a normalized error instead of audio.
 */
const {
  handleCors,
  requireAuthenticatedUser,
  requireRateLimit,
  sendNormalizedError,
} = require('./_lib/apiSecurity')
const { getVoiceProvider, synthesizeVoice } = require('./voice/elevenlabs')

const VOICE_PROVIDER = 'elevenlabs'

async function handler(req, res, dependencies = {}) {
  const env = dependencies.env || process.env
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const cors = await handleCors(req, res, { env, provider: VOICE_PROVIDER })
  if (cors.handled) return

  if (req.method !== 'POST') {
    return sendNormalizedError(res, { provider: VOICE_PROVIDER, status: 405, code: 'REQUEST_INVALID' })
  }

  const user = await requireAuthenticatedUser(req, res, { provider: VOICE_PROVIDER, env, fetchImpl })
  if (!user) return

  const { text, gender, probe = false } = req.body || {}
  if (probe === true) {
    try {
      const voice = await getVoiceProvider()
      return res.status(200).json({
        ok: true,
        provider: voice.id,
        model: voice.defaultModel,
        available: Boolean(env[voice.keyEnv]),
      })
    } catch {
      return sendNormalizedError(res, { provider: VOICE_PROVIDER, status: 503, code: 'PROVIDER_UNAVAILABLE' })
    }
  }
  if (typeof text !== 'string' || !text.trim()) {
    return sendNormalizedError(res, { provider: VOICE_PROVIDER, status: 400, code: 'REQUEST_INVALID' })
  }

  const allowed = await requireRateLimit(req, res, {
    user,
    scope: 'tts',
    provider: VOICE_PROVIDER,
    env,
    fetchImpl,
    limiter: dependencies.rateLimiter,
  })
  if (!allowed) return

  try {
    const audio = await synthesizeVoice({ text, gender, env, fetchImpl })
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', audio.byteLength)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(audio)
  } catch (error) {
    console.error('[tts handler]', { provider: VOICE_PROVIDER, code: error?.code, status: error?.status })
    return sendNormalizedError(res, {
      provider: VOICE_PROVIDER,
      status: error?.status,
      code: error?.code,
    })
  }
}

module.exports = handler
