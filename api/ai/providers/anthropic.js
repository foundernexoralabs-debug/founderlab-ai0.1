const {
  assertProviderResponse,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')
const { iterateSSE } = require('../streamUtils')

function normalizeMessages(messages) {
  return messages.map((message) => {
    if (message.image) {
      const parts = message.image.split(',')
      const mediaType = parts[0].match(/data:([^;]+)/)?.[1] || 'image/jpeg'
      return {
        role: message.role,
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: parts[1] || '' } },
          { type: 'text', text: message.content || 'What do you see in this image?' },
        ],
      }
    }
    return { role: message.role, content: message.content }
  })
}

function createAnthropicBody(request, { stream = false } = {}) {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    ...(request.system && { system: request.system }),
    ...(request.temperature !== undefined && { temperature: request.temperature }),
    messages: normalizeMessages(request.messages),
    ...(stream ? { stream: true } : {}),
  }
}

async function callAnthropic({ request, env, fetchImpl, stream = false }) {
  const apiKey = requireProviderKey(env, 'ANTHROPIC_API_KEY', 'anthropic')
  return fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(createAnthropicBody(request, { stream })),
  })
}

async function execute({ request, env, fetchImpl }) {
  const response = await callAnthropic({ request, env, fetchImpl })
  const data = await readProviderJson(response, 'anthropic')
  assertProviderResponse(response, data, 'anthropic')
  return {
    text: data.content?.map((content) => content.text || '').join('') || '',
    usage: data.usage,
    finishReason: data.stop_reason,
  }
}

async function* stream({ request, env, fetchImpl }) {
  const response = await callAnthropic({ request, env, fetchImpl, stream: true })
  if (!response.ok) {
    const data = await readProviderJson(response, 'anthropic')
    assertProviderResponse(response, data, 'anthropic')
  }
  let usage = null
  let finishReason = null
  for await (const event of iterateSSE(response.body)) {
    let data
    try { data = JSON.parse(event.data) } catch { continue }
    if (event.event === 'content_block_delta' && typeof data?.delta?.text === 'string' && data.delta.text) {
      yield { type: 'delta', text: data.delta.text }
    }
    if (event.event === 'message_delta') {
      if (data?.usage) usage = data.usage
      if (data?.delta?.stop_reason) finishReason = data.delta.stop_reason
    }
    if (event.event === 'message_stop') break
  }
  yield { type: 'complete', usage, finishReason }
}

module.exports = { execute, stream, createAnthropicBody }
