import { normalizeOllamaUrl } from '../normalizeRequest.js'
import { createAIErrorResult, createAIResult } from '../normalizeResponse.js'

export const OLLAMA_DISCOVERY_TIMEOUT_MS = 5000
export const OLLAMA_CHAT_TIMEOUT_MS = 120000

function resolveElectronBridge(bridge) {
  if (bridge) return bridge
  if (typeof window === 'undefined') return null
  return window.electronBridge || null
}

function timeoutSignal(timeout) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeout)
    : undefined
}

function normalizeModelName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name && name.length <= 160 ? name : ''
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return []
  const seen = new Set()
  return models.reduce((items, model) => {
    const name = normalizeModelName(typeof model === 'string' ? model : model?.name || model?.model)
    if (!name || seen.has(name)) return items
    seen.add(name)
    items.push(Object.freeze({
      id: name,
      name,
      family: typeof model?.details?.family === 'string' ? model.details.family : '',
      parameterSize: typeof model?.details?.parameter_size === 'string' ? model.details.parameter_size : '',
      size: Number.isFinite(model?.size) ? model.size : null,
    }))
    return items
  }, [])
}

function unavailableInspection(code = 'OLLAMA_UNAVAILABLE') {
  return Object.freeze({
    ok: false,
    state: 'unavailable',
    running: false,
    models: Object.freeze([]),
    error: Object.freeze({ code }),
  })
}

function availableInspection(models) {
  const normalizedModels = normalizeModels(models)
  return Object.freeze({
    ok: true,
    state: normalizedModels.length ? 'models_available' : 'no_models',
    running: true,
    models: Object.freeze(normalizedModels),
    error: null,
  })
}

export function isElectronOllamaAvailable(bridge) {
  return Boolean(resolveElectronBridge(bridge)?.isElectron)
}

/**
 * Browser discovery is deliberately a CORS-readable /api/tags call. A no-cors
 * request produces an opaque response and cannot prove that this website can
 * actually use Ollama, so it must never be treated as a successful detection.
 */
export async function discoverOllama(base, { fetchImpl = globalThis.fetch, electronBridge } = {}) {
  const url = normalizeOllamaUrl(base)
  if (!url || typeof fetchImpl !== 'function') return unavailableInspection('OLLAMA_UNAVAILABLE')

  const bridge = resolveElectronBridge(electronBridge)
  try {
    if (bridge?.isElectron) {
      const result = await bridge.ollama.probe(url)
      return result?.running ? availableInspection(result.models) : unavailableInspection()
    }
    const response = await fetchImpl(url + '/api/tags', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: timeoutSignal(OLLAMA_DISCOVERY_TIMEOUT_MS),
    })
    if (!response.ok) return unavailableInspection('OLLAMA_UNAVAILABLE')
    const data = await response.json().catch(() => null)
    if (!data || !Array.isArray(data.models)) return unavailableInspection('MALFORMED_RESPONSE')
    return availableInspection(data.models)
  } catch (error) {
    return unavailableInspection(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'OLLAMA_TIMEOUT' : 'OLLAMA_UNAVAILABLE')
  }
}

// Kept as a small compatibility alias for callers from the Phase 2.2 engine.
export const probeOllama = discoverOllama

export async function requestOllama({
  model,
  messages,
  system,
  maxTokens,
  temperature,
  ollamaUrl,
}, { fetchImpl = globalThis.fetch, electronBridge } = {}) {
  const base = normalizeOllamaUrl(ollamaUrl)
  const selectedModel = normalizeModelName(model)
  if (!base) return createAIErrorResult({ provider: 'ollama', model: selectedModel, code: 'OLLAMA_INVALID_URL' })
  if (!selectedModel) return createAIErrorResult({ provider: 'ollama', code: 'OLLAMA_MODEL_REQUIRED' })
  const fullMessages = system ? [{ role: 'system', content: system }, ...(messages || [])] : messages || []
  const bridge = resolveElectronBridge(electronBridge)

  try {
    if (bridge?.isElectron) {
      const response = await bridge.ollama.chat({ url: base, model: selectedModel, messages: fullMessages, max: maxTokens, temperature })
      if (!response?.ok) {
        return createAIErrorResult({
          provider: 'ollama',
          model: selectedModel,
          code: response?.status === 404 ? 'OLLAMA_MODEL_UNAVAILABLE' : 'OLLAMA_UNAVAILABLE',
        })
      }
      return createAIResult({
        provider: 'ollama',
        model: selectedModel,
        text: response.data?.message?.content || '',
        usage: response.data?.eval_count ? { outputTokens: response.data.eval_count } : null,
        finishReason: response.data?.done_reason,
      })
    }

    if (typeof fetchImpl !== 'function') return createAIErrorResult({ provider: 'ollama', model: selectedModel, code: 'OLLAMA_UNAVAILABLE' })
    const response = await fetchImpl(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        model: selectedModel,
        messages: fullMessages,
        stream: false,
        options: { num_predict: maxTokens, ...(temperature !== undefined && { temperature }) },
      }),
      signal: timeoutSignal(OLLAMA_CHAT_TIMEOUT_MS),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return createAIErrorResult({
        provider: 'ollama',
        model: selectedModel,
        status: response.status,
        code: response.status === 404 ? 'OLLAMA_MODEL_UNAVAILABLE' : response.status === 429 ? 'RATE_LIMITED' : 'OLLAMA_UNAVAILABLE',
      })
    }
    return createAIResult({
      provider: 'ollama',
      model: selectedModel,
      text: data?.message?.content || '',
      usage: data?.eval_count ? { outputTokens: data.eval_count } : null,
      finishReason: data?.done_reason,
    })
  } catch (error) {
    return createAIErrorResult({
      provider: 'ollama',
      model: selectedModel,
      code: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'OLLAMA_TIMEOUT' : 'OLLAMA_UNAVAILABLE',
    })
  }
}
