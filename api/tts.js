/**
 * FounderLab AI — TTS Proxy
 * Proxies ElevenLabs text-to-speech so the API key stays server-side.
 * Returns audio/mpeg on success, or JSON { fallback: true } if no key is set
 * (frontend then falls back to Web Speech Synthesis automatically).
 */

const ELEVENLABS_VOICES = {
  male:   'nPczCjzI2devNBz1zQrb', // Brian — natural UK male
  female: 'EST9Ui6982FZPSi7gCHi', // Custom female voice ID supplied by user
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function handler(req, res) {
  setCORS(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.ELEVENLABS_API_KEY
  // No key → tell frontend to fall back to browser TTS
  if (!apiKey) return res.status(200).json({ fallback: true, reason: 'no_key' })

  const { text, gender = 'male' } = req.body || {}
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  const voiceId = ELEVENLABS_VOICES[gender] || ELEVENLABS_VOICES.male

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 2500), // ElevenLabs free tier cap
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.82, style: 0.3, use_speaker_boost: true },
      }),
    })

    if (!r.ok) {
      const err = await r.text().catch(() => '')
      // Quota exceeded or auth error → graceful fallback
      if (r.status === 401 || r.status === 403 || r.status === 429) {
        return res.status(200).json({ fallback: true, reason: r.status === 429 ? 'quota' : 'auth' })
      }
      return res.status(200).json({ fallback: true, reason: 'api_error', detail: err.slice(0, 200) })
    }

    const buffer = await r.arrayBuffer()
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', buffer.byteLength)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(Buffer.from(buffer))
  } catch (e) {
    return res.status(200).json({ fallback: true, reason: 'network', detail: e.message })
  }
}

module.exports = handler
