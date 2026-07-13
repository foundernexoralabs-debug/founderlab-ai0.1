const CONNECTION_STATES = Object.freeze({
  not_configured: Object.freeze({ state: 'not_configured', label: 'Not configured' }),
  local: Object.freeze({ state: 'local', label: 'Local only — test connection' }),
  ready: Object.freeze({ state: 'ready', label: 'Ready to test' }),
  testing: Object.freeze({ state: 'testing', label: 'Testing' }),
  connected: Object.freeze({ state: 'connected', label: 'Connected' }),
  failed: Object.freeze({ state: 'failed', label: 'Failed' }),
})

export function getProviderConnectionState(configuration, testState) {
  if (testState && CONNECTION_STATES[testState]) return CONNECTION_STATES[testState]
  return CONNECTION_STATES[configuration] || CONNECTION_STATES.not_configured
}
