import { PROVIDERS, getDefaultModel, resolveModel } from '../ai/providerRegistry.js'
import {
  normalizeProviderAvailability,
  resolveConfiguredProvider,
} from '../ai/providerAvailability.js'
import {
  getAIProviderPreference,
  getOllamaModelPreference,
  getOllamaURLPreference,
  getProviderModelPreference,
  OLLAMA_MODEL_STORAGE_KEY,
  OLLAMA_URL_STORAGE_KEY,
  setAIProviderPreference,
  setProviderModelPreference,
} from '../ai/providerPreferences.js'
import { createAIErrorResult, toLegacyAIText } from '../ai/normalizeResponse.js'
import { routeAIRequest } from '../ai/providerRouter.js'
import { isElectronOllamaAvailable, probeOllama, requestOllama } from '../ai/providers/ollama.js'
import { workspaceStore } from './workspaceStore.js'

export {
  PROVIDERS,
  OLLAMA_MODEL_STORAGE_KEY,
  OLLAMA_URL_STORAGE_KEY,
}

let providerAvailability = normalizeProviderAvailability()

export function getProviderAvailability() {
  return providerAvailability
}

export async function refreshProviderAvailability({
  fetchImpl = globalThis.fetch,
  accessToken,
} = {}) {
  const preferredProvider = getAIProviderPreference()
  let activeAccessToken
  try {
    activeAccessToken = accessToken ?? await workspaceStore.getActiveAccessToken()
  } catch {
    return { provider: preferredProvider, providers: providerAvailability }
  }
  if (!activeAccessToken || typeof fetchImpl !== 'function') {
    return { provider: preferredProvider, providers: providerAvailability }
  }

  try {
    const requestStatus = (token) => fetchImpl('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ action: 'provider-status' }),
    })
    let response = await requestStatus(activeAccessToken)
    if (response.status === 401 && accessToken === undefined) {
      const refreshedAccessToken = await workspaceStore.getActiveAccessToken({ forceRefresh: true })
      if (refreshedAccessToken && refreshedAccessToken !== activeAccessToken) {
        activeAccessToken = refreshedAccessToken
        response = await requestStatus(activeAccessToken)
      }
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok || !payload.providers || typeof payload.providers !== 'object') {
      return { provider: preferredProvider, providers: providerAvailability }
    }

    providerAvailability = normalizeProviderAvailability(payload.providers)
    const provider = resolveConfiguredProvider(preferredProvider, providerAvailability)
    if (provider && provider !== preferredProvider) setAIProviderPreference(provider)
    return { provider, providers: providerAvailability }
  } catch {
    return { provider: preferredProvider, providers: providerAvailability }
  }
}

export function getAIProvider() {
  return getAIProviderPreference()
}

export function setAIProvider(providerId) {
  return setAIProviderPreference(providerId)
}

export function getProviderModel(providerId) {
  return getProviderModelPreference(providerId)
}

export function setProviderModel(providerId, model) {
  return setProviderModelPreference(providerId, model)
}

export function getOllamaURL() {
  return getOllamaURLPreference()
}

export function getOllamaModel() {
  return getOllamaModelPreference()
}

export const isElectron = isElectronOllamaAvailable()

export async function ollamaProbe(base) {
  return probeOllama(base)
}

export async function ollamaChat(messages, system, maxTokens) {
  const model = getOllamaModel() || getDefaultModel('ollama')
  const result = await requestOllama({
    model,
    messages,
    system,
    maxTokens,
    ollamaUrl: getOllamaURL(),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.text
}

export async function requestAIResult({
  provider = getAIProvider(),
  model,
  messages,
  system = '',
  maxTokens = 1200,
  ollamaUrl,
} = {}, {
  fetchImpl = globalThis.fetch,
  electronBridge,
  accessToken,
} = {}) {
  if (!provider) {
    return createAIErrorResult({ code: 'MISSING_CONFIGURATION' })
  }

  const resolvedModel = model || (provider === 'ollama'
    ? getOllamaModel() || resolveModel('ollama', '')
    : getProviderModel(provider))
  let activeAccessToken = ''
  if (provider !== 'ollama') {
    try {
      activeAccessToken = accessToken ?? await workspaceStore.getActiveAccessToken()
    } catch {
      return createAIErrorResult({ provider, model: resolvedModel, code: 'AUTHENTICATION_UNAVAILABLE' })
    }
  }
  const request = (token) => routeAIRequest({
    provider,
    model: resolvedModel,
    messages,
    system,
    maxTokens,
    ollamaUrl: provider === 'ollama' ? ollamaUrl || getOllamaURL() : undefined,
  }, {
    fetchImpl,
    electronBridge,
    accessToken: token,
  })
  let result = await request(activeAccessToken)
  if (provider !== 'ollama' && result.error?.code === 'AUTHENTICATION_INVALID' && accessToken === undefined) {
    let refreshedAccessToken = ''
    try {
      refreshedAccessToken = await workspaceStore.getActiveAccessToken({ forceRefresh: true })
    } catch {
      return createAIErrorResult({ provider, model: resolvedModel, code: 'AUTHENTICATION_UNAVAILABLE' })
    }
    if (refreshedAccessToken && refreshedAccessToken !== activeAccessToken) {
      activeAccessToken = refreshedAccessToken
      result = await request(activeAccessToken)
    }
  }
  return result
}

export async function ai(messages, system = '', maxTokens = 1200) {
  const result = await requestAIResult({ messages, system, maxTokens })
  return toLegacyAIText(result)
}
