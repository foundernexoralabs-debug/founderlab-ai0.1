const providerEntries = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    icon: '✦',
    sub: 'Best quality · Cloud API',
    default: 'claude-sonnet-4-6',
    keyEnv: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://console.anthropic.com',
    capabilities: { cloud: true, local: false, imageInput: true, streaming: false },
    limits: { maxOutputTokens: 12000 },
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4 (recommended)', capabilities: { imageInput: true } },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)', capabilities: { imageInput: true } },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)', capabilities: { imageInput: true } },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    sub: 'Ultra-fast inference · Free tier',
    default: 'openai/gpt-oss-120b',
    keyEnv: 'GROQ_API_KEY',
    docsUrl: 'https://console.groq.com',
    capabilities: { cloud: true, local: false, imageInput: false, streaming: false },
    limits: { maxOutputTokens: 12000 },
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (recommended)', capabilities: { imageInput: false } },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fastest)', capabilities: { imageInput: false } },
      { id: 'qwen/qwen3-32b', label: 'Qwen3 32B', capabilities: { imageInput: false } },
      { id: 'moonshotai/kimi-k2-instruct-0905', label: 'Kimi K2 Instruct', capabilities: { imageInput: false } },
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B',
        capabilities: { imageInput: false },
        internalOnly: true,
        purpose: 'youtube-analysis',
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    icon: '✶',
    sub: 'Google AI · Generous free tier',
    default: 'gemini-3.5-flash',
    keyEnv: 'GEMINI_API_KEY',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    capabilities: { cloud: true, local: false, imageInput: false, streaming: false },
    limits: { maxOutputTokens: 12000 },
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (recommended)', capabilities: { imageInput: false } },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (fastest)', capabilities: { imageInput: false } },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (most capable)', capabilities: { imageInput: false } },
    ],
  },
  {
    id: 'ollama',
    name: 'Local Ollama',
    icon: '🦙',
    sub: 'Local inference · Free · Your machine',
    default: 'llama3.2',
    keyEnv: null,
    docsUrl: 'https://ollama.com',
    capabilities: { cloud: false, local: true, imageInput: false, streaming: false, dynamicModels: true },
    limits: { maxOutputTokens: 12000 },
    models: [],
  },
]

function freezeProvider(provider) {
  return Object.freeze({
    ...provider,
    capabilities: Object.freeze({ ...provider.capabilities }),
    limits: Object.freeze({ ...provider.limits }),
    models: Object.freeze(provider.models.map((model) => Object.freeze({
      ...model,
      capabilities: Object.freeze({ ...model.capabilities }),
    }))),
  })
}

export const PROVIDERS = Object.freeze(Object.fromEntries(
  providerEntries.map((provider) => [provider.id, freezeProvider(provider)])
))

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS))

export function getProvider(providerId) {
  return PROVIDERS[providerId] || null
}

export function listProviders() {
  return PROVIDER_IDS.map((providerId) => PROVIDERS[providerId])
}

export function isSupportedProvider(providerId) {
  return Boolean(getProvider(providerId))
}

export function getDefaultModel(providerId) {
  return getProvider(providerId)?.default || ''
}

export function getProviderModel(providerId, modelId) {
  return getProvider(providerId)?.models.find((model) => model.id === modelId) || null
}

export function getPurposeModel(purpose) {
  for (const provider of listProviders()) {
    const model = provider.models.find((candidate) => candidate.purpose === purpose)
    if (model) return { provider: provider.id, model: model.id }
  }
  return null
}

export function isSupportedModel(providerId, modelId, { includeInternal = false } = {}) {
  const provider = getProvider(providerId)
  if (!provider || typeof modelId !== 'string' || !modelId.trim()) return false
  if (provider.capabilities.dynamicModels) return true
  const model = getProviderModel(providerId, modelId)
  return Boolean(model && (includeInternal || !model.internalOnly))
}

export function resolveModel(providerId, modelId, options) {
  const provider = getProvider(providerId)
  if (!provider) return ''
  if (isSupportedModel(providerId, modelId, options)) return modelId.trim()
  return provider.default
}

export function getProviderMaxTokens(providerId) {
  return getProvider(providerId)?.limits.maxOutputTokens || 1200
}
