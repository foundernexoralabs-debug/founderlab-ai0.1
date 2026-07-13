const {
  assertProviderResponse,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')

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

async function execute({ request, env, fetchImpl }) {
  const apiKey = requireProviderKey(env, 'ANTHROPIC_API_KEY', 'anthropic')
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(request.system && { system: request.system }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      messages: normalizeMessages(request.messages),
    }),
  })
  const data = await readProviderJson(response, 'anthropic')
  assertProviderResponse(response, data, 'anthropic')
  return {
    text: data.content?.map((content) => content.text || '').join('') || '',
    usage: data.usage,
    finishReason: data.stop_reason,
  }
}

module.exports = { execute }
