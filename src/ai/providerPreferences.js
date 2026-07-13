import {
  getDefaultModel,
  isSupportedModel,
  isSupportedProvider,
} from './providerRegistry.js'

const PROVIDER_STORAGE_KEY = 'fl_ai_provider'
const MODEL_STORAGE_KEY = 'fl_ai_models'
export const OLLAMA_URL_STORAGE_KEY = 'fl_ollama_url'
export const OLLAMA_MODEL_STORAGE_KEY = 'fl_ollama_model'

function readStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

export function getAIProviderPreference() {
  const stored = readStorage(PROVIDER_STORAGE_KEY)
  return isSupportedProvider(stored) ? stored : ''
}

export function setAIProviderPreference(providerId) {
  if (!isSupportedProvider(providerId)) return false
  try {
    localStorage.setItem(PROVIDER_STORAGE_KEY, providerId)
    return true
  } catch {
    return false
  }
}

export function getProviderModelPreference(providerId) {
  try {
    const stored = JSON.parse(readStorage(MODEL_STORAGE_KEY, '{}'))
    const model = stored[providerId]
    return isSupportedModel(providerId, model) ? model : getDefaultModel(providerId)
  } catch {
    return getDefaultModel(providerId)
  }
}

export function setProviderModelPreference(providerId, model) {
  if (!isSupportedModel(providerId, model)) return false
  try {
    const stored = JSON.parse(readStorage(MODEL_STORAGE_KEY, '{}'))
    stored[providerId] = model
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

export function getOllamaURLPreference() {
  return readStorage(OLLAMA_URL_STORAGE_KEY, 'http://localhost:11434')
}

export function getOllamaModelPreference() {
  return readStorage(OLLAMA_MODEL_STORAGE_KEY, '')
}
