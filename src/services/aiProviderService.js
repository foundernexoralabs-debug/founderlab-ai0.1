import { PROVIDERS } from '../ai/providerRegistry.js'
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
  setOllamaModelPreference,
  setOllamaURLPreference,
  setProviderModelPreference,
} from '../ai/providerPreferences.js'
import { createAIErrorResult, toLegacyAIText } from '../ai/normalizeResponse.js'
import { routeAIRequest } from '../ai/providerRouter.js'
import { recordProviderConnectionResult } from '../ai/providerConnectionState.js'
import { discoverOllama, recordOllamaDiagnostic } from '../ai/providers/ollama.js'
import { workspaceStore } from './workspaceStore.js'

export {
  PROVIDERS,
  OLLAMA_MODEL_STORAGE_KEY,
  OLLAMA_URL_STORAGE_KEY,
}

let providerAvailability = normalizeProviderAvailability()

export const PROVIDER_CONNECTION_TEST_MAX_TOKENS = 256
export const OLLAMA_CONNECTION_TEST_MAX_TOKENS = 24

export function createProviderConnectionTestRequest({ provider, model } = {}) {
  return {
    provider,
    model,
    messages: [{ role: 'user', content: 'Say only: CONNECTED' }],
    // A local connection test proves the selected model can reply; it should
    // not make a small laptop model generate a cloud-sized response.
    maxTokens: provider === 'ollama'
      ? OLLAMA_CONNECTION_TEST_MAX_TOKENS
      : PROVIDER_CONNECTION_TEST_MAX_TOKENS,
    connectionTest: true,
  }
}

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
    // The Settings card can be changed while this authenticated status request
    // is in flight. Resolve against the latest preference so a stale response
    // never unmounts Local Ollama and discards its visible result.
    const currentPreferredProvider = getAIProviderPreference() || preferredProvider
    const provider = resolveConfiguredProvider(currentPreferredProvider, providerAvailability)
    if (preferredProvider === 'ollama' || currentPreferredProvider === 'ollama') {
      recordOllamaDiagnostic('provider-status', {
        selectedProviderAtStart: preferredProvider || 'none',
        selectedProviderAtCompletion: currentPreferredProvider || 'none',
        selectedProviderChangedDuringRefresh: preferredProvider !== currentPreferredProvider,
        resolvedProvider: provider || 'none',
      })
    }
    if (provider && provider !== currentPreferredProvider) setAIProviderPreference(provider)
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
  return providerId === 'ollama' ? getOllamaModelPreference() : getProviderModelPreference(providerId)
}

export function setProviderModel(providerId, model) {
  return providerId === 'ollama' ? setOllamaModelPreference(model) : setProviderModelPreference(providerId, model)
}

export function getOllamaURL() {
  return getOllamaURLPreference()
}

export function getOllamaModel() {
  return getOllamaModelPreference()
}

export function setOllamaModel(model) {
  return setOllamaModelPreference(model)
}

export function setOllamaURL(url) {
  return setOllamaURLPreference(url)
}

export async function discoverLocalOllama(options = {}) {
  return discoverOllama(options.url || getOllamaURL(), options)
}

export async function requestAIResult({
  provider = getAIProvider(),
  model,
  messages,
  system = '',
  maxTokens = 1200,
  ollamaUrl,
  connectionTest = false,
  localOllamaAllowed = false,
} = {}, {
  fetchImpl = globalThis.fetch,
  electronBridge,
  permissionQuery,
  accessToken,
  signal,
} = {}) {
  if (!provider) {
    return createAIErrorResult({ code: 'MISSING_CONFIGURATION' })
  }

  if (provider === 'ollama' && !localOllamaAllowed) {
    return createAIErrorResult({ provider, code: 'OLLAMA_CHAT_ONLY' })
  }

  const resolvedModel = model || (provider === 'ollama'
    ? getOllamaModel()
    : getProviderModel(provider))
  if (provider === 'ollama' && !resolvedModel) {
    return createAIErrorResult({ provider, code: 'OLLAMA_MODEL_REQUIRED' })
  }
  const complete = (result) => {
    recordProviderConnectionResult(provider, result, { connectionTest })
    return result
  }
  let activeAccessToken = ''
  if (provider !== 'ollama') {
    try {
      activeAccessToken = accessToken ?? await workspaceStore.getActiveAccessToken()
    } catch {
      return complete(createAIErrorResult({ provider, model: resolvedModel, code: 'AUTHENTICATION_UNAVAILABLE' }))
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
    permissionQuery,
    diagnosticFlow: provider === 'ollama' ? (connectionTest ? 'connection-test' : 'chat') : undefined,
    accessToken: token,
    signal,
  })
  let result = await request(activeAccessToken)
  if (provider !== 'ollama' && result.error?.code === 'AUTHENTICATION_INVALID' && accessToken === undefined) {
    let refreshedAccessToken = ''
    try {
      refreshedAccessToken = await workspaceStore.getActiveAccessToken({ forceRefresh: true })
    } catch {
      return complete(createAIErrorResult({ provider, model: resolvedModel, code: 'AUTHENTICATION_UNAVAILABLE' }))
    }
    if (refreshedAccessToken && refreshedAccessToken !== activeAccessToken) {
      activeAccessToken = refreshedAccessToken
      result = await request(activeAccessToken)
    }
  }
  return complete(result)
}

export async function ai(messages, system = '', maxTokens = 1200, { localOllamaAllowed = false } = {}) {
  const result = await requestAIResult({ messages, system, maxTokens, localOllamaAllowed })
  return toLegacyAIText(result)
}
