/**
 * FounderLab YouTube API. Metadata and transcript helpers remain feature
 * specific; AI analysis and voice synthesis use the shared provider adapters.
 */
const { runProvider } = require('./ai/providerRunner')
const { createProviderError } = require('./ai/providerUtils')
const {
  handleCors,
  requireAuthenticatedUser,
  requireRateLimit,
  sendNormalizedError,
} = require('./_lib/apiSecurity')
const { synthesizeVoice } = require('./voice/elevenlabs')

const TEXT_PROVIDER = 'groq'
const VOICE_PROVIDER = 'elevenlabs'

let youtubeAIEnginePromise = null

function getYouTubeAIEngine() {
  if (!youtubeAIEnginePromise) {
    youtubeAIEnginePromise = Promise.all([
      import('../src/ai/normalizeRequest.js'),
      import('../src/ai/providerRegistry.js'),
    ]).then(([request, registry]) => ({
      normalizeAIRequest: request.normalizeAIRequest,
      getPurposeModel: registry.getPurposeModel,
    }))
  }
  return youtubeAIEnginePromise
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function extractVideoId(url) {
  if (!url) return null
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([A-Za-z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = String(url).match(pattern)
    if (match) return match[1]
  }
  return null
}

async function analyzeWithGroq(transcript, durationSec = 0, { env, fetchImpl } = {}) {
  if (!transcript?.trim()) {
    throw createProviderError({ provider: TEXT_PROVIDER, status: 400, code: 'REQUEST_INVALID', message: 'Transcript is required.' })
  }
  const prompt = `Analyze this YouTube transcript for viral potential.
Duration: ${durationSec}s. Transcript: ${transcript.slice(0, 4000)}

Return ONLY valid JSON (no markdown) with exactly these fields:
{
  "viralityScore": <0-100>,
  "reason": "<why it will or won't go viral>",
  "peakMoment": <best timestamp in seconds>,
  "suggestedTitle": "<catchy title>",
  "hook": "<first 10 words of best hook>",
  "hashtags": ["<5 hashtags>"],
  "clipRanges": [{ "start": <seconds>, "end": <seconds>, "label": "<what happens>", "score": <0-100> }],
  "shortScript": "<60-second word-for-word script for Shorts/TikTok/Reels>",
  "thumbnailIdea": "<describe the ideal thumbnail>"
}`

  const { getPurposeModel, normalizeAIRequest } = await getYouTubeAIEngine()
  const selection = getPurposeModel('youtube-analysis')
  if (!selection) {
    throw createProviderError({ provider: TEXT_PROVIDER, status: 503, code: 'MISSING_CONFIGURATION', message: 'YouTube analysis model is not configured.' })
  }
  const normalized = normalizeAIRequest({
    provider: selection.provider,
    model: selection.model,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2000,
    temperature: 0.2,
  }, { enforceLimits: true, allowInternalModels: true })
  if (!normalized.ok) {
    throw createProviderError({ provider: selection.provider, status: normalized.error.status, code: normalized.error.code, message: normalized.error.message })
  }

  const output = await runProvider({ ...normalized.value, responseFormat: { type: 'json_object' } }, { env, fetchImpl })
  try {
    const result = JSON.parse(output.text)
    const peakMoment = Number(result?.peakMoment)
    const viralityScore = Number(result?.viralityScore)
    if (!result || Array.isArray(result) || !Number.isFinite(peakMoment) || !Number.isFinite(viralityScore)) {
      throw new Error('The provider response did not match the analysis contract.')
    }
    if (!Array.isArray(result.clipRanges) || result.clipRanges.length === 0) {
      result.clipRanges = [{ start: Math.max(0, peakMoment - 30), end: peakMoment + 30, label: 'Best moment', score: viralityScore }]
    }
    return result
  } catch {
    throw createProviderError({ provider: selection.provider, status: 502, code: 'MALFORMED_RESPONSE', message: 'YouTube analysis returned an invalid result.' })
  }
}

async function fetchTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript')
    const items = await YoutubeTranscript.fetchTranscript(videoId)
    return items.map((item) => item.text).join(' ')
  } catch {
    return null
  }
}

async function getVideoInfo(url) {
  try {
    const ytdl = require('ytdl-core')
    const info = await ytdl.getInfo(url)
    const details = info.videoDetails
    return {
      title: details.title,
      duration: parseInt(details.lengthSeconds || 0),
      author: details.author?.name || '',
      thumbnail: details.thumbnails?.slice(-1)[0]?.url || '',
      viewCount: parseInt(details.viewCount || 0),
      videoId: details.videoId,
      description: details.description?.slice(0, 500) || '',
    }
  } catch {
    return null
  }
}

function providerForRoute(urlPath) {
  return urlPath === '/ai-dub' ? VOICE_PROVIDER : urlPath === '/analyze' ? TEXT_PROVIDER : null
}

async function requireYouTubeLimit(req, res, user, scope, provider, dependencies) {
  return requireRateLimit(req, res, {
    user,
    scope,
    provider,
    env: dependencies.env,
    fetchImpl: dependencies.fetchImpl,
    limiter: dependencies.rateLimiter,
  })
}

async function handler(req, res, injectedDependencies = {}) {
  const dependencies = {
    env: injectedDependencies.env || process.env,
    fetchImpl: injectedDependencies.fetchImpl || globalThis.fetch,
    rateLimiter: injectedDependencies.rateLimiter,
  }
  const urlPath = (req.url || '').split('?')[0].replace(/^\/api\/youtube/, '')
  const provider = providerForRoute(urlPath)
  const cors = await handleCors(req, res, { env: dependencies.env, provider })
  if (cors.handled) return

  if (req.method !== 'POST') {
    return sendNormalizedError(res, { provider, status: 405, code: 'REQUEST_INVALID' })
  }

  const user = await requireAuthenticatedUser(req, res, { provider, env: dependencies.env, fetchImpl: dependencies.fetchImpl })
  if (!user) return

  try {
    if (urlPath === '/info' && req.method === 'POST') {
      const { url } = await parseBody(req)
      if (!extractVideoId(url)) return sendNormalizedError(res, { status: 400, code: 'REQUEST_INVALID' })
      if (!await requireYouTubeLimit(req, res, user, 'youtube', null, dependencies)) return
      const info = await getVideoInfo(url)
      const videoId = extractVideoId(url)
      if (!info) return res.status(200).json({ videoId, title: 'Video', duration: 0, thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, author: '', viewCount: 0, description: '', limited: true })
      return res.status(200).json({ ...info, videoId })
    }

    if (urlPath === '/transcript' && req.method === 'POST') {
      const { url, videoId: requestedVideoId } = await parseBody(req)
      const videoId = requestedVideoId || extractVideoId(url)
      if (!videoId) return sendNormalizedError(res, { status: 400, code: 'REQUEST_INVALID' })
      if (!await requireYouTubeLimit(req, res, user, 'youtube', null, dependencies)) return
      const transcript = await fetchTranscript(videoId)
      if (!transcript) return res.status(200).json({ transcript: null, message: 'No auto-captions found for this video. Paste the transcript manually for best results.' })
      return res.status(200).json({ transcript })
    }

    if (urlPath === '/analyze' && req.method === 'POST') {
      const { transcript, duration = 0, url } = await parseBody(req)
      if (!await requireYouTubeLimit(req, res, user, 'youtube', TEXT_PROVIDER, dependencies)) return
      let text = transcript
      if (!text && url) {
        const videoId = extractVideoId(url)
        if (videoId) text = await fetchTranscript(videoId)
      }
      if (!text?.trim()) return sendNormalizedError(res, { provider: TEXT_PROVIDER, status: 400, code: 'REQUEST_INVALID' })
      const result = await analyzeWithGroq(text, duration, dependencies)
      return res.status(200).json(result)
    }

    if (urlPath === '/ai-dub' && req.method === 'POST') {
      const { transcript, gender = 'male' } = await parseBody(req)
      if (typeof transcript !== 'string' || !transcript.trim()) return sendNormalizedError(res, { provider: VOICE_PROVIDER, status: 400, code: 'REQUEST_INVALID' })
      if (!await requireYouTubeLimit(req, res, user, 'tts', VOICE_PROVIDER, dependencies)) return
      const audio = await synthesizeVoice({ text: transcript, gender, env: dependencies.env, fetchImpl: dependencies.fetchImpl })
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Content-Length', audio.byteLength)
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(audio)
    }

    if (urlPath === '/generate-thumbnail' && req.method === 'POST') {
      const { title, videoId, thumbnailUrl } = await parseBody(req)
      const thumbnail = thumbnailUrl || (videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null)
      if (!thumbnail) return sendNormalizedError(res, { status: 400, code: 'REQUEST_INVALID' })
      return res.status(200).json({ thumbnailUrl: thumbnail, overlayText: title, ready: true })
    }

    return sendNormalizedError(res, { provider, status: 404, code: 'REQUEST_INVALID' })
  } catch (error) {
    console.error('[youtube api]', { route: urlPath, provider: provider || error?.provider, code: error?.code, status: error?.status })
    return sendNormalizedError(res, {
      provider: provider || error?.provider,
      status: error?.status,
      code: error?.code || 'PROVIDER_UNAVAILABLE',
    })
  }
}

module.exports = handler
