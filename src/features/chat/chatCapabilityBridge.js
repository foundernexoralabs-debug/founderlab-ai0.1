/**
 * The capability bridge is a small, declarative inventory of routes Chat can
 * safely prepare today. It separates a real FounderLab action from an
 * external integration that still needs connection, so Chat never turns a
 * route recommendation into an unverified tool claim.
 */

const MAX_ROUTES = 3
const CAPABILITY_IDS = new Set(['notes', 'tasks', 'builder', 'code', 'github', 'youtube', 'email', 'calendar', 'external-app'])
const CAPABILITY_KINDS = new Set(['workspace', 'tool', 'integration'])
const AVAILABILITY = new Set(['available', 'connected', 'not-connected', 'not-implemented'])
const ACTION_IDS = new Set(['save-note', 'create-task', 'builder', 'code', 'github', 'youtube'])

const CAPABILITY_COPY = Object.freeze({
  notes: Object.freeze({ label: 'Notes', kind: 'workspace', action: 'save-note' }),
  tasks: Object.freeze({ label: 'Tasks', kind: 'workspace', action: 'create-task' }),
  builder: Object.freeze({ label: 'Builder', kind: 'tool', action: 'builder' }),
  code: Object.freeze({ label: 'Code AI', kind: 'tool', action: 'code' }),
  github: Object.freeze({ label: 'GitHub', kind: 'integration', action: 'github' }),
  youtube: Object.freeze({ label: 'YouTube AI', kind: 'tool', action: 'youtube' }),
  email: Object.freeze({ label: 'Email', kind: 'integration' }),
  calendar: Object.freeze({ label: 'Calendar', kind: 'integration' }),
  'external-app': Object.freeze({ label: 'External app', kind: 'integration' }),
})

const EMAIL_TERMS = Object.freeze(['email', 'mail', 'gmail', 'outreach'])
const CALENDAR_TERMS = Object.freeze(['calendar', 'schedule', 'meeting', 'invite'])
const EXTERNAL_APP_TERMS = Object.freeze(['slack', 'notion', 'linear', 'jira', 'airtable', 'hubspot', 'zapier', 'composio', 'integration', 'connector'])
const EXTERNAL_ACTION_TERMS = Object.freeze(['send', 'schedule', 'book', 'post', 'sync', 'connect'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value, limit = 900) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
    : ''
}

function mentionsAny(value, terms) {
  const padded = ` ${normalizeText(value)} `
  return terms.some((term) => padded.includes(` ${normalizeText(term)} `))
}

function getIntegrationAvailability(integrations, id) {
  if (id === 'github') return integrations?.github?.connected === true ? 'connected' : 'not-connected'
  if (['email', 'calendar', 'external-app'].includes(id)) return 'not-connected'
  return 'available'
}

function createRoute(id, integrations) {
  const definition = CAPABILITY_COPY[id]
  if (!definition) return null
  const availability = getIntegrationAvailability(integrations, id)
  return Object.freeze({
    id,
    kind: definition.kind,
    availability,
    ...(definition.action ? { action: definition.action } : {}),
  })
}

/** Persist only stable route IDs and connection state—never connector tokens, account data, or request text. */
export function normalizeCapabilityBridge(value) {
  if (!isRecord(value) || !Array.isArray(value.routes)) return null
  const seen = new Set()
  const routes = value.routes.reduce((items, route) => {
    if (!isRecord(route) || !CAPABILITY_IDS.has(route.id) || seen.has(route.id)) return items
    const definition = CAPABILITY_COPY[route.id]
    if (!definition || !CAPABILITY_KINDS.has(route.kind) || route.kind !== definition.kind || !AVAILABILITY.has(route.availability)) return items
    const action = ACTION_IDS.has(route.action) && route.action === definition.action ? route.action : ''
    seen.add(route.id)
    items.push(Object.freeze({ id: route.id, kind: route.kind, availability: route.availability, ...(action ? { action } : {}) }))
    return items
  }, []).slice(0, MAX_ROUTES)
  if (!routes.length) return null
  const primary = CAPABILITY_IDS.has(value.primary) && routes.some((route) => route.id === value.primary)
    ? value.primary
    : routes[0].id
  return Object.freeze({ version: 1, primary, routes: Object.freeze(routes) })
}

function routeIdForTool(primaryTool) {
  return ['builder', 'code', 'github', 'youtube'].includes(primaryTool) ? primaryTool : ''
}

function inferRepositoryRoute(request, executionBridge) {
  if (executionBridge?.target?.surface === 'repository' || executionBridge?.target?.surface === 'github') return 'github'
  return ''
}

function requestsExternalAction(request, intent) {
  const normalized = normalizeText(request)
  if (!normalized) return false
  if (/^(?:how|what|why|when|where|should|can i)\b/.test(normalized)) return false
  if (intent?.isOperational) return true
  if (mentionsAny(request, EXTERNAL_ACTION_TERMS)) return true
  return /^(?:please )?(?:email|mail|schedule|book)\b/.test(normalized)
}

/**
 * Map a request to the small set of routes FounderLab can accurately expose.
 * A non-connected external route remains visible as a requirement, not a
 * button that pretends to send, sync, or modify something.
 */
export function getChatCapabilityBridge({ request = '', intent = null, executionBridge = null, integrations = null } = {}) {
  const routeIds = []
  const add = (id) => {
    if (id && !routeIds.includes(id) && routeIds.length < MAX_ROUTES) routeIds.push(id)
  }
  if (intent?.wantsTask) add('tasks')
  if (intent?.wantsNote) add('notes')
  add(routeIdForTool(intent?.primaryTool))
  add(inferRepositoryRoute(request, executionBridge))
  if (requestsExternalAction(request, intent)) {
    if (mentionsAny(request, EMAIL_TERMS)) add('email')
    if (mentionsAny(request, CALENDAR_TERMS)) add('calendar')
    if (mentionsAny(request, EXTERNAL_APP_TERMS)) add('external-app')
  }
  const routes = routeIds.map((id) => createRoute(id, integrations)).filter(Boolean)
  if (!routes.length) return null
  const external = routes.find((route) => route.kind === 'integration' && route.availability !== 'connected')
  return normalizeCapabilityBridge({
    primary: external?.id || routes[0].id,
    routes,
  })
}

function routeLabel(route) {
  return CAPABILITY_COPY[route?.id]?.label || 'FounderLab capability'
}

/** Provider-neutral boundary guidance for model responses. */
export function getCapabilityBridgeGuidance(value) {
  const bridge = normalizeCapabilityBridge(value)
  if (!bridge) return ''
  const notes = bridge.routes.map((route) => {
    const label = routeLabel(route)
    if (route.kind === 'integration' && route.availability === 'not-connected') {
      return `${label} is an external integration route that is not connected for this workspace. Do not claim an email, repository mutation, sync, or external app action occurred. Provide the useful draft or plan now and label connection as the required next step.`
    }
    if (route.kind === 'integration' && route.availability === 'connected') {
      return `${label} is connected for this browser session, but connection is not proof that a repository, branch, pull request, or external action was inspected or changed. Keep execution explicit and evidence-based.`
    }
    return `${label} is an available FounderLab route. Offer its explicit action only when it helps; never claim the action was taken until recorded evidence exists.`
  })
  return notes.join(' ')
}

/** Compact presentation for the existing Operator report, with no connector internals. */
export function getCapabilityBridgePresentation(value) {
  const bridge = normalizeCapabilityBridge(value)
  if (!bridge) return null
  const route = bridge.routes.find((item) => item.id === bridge.primary) || bridge.routes[0]
  const label = routeLabel(route)
  if (route.kind === 'integration' && route.availability === 'not-connected') {
    return Object.freeze({
      id: route.id,
      state: 'external-integration-needed',
      label: `Capability route: ${label} connection needed`,
      detail: `${label} is not connected for this workspace. FounderLab did not attempt an external action.`,
    })
  }
  if (route.kind === 'integration' && route.availability === 'connected') {
    return Object.freeze({
      id: route.id,
      state: 'integration-ready',
      label: `Capability route: ${label} available`,
      detail: `${label} is available for a future explicit workflow; no external action is confirmed.`,
    })
  }
  return Object.freeze({
    id: route.id,
    state: 'founderlab-route-available',
    label: `Capability route: ${label} available`,
    detail: `${label} can be continued with an explicit FounderLab action.`,
  })
}

/** Return only a real internal action; external integrations never manufacture an action button. */
export function getCapabilityBridgeHandoffAction(value) {
  const bridge = normalizeCapabilityBridge(value)
  if (!bridge) return ''
  const route = bridge.routes.find((item) => item.id === bridge.primary) || bridge.routes[0]
  if (!route?.action || !ACTION_IDS.has(route.action)) return ''
  if (route.kind === 'integration' && route.availability !== 'connected') return ''
  return route.action
}
