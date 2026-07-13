const {
  assertProviderResponse,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')

async function execute({ request, env, fetchImpl }) {
  const apiKey = requireProviderKey(env, 'GROQ_API_KEY', 'groq')
  const messages = request.system
    ? [{ role: 'system', content: request.system }, ...request.messages]
    : request.messages
  const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: request.model,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      max_tokens: request.maxTokens,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.responseFormat && { response_format: request.responseFormat }),
    }),
  })
  const data = await readProviderJson(response, 'groq')
  assertProviderResponse(response, data, 'groq')
  return {
    text: data.choices?.[0]?.message?.content || '',
    usage: data.usage,
    finishReason: data.choices?.[0]?.finish_reason,
  }
}

module.exports = { execute }
