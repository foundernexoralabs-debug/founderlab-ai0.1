import { getProvider, getProviderModel } from '../../ai/providerRegistry.js'
import { getLocalModelCapabilities } from '../../ai/localModelCapabilities.js'

export const CHAT_ROUTING_VERSION = 1

const ROUTING_CLASSES = Object.freeze(['conversation', 'planning', 'code', 'execution'])
const ROUTING_PATHS = Object.freeze(['cloud', 'local'])
const CLOUD_PROVIDER_ORDER = Object.freeze({
  conversation: Object.freeze(['groq', 'gemini', 'anthropic']),
  planning: Object.freeze(['anthropic', 'gemini', 'groq']),
  code: Object.freeze(['anthropic', 'gemini', 'groq']),
  execution: Object.freeze(['anthropic', 'gemini', 'groq']),
})
const ROUTING_MODEL_PREFERENCES = Object.freeze({
  anthropic: Object.freeze({
    conversation: 'claude-haiku-4-5-20251001',
    planning: 'claude-sonnet-4-6',
    code: 'claude-sonnet-4-6',
    execution: 'claude-sonnet-4-6',
  }),
  groq: Object.freeze({
    conversation: 'openai/gpt-oss-20b',
    planning: 'openai/gpt-oss-120b',
    code: 'openai/gpt-oss-120b',
    execution: 'openai/gpt-oss-120b',
  }),
  gemini: Object.freeze({
    conversation: 'gemini-3.5-flash',
    planning: 'gemini-2.5-pro',
    code: 'gemini-2.5-pro',
    execution: 'gemini-2.5-pro',
  }),
})

const LOCAL_REQUEST_TERMS = Object.freeze(['local', 'ollama', 'private', 'on device', 'on-device', 'offline'])
const CLOUD_REQUEST_TERMS = Object.freeze(['cloud', 'claude', 'anthropic', 'gemini', 'groq'])
const HIGH_REASONING_TERMS = Object.freeze([
  'architecture', 'tradeoff', 'trade-off', 'strategy', 'roadmap', 'migration', 'security review', 'audit',
  'root cause', 'multi step', 'multi-step', 'complex', 'compare', 'analyze', 'analysis', 'research',
])

function safeText(value, limit = 220) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function normalizedText(value) {
  return safeText(value, 800).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function hasTerm(value, term) {
  const normalized = ` ${normalizedText(value)} `
  const candidate = ` ${normalizedText(term)} `
  return Boolean(candidate.trim()) && normalized.includes(candidate)
}

function includesAny(value, terms) {
  return terms.some((term) => hasTerm(value, term))
}

function cleanProvider(providerId) {
  return getProvider(typeof providerId === 'string' ? providerId.trim() : '')?.id || ''
}

function cleanModel(providerId, modelId) {
  const model = safeText(modelId, 160)
  if (!model) return ''
  const provider = getProvider(providerId)
  if (provider?.capabilities.dynamicModels) return model
  return getProviderModel(providerId, model)?.id || ''
}

function cleanSelection(value) {
  const provider = cleanProvider(value?.provider || value?.id)
  const model = cleanModel(provider, value?.model || value?.modelId)
  if (!provider || !model) return Object.freeze({ provider: '', model: '', path: '' })
  return Object.freeze({
    provider,
    model,
    path: getProvider(provider)?.capabilities.local ? 'local' : 'cloud',
  })
}

function normalizeLocalModels(localModels) {
  const seen = new Set()
  return Object.freeze((Array.isArray(localModels) ? localModels : []).reduce((models, entry) => {
    const id = safeText(typeof entry === 'string' ? entry : entry?.id, 160)
    if (!id || seen.has(id)) return models
    seen.add(id)
    const capabilities = getLocalModelCapabilities(id)
    models.push(Object.freeze({ id, codeReady: capabilities.codeGeneration }))
    return models
  }, []))
}

function routingClass(intent, request, projectAwareness) {
  if (intent?.primaryTool === 'code' || /\b(?:code|component|api|test|debug|refactor|implementation)\b/i.test(request)) return 'code'
  if (intent?.primaryTool === 'github' || ['change', 'inspect', 'handoff'].includes(intent?.operation)) return 'execution'
  if (intent?.requiresPlan || intent?.primaryTool === 'builder' || projectAwareness?.artifact === 'plan') return 'planning'
  if (intent?.isOperational || ['create', 'change', 'inspect', 'handoff'].includes(intent?.operation)) return 'execution'
  return 'conversation'
}

function getReasoningLevel(request, taskClass) {
  if (taskClass === 'planning' || taskClass === 'execution' || includesAny(request, HIGH_REASONING_TERMS)) return 'high'
  if (taskClass === 'code') return 'focused'
  return 'light'
}

function getCloudCandidate(providerId, taskClass) {
  const provider = getProvider(providerId)
  if (!provider || provider.capabilities.local) return null
  const preferredModel = ROUTING_MODEL_PREFERENCES[providerId]?.[taskClass] || provider.default
  const model = getProviderModel(providerId, preferredModel)?.id || provider.default
  if (!model) return null
  return Object.freeze({ provider: provider.id, model, path: 'cloud' })
}

function configuredCloudCandidates(availability, taskClass) {
  return Object.freeze((CLOUD_PROVIDER_ORDER[taskClass] || CLOUD_PROVIDER_ORDER.conversation)
    .filter((providerId) => availability?.[providerId]?.configured === true)
    .map((providerId) => getCloudCandidate(providerId, taskClass))
    .filter(Boolean))
}

function localCandidate(localModels, { codeOnly = false } = {}) {
  const candidate = localModels.find((model) => codeOnly ? model.codeReady : true)
  return candidate ? Object.freeze({ provider: 'ollama', model: candidate.id, path: 'local' }) : null
}

function selectionAvailability(selection, availability, localModels) {
  if (!selection.provider || !selection.model) return 'missing'
  if (selection.path === 'local') return localModels.some((model) => model.id === selection.model) ? 'available' : 'unavailable'
  return availability?.[selection.provider]?.configured === true ? 'available' : 'unavailable'
}

function currentFit(selection, { taskClass, explicitLocal, hasImage, localModels, availability }) {
  const availabilityState = selectionAvailability(selection, availability, localModels)
  if (availabilityState !== 'available') return 'unavailable'
  if (hasImage && selection.provider !== 'anthropic') return 'limited'
  if (selection.path === 'local') {
    const codeReady = getLocalModelCapabilities(selection.model).codeGeneration
    if (taskClass === 'code' && !codeReady) return 'limited'
    if (['planning', 'execution'].includes(taskClass) && !explicitLocal) return 'limited'
  }
  return 'good'
}

function reasonFor({ taskClass, path, explicitLocal, hasImage, currentFit: fit }) {
  if (hasImage) return 'Image context needs a configured vision-capable cloud model.'
  if (path === 'local' && ['planning', 'execution'].includes(taskClass)) return explicitLocal
    ? 'You asked for a local path. It can support a focused first pass, while a configured cloud reasoning model is stronger for this deeper work.'
    : 'No configured cloud reasoning path is available. This local model is a constrained fallback for a focused first pass, not proof that execution happened.'
  if (path === 'local' && taskClass === 'code') return 'A local coding model is a strong fit for focused private code work.'
  if (path === 'local') return explicitLocal
    ? 'You asked for a private local path, and a local model is available.'
    : 'A local model is available for this focused request.'
  if (taskClass === 'planning') return 'This is a multi-step planning request; a cloud reasoning model is the stronger fit.'
  if (taskClass === 'code') return 'This code request benefits from a capable cloud coding and reasoning path.'
  if (taskClass === 'execution') return 'This operational request benefits from a cloud model for broader reasoning and planning.'
  if (fit === 'unavailable') return 'The previously selected path is not available, so this is the best configured alternative.'
  return 'This configured cloud model is a fast fit for a general conversation.'
}

function preferenceKind(request) {
  if (includesAny(request, LOCAL_REQUEST_TERMS)) return 'local'
  if (includesAny(request, CLOUD_REQUEST_TERMS)) return 'cloud'
  return ''
}

function displayTaskClass(taskClass) {
  return {
    conversation: 'conversation',
    planning: 'planning',
    code: 'code work',
    execution: 'operator work',
  }[taskClass] || 'conversation'
}

/**
 * Deterministic, inspectable model-route recommendation for Chat. It never
 * executes, changes a provider preference, or treats a recommendation as a
 * capability guarantee. The selected provider remains the user’s choice.
 */
export function getChatModelRouting({
  request = '',
  intent = null,
  projectAwareness = null,
  availability = {},
  currentSelection = null,
  localModels = [],
  hasImage = false,
} = {}) {
  const taskClass = routingClass(intent, request, projectAwareness)
  const local = normalizeLocalModels(localModels)
  const current = cleanSelection(currentSelection)
  const explicitPreference = preferenceKind(request)
  const explicitLocal = explicitPreference === 'local'
  const explicitCloud = explicitPreference === 'cloud'
  const fit = currentFit(current, { taskClass, explicitLocal, hasImage, localModels: local, availability })
  const cloud = configuredCloudCandidates(availability, taskClass)
  const codeLocal = localCandidate(local, { codeOnly: true })
  const generalLocal = localCandidate(local)
  const currentLocalFallback = current.path === 'local' && selectionAvailability(current, availability, local) === 'available'
    ? current
    : codeLocal || generalLocal
  let recommendation = null

  if (hasImage) {
    recommendation = cloud.find((candidate) => candidate.provider === 'anthropic') || null
  } else if (explicitLocal) {
    recommendation = taskClass === 'code' ? codeLocal : generalLocal
  } else if (explicitCloud) {
    recommendation = cloud[0] || null
  } else if (current.path === 'cloud' && fit === 'good') {
    // A configured cloud route is already a capable, deliberate choice. The
    // advisor should not churn models or steer users toward another provider
    // just because it ranks first in a generic preference list.
    recommendation = current
  } else if (taskClass === 'code' && current.path === 'local' && codeLocal) {
    recommendation = codeLocal
  } else if (['planning', 'execution'].includes(taskClass)) {
    recommendation = cloud[0] || currentLocalFallback
  } else if (taskClass === 'code') {
    recommendation = cloud[0] || codeLocal
  } else if (current.path === 'local' && fit === 'good') {
    recommendation = current
  } else {
    recommendation = cloud[0] || generalLocal
  }

  if (!recommendation && fit === 'good') recommendation = current
  const selectedMatchesRecommendation = Boolean(recommendation
    && current.provider === recommendation.provider
    && current.model === recommendation.model)
  const shouldOfferSwitch = Boolean(recommendation && !selectedMatchesRecommendation && (fit !== 'good' || explicitPreference || taskClass !== 'conversation'))
  const reason = recommendation ? reasonFor({
    taskClass,
    path: recommendation.path,
    explicitLocal,
    hasImage,
    currentFit: fit,
  }) : 'No configured provider path is available for this request yet.'

  return Object.freeze({
    version: CHAT_ROUTING_VERSION,
    taskClass,
    reasoningLevel: getReasoningLevel(request, taskClass),
    ...(safeText(request) ? { hasRequest: true } : {}),
    ...(explicitPreference ? { preference: explicitPreference } : {}),
    ...(hasImage ? { requiresImage: true } : {}),
    current: Object.freeze({ ...current, fit }),
    ...(recommendation ? { recommendation: Object.freeze({ ...recommendation }) } : {}),
    shouldOfferSwitch,
    summary: `${displayTaskClass(taskClass)} · ${recommendation?.path === 'local' ? 'local path' : recommendation?.path === 'cloud' ? 'cloud path' : 'route unavailable'}`,
    reason,
  })
}

/** Safe, bounded message metadata for auditing a selected route later. */
export function getChatRoutingEvidence(routing) {
  if (!routing || !ROUTING_CLASSES.includes(routing.taskClass)) return null
  const selection = cleanSelection(routing.current)
  const recommendation = cleanSelection(routing.recommendation)
  if (!selection.provider || !selection.model) return null
  return Object.freeze({
    version: CHAT_ROUTING_VERSION,
    taskClass: routing.taskClass,
    reasoningLevel: ['light', 'focused', 'high'].includes(routing.reasoningLevel) ? routing.reasoningLevel : 'light',
    selected: selection,
    ...(recommendation.provider && recommendation.model ? { recommendation } : {}),
  })
}

export function getChatModelRoutingGuidance(routing) {
  if (!routing?.hasRequest || !routing.current?.provider) return ''
  const selected = routing.current.path === 'local' ? 'a local Ollama model' : 'a cloud model'
  const suitability = routing.current.fit === 'unavailable'
    ? 'That path is not currently verified as available. Do not imply another provider was selected or that a request was executed.'
    : routing.current.fit === 'limited'
      ? 'The UI may offer a better-fitting route; do not imply it was switched automatically.'
      : 'Use the user-selected route as the active path for this reply.'
  return `This is classified as ${displayTaskClass(routing.taskClass)} with ${routing.reasoningLevel || 'light'} reasoning needs. The user selected ${selected}. ${suitability}`
}
