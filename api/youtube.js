/**
 * FounderLab AI — YouTube / Viral Clip Studio API
 * All routes under /api/youtube/* handled by this single Vercel serverless function.
 * Phase 1: download, segment, analyze, clip, stream
 * Phase 3: analyze-all (with word timings), export-pro, generate-thumbnail, ai-dub
 */

const { execSync, exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const sessions = new Map()
const tmpDir   = path.join(os.tmpdir(), 'founderlab-viral')
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

async function downloadVideo(url, sessionId) {
  const outputDir = path.join(tmpDir, sessionId)
  fs.mkdirSync(outputDir, { recursive: true })
  const outputTemplate = path.join(outputDir, 'source.%(ext)s')
  execSync(`yt-dlp -f "bestvideo[height<=2160]+bestaudio/best[height<=2160]" --merge-output-format mp4 -o "${outputTemplate}" "${url}"`, { stdio: 'inherit' })
  return path.join(outputDir, 'source.mp4')
}

async function splitVideo(videoPath, sessionId, segmentDuration = 60) {
  const outputDir = path.dirname(videoPath)
  const segments = []
  const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, { encoding: 'utf8' }).trim()
  const duration = parseFloat(durationStr)
  let start = 0, index = 0
  while (start < duration) {
    const end = Math.min(start + segmentDuration, duration)
    const outputFile = path.join(outputDir, `seg_${index}.mp4`)
    execSync(`ffmpeg -i "${videoPath}" -ss ${start} -t ${segmentDuration} -c copy "${outputFile}" -y`, { stdio: 'inherit' })
    segments.push({ start, end, filePath: outputFile, index })
    start = end; index++
  }
  return segments
}

async function transcribeWithGroq(audioPath) {
  const groqApiKey = process.env.GROQ_API_KEY
  if (!groqApiKey) return { text: '[No GROQ_API_KEY]', words: [] }
  // Use fetch to call Groq's Whisper endpoint with verbose_json for word timings
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(audioPath)]), 'audio.wav')
  form.append('model', 'whisper-large-v3')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + groqApiKey },
    body: form,
  })
  if (!r.ok) return { text: '[Transcription failed]', words: [] }
  const data = await r.json()
  const words = (data.words || []).map(w => ({ word: w.word, start: w.start, end: w.end }))
  return { text: data.text || '', words }
}

async function analyzeWithGroq(transcript, durationSec) {
  const groqApiKey = process.env.GROQ_API_KEY
  if (!groqApiKey) {
    return { viralityScore: 72, reason: 'Set GROQ_API_KEY for real analysis.', peakMoment: Math.floor(durationSec / 2), suggestedTitle: 'Viral moment', hook: transcript.slice(0, 80), hashtags: ['#viral'] }
  }
  const prompt = `You are a viral content expert. Analyze this transcript for virality potential.
Return ONLY JSON with: viralityScore (0-100), reason (string), peakMoment (seconds), suggestedTitle (string), hook (first 10 words), hashtags (array of 5).
Transcript: ${transcript}`
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqApiKey },
    body: JSON.stringify({ model: 'llama-3.2-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.3, response_format: { type: 'json_object' } }),
  })
  const data = await r.json()
  try {
    const result = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    return { viralityScore: result.viralityScore || 70, reason: result.reason || '', peakMoment: result.peakMoment || 0, suggestedTitle: result.suggestedTitle || '', hook: result.hook || '', hashtags: result.hashtags || [] }
  } catch { return { viralityScore: 70, reason: 'Analysis error', peakMoment: 0, suggestedTitle: '', hook: '', hashtags: [] } }
}

// ── Phase 3 helpers ───────────────────────────────────────────

function buildKaraokeFilter(words, style, fontConfig = { fontSize: 24, color: 'white', position: 'bottom' }) {
  if (!words || !words.length) return ''
  const baseX = '(w-text_w)/2'
  const baseY = fontConfig.position === 'top' ? '30' : fontConfig.position === 'middle' ? '(h-text_h)/2' : 'h-text_h-30'
  const filters = words.map(w => {
    const safeWord = w.word.replace(/'/g, "\\'").replace(/:/g, '\\:')
    const boxColor = style === 'highlight' ? '0x6366f1@0.8' : '0x000000@0.5'
    const fc       = style === 'highlight' ? 'white' : (fontConfig.color || 'white')
    const yExpr    = style === 'bounce'    ? `if(between(t\\,${w.start}\\,${w.end})\\,${baseY}-12\\,${baseY})` : baseY
    return `drawtext=text='${safeWord}':fontsize=${fontConfig.fontSize || 24}:fontcolor=${fc}:box=1:boxcolor=${boxColor}:boxborderw=4:x=${baseX}:y=${yExpr}:enable='between(t\\,${w.start}\\,${w.end})'`
  })
  return filters.join(',')
}

async function smartReframe(inputPath, outputPath, aspectRatio) {
  const dims = { '9:16': '1080:1920', '1:1': '1080:1080', '16:9': '1920:1080' }
  const size = dims[aspectRatio] || '1080:1920'
  const [tw, th] = size.split(':')
  // Center-crop to target ratio, then scale
  const filter = `crop=min(iw\\,ih*${tw}/${th}):min(ih\\,iw*${th}/${tw}),scale=${tw}:${th}:flags=lanczos,setsar=1`
  await execAsync(`ffmpeg -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}" -y`)
}

async function makeMonetizationSafe(inputPath, outputPath) {
  // Normalize loudness to -14 LUFS (safe for most platforms); mute if flagged
  await execAsync(`ffmpeg -i "${inputPath}" -af loudnorm=I=-14:TP=-1:LRA=11 -c:v copy "${outputPath}" -y`)
}

async function replaceAudio(videoPath, audioPath, outputPath) {
  await execAsync(`ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -map 0:v:0 -map 1:a:0 -shortest "${outputPath}" -y`)
}

async function synthesizeVoice(transcript, gender = 'male') {
  // Use our own /api/tts endpoint (ElevenLabs or browser-fallback) — call it server-side via fetch
  const gender_ = gender === 'female' ? 'female' : 'male'
  const r = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: transcript.slice(0, 2500), gender: gender_ }),
  })
  if (!r.ok) return null
  const ct = r.headers.get('Content-Type') || ''
  if (!ct.includes('audio')) return null
  return Buffer.from(await r.arrayBuffer())
}

// ── Parse request body ────────────────────────────────────────
async function parseBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const url_  = req.url || ''
  const route = url_.split('?')[0].replace(/^\/api\/youtube/, '')

  // ── DOWNLOAD ─────────────────────────────────────────────
  if (route === '/download' && req.method === 'POST') {
    const { url } = await parseBody(req)
    if (!url) return res.status(400).json({ error: 'URL required' })
    try {
      const sessionId = uid()
      const videoPath = await downloadVideo(url, sessionId)
      sessions.set(sessionId, { videoPath })
      return res.status(200).json({ sessionId })
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // ── SEGMENT ───────────────────────────────────────────────
  if (route === '/segment' && req.method === 'POST') {
    const { sessionId, segmentDuration = 60 } = await parseBody(req)
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    try {
      const segments = await splitVideo(session.videoPath, sessionId, segmentDuration)
      session.segments = segments; sessions.set(sessionId, session)
      return res.status(200).json({ segments: segments.map(s => ({ start: s.start, end: s.end })) })
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // ── ANALYZE (single segment) ──────────────────────────────
  if (route === '/analyze' && req.method === 'POST') {
    const { sessionId, segmentIndex = 0 } = await parseBody(req)
    const session = sessions.get(sessionId)
    if (!session?.segments) return res.status(404).json({ error: 'Segments not found' })
    const seg = session.segments[segmentIndex]
    if (!seg) return res.status(404).json({ error: 'Segment not found' })
    try {
      const audioPath = path.join(tmpDir, `${sessionId}_audio${segmentIndex}.wav`)
      execSync(`ffmpeg -i "${seg.filePath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" -y`, { stdio: 'inherit' })
      const { text, words } = await transcribeWithGroq(audioPath)
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)
      const analysis = await analyzeWithGroq(text, seg.end - seg.start)
      return res.status(200).json({ bestClip: { start: seg.start, end: seg.end, transcript: text, words, ...analysis } })
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // ── ANALYZE ALL ───────────────────────────────────────────
  if (route === '/analyze-all' && req.method === 'POST') {
    const { sessionId } = await parseBody(req)
    const session = sessions.get(sessionId)
    if (!session?.segments) return res.status(404).json({ error: 'Segments not found' })
    const results = []
    for (const seg of session.segments) {
      try {
        const audioPath = path.join(tmpDir, `${sessionId}_audio${seg.index}.wav`)
        execSync(`ffmpeg -i "${seg.filePath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" -y`, { stdio: 'pipe' })
        const { text, words } = await transcribeWithGroq(audioPath)
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath)
        const analysis = await analyzeWithGroq(text, seg.end - seg.start)
        results.push({ start: seg.start, end: seg.end, transcript: text, words, ...analysis })
      } catch (e) { results.push({ start: seg.start, end: seg.end, transcript: '', words: [], viralityScore: 0, reason: e.message, peakMoment: 0 }) }
    }
    results.sort((a, b) => b.viralityScore - a.viralityScore)
    return res.status(200).json({ clips: results })
  }

  // ── CLIP DOWNLOAD ─────────────────────────────────────────
  if (route === '/clip' && req.method === 'POST') {
    const { sessionId, start, end } = await parseBody(req)
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    try {
      const outputFile = path.join(tmpDir, `clip_${sessionId}_${start}.mp4`)
      execSync(`ffmpeg -i "${session.videoPath}" -ss ${start} -to ${end} -c copy "${outputFile}" -y`, { stdio: 'inherit' })
      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Disposition', 'attachment; filename="viral_clip.mp4"')
      fs.createReadStream(outputFile).pipe(res)
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // ── STREAM ────────────────────────────────────────────────
  else if (route === '/stream' && req.method === 'GET') {
    const params = new URLSearchParams(url_.split('?')[1] || '')
    const sessionId = params.get('sessionId')
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    const { videoPath } = session
    const stat = fs.statSync(videoPath)
    const range = req.headers.range
    if (range) {
      const [startB, endB_] = range.replace(/bytes=/, '').split('-').map(Number)
      const endB = endB_ || stat.size - 1
      res.writeHead(206, { 'Content-Range': `bytes ${startB}-${endB}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': endB - startB + 1, 'Content-Type': 'video/mp4' })
      fs.createReadStream(videoPath, { start: startB, end: endB }).pipe(res)
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' })
      fs.createReadStream(videoPath).pipe(res)
    }
  }

  // ── EXPORT PRO ────────────────────────────────────────────
  else if (route === '/export-pro' && req.method === 'POST') {
    const { sessionId, start, end, words, captionStyle, aspectRatio, exportSettings, includeAudioDub } = await parseBody(req)
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    const tmp = (name) => path.join(tmpDir, `${name}_${sessionId}_${Date.now()}.mp4`)
    try {
      const clip    = tmp('clip');    execSync(`ffmpeg -i "${session.videoPath}" -ss ${start} -to ${end} -c copy "${clip}" -y`, { stdio: 'pipe' })
      const safe    = tmp('safe');    await makeMonetizationSafe(clip, safe)
      const reframed = tmp('ref');   await smartReframe(safe, reframed, aspectRatio || '9:16')

      let preCaption = reframed

      // Optional AI voice dub
      if (includeAudioDub && words?.length) {
        const transcript = words.map(w => w.word).join(' ')
        const audioBuffer = await synthesizeVoice(transcript, exportSettings?.voiceGender || 'male')
        if (audioBuffer) {
          const audioPath = path.join(tmpDir, `dub_${sessionId}.mp3`)
          fs.writeFileSync(audioPath, audioBuffer)
          const dubbed = tmp('dubbed')
          await replaceAudio(reframed, audioPath, dubbed)
          preCaption = dubbed
          fs.unlinkSync(audioPath)
        }
      }

      // Burn karaoke captions
      let captionedFile = preCaption
      if (exportSettings?.includeCaptions !== false && words?.length) {
        const karaokeFilter = buildKaraokeFilter(words, captionStyle || 'highlight', { fontSize: 28, color: 'white', position: 'bottom' })
        if (karaokeFilter) {
          captionedFile = tmp('cap')
          await execAsync(`ffmpeg -i "${preCaption}" -vf "${karaokeFilter}" -c:a copy "${captionedFile}" -y`)
        }
      }

      // Final encode
      const resMap    = { '1080p': '1920:1080', '1440p': '2560:1440', '4K': '3840:2160' }
      const outSize   = resMap[exportSettings?.resolution || '1080p'] || '1920:1080'
      const fps       = exportSettings?.fps || 30
      const codecStr  = exportSettings?.codec === 'h265' ? 'libx265' : 'libx264'
      const bitrate   = exportSettings?.bitrateControl === 'VBR' ? '-crf 20' : '-b:v 8M -minrate 8M -maxrate 8M -bufsize 16M'
      const finalFile = tmp('final_out').replace('.mp4', '_pro.mp4')
      await execAsync(`ffmpeg -i "${captionedFile}" -vf "scale=${outSize}:flags=lanczos,fps=${fps}" -c:v ${codecStr} ${bitrate} -preset medium -c:a aac -b:a 192k "${finalFile}" -y`)

      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Disposition', 'attachment; filename="pro_clip.mp4"')
      fs.createReadStream(finalFile).pipe(res)
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // ── GENERATE THUMBNAIL ────────────────────────────────────
  else if (route === '/generate-thumbnail' && req.method === 'POST') {
    const { sessionId, start, title, aspectRatio } = await parseBody(req)
    const session = sessions.get(sessionId)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    try {
      const midTime   = (start || 0) + 3
      const frameFile = path.join(tmpDir, `frame_${sessionId}_${Date.now()}.png`)
      const thumbFile = path.join(tmpDir, `thumb_${sessionId}_${Date.now()}.jpg`)
      execSync(`ffmpeg -i "${session.videoPath}" -ss ${midTime} -frames:v 1 "${frameFile}" -y`, { stdio: 'pipe' })
      const safeTitle = (title || 'Viral Clip').replace(/'/g, "\\'").replace(/:/g, '\\:').slice(0, 50)
      await execAsync(`ffmpeg -i "${frameFile}" -vf "drawtext=text='${safeTitle}':fontsize=52:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=h-th-40" "${thumbFile}" -y`)
      const buf = fs.readFileSync(thumbFile)
      res.setHeader('Content-Type', 'image/jpeg')
      res.status(200).send(buf)
      fs.unlinkSync(frameFile); fs.unlinkSync(thumbFile)
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  // ── AI DUB ────────────────────────────────────────────────
  else if (route === '/ai-dub' && req.method === 'POST') {
    const { transcript, gender = 'male' } = await parseBody(req)
    if (!transcript) return res.status(400).json({ error: 'Transcript required' })
    try {
      const audioBuffer = await synthesizeVoice(transcript, gender)
      if (!audioBuffer) return res.status(500).json({ error: 'Voice synthesis failed or no API key' })
      res.setHeader('Content-Type', 'audio/mpeg')
      res.status(200).send(audioBuffer)
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  else {
    return res.status(404).json({ error: 'Route not found' })
  }
}
