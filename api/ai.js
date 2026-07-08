/**
 * FounderLab AI — Unified AI Provider Handler
 * Serverless function (Vercel). Reads all API keys from process.env.
 * Normalises every provider response to { content: [{ type:'text', text:string }] }
 * so the frontend never needs to know which provider is active.
 *
 * Supported providers:
 *   anthropic | groq | gemini | ollama
 *
 * Request body:
 *   { provider, model, messages, system?, max_tokens? }
 *   For Ollama: add { ollamaUrl }
 */

// ── CORS ─────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// ── Response normaliser — every provider returns this shape ──
function ok(res, text) {
  return res.status(200).json({ content: [{ type: 'text', text: text || '' }] })
}
function err(res, status, message) {
  return res.status(status).json({ error: message })
}

// ── ANTHROPIC ─────────────────────────────────────────────────
async function handleAnthropic(req, res, { model, messages, system, max_tokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return err(res, 500, 'ANTHROPIC_API_KEY is not configured on the server.')

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1200,
      ...(system && { system }),
      messages,
    }),
  })
  const d = await r.json()
  if (!r.ok) return err(res, r.status, d?.error?.message || `Anthropic error ${r.status}`)
  const text = d.content?.map(c => c.text || '').join('') || ''
  return ok(res, text)
}

// ── GROQ (OpenAI-compatible) ───────────────────────────────────
async function handleGroq(req, res, { model, messages, system, max_tokens }) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return err(res, 500, 'GROQ_API_KEY is not configured on the server.')

  // Groq uses OpenAI message format — prepend system as a system role message
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'llama-3.2-70b-versatile',
      messages: fullMessages,
      max_tokens: max_tokens || 1200,
    }),
  })
  const d = await r.json()
  if (!r.ok) return err(res, r.status, d?.error?.message || `Groq error ${r.status}`)
  const text = d.choices?.[0]?.message?.content || ''
  return ok(res, text)
}

// ── GEMINI ────────────────────────────────────────────────────
async function handleGemini(req, res, { model, messages, system, max_tokens }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return err(res, 500, 'GEMINI_API_KEY is not configured on the server.')

  const geminiModel = model || 'gemini-1.5-flash'

  // Convert OpenAI-style messages to Gemini contents format
  // Gemini uses "user"/"model" (not "assistant"), and each message is { role, parts:[{text}] }
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens || 1200 },
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${geminiModel}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  const d = await r.json()
  if (!r.ok) return err(res, r.status, d?.error?.message || `Gemini error ${r.status}`)
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return ok(res, text)
}

// ── OLLAMA (server-side path — used when not browser-direct) ──
async function handleOllama(req, res, { model, messages, system, max_tokens, ollamaUrl }) {
  const base = (ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')
  const fullMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages

  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.2',
        messages: fullMessages,
        stream: false,
        options: { num_predict: max_tokens || 1200 },
      }),
    })
    const d = await r.json()
    if (!r.ok) return err(res, r.status, d?.error || `Ollama error ${r.status}`)
    return ok(res, d.message?.content || '')
  } catch (e) {
    return err(res, 500, `Cannot reach Ollama at ${base}: ${e.message}`)
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────
async function handler(req, res) {
  setCORS(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')   return err(res, 405, 'Method not allowed')

  const { provider = 'anthropic', model, messages, system, max_tokens, ollamaUrl } = req.body || {}
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return err(res, 400, 'messages array is required')
  }

  const params = { model, messages, system, max_tokens, ollamaUrl }

  try {
    switch (provider) {
      case 'anthropic': return await handleAnthropic(req, res, params)
      case 'groq':      return await handleGroq(req, res, params)
      case 'gemini':    return await handleGemini(req, res, params)
      case 'ollama':    return await handleOllama(req, res, params)
      default:          return err(res, 400, `Unknown provider: "${provider}". Supported: anthropic, groq, gemini, ollama`)
    }
  } catch (e) {
    console.error('[ai handler]', e)
    return err(res, 500, `Internal error: ${e.message}`)
  }
}

module.exports = handler
