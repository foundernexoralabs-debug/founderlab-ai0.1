const {
  assertProviderResponse,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')
const { iterateSSE } = require('../streamUtils')

function extractGroqText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    return part?.type === 'text' && typeof part.text === 'string' ? part.text : ''
  }).join('')
}

function createGroqBody(request, { stream = false } = {}) {
  const messages = request.system
    ? [{ role: 'system', content: request.system }, ...request.messages]
    : request.messages
  return {
    model: request.model,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    max_tokens: request.maxTokens,
    ...(request.temperature !== undefined && { temperature: request.temperature }),
    ...(request.responseFormat && { response_format: request.responseFormat }),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  }
}

async function callGroq({ request, env, fetchImpl, stream = false }) {
  const apiKey = requireProviderKey(env, 'GROQ_API_KEY', 'groq')
  return fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify(createGroqBody(request, { stream })),
  })
}

async function execute({ request, env, fetchImpl }) {
  const response = await callGroq({ request, env, fetchImpl })
  const data = await readProviderJson(response, 'groq')
  assertProviderResponse(response, data, 'groq')
  return {
    text: extractGroqText(data.choices?.[0]?.message?.content),
    usage: data.usage,
    finishReason: data.choices?.[0]?.finish_reason,
  }
}

async function* stream({ request, env, fetchImpl }) {
  const response = await callGroq({ request, env, fetchImpl, stream: true })
  if (!response.ok) {
    const data = await readProviderJson(response, 'groq')
    assertProviderResponse(response, data, 'groq')
  }
  let usage = null
  let finishReason = null
  for await (const event of iterateSSE(response.body)) {
    if (event.data === '[DONE]') break
    let data
    try { data = JSON.parse(event.data) } catch { continue }
    const choice = data?.choices?.[0]
    const text = extractGroqText(choice?.delta?.content)
    if (text) yield { type: 'delta', text }
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (data?.usage) usage = data.usage
  }
  yield { type: 'complete', usage, finishReason }
}

module.exports = { execute, stream, extractGroqText, createGroqBody }
