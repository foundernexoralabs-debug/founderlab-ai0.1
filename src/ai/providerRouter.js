import { normalizeAIRequest } from './normalizeRequest.js'
import { createAIErrorResult, normalizeApiResult } from './normalizeResponse.js'
import { requestOllama } from './providers/ollama.js'

export async function routeAIRequest(input, {
  fetchImpl = globalThis.fetch,
  electronBridge,
  accessToken,
  signal,
} = {}) {
  const normalized = normalizeAIRequest(input, { enforceLimits: true })
  if (!normalized.ok) {
    return createAIErrorResult({
      provider: input?.provider,
      model: input?.model,
      code: normalized.error.code,
      message: normalized.error.message,
    })
  }

  const request = normalized.value
  if (request.provider === 'ollama') {
    return requestOllama(request, { fetchImpl, electronBridge, signal })
  }

  if (typeof fetchImpl !== 'function') {
    return createAIErrorResult({ provider: request.provider, model: request.model, code: 'NETWORK_FAILURE' })
  }

  try {
    const response = await fetchImpl('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
      },
      body: JSON.stringify({
        provider: request.provider,
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        ...(request.system && { system: request.system }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.responseFormat && { response_format: request.responseFormat }),
      }),
      signal,
    })
    const payload = await response.json().catch(() => null)
    if (!payload) {
      return createAIErrorResult({ provider: request.provider, model: request.model, status: response.status, code: 'MALFORMED_RESPONSE' })
    }
    return normalizeApiResult(payload, {
      provider: request.provider,
      model: request.model,
      status: response.status,
    })
  } catch (error) {
    return createAIErrorResult({
      provider: request.provider,
      model: request.model,
      code: error?.name === 'AbortError' ? 'REQUEST_CANCELLED' : 'NETWORK_FAILURE',
      message: error?.message,
    })
  }
}
