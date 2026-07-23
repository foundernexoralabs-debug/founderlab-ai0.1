const {
  assertProviderResponse,
  createProviderError,
  readProviderJson,
  requireProviderKey,
} = require('../providerUtils')
const { iterateSSE } = require('../streamUtils')

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

function createGeminiBody(request) {
  return {
    contents: request.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      maxOutputTokens: request.maxTokens,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
    },
    ...(request.system && { systemInstruction: { parts: [{ text: request.system }] } }),
  }
}

async function callGemini({ apiKey, request, fetchImpl, stream = false }) {
  const method = stream ? ':streamGenerateContent?alt=sse' : ':generateContent'
  return fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(request.model) + method,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(createGeminiBody(request)),
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

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
}

async function* stream({ request, env, fetchImpl }) {
  const apiKey = requireProviderKey(env, 'GEMINI_API_KEY', 'gemini')
  const response = await callGemini({ apiKey, request, fetchImpl, stream: true })
  if (!response.ok) {
    const data = await readProviderJson(response, 'gemini')
    assertGeminiResponse(response, data)
  }
  let textSoFar = ''
  let usage = null
  let finishReason = null
  for await (const event of iterateSSE(response.body)) {
    let data
    try { data = JSON.parse(event.data) } catch { continue }
    const candidateText = extractGeminiText(data)
    // Gemini can emit either a true chunk or a cumulative candidate depending
    // on model/version. Avoid duplicated words while preserving every real
    // provider token in the browser stream.
    const delta = candidateText.startsWith(textSoFar)
      ? candidateText.slice(textSoFar.length)
      : candidateText
    if (delta) {
      textSoFar += delta
      yield { type: 'delta', text: delta }
    }
    if (data?.usageMetadata) usage = data.usageMetadata
    if (data?.candidates?.[0]?.finishReason) finishReason = data.candidates[0].finishReason
  }
  yield { type: 'complete', usage, finishReason }
}

module.exports = { execute, stream, assertGeminiResponse, getGeminiErrorCode, createGeminiBody, extractGeminiText }
