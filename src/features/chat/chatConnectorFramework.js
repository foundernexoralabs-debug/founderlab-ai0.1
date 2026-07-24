/**
 * Shared connector and tool framework for FounderLab Chat.
 *
 * A connector describes what FounderLab can route toward; it never claims an
 * external account, permission, or action exists without runtime evidence.
 * The plan derived here is compact enough to persist with a Chat reply and is
 * deliberately separate from any future connector executor.
 */

import {
  isChatConnectorAccess,
  isChatConnectorApproval,
  isChatConnectorAuthorization,
  isChatConnectorConfiguration,
  isChatConnectorEvidence,
  isChatConnectorHealth,
  isChatConnectorInstallation,
  isChatConnectorPlanDecision,
  isChatConnectorReadiness,
  isChatConnectorScope,
} from './chatExecutionVocabulary.js'

const MAX_CONNECTOR_ROUTES = 3
const CONNECTOR_IDS = new Set(['notes', 'tasks', 'builder', 'code', 'github', 'youtube', 'email', 'calendar', 'external-app'])
const CONNECTOR_KINDS = new Set(['workspace', 'tool', 'integration'])

const CONNECTOR_REGISTRY = Object.freeze({
  notes: Object.freeze({
    id: 'notes', label: 'Notes', kind: 'workspace', scope: 'founderlab',
    actions: Object.freeze([{ id: 'save-note', label: 'Save note', access: 'write', approval: 'not-required' }]),
    fallbacks: Object.freeze([]),
  }),
  tasks: Object.freeze({
    id: 'tasks', label: 'Tasks', kind: 'workspace', scope: 'founderlab',
    actions: Object.freeze([{ id: 'create-task', label: 'Create task', access: 'write', approval: 'not-required' }]),
    fallbacks: Object.freeze(['notes']),
  }),
  builder: Object.freeze({
    id: 'builder', label: 'Builder', kind: 'tool', scope: 'founderlab',
    actions: Object.freeze([{ id: 'builder', label: 'Open Builder handoff', access: 'write', approval: 'not-required' }]),
    fallbacks: Object.freeze(['code']),
  }),
  code: Object.freeze({
    id: 'code', label: 'Code AI', kind: 'tool', scope: 'founderlab',
    actions: Object.freeze([{ id: 'code', label: 'Open Code AI handoff', access: 'write', approval: 'not-required' }]),
    fallbacks: Object.freeze([]),
  }),
  github: Object.freeze({
    id: 'github', label: 'GitHub', kind: 'integration', scope: 'external',
    actions: Object.freeze([
      { id: 'inspect-repo', label: 'Inspect public repository', access: 'read', approval: 'not-required', publicRead: true },
      { id: 'create-branch', label: 'Create approved branch', access: 'write', approval: 'required' },
      { id: 'apply-file-change', label: 'Commit reviewed changes', access: 'write', approval: 'required' },
      { id: 'validate', label: 'Read commit validation', access: 'read', approval: 'not-required' },
    ]),
    fallbacks: Object.freeze(['code']),
  }),
  youtube: Object.freeze({
    id: 'youtube', label: 'YouTube AI', kind: 'tool', scope: 'founderlab',
    actions: Object.freeze([{ id: 'youtube', label: 'Open YouTube AI handoff', access: 'write', approval: 'not-required' }]),
    fallbacks: Object.freeze([]),
  }),
  email: Object.freeze({
    id: 'email', label: 'Email', kind: 'integration', scope: 'external',
    actions: Object.freeze([{ id: 'send-email', label: 'Send email', access: 'write', approval: 'required' }]),
    fallbacks: Object.freeze([]),
  }),
  calendar: Object.freeze({
    id: 'calendar', label: 'Calendar', kind: 'integration', scope: 'external',
    actions: Object.freeze([{ id: 'schedule-event', label: 'Schedule event', access: 'write', approval: 'required' }]),
    fallbacks: Object.freeze([]),
  }),
  'external-app': Object.freeze({
    id: 'external-app', label: 'External app', kind: 'integration', scope: 'external',
    actions: Object.freeze([{ id: 'external-action', label: 'Run external action', access: 'write', approval: 'required' }]),
    fallbacks: Object.freeze([]),
  }),
})

const EXTERNAL_SIGNALS = Object.freeze({
  email: Object.freeze(['email', 'mail', 'gmail', 'outreach']),
  calendar: Object.freeze(['calendar', 'schedule', 'meeting', 'invite']),
  'external-app': Object.freeze(['slack', 'notion', 'linear', 'jira', 'airtable', 'hubspot', 'zapier', 'composio', 'integration', 'connector']),
})

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, limit = 160) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function normalizedText(value) {
  return text(value, 900).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function mentionsAny(value, terms) {
  const padded = ` ${normalizedText(value)} `
  return terms.some((term) => padded.includes(` ${term} `))
}

function definitionFor(id) {
  return CONNECTOR_IDS.has(id) ? CONNECTOR_REGISTRY[id] || null : null
}

function defaultRuntime(definition) {
  if (!definition) return null
  if (definition.scope === 'founderlab') {
    return { installation: 'installed', configuration: 'not-applicable', authorization: 'not-applicable', access: 'writable', health: 'healthy' }
  }
  if (definition.id === 'github') {
    return { installation: 'installed', configuration: 'not-configured', authorization: 'not-authorized', access: 'not-applicable', health: 'healthy' }
  }
  return { installation: 'not-installed', configuration: 'not-applicable', authorization: 'not-applicable', access: 'not-applicable', health: 'healthy' }
}

/** Runtime state accepts only booleans and named states; credentials never enter the connector model. */
function runtimeFor(definition, integrations) {
  const fallback = defaultRuntime(definition)
  const runtime = integrations?.[definition.id]
  if (!isRecord(runtime)) return fallback
  if (runtime.temporarilyUnavailable === true || runtime.health === 'temporarily-unavailable') return { ...fallback, health: 'temporarily-unavailable' }
  const installation = runtime.installed === false ? 'not-installed' : runtime.installed === true ? 'installed' : fallback.installation
  const configuration = runtime.configured === true || runtime.connected === true ? 'configured'
    : runtime.configured === false ? 'not-configured'
      : fallback.configuration
  const authorization = runtime.authorization === 'authorized' ? 'authorized'
    : runtime.authorization === 'denied' || runtime.authorization === 'not-authorized' ? 'not-authorized'
      : runtime.connected === true && typeof runtime.writable === 'boolean' ? 'authorized'
        : fallback.authorization
  const access = runtime.writable === true ? 'writable'
    : runtime.writable === false ? 'read-only'
      : fallback.access
  const health = runtime.health === 'unavailable' ? 'unavailable' : fallback.health
  return { installation, configuration, authorization, access, health }
}

function readinessFor(runtime) {
  if (runtime.health === 'temporarily-unavailable' || runtime.health === 'unavailable') return 'temporarily-unavailable'
  if (runtime.installation === 'not-installed') return 'not-installed'
  if (runtime.configuration === 'not-configured') return 'not-configured'
  if (runtime.authorization === 'not-authorized') return 'not-authorized'
  if (runtime.access === 'read-only') return 'read-only'
  if (runtime.access === 'writable') return 'writable'
  return 'available'
}

function actionFor(definition, id) {
  return definition?.actions.find((action) => action.id === id) || null
}

function intendedActionFor(definition, { executionBridge = null, executionWorkflow = null } = {}) {
  if (!definition) return null
  if (definition.id === 'github') {
    if (executionWorkflow?.branch?.state === 'created' && executionWorkflow?.change?.state === 'prepared' && executionWorkflow?.approval === 'approved') {
      return actionFor(definition, 'apply-file-change')
    }
    if (executionWorkflow?.branch?.state === 'created' && executionWorkflow?.change?.state === 'applied') {
      return actionFor(definition, 'validate')
    }
    if (executionWorkflow?.approval === 'approved' && executionWorkflow?.branch?.state === 'planned') return actionFor(definition, 'create-branch')
    return actionFor(definition, 'inspect-repo')
  }
  return definition.actions[0] || null
}

function actionReadiness(definition, action, runtime, executionWorkflow) {
  if (!definition || !action) return 'temporarily-unavailable'
  if (action.publicRead === true && runtime.health === 'healthy') return 'available'
  const connectorReadiness = readinessFor(runtime)
  if (connectorReadiness !== 'available' && connectorReadiness !== 'writable') return connectorReadiness
  if (action.access === 'write' && runtime.access === 'read-only') return 'read-only'
  if (action.approval === 'required' && executionWorkflow?.approval !== 'approved') return 'approval-required'
  return 'available'
}

function createResolvedConnector(id, { integrations = null, executionBridge = null, executionWorkflow = null } = {}) {
  const definition = definitionFor(id)
  if (!definition) return null
  const runtime = runtimeFor(definition, integrations)
  const action = intendedActionFor(definition, { executionBridge, executionWorkflow })
  const readiness = readinessFor(runtime)
  const intendedReadiness = actionReadiness(definition, action, runtime, executionWorkflow)
  return Object.freeze({
    id: definition.id,
    kind: definition.kind,
    scope: definition.scope,
    installation: runtime.installation,
    configuration: runtime.configuration,
    authorization: runtime.authorization,
    access: runtime.access,
    health: runtime.health,
    readiness,
    ...(action ? { action: action.id, actionLabel: action.label, actionReadiness: intendedReadiness, approval: action.approval } : {}),
  })
}

function integrationSnapshotFromConnector(connector, executionWorkflow) {
  const snapshot = {
    ...(connector.installation === 'installed' ? { installed: true } : connector.installation === 'not-installed' ? { installed: false } : {}),
    ...(connector.configuration === 'configured' ? { configured: true, connected: true } : connector.configuration === 'not-configured' ? { configured: false } : {}),
    ...(connector.authorization === 'authorized' ? { authorization: 'authorized' } : connector.authorization === 'not-authorized' ? { authorization: 'not-authorized' } : {}),
    ...(connector.access === 'writable' ? { writable: true } : connector.access === 'read-only' ? { writable: false } : {}),
    ...(connector.health ? { health: connector.health } : {}),
  }
  if (connector.id !== 'github' || !executionWorkflow?.capability) return snapshot
  const capability = executionWorkflow.capability
  if (capability.connection === 'connected') {
    snapshot.configured = true
    snapshot.connected = true
  }
  if (capability.authorization === 'writable') {
    snapshot.authorization = 'authorized'
    snapshot.writable = true
  } else if (capability.authorization === 'read-only') {
    snapshot.authorization = 'authorized'
    snapshot.writable = false
  } else if (capability.authorization === 'denied') {
    snapshot.authorization = 'denied'
  }
  return snapshot
}

/**
 * Refresh a persisted connector projection after a recorded execution
 * transition. This preserves only named capability state and ensures an
 * operator report never shows an earlier GitHub action after a real branch
 * creation, file commit, or validation readback.
 */
export function refreshConnectorPlanForExecution(value, executionWorkflow = null) {
  const plan = normalizeConnectorPlan(value)
  if (!plan || plan.decision === 'chat-only') return plan
  const integrations = Object.fromEntries(plan.connectors
    .filter((connector) => connector.kind === 'integration')
    .map((connector) => [connector.id, integrationSnapshotFromConnector(connector, executionWorkflow)]))
  const context = { integrations, executionWorkflow }
  const connectors = plan.connectors
    .map((connector) => createResolvedConnector(connector.id, context))
    .filter(Boolean)
  const primary = connectors.find((connector) => connector.id === plan.primary) || connectors[0] || null
  if (!primary) return null
  return normalizeConnectorPlan({
    version: 1,
    taskClass: plan.taskClass,
    decision: decisionFor(primary),
    primary: primary.id,
    connectors,
    fallback: fallbackFor(primary, context),
  })
}

function candidateConnectorIds({ request = '', intent = null, executionBridge = null } = {}) {
  const ids = []
  const add = (id) => {
    if (definitionFor(id) && !ids.includes(id) && ids.length < MAX_CONNECTOR_ROUTES) ids.push(id)
  }
  if (intent?.wantsTask) add('tasks')
  if (intent?.wantsNote) add('notes')
  if (definitionFor(intent?.primaryTool)) add(intent.primaryTool)
  if (executionBridge?.target?.repository || ['repository', 'github'].includes(executionBridge?.target?.surface)) add('github')
  const requestIsAdvice = /\b(?:how should|how do|help me|advice|tips?|best way to)\b/i.test(text(request, 900))
  Object.entries(EXTERNAL_SIGNALS).forEach(([id, signals]) => {
    // Mentioning an external product in an advice question is not a request
    // to invoke it. Keep ordinary conversational guidance in Chat and only
    // create a connector plan for an operational request.
    if (!requestIsAdvice && intent?.isOperational && mentionsAny(request, signals)) add(id)
  })
  return ids
}

function decisionFor(primary) {
  if (!primary) return 'chat-only'
  if (primary.actionReadiness === 'approval-required') return 'approval-required'
  if (['not-installed', 'not-configured', 'not-authorized', 'read-only', 'temporarily-unavailable'].includes(primary.actionReadiness)) return 'integration-blocked'
  if (primary.kind === 'integration' || ['tasks', 'notes'].includes(primary.id)) return 'tool-required'
  return 'tool-recommended'
}

function fallbackFor(primary, context) {
  const definition = definitionFor(primary?.id)
  if (!definition) return Object.freeze({ kind: 'manual', label: 'Continue in Chat manually' })
  const fallback = definition.fallbacks
    .map((id) => createResolvedConnector(id, context))
    .find((candidate) => candidate && ['available', 'writable'].includes(candidate.actionReadiness))
  if (fallback) return Object.freeze({ kind: 'connector', id: fallback.id, label: `${definitionFor(fallback.id).label} is an acceptable fallback` })
  return Object.freeze({ kind: 'manual', label: 'Continue in Chat with manual guidance' })
}

function planTaskClass(intent, executionBridge) {
  if (executionBridge?.branch === 'required' || intent?.operation === 'change' || intent?.operation === 'inspect') return 'execution'
  if (intent?.requiresPlan) return 'planning'
  return 'conversation'
}

/**
 * Registry-backed connector selection. It selects a safe path and fallback
 * without invoking a connector, changing provider selection, or claiming an
 * external action occurred.
 */
export function getChatConnectorPlan({ request = '', intent = null, executionBridge = null, executionWorkflow = null, integrations = null } = {}) {
  const context = { integrations, executionBridge, executionWorkflow }
  const connectors = candidateConnectorIds({ request, intent, executionBridge })
    .map((id) => createResolvedConnector(id, context))
    .filter(Boolean)
  const blocked = connectors.find((connector) => ['not-installed', 'not-configured', 'not-authorized', 'read-only', 'temporarily-unavailable'].includes(connector.actionReadiness))
  const primary = blocked || connectors[0] || null
  const decision = decisionFor(primary)
  const fallback = primary ? fallbackFor(primary, context) : Object.freeze({ kind: 'manual', label: 'Continue in Chat with manual guidance' })
  return normalizeConnectorPlan({
    version: 1,
    taskClass: planTaskClass(intent, executionBridge),
    decision,
    ...(primary ? { primary: primary.id } : {}),
    connectors,
    fallback,
  })
}

function normalizeConnector(value) {
  if (!isRecord(value) || !CONNECTOR_IDS.has(value.id) || !CONNECTOR_KINDS.has(value.kind) || !isChatConnectorScope(value.scope)) return null
  if (!isChatConnectorInstallation(value.installation) || !isChatConnectorConfiguration(value.configuration) || !isChatConnectorAuthorization(value.authorization) || !isChatConnectorAccess(value.access) || !isChatConnectorHealth(value.health) || !isChatConnectorReadiness(value.readiness)) return null
  const definition = definitionFor(value.id)
  const action = actionFor(definition, value.action)
  const actionReadiness = isChatConnectorReadiness(value.actionReadiness) ? value.actionReadiness : ''
  const approval = isChatConnectorApproval(value.approval) ? value.approval : ''
  if (value.kind !== definition.kind || value.scope !== definition.scope) return null
  if (value.action && (!action || !actionReadiness || !approval)) return null
  return Object.freeze({
    id: value.id, kind: value.kind, scope: value.scope,
    installation: value.installation, configuration: value.configuration, authorization: value.authorization,
    access: value.access, health: value.health, readiness: value.readiness,
    ...(action ? { action: action.id, actionLabel: action.label, actionReadiness, approval } : {}),
  })
}

/** Persist only named connector state, never account data, tokens, raw errors, or request text. */
export function normalizeConnectorPlan(value) {
  if (!isRecord(value) || value.version !== 1 || !['conversation', 'planning', 'execution'].includes(value.taskClass) || !isChatConnectorPlanDecision(value.decision)) return null
  const seen = new Set()
  const connectors = Array.isArray(value.connectors)
    ? value.connectors.reduce((items, connector) => {
      const normalized = normalizeConnector(connector)
      if (!normalized || seen.has(normalized.id) || items.length >= MAX_CONNECTOR_ROUTES) return items
      seen.add(normalized.id)
      items.push(normalized)
      return items
    }, [])
    : []
  const primary = CONNECTOR_IDS.has(value.primary) && connectors.some((connector) => connector.id === value.primary) ? value.primary : ''
  const fallback = isRecord(value.fallback) && ['connector', 'manual'].includes(value.fallback.kind)
    ? value.fallback.kind === 'connector' && CONNECTOR_IDS.has(value.fallback.id)
      ? Object.freeze({ kind: 'connector', id: value.fallback.id, label: text(value.fallback.label, 100) || `${definitionFor(value.fallback.id).label} is an acceptable fallback` })
      : value.fallback.kind === 'manual'
        ? Object.freeze({ kind: 'manual', label: text(value.fallback.label, 100) || 'Continue in Chat with manual guidance' })
        : null
    : null
  if (value.decision === 'chat-only') return Object.freeze({ version: 1, taskClass: value.taskClass, decision: 'chat-only', connectors: Object.freeze([]), fallback: Object.freeze({ kind: 'manual', label: 'Continue in Chat with manual guidance' }) })
  if (!primary || !connectors.length || !fallback) return null
  const primaryConnector = connectors.find((connector) => connector.id === primary)
  if (!primaryConnector || value.decision !== decisionFor(primaryConnector)) return null
  if (fallback.kind === 'connector' && !definitionFor(primary).fallbacks.includes(fallback.id)) return null
  return Object.freeze({ version: 1, taskClass: value.taskClass, decision: value.decision, primary, connectors: Object.freeze(connectors), fallback })
}

const READINESS_COPY = Object.freeze({
  available: 'Ready',
  writable: 'Connected · writable',
  'not-installed': 'Available to install',
  'not-configured': 'Installed · setup needed',
  'not-authorized': 'Configured · authorization needed',
  'read-only': 'Connected · read-only',
  'temporarily-unavailable': 'Temporarily unavailable',
  'approval-required': 'Approval required',
})

const DECISION_COPY = Object.freeze({
  'chat-only': 'Chat is the best path',
  'tool-recommended': 'Tool recommended',
  'tool-required': 'Tool required',
  'integration-blocked': 'Connector blocked',
  'approval-required': 'Approval required',
  'manual-fallback': 'Manual fallback',
})

/** A concise, evidence-first rule set for provider prompts. */
export function getConnectorPlanGuidance(value) {
  const plan = normalizeConnectorPlan(value)
  if (!plan || plan.decision === 'chat-only') return ''
  const primary = plan.connectors.find((connector) => connector.id === plan.primary)
  if (!primary) return ''
  const label = definitionFor(primary.id).label
  const readiness = READINESS_COPY[primary.actionReadiness] || 'Unavailable'
  const base = `Best tool path: ${label} for “${primary.actionLabel}” (${readiness}). This is a routing recommendation, not evidence that the action ran.`
  if (plan.decision === 'integration-blocked') return `${base} Do not claim the connector is usable. Offer the safe fallback: ${plan.fallback.label}.`
  if (plan.decision === 'approval-required') return `${base} Explicit approval is required before any mutating action. Keep the plan and next step clear; do not act or claim execution.`
  if (plan.decision === 'tool-required') return `${base} Use the explicit FounderLab action when the user chooses it; do not silently execute or claim completion.`
  return `${base} Offer the tool as the next useful action, while still providing useful guidance in Chat now.`
}

/** Compact display model for the existing collapsed Operator report. */
export function getConnectorPlanPresentation(value) {
  const plan = normalizeConnectorPlan(value)
  if (!plan || plan.decision === 'chat-only') return null
  const primary = plan.connectors.find((connector) => connector.id === plan.primary)
  if (!primary) return null
  const definition = definitionFor(primary.id)
  const readiness = READINESS_COPY[primary.actionReadiness] || 'Unavailable'
  const action = primary.actionLabel || 'Choose a tool action'
  const state = {
    'not-installed': 'connector-install-needed',
    'not-configured': 'connector-configuration-needed',
    'not-authorized': 'authorization-needed',
    'read-only': 'read-only-integration',
    'temporarily-unavailable': 'connector-unavailable',
    'approval-required': 'waiting-for-approval',
  }[primary.actionReadiness] || 'tool-ready'
  const detail = plan.decision === 'integration-blocked'
    ? `${definition.label} cannot safely run “${action}” yet. ${plan.fallback.label}.`
    : plan.decision === 'approval-required'
      ? `${definition.label} is selected, but “${action}” requires explicit approval before any mutation.`
      : `${definition.label} is the best current path for “${action}”. The action remains explicit.`
  return Object.freeze({
    decision: plan.decision,
    state,
    label: DECISION_COPY[plan.decision],
    detail,
    connector: definition.label,
    action,
    readiness,
    fallback: plan.fallback.label,
  })
}

const ACTION_EVIDENCE = Object.freeze({
  'save-note:completed': Object.freeze({ connector: 'notes', action: 'save-note', state: 'completed', evidence: 'locally-verified' }),
  'create-task:completed': Object.freeze({ connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified' }),
  'builder:handoff-opened': Object.freeze({ connector: 'builder', action: 'builder', state: 'handed-off', evidence: 'externally-unverified' }),
  'code:handoff-opened': Object.freeze({ connector: 'code', action: 'code', state: 'handed-off', evidence: 'externally-unverified' }),
  'youtube:handoff-opened': Object.freeze({ connector: 'youtube', action: 'youtube', state: 'handed-off', evidence: 'externally-unverified' }),
  'inspect-repo:inspection-completed': Object.freeze({ connector: 'github', action: 'inspect-repo', state: 'completed', evidence: 'externally-verified' }),
  'create-branch:branch-created': Object.freeze({ connector: 'github', action: 'create-branch', state: 'completed', evidence: 'externally-verified' }),
  'create-branch:execution-blocked': Object.freeze({ connector: 'github', action: 'create-branch', state: 'blocked', evidence: 'failure-recorded' }),
  'apply-file-change:change-applied': Object.freeze({ connector: 'github', action: 'apply-file-change', state: 'completed', evidence: 'externally-verified' }),
  'apply-file-change:execution-blocked': Object.freeze({ connector: 'github', action: 'apply-file-change', state: 'blocked', evidence: 'failure-recorded' }),
  'validate:validation-recorded': Object.freeze({ connector: 'github', action: 'validate', state: 'planned', evidence: 'externally-unverified' }),
  'validate:validation-passed': Object.freeze({ connector: 'github', action: 'validate', state: 'completed', evidence: 'externally-verified' }),
  'validate:validation-failed': Object.freeze({ connector: 'github', action: 'validate', state: 'blocked', evidence: 'failure-recorded' }),
  'review:review-ready': Object.freeze({ connector: 'github', action: 'validate', state: 'completed', evidence: 'externally-verified' }),
})

/** Standardize recorded action facts across future connectors without inferring a result. */
export function getConnectorActionEvidence({ id, status } = {}) {
  const evidence = ACTION_EVIDENCE[`${id}:${status}`]
  return evidence ? Object.freeze({ ...evidence }) : null
}

export function normalizeConnectorActionEvidence(value) {
  if (!isRecord(value) || !CONNECTOR_IDS.has(value.connector) || !isChatConnectorEvidence(value.evidence) || !['planned', 'handed-off', 'completed', 'blocked', 'cancelled'].includes(value.state)) return null
  if (!actionFor(definitionFor(value.connector), value.action)) return null
  return Object.freeze({ connector: value.connector, action: value.action, state: value.state, evidence: value.evidence })
}

export function getConnectorRegistryEntry(id) {
  const definition = definitionFor(id)
  return definition ? Object.freeze({ id: definition.id, label: definition.label, kind: definition.kind, scope: definition.scope, actions: definition.actions.map((action) => Object.freeze({ ...action })) }) : null
}
