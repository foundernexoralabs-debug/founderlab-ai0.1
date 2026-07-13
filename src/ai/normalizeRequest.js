import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  getProviderMaxTokens,
  isSupportedModel,
  isSupportedProvider,
  resolveModel,
} from './providerRegistry.js'

export const REQUEST_LIMITS = Object.freeze({
  maxMessages: 50,
  maxMessageCharacters: 160000,
  maxTotalTextCharacters: 250000,
  maxSystemCharacters: 60000,
  maxImageDataUrlCharacters: 7000000,
  maxImages: 1,
})

const ALLOWED_ROLES = new Set(['user', 'assistant'])

function requestError(code, message) {
  return { ok: false, error: { code, message, status: 400 } }
}

function normalizeMaxTokens(providerId, value) {
  const parsed = Number(value)
  const fallback = 1200
  const requested = Number.isFinite(parsed) ? Math.floor(parsed) : fallback
  return Math.min(Math.max(requested, 1), getProviderMaxTokens(providerId))
}

function normalizeTemperature(value) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
}

function normalizeMessages(messages, enforceLimits, supportsImageInput) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return requestError('REQUEST_INVALID', 'At least one message is required.')
  }
  if (messages.length > REQUEST_LIMITS.maxMessages) {
    return requestError('REQUEST_INVALID', 'Too many messages were included in this request.')
  }

  let totalTextCharacters = 0
  let imageCount = 0
  const normalized = []
  for (const message of messages) {
    if (!message || !ALLOWED_ROLES.has(message.role) || typeof message.content !== 'string') {
      return requestError('REQUEST_INVALID', 'Each message needs a valid role and text content.')
    }
    if (enforceLimits && message.content.length > REQUEST_LIMITS.maxMessageCharacters) {
      return requestError('REQUEST_INVALID', 'A message is too large.')
    }
    if (message.image) {
      imageCount += 1
      if (!supportsImageInput) {
        return requestError('REQUEST_INVALID', 'The selected provider does not support image input in FounderLab yet.')
      }
      if (typeof message.image !== 'string' || !message.image.startsWith('data:image/') || message.image.length > REQUEST_LIMITS.maxImageDataUrlCharacters) {
        return requestError('REQUEST_INVALID', 'Image input is invalid or too large.')
      }
    }
    if (enforceLimits && imageCount > REQUEST_LIMITS.maxImages) {
      return requestError('REQUEST_INVALID', 'Only one image can be sent in a request.')
    }
    totalTextCharacters += message.content.length
    if (enforceLimits && totalTextCharacters > REQUEST_LIMITS.maxTotalTextCharacters) {
      return requestError('REQUEST_INVALID', 'Request text is too large.')
    }
    normalized.push({
      role: message.role,
      content: message.content,
      ...(message.image ? { image: message.image } : {}),
    })
  }
  return { ok: true, value: normalized }
}

export function normalizeOllamaUrl(value) {
  try {
    const url = new URL(value || 'http://localhost:11434')
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}

export function normalizeAIRequest(input = {}, {
  enforceLimits = false,
  restrictOllamaToLocal = false,
  allowInternalModels = false,
} = {}) {
  const provider = input.provider || DEFAULT_PROVIDER_ID
  if (!isSupportedProvider(provider)) {
    return requestError('REQUEST_INVALID', 'The selected AI provider is not supported.')
  }

  if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 160)) {
    return requestError('REQUEST_INVALID', 'Model selection is invalid.')
  }
  if (input.model && !isSupportedModel(provider, input.model, { includeInternal: allowInternalModels })) {
    return requestError('INVALID_MODEL', 'The selected model is not supported by this provider.')
  }
  if (input.system !== undefined && (typeof input.system !== 'string' || (enforceLimits && input.system.length > REQUEST_LIMITS.maxSystemCharacters))) {
    return requestError('REQUEST_INVALID', 'System instructions are invalid or too large.')
  }
  const temperature = normalizeTemperature(input.temperature)
  if (temperature === null) {
    return requestError('REQUEST_INVALID', 'Temperature must be a number between 0 and 1.')
  }

  const messages = normalizeMessages(input.messages, enforceLimits, getProvider(provider).capabilities.imageInput)
  if (!messages.ok) return messages

  const resolvedModel = resolveModel(provider, input.model, { includeInternal: allowInternalModels })
  const ollamaUrl = restrictOllamaToLocal && provider === 'ollama'
    ? normalizeOllamaUrl(input.ollamaUrl)
    : input.ollamaUrl
  if (restrictOllamaToLocal && provider === 'ollama' && !ollamaUrl) {
    return requestError('REQUEST_INVALID', 'Ollama URL must use localhost.')
  }

  return {
    ok: true,
    value: {
      provider,
      model: resolvedModel,
      messages: messages.value,
      system: input.system || '',
      maxTokens: normalizeMaxTokens(provider, input.maxTokens),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(ollamaUrl ? { ollamaUrl } : {}),
    },
  }
}

export function normalizeServerAIRequest(payload = {}) {
  return normalizeAIRequest({
    provider: payload.provider,
    model: payload.model,
    messages: payload.messages,
    system: payload.system,
    maxTokens: payload.max_tokens,
    temperature: payload.temperature,
    ollamaUrl: payload.ollamaUrl,
  }, { enforceLimits: true, restrictOllamaToLocal: true })
}
