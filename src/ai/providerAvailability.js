import { PROVIDER_IDS, isSupportedProvider } from './providerRegistry.js'

function isConfigured(entry) {
  return entry?.configured === true
}

/**
 * Provider-key availability is discovered by the authenticated server endpoint.
 * This module deliberately stores booleans only; provider keys never cross the
 * browser boundary.
 */
export function normalizeProviderAvailability(input) {
  return Object.freeze(Object.fromEntries(PROVIDER_IDS.map((providerId) => [providerId, Object.freeze({
    configured: isConfigured(input?.[providerId]),
    local: input?.[providerId]?.local === true,
  })])))
}

export function resolveConfiguredProvider(preferredProviderId, availability) {
  const normalized = normalizeProviderAvailability(availability)
  if (isSupportedProvider(preferredProviderId) && normalized[preferredProviderId].configured) {
    return preferredProviderId
  }
  return PROVIDER_IDS.find((providerId) => normalized[providerId].configured) || ''
}

export function getProviderConfigurationState(providerId, availability) {
  const provider = normalizeProviderAvailability(availability)[providerId]
  if (!provider) return 'unknown'
  if (!provider.configured) return 'not_configured'
  return provider.local ? 'local' : 'ready'
}
