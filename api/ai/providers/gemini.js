const {
  assertProviderResponse,
  createProviderError,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')

function getGeminiErrorCode(response, data) {
  if (response.status !== 400) return ''
  return data?.error?.status === 'FAILED_PRECONDITION'
    ? 'GEMINI_BILLING_OR_REGION_REQUIRED'
    : 'GEMINI_REQUEST_INVALID'
}

function assertGeminiResponse(response, data) {
  const code = getGeminiErrorCode(response, data)
  if (code) {
    throw createProviderError({
      provider: 'gemini',
      status: response.status || 400,
      code,
      message: 'Gemini rejected the request.',
    })
  }
  assertProviderResponse(response, data, 'gemini')
}

async function callGemini({ apiKey, request, fetchImpl }) {
  return fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(request.model) + ':generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: request.messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.responseFormat?.type === 'json_object' && { responseMimeType: 'application/json' }),
        },
        ...(request.system && { systemInstruction: { parts: [{ text: request.system }] } }),
      }),
    }
  )
}

async function execute({ request, env, fetchImpl }) {
  const apiKey = requireProviderKey(env, 'GEMINI_API_KEY', 'gemini')
  const response = await callGemini({ apiKey, request, fetchImpl })
  const data = await readProviderJson(response, 'gemini')
  assertGeminiResponse(response, data)
  return {
    text: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '',
    usage: data.usageMetadata,
    finishReason: data.candidates?.[0]?.finishReason,
  }
}

module.exports = { execute, assertGeminiResponse, getGeminiErrorCode }
