const {
  assertProviderResponse,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')

async function callGemini({ apiKey, request, fetchImpl, apiVersion }) {
  return fetchImpl(
    'https://generativelanguage.googleapis.com/' + apiVersion + '/models/' + encodeURIComponent(request.model) + ':generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: request.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          ...(request.temperature !== undefined && { temperature: request.temperature }),
        },
        ...(request.system && { system_instruction: { parts: [{ text: request.system }] } }),
      }),
    }
  )
}

async function execute({ request, env, fetchImpl }) {
  const apiKey = requireProviderKey(env, 'GEMINI_API_KEY', 'gemini')
  let response = await callGemini({ apiKey, request, fetchImpl, apiVersion: 'v1' })
  let data = await readProviderJson(response, 'gemini')

  if (!response.ok && response.status === 404) {
    response = await callGemini({ apiKey, request, fetchImpl, apiVersion: 'v1beta' })
    data = await readProviderJson(response, 'gemini')
  }

  assertProviderResponse(response, data, 'gemini')
  return {
    text: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '',
    usage: data.usageMetadata,
    finishReason: data.candidates?.[0]?.finishReason,
  }
}

module.exports = { execute }
