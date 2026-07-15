import { createAIErrorResult, createAIResult } from '../normalizeResponse.js'

function resolveElectronBridge(bridge) {
  if (bridge) return bridge
  if (typeof window === 'undefined') return null
  return window.electronBridge || null
}

export function isElectronOllamaAvailable(bridge) {
  return Boolean(resolveElectronBridge(bridge)?.isElectron)
}

export async function probeOllama(base, { fetchImpl = globalThis.fetch, electronBridge } = {}) {
  const url = (base || 'http://localhost:11434').replace(/\/$/, '')
  const bridge = resolveElectronBridge(electronBridge)
  if (bridge?.isElectron) {
    try {
      return await bridge.ollama.probe(url)
    } catch {
      return { running: false, corsOk: true, models: [] }
    }
  }

  if (typeof fetchImpl !== 'function') return { models: [], corsOk: false, running: false }
  try {
    const response = await fetchImpl(url + '/api/tags', { signal: AbortSignal.timeout(5000) })
    if (response.ok) {
      const data = await response.json()
      return { models: (data.models || []).map((model) => model.name).filter(Boolean), corsOk: true, running: true }
    }
    return { models: [], corsOk: true, running: false }
  } catch {
    try {
      await fetchImpl(url, { mode: 'no-cors', signal: AbortSignal.timeout(3000) })
      return { models: [], corsOk: false, running: true }
    } catch {
      return { models: [], corsOk: false, running: false }
    }
  }
}

export async function requestOllama({
  model,
  messages,
  system,
  maxTokens,
  temperature,
  ollamaUrl,
}, { fetchImpl = globalThis.fetch, electronBridge, signal } = {}) {
  const base = (ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')
  const fullMessages = system ? [{ role: 'system', content: system }, ...messages] : messages
  const bridge = resolveElectronBridge(electronBridge)

  try {
    if (bridge?.isElectron) {
      const response = await bridge.ollama.chat({ url: base, model, messages: fullMessages, max: maxTokens, temperature })
      if (!response.ok) {
        return createAIErrorResult({ provider: 'ollama', model, code: 'PROVIDER_UNAVAILABLE', message: response.data?.error })
      }
      return createAIResult({
        provider: 'ollama',
        model,
        text: response.data?.message?.content || '',
        usage: response.data?.eval_count ? { outputTokens: response.data.eval_count } : null,
      })
    }

    if (typeof fetchImpl !== 'function') {
      return createAIErrorResult({ provider: 'ollama', model, code: 'NETWORK_FAILURE' })
    }
    const response = await fetchImpl(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: false,
        options: { num_predict: maxTokens, ...(temperature !== undefined && { temperature }) },
      }),
      signal: signal || AbortSignal.timeout(120000),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return createAIErrorResult({
        provider: 'ollama',
        model,
        status: response.status,
        code: data?.error ? 'PROVIDER_UNAVAILABLE' : 'MALFORMED_RESPONSE',
        message: data?.error,
      })
    }
    return createAIResult({
      provider: 'ollama',
      model,
      text: data?.message?.content || '',
      usage: data?.eval_count ? { outputTokens: data.eval_count } : null,
      finishReason: data?.done_reason,
    })
  } catch (error) {
    return createAIErrorResult({ provider: 'ollama', model, code: error?.name === 'AbortError' ? 'REQUEST_CANCELLED' : error?.name === 'TimeoutError' ? 'PROVIDER_UNAVAILABLE' : 'NETWORK_FAILURE', message: error?.message })
  }
}
