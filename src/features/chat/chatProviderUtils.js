import { getProvider, getProviderModel, listProviders } from '../../ai/providerRegistry.js'

function configuredCloudProvider(provider, availability) {
  return provider.capabilities.local || availability?.[provider.id]?.configured === true
}

/**
 * The chat picker intentionally exposes only providers that can be used from
 * the current chat surface. Local Ollama remains available without a cloud
 * key; cloud entries appear only after the authenticated availability route
 * has confirmed that the server is configured for them.
 */
export function getChatProviderOptions(availability = {}) {
  return listProviders()
    .filter((provider) => configuredCloudProvider(provider, availability))
    .map((provider) => Object.freeze({
      id: provider.id,
      name: provider.name,
      icon: provider.icon,
      local: provider.capabilities.local === true,
      description: provider.capabilities.local ? 'Private · runs on this device' : 'Cloud · available for this workspace',
    }))
}

export function getChatModelOptions(providerId, { localModels = [], selectedModel = '' } = {}) {
  const provider = getProvider(providerId)
  if (!provider) return []

  if (!provider.capabilities.dynamicModels) {
    return provider.models
      .filter((model) => !model.internalOnly)
      .map((model) => Object.freeze({ id: model.id, label: model.label }))
  }

  const seen = new Set()
  const local = Array.isArray(localModels) ? localModels : []
  const options = local.reduce((items, model) => {
    const id = typeof model === 'string' ? model.trim() : typeof model?.id === 'string' ? model.id.trim() : ''
    if (!id || seen.has(id)) return items
    seen.add(id)
    const details = typeof model === 'object' && model ? [model.parameterSize, model.family].filter(Boolean).join(' · ') : ''
    items.push(Object.freeze({ id, label: details ? `${id} · ${details}` : id }))
    return items
  }, [])

  const remembered = typeof selectedModel === 'string' ? selectedModel.trim() : ''
  if (remembered && !seen.has(remembered)) options.unshift(Object.freeze({ id: remembered, label: remembered }))
  return options
}

export function getChatProviderPresentation(providerId, modelId) {
  const provider = getProvider(providerId)
  if (!provider) {
    return Object.freeze({ id: '', name: 'Choose a provider', model: 'Select a model', local: false, icon: '✦' })
  }
  const model = provider.capabilities.dynamicModels ? null : getProviderModel(providerId, modelId)
  return Object.freeze({
    id: provider.id,
    name: provider.name,
    model: model?.label || modelId || provider.default || 'Select a model',
    local: provider.capabilities.local === true,
    icon: provider.icon,
  })
}
