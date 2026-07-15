const CONNECTION_STATES = Object.freeze({
  not_configured: Object.freeze({ state: 'not_configured', label: 'Not configured' }),
  local: Object.freeze({ state: 'local', label: 'Local only — test connection' }),
  ready: Object.freeze({ state: 'ready', label: 'Ready to test' }),
  testing: Object.freeze({ state: 'testing', label: 'Testing' }),
  connected: Object.freeze({ state: 'connected', label: 'Connected' }),
  failed: Object.freeze({ state: 'failed', label: 'Failed' }),
})

const providerConnectionStatuses = new Map()
const connectionStatusListeners = new Set()

const PROVIDER_EXECUTION_ERROR_CODES = new Set([
  'MISSING_CONFIGURATION',
  'INVALID_MODEL',
  'AUTHENTICATION_FAILED',
  'PROVIDER_UNAVAILABLE',
  'MALFORMED_RESPONSE',
  'EMPTY_RESPONSE',
  'REQUEST_INVALID',
  'GEMINI_REQUEST_INVALID',
  'GEMINI_BILLING_OR_REGION_REQUIRED',
])

function publishConnectionStatuses() {
  const snapshot = getProviderConnectionStatuses()
  connectionStatusListeners.forEach((listener) => listener(snapshot))
}

export function getProviderConnectionState(configuration, testState) {
  if (testState && CONNECTION_STATES[testState]) return CONNECTION_STATES[testState]
  return CONNECTION_STATES[configuration] || CONNECTION_STATES.not_configured
}

export function getProviderConnectionStatus(providerId) {
  return providerConnectionStatuses.get(providerId) || ''
}

export function getProviderConnectionStatuses() {
  return Object.fromEntries(providerConnectionStatuses)
}

export function setProviderConnectionStatus(providerId, state) {
  if (!providerId || !CONNECTION_STATES[state] || providerConnectionStatuses.get(providerId) === state) return false
  providerConnectionStatuses.set(providerId, state)
  publishConnectionStatuses()
  return true
}

export function recordProviderConnectionResult(providerId, result, { connectionTest = false } = {}) {
  if (!providerId || !result) return
  if (result.ok) {
    setProviderConnectionStatus(providerId, 'connected')
    return
  }

  const code = result.error?.code
  if (!PROVIDER_EXECUTION_ERROR_CODES.has(code)) return
  if (connectionTest && getProviderConnectionStatus(providerId) === 'connected') return
  setProviderConnectionStatus(providerId, code === 'MISSING_CONFIGURATION' ? 'not_configured' : 'failed')
}

export function subscribeProviderConnectionStatuses(listener) {
  if (typeof listener !== 'function') return () => {}
  connectionStatusListeners.add(listener)
  return () => connectionStatusListeners.delete(listener)
}

export function resetProviderConnectionStatuses() {
  providerConnectionStatuses.clear()
  publishConnectionStatuses()
}
