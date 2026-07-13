import { PROVIDERS, getDefaultModel, resolveModel } from '@/ai/providerRegistry'
import {
  normalizeProviderAvailability,
  resolveConfiguredProvider,
} from '@/ai/providerAvailability'
import {
  getAIProviderPreference,
  getOllamaModelPreference,
  getOllamaURLPreference,
  getProviderModelPreference,
  OLLAMA_MODEL_STORAGE_KEY,
  OLLAMA_URL_STORAGE_KEY,
  setAIProviderPreference,
  setProviderModelPreference,
} from '@/ai/providerPreferences'
import { toLegacyAIText } from '@/ai/normalizeResponse'
import { routeAIRequest } from '@/ai/providerRouter'
import { isElectronOllamaAvailable, probeOllama, requestOllama } from '@/ai/providers/ollama'
import { workspaceStore } from '@/services/workspaceStore'

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
  accessToken = workspaceStore.session?.access_token,
} = {}) {
  const preferredProvider = getAIProviderPreference()
  if (!accessToken || typeof fetchImpl !== 'function') {
    return { provider: preferredProvider, providers: providerAvailability }
  }

  try {
    const response = await fetchImpl('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken,
      },
      body: JSON.stringify({ action: 'provider-status' }),
    })
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

export async function ai(messages, system = '', maxTokens = 1200) {
  const provider = getAIProvider()
  if (!provider) return '⚠ No AI provider is configured. Add one optional provider key in the server environment, then try again.'
  const model = provider === 'ollama'
    ? getOllamaModel() || resolveModel('ollama', '')
    : getProviderModel(provider)

  const result = await routeAIRequest({
    provider,
    model,
    messages,
    system,
    maxTokens,
    ollamaUrl: provider === 'ollama' ? getOllamaURL() : undefined,
    accessToken: workspaceStore.session?.access_token,
  })
  return toLegacyAIText(result)
}
