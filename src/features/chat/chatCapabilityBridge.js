/**
 * Compatibility adapter between the shared connector framework and existing
 * Chat handoff surfaces. Connector discovery, readiness, and selection live
 * in chatConnectorFramework; this file only exposes the compact route shape
 * already consumed by the current Chat UI.
 */

import { isChatExecutionActionId } from './chatExecutionVocabulary.js'
import {
  getChatConnectorPlan,
  getConnectorPlanGuidance,
  getConnectorRegistryEntry,
  normalizeConnectorPlan,
} from './chatConnectorFramework.js'

const MAX_ROUTES = 3
const CAPABILITY_IDS = new Set(['notes', 'tasks', 'builder', 'code', 'github', 'youtube', 'email', 'calendar', 'external-app'])
const CAPABILITY_KINDS = new Set(['workspace', 'tool', 'integration'])
const AVAILABILITY = new Set(['available', 'connected', 'not-installed', 'not-configured', 'not-connected', 'read-only', 'unauthorized', 'unavailable', 'not-implemented'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function capabilityAvailability(connector) {
  if (!connector) return 'unavailable'
  // Public read actions (for example an explicit public GitHub inspection)
  // may be available without granting write access to that connector.
  if (connector.actionReadiness === 'available' && connector.kind === 'integration' && connector.readiness !== 'writable') return 'available'
  if (connector.readiness === 'not-installed') return 'not-installed'
  if (connector.readiness === 'not-configured') return 'not-configured'
  if (connector.readiness === 'not-authorized') return 'unauthorized'
  if (connector.readiness === 'read-only') return 'read-only'
  if (connector.readiness === 'temporarily-unavailable') return 'unavailable'
  if (connector.kind === 'integration') return 'connected'
  return 'available'
}

function actionFor(connector) {
  return isChatExecutionActionId(connector?.action) ? connector.action : ''
}

function fromConnectorPlan(value) {
  const plan = normalizeConnectorPlan(value)
  if (!plan || plan.decision === 'chat-only') return null
  const routes = plan.connectors
    .filter((connector) => CAPABILITY_IDS.has(connector.id) && CAPABILITY_KINDS.has(connector.kind))
    .slice(0, MAX_ROUTES)
    .map((connector) => Object.freeze({
      id: connector.id,
      kind: connector.kind,
      availability: capabilityAvailability(connector),
      ...(actionFor(connector) ? { action: actionFor(connector) } : {}),
    }))
  if (!routes.length) return null
  const primary = routes.some((route) => route.id === plan.primary) ? plan.primary : routes[0].id
  return Object.freeze({ version: 1, primary, routes: Object.freeze(routes) })
}

/** Persist only compact route IDs and readiness; detailed connector state is kept in connectorPlan. */
export function normalizeCapabilityBridge(value) {
  if (!isRecord(value) || !Array.isArray(value.routes)) return null
  const seen = new Set()
  const routes = value.routes.reduce((items, route) => {
    if (!isRecord(route) || !CAPABILITY_IDS.has(route.id) || seen.has(route.id)) return items
    if (!CAPABILITY_KINDS.has(route.kind) || !AVAILABILITY.has(route.availability)) return items
    const action = isChatExecutionActionId(route.action) ? route.action : ''
    seen.add(route.id)
    items.push(Object.freeze({ id: route.id, kind: route.kind, availability: route.availability, ...(action ? { action } : {}) }))
    return items
  }, []).slice(0, MAX_ROUTES)
  if (!routes.length) return null
  const primary = CAPABILITY_IDS.has(value.primary) && routes.some((route) => route.id === value.primary) ? value.primary : routes[0].id
  return Object.freeze({ version: 1, primary, routes: Object.freeze(routes) })
}

/**
 * Existing callers may pass a connector plan to avoid recomputation. New
 * connector implementations only need the shared framework, not Chat regexes.
 */
export function getChatCapabilityBridge({ request = '', intent = null, executionBridge = null, executionWorkflow = null, integrations = null, connectorPlan = null } = {}) {
  const plan = normalizeConnectorPlan(connectorPlan) || getChatConnectorPlan({ request, intent, executionBridge, executionWorkflow, integrations })
  return fromConnectorPlan(plan)
}

function labelFor(route) {
  return getConnectorRegistryEntry(route?.id)?.label || 'FounderLab capability'
}

/** Provider-neutral boundary guidance remains derived from the shared plan. */
export function getCapabilityBridgeGuidance(value) {
  const bridge = normalizeCapabilityBridge(value)
  if (!bridge) return ''
  const route = bridge.routes.find((item) => item.id === bridge.primary) || bridge.routes[0]
  const label = labelFor(route)
  if (route.availability === 'not-installed') return `${label} is available as a future connector but is not installed. Do not claim access; offer manual guidance or the recorded fallback instead.`
  if (route.availability === 'not-configured') return `${label} is installed but not configured for this workspace. Do not claim connection or external execution; state setup as the required next step.`
  if (route.availability === 'unauthorized') return `${label} is configured but not authorized for this workflow. Do not retry a mutation until the user reconnects with the required permission.`
  if (route.availability === 'read-only') return `${label} is connected only for read-only work. Do not claim a branch or file mutation is available; request writable authorization before an explicit change action.`
  if (route.availability === 'unavailable') return `${label} is temporarily unavailable. Do not claim an action ran; offer the safe fallback or manual guidance.`
  if (route.kind === 'integration' && route.availability === 'connected') return `${label} is connected for this browser session, but connection is not proof that a repository, branch, pull request, or external action was inspected or changed. Keep execution explicit and evidence-based.`
  return `${label} is an available FounderLab route. Offer its explicit action only when it helps; never claim the action was taken until recorded evidence exists.`
}

/** Compact presentation for legacy Operator report consumers. */
export function getCapabilityBridgePresentation(value) {
  const bridge = normalizeCapabilityBridge(value)
  if (!bridge) return null
  const route = bridge.routes.find((item) => item.id === bridge.primary) || bridge.routes[0]
  const label = labelFor(route)
  const copy = {
    'not-installed': { state: 'connector-install-needed', label: `Capability route: ${label} available to install`, detail: `${label} is not installed. FounderLab did not attempt an external action.` },
    'not-configured': { state: 'connector-configuration-needed', label: `Capability route: ${label} setup needed`, detail: `${label} is installed but not configured for this workspace. FounderLab did not attempt an external action.` },
    unauthorized: { state: 'authorization-needed', label: `Capability route: ${label} authorization needed`, detail: `${label} is configured but not authorized for this workflow. FounderLab did not attempt a mutation.` },
    'read-only': { state: 'read-only-integration', label: `Capability route: ${label} read-only`, detail: `${label} can support inspection, but writable authorization is required before a branch or file mutation.` },
    unavailable: { state: 'connector-unavailable', label: `Capability route: ${label} temporarily unavailable`, detail: `${label} is temporarily unavailable. FounderLab did not attempt an external action.` },
    connected: { state: 'integration-ready', label: `Capability route: ${label} available`, detail: `${label} is connected for this browser session; no external action is confirmed.` },
    available: { state: 'founderlab-route-available', label: `Capability route: ${label} available`, detail: `${label} can be continued with an explicit FounderLab action.` },
  }[route.availability]
  return Object.freeze({ id: route.id, ...copy })
}

/** Return only a real internal handoff; uninstalled/blocked integrations never manufacture a button. */
export function getCapabilityBridgeHandoffAction(value) {
  const bridge = normalizeCapabilityBridge(value)
  if (!bridge) return ''
  const route = bridge.routes.find((item) => item.id === bridge.primary) || bridge.routes[0]
  if (!route?.action || !isChatExecutionActionId(route.action)) return ''
  if (route.kind === 'integration' && route.availability !== 'connected') return ''
  return route.action
}

export function getConnectorBridgeGuidance(connectorPlan) {
  return getConnectorPlanGuidance(connectorPlan)
}
