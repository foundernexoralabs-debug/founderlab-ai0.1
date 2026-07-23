import { normalizeAIRequest } from './normalizeRequest.js'
import { createAIErrorResult, normalizeApiResult } from './normalizeResponse.js'
import { requestOllama } from './providers/ollama.js'
import { consumeAIEventStream, isAIEventStream } from './streaming.js'

export async function routeAIRequest(input, {
  fetchImpl = globalThis.fetch,
  electronBridge,
  permissionQuery,
  diagnosticFlow,
  accessToken,
  signal,
  onStreamEvent,
} = {}) {
  const normalized = normalizeAIRequest(input, {
    enforceLimits: true,
    // Ollama is a browser-to-loopback integration. Normalizing here prevents a
    // persisted preference or caller from turning it into an arbitrary fetch.
    restrictOllamaToLocal: true,
  })
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
    return requestOllama(request, { fetchImpl, electronBridge, permissionQuery, diagnosticFlow, signal, onStreamEvent })
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
        ...(request.stream ? { stream: true } : {}),
      }),
      ...(signal ? { signal } : {}),
    })
    if (request.stream && isAIEventStream(response)) {
      const streamed = await consumeAIEventStream(response, { onEvent: onStreamEvent })
      if (streamed.error) {
        const result = normalizeApiResult({
          ok: false,
          provider: streamed.completion?.provider || request.provider,
          model: streamed.completion?.model || request.model,
          error: streamed.error,
        }, { provider: request.provider, model: request.model, status: response.status })
        return streamed.text ? { ...result, partialText: streamed.text } : result
      }
      if (!streamed.completed) {
        const result = createAIErrorResult({ provider: request.provider, model: request.model, status: response.status, code: 'MALFORMED_RESPONSE' })
        return streamed.text ? { ...result, partialText: streamed.text } : result
      }
      if (!streamed.text) {
        return createAIErrorResult({ provider: request.provider, model: request.model, status: response.status, code: 'EMPTY_RESPONSE' })
      }
      return normalizeApiResult({
        ok: true,
        provider: streamed.completion?.provider || request.provider,
        model: streamed.completion?.model || request.model,
        text: streamed.text,
        meta: streamed.completion?.meta || null,
      }, { provider: request.provider, model: request.model, status: response.status })
    }
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
    const result = createAIErrorResult({
      provider: request.provider,
      model: request.model,
      code: 'NETWORK_FAILURE',
      message: error?.message,
    })
    return error?.partialText ? { ...result, partialText: error.partialText } : result
  }
}
