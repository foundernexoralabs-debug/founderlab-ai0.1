async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { provider, ollamaUrl, model, messages, system, max_tokens } = req.body || {}

  // ── OLLAMA ────────────────────────────────────────────────
  if (provider === 'ollama') {
    if (!ollamaUrl) return res.status(400).json({ error: 'ollamaUrl required' })
    if (!messages)  return res.status(400).json({ error: 'messages required' })
    try {
      const r = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3.2',
          messages,
          stream: false,
          options: { num_predict: max_tokens || 1200 },
        }),
      })
      const d = await r.json()
      if (!r.ok) return res.status(r.status).json({ error: d.error || 'Ollama error' })
      // Normalise to same shape as Anthropic so frontend code is identical
      return res.status(200).json({
        content: [{ type: 'text', text: d.message?.content || '' }],
      })
    } catch (err) {
      return res.status(500).json({ error: 'Cannot reach Ollama: ' + err.message })
    }
  }

  // ── ANTHROPIC ─────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey)  return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' })
  if (!messages) return res.status(400).json({ error: 'messages required' })
  try {
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
    return res.status(r.ok ? 200 : r.status).json(d)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

module.exports = handler
