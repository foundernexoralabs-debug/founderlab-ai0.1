import { getProvider } from './providerRegistry.js'
import { getVoiceProvider } from './voiceProviderRegistry.js'

const ERROR_MESSAGES = {
  AUTHENTICATION_REQUIRED: 'requires you to sign in before using this feature.',
  AUTHENTICATION_INVALID: 'could not verify your sign-in session. Please sign in again.',
  AUTHENTICATION_UNAVAILABLE: 'could not verify your sign-in session right now. Please try again.',
  CORS_ORIGIN_DENIED: 'cannot be called from this website origin.',
  INVALID_MODEL: 'cannot use the selected model. Choose another model in Settings.',
  AUTHENTICATION_FAILED: 'could not authenticate with its server configuration. Check the server key and try again.',
  RATE_LIMITED: 'is temporarily busy. Please try again in a moment.',
  RATE_LIMIT_BACKEND_UNAVAILABLE: 'cannot run because AI request protection is unavailable for this deployment. Please try again later.',
  PROVIDER_UNAVAILABLE: 'is unavailable right now. Check the provider status and try again.',
  GEMINI_REQUEST_INVALID: 'rejected this request. Choose another Gemini model or check server-side Google AI access.',
  GEMINI_BILLING_OR_REGION_REQUIRED: 'requires Google AI Studio billing or a supported region before it can run.',
  NETWORK_FAILURE: 'could not be reached. Check your connection and try again.',
  MALFORMED_RESPONSE: 'returned an invalid response. Please try again.',
  EMPTY_RESPONSE: 'returned an empty response. Please try again.',
  REQUEST_INVALID: 'could not process this request. Check the selected model and input, then try again.',
  UNKNOWN: 'could not complete this request. Please try again.',
}

function missingConfigurationMessage(provider, providerName) {
  if (provider === 'anthropic') {
    return 'Anthropic is not configured. Choose another provider or add ANTHROPIC_API_KEY.'
  }
  const keyName = getProvider(provider)?.keyEnv || getVoiceProvider(provider)?.keyEnv
  return keyName
    ? providerName + ' is not configured. Choose another provider or add ' + keyName + '.'
    : providerName + ' is not configured. Please check its local setup and try again.'
}

export function classifyAIError({ provider, status, code, message } = {}) {
  const detail = String(message || '').toLowerCase()
  let resolvedCode = code || ''

  if (!resolvedCode) {
    if (status === 429 || /rate.?limit|too many requests/.test(detail)) resolvedCode = 'RATE_LIMITED'
    else if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid api key/.test(detail)) resolvedCode = 'AUTHENTICATION_FAILED'
    else if (status === 404 || /model.*not found|unknown model|unsupported model/.test(detail)) resolvedCode = 'INVALID_MODEL'
    else if ([502, 503, 504].includes(status) || /service unavailable|provider unavailable/.test(detail)) resolvedCode = 'PROVIDER_UNAVAILABLE'
    else if (/not configured|missing.*api.?key/.test(detail)) resolvedCode = 'MISSING_CONFIGURATION'
    else if (/empty response/.test(detail)) resolvedCode = 'EMPTY_RESPONSE'
    else if (/malformed|invalid json|unexpected token/.test(detail)) resolvedCode = 'MALFORMED_RESPONSE'
    else if (/timeout|network|fetch|connection|unavailable/.test(detail)) resolvedCode = 'NETWORK_FAILURE'
    else resolvedCode = 'UNKNOWN'
  }

  const providerName = getProvider(provider)?.name || getVoiceProvider(provider)?.name || 'The AI provider'
  const globalError = ['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_INVALID', 'AUTHENTICATION_UNAVAILABLE', 'CORS_ORIGIN_DENIED'].includes(resolvedCode)
  const retryable = ['RATE_LIMITED', 'RATE_LIMIT_BACKEND_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'NETWORK_FAILURE', 'MALFORMED_RESPONSE', 'EMPTY_RESPONSE', 'UNKNOWN', 'AUTHENTICATION_UNAVAILABLE'].includes(resolvedCode)
  const resolvedStatus = Number.isInteger(status)
    ? status
    : resolvedCode === 'AUTHENTICATION_REQUIRED' || resolvedCode === 'AUTHENTICATION_INVALID' ? 401
      : resolvedCode === 'CORS_ORIGIN_DENIED' ? 403
      : resolvedCode === 'REQUEST_INVALID' || resolvedCode === 'INVALID_MODEL' || resolvedCode === 'GEMINI_REQUEST_INVALID' || resolvedCode === 'GEMINI_BILLING_OR_REGION_REQUIRED' ? 400
      : resolvedCode === 'RATE_LIMITED' ? 429
        : resolvedCode === 'MISSING_CONFIGURATION' || resolvedCode === 'AUTHENTICATION_UNAVAILABLE' || resolvedCode === 'RATE_LIMIT_BACKEND_UNAVAILABLE' ? 503
          : 502

  return {
    code: resolvedCode,
    message: globalError
      ? (ERROR_MESSAGES[resolvedCode] || ERROR_MESSAGES.UNKNOWN)
      : resolvedCode === 'MISSING_CONFIGURATION'
        ? missingConfigurationMessage(provider, providerName)
      : providerName + ' ' + (ERROR_MESSAGES[resolvedCode] || ERROR_MESSAGES.UNKNOWN),
    retryable,
    status: resolvedStatus,
  }
}
