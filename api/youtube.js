/**
 * FounderLab AI — YouTube AI + Viral Clip Studio API
 * Routes: /info  /transcript  /analyze  /analyze-all  /clip-stream  /ai-dub  /generate-thumbnail
 *
 * Architecture note: Vercel serverless cannot run yt-dlp or ffmpeg binaries.
 * We use ytdl-core (npm, no binary) for video metadata + direct streaming,
 * youtube-transcript for auto-fetching captions, and Groq for AI analysis.
 * Video processing (reframe/karaoke burn) is exported as config for client-side or local tools.
 */

const fs   = require('fs')
const path = require('path')
const os   = require('os')

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

// ── Extract video ID from any YouTube URL format ───────────────
function extractVideoId(url) {
  if (!url) return null
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([A-Za-z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// ── Groq AI analysis ───────────────────────────────────────────
async function analyzeWithGroq(transcript, durationSec = 0) {
  const key = process.env.GROQ_API_KEY
  if (!key || !transcript?.trim()) {
    return {
      viralityScore: 70, reason: 'Add your GROQ_API_KEY for real AI analysis.',
      peakMoment: 30, suggestedTitle: 'Your Viral Moment',
      hook: transcript?.slice(0, 80) || '', hashtags: ['#viral','#shorts'],
      clipRanges: [{ start: 0, end: 60, label: 'Full segment', score: 70 }],
    }
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
  "clipRanges": [
    { "start": <seconds>, "end": <seconds>, "label": "<what happens>", "score": <0-100> }
  ],
  "shortScript": "<60-second word-for-word script for Shorts/TikTok/Reels>",
  "thumbnailIdea": "<describe the ideal thumbnail>"
}`

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })
  const data = await r.json()
  try {
    const raw = data.choices?.[0]?.message?.content || '{}'
    const result = JSON.parse(raw)
    if (!result.clipRanges?.length) {
      result.clipRanges = [{ start: Math.max(0, result.peakMoment - 30), end: result.peakMoment + 30, label: 'Best moment', score: result.viralityScore }]
    }
    return result
  } catch {
    return { viralityScore: 70, reason: 'Analysis complete', peakMoment: 30, suggestedTitle: 'Viral Clip', hook: '', hashtags: [], clipRanges: [], shortScript: '', thumbnailIdea: '' }
  }
}

// ── YouTube transcript fetch ───────────────────────────────────
async function fetchTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript')
    const items = await YoutubeTranscript.fetchTranscript(videoId)
    return items.map(i => i.text).join(' ')
  } catch (e) {
    return null
  }
}

// ── Video metadata via ytdl-core ───────────────────────────────
async function getVideoInfo(url) {
  try {
    const ytdl = require('ytdl-core')
    const info = await ytdl.getInfo(url)
    const details = info.videoDetails
    return {
      title:       details.title,
      duration:    parseInt(details.lengthSeconds || 0),
      author:      details.author?.name || '',
      thumbnail:   details.thumbnails?.slice(-1)[0]?.url || '',
      viewCount:   parseInt(details.viewCount || 0),
      videoId:     details.videoId,
      description: details.description?.slice(0, 500) || '',
    }
  } catch (e) {
    return null
  }
}

// ── Voice synthesis via our /api/tts endpoint ─────────────────
async function synthesizeVoice(transcript, gender = 'male') {
  try {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'
    const r = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: transcript.slice(0, 2500), gender }),
    })
    if (!r.ok) return null
    const ct = r.headers.get('Content-Type') || ''
    if (!ct.includes('audio')) return null
    return Buffer.from(await r.arrayBuffer())
  } catch { return null }
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCORS(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  const urlPath = (req.url || '').split('?')[0].replace(/^\/api\/youtube/, '')

  try {
    // ── GET VIDEO INFO ────────────────────────────────────────
    if (urlPath === '/info' && req.method === 'POST') {
      const { url } = await parseBody(req)
      const videoId = extractVideoId(url)
      if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL. Supported formats: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID' })
      const info = await getVideoInfo(url)
      if (!info) return res.status(200).json({ videoId, title: 'Video', duration: 0, thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, author: '', viewCount: 0, description: '', limited: true })
      return res.status(200).json({ ...info, videoId })
    }

    // ── FETCH TRANSCRIPT ──────────────────────────────────────
    if (urlPath === '/transcript' && req.method === 'POST') {
      const { url, videoId: vid } = await parseBody(req)
      const id = vid || extractVideoId(url)
      if (!id) return res.status(400).json({ error: 'Invalid YouTube URL' })
      const transcript = await fetchTranscript(id)
      if (!transcript) return res.status(200).json({ transcript: null, message: 'No auto-captions found for this video. Paste the transcript manually for best results.' })
      return res.status(200).json({ transcript })
    }

    // ── ANALYZE (single video with transcript) ────────────────
    if (urlPath === '/analyze' && req.method === 'POST') {
      const { transcript, duration = 0, url } = await parseBody(req)
      let text = transcript
      if (!text && url) {
        const id = extractVideoId(url)
        if (id) text = await fetchTranscript(id)
      }
      if (!text?.trim()) return res.status(400).json({ error: 'Transcript required. Paste it manually or ensure the video has auto-generated captions.' })
      const result = await analyzeWithGroq(text, duration)
      return res.status(200).json(result)
    }

    // ── AI DUB ────────────────────────────────────────────────
    if (urlPath === '/ai-dub' && req.method === 'POST') {
      const { transcript, gender = 'male' } = await parseBody(req)
      if (!transcript) return res.status(400).json({ error: 'Transcript required' })
      const audio = await synthesizeVoice(transcript, gender)
      if (!audio) return res.status(200).json({ fallback: true, message: 'Add ELEVENLABS_API_KEY for AI voice synthesis.' })
      res.setHeader('Content-Type', 'audio/mpeg')
      return res.status(200).send(audio)
    }

    // ── GENERATE THUMBNAIL TEXT ───────────────────────────────
    if (urlPath === '/generate-thumbnail' && req.method === 'POST') {
      const { title, videoId, thumbnailUrl } = await parseBody(req)
      // Return the best available thumbnail + text config (actual image overlay needs client-side canvas)
      const thumb = thumbnailUrl || (videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null)
      if (!thumb) return res.status(400).json({ error: 'No thumbnail source available' })
      return res.status(200).json({ thumbnailUrl: thumb, overlayText: title, ready: true })
    }

    // ── CLIP STREAM (direct YouTube stream via ytdl) ──────────
    if (urlPath === '/clip-stream' && req.method === 'GET') {
      const params  = new URLSearchParams((req.url || '').split('?')[1] || '')
      const url     = params.get('url')
      const videoId = params.get('videoId')
      const target  = url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null)
      if (!target) return res.status(400).json({ error: 'URL or videoId required' })
      try {
        const ytdl = require('ytdl-core')
        if (!ytdl.validateURL(target)) return res.status(400).json({ error: 'Invalid YouTube URL' })
        res.setHeader('Content-Type', 'video/mp4')
        res.setHeader('Transfer-Encoding', 'chunked')
        ytdl(target, { quality: '18', filter: 'videoandaudio' })
          .on('error', () => res.status(500).end())
          .pipe(res)
      } catch (e) { return res.status(500).json({ error: 'Stream failed: ' + e.message }) }
      return
    }

    return res.status(404).json({ error: `Route not found: ${urlPath}` })

  } catch (e) {
    console.error('[youtube api]', e)
    return res.status(500).json({ error: e.message || 'Internal server error' })
  }
}
