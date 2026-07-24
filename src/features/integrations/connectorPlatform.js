/**
 * FounderLab connector execution platform.
 *
 * This is the shared source of truth for connector metadata, safe runtime
 * state, action boundaries, and execution receipts. It intentionally stores
 * no tokens, account identifiers, raw provider errors, or request bodies.
 * Feature surfaces (Chat, Settings, future workflows) supply their own
 * executor callbacks and record their own durable evidence only after an
 * action has genuinely completed.
 */

const CONNECTOR_KINDS = new Set(['workspace', 'tool', 'integration'])
const CONNECTOR_INSTALLATIONS = new Set(['not-installed', 'installed', 'not-applicable'])
const CONNECTOR_CONFIGURATIONS = new Set(['not-configured', 'configured', 'not-applicable'])
const CONNECTOR_AUTHORIZATIONS = new Set(['not-authorized', 'authorized', 'not-applicable'])
const CONNECTOR_ACCESS = new Set(['read-only', 'writable', 'not-applicable'])
const CONNECTOR_HEALTH = new Set(['healthy', 'temporarily-unavailable', 'unavailable'])
const CONNECTOR_READINESS = new Set([
  'available', 'writable', 'not-installed', 'not-configured', 'not-authorized', 'read-only', 'temporarily-unavailable', 'approval-required',
])
const CONNECTOR_APPROVAL = new Set(['not-required', 'required'])
const CONNECTOR_SCOPES = new Set(['founderlab', 'local', 'cloud', 'external'])
const CONNECTOR_EVIDENCE = new Set(['locally-verified', 'externally-verified', 'externally-unverified'])

export const CONNECTOR_REGISTRY = Object.freeze({
  notes: Object.freeze({
    id: 'notes', label: 'Notes', kind: 'workspace', scope: 'founderlab', icon: '◫',
    description: 'Save durable knowledge from the current FounderLab workspace.',
    actions: Object.freeze([{ id: 'save-note', label: 'Save note', access: 'write', approval: 'not-required', evidence: 'locally-verified' }]),
    fallbacks: Object.freeze([]),
  }),
  tasks: Object.freeze({
    id: 'tasks', label: 'Tasks', kind: 'workspace', scope: 'founderlab', icon: '✓',
    description: 'Turn a clear next step into a FounderLab task.',
    actions: Object.freeze([{ id: 'create-task', label: 'Create task', access: 'write', approval: 'not-required', evidence: 'locally-verified' }]),
    fallbacks: Object.freeze(['notes']),
  }),
  builder: Object.freeze({
    id: 'builder', label: 'Builder', kind: 'tool', scope: 'founderlab', icon: '⬡',
    description: 'Carry an approved product brief into FounderLab Builder.',
    actions: Object.freeze([{ id: 'builder', label: 'Open Builder handoff', access: 'write', approval: 'not-required', evidence: 'externally-unverified' }]),
    fallbacks: Object.freeze(['code']),
  }),
  code: Object.freeze({
    id: 'code', label: 'Code AI', kind: 'tool', scope: 'founderlab', icon: '⌨',
    description: 'Continue a scoped implementation plan in Code AI.',
    actions: Object.freeze([{ id: 'code', label: 'Open Code AI handoff', access: 'write', approval: 'not-required', evidence: 'externally-unverified' }]),
    fallbacks: Object.freeze([]),
  }),
  github: Object.freeze({
    id: 'github', label: 'GitHub', kind: 'integration', scope: 'external', icon: '⌘',
    description: 'Inspect repositories and make explicitly approved branch-first changes.',
    actions: Object.freeze([
      { id: 'inspect-repo', label: 'Inspect public repository', access: 'read', approval: 'not-required', publicRead: true, evidence: 'externally-verified' },
      { id: 'prepare-branch', label: 'Prepare branch plan', access: 'read', approval: 'not-required', localPreparation: true, evidence: 'locally-verified' },
      { id: 'prepare-execution', label: 'Prepare execution workflow', access: 'read', approval: 'not-required', localPreparation: true, evidence: 'locally-verified' },
      { id: 'approve-execution', label: 'Record execution approval', access: 'write', approval: 'not-required', localPreparation: true, evidence: 'locally-verified' },
      { id: 'create-branch', label: 'Create approved branch', access: 'write', approval: 'required', evidence: 'externally-verified' },
      { id: 'apply-file-change', label: 'Commit reviewed changes', access: 'write', approval: 'required', evidence: 'externally-verified' },
      { id: 'validate', label: 'Read commit validation', access: 'read', approval: 'not-required', evidence: 'externally-unverified' },
      { id: 'review', label: 'Prepare review summary', access: 'read', approval: 'not-required', localPreparation: true, evidence: 'locally-verified' },
      { id: 'retry-execution', label: 'Restore retry path', access: 'read', approval: 'not-required', localPreparation: true, evidence: 'locally-verified' },
    ]),
    fallbacks: Object.freeze(['code']),
  }),
  youtube: Object.freeze({
    id: 'youtube', label: 'YouTube AI', kind: 'tool', scope: 'founderlab', icon: '▶',
    description: 'Carry a content brief into FounderLab YouTube AI.',
    actions: Object.freeze([{ id: 'youtube', label: 'Open YouTube AI handoff', access: 'write', approval: 'not-required', evidence: 'externally-unverified' }]),
    fallbacks: Object.freeze([]),
  }),
  email: Object.freeze({
    id: 'email', label: 'Email', kind: 'integration', scope: 'external', icon: '✉',
    description: 'Prepare and send approved email through a configured mail connector.',
    selectionSignals: Object.freeze(['email', 'mail', 'gmail', 'outreach']),
    actions: Object.freeze([{ id: 'send-email', label: 'Send email', access: 'write', approval: 'required', evidence: 'externally-unverified' }]),
    fallbacks: Object.freeze([]),
  }),
  calendar: Object.freeze({
    id: 'calendar', label: 'Calendar', kind: 'integration', scope: 'external', icon: '◷',
    description: 'Create approved events through a configured calendar connector.',
    selectionSignals: Object.freeze(['calendar', 'schedule', 'meeting', 'invite']),
    actions: Object.freeze([{ id: 'schedule-event', label: 'Schedule event', access: 'write', approval: 'required', evidence: 'externally-unverified' }]),
    fallbacks: Object.freeze([]),
  }),
  'external-app': Object.freeze({
    id: 'external-app', label: 'External app', kind: 'integration', scope: 'external', icon: '↗',
    description: 'Route a future connected application through FounderLab.',
    selectionSignals: Object.freeze(['slack', 'notion', 'linear', 'jira', 'airtable', 'hubspot', 'zapier', 'composio', 'integration', 'connector']),
    actions: Object.freeze([{ id: 'external-action', label: 'Run external action', access: 'write', approval: 'required', evidence: 'externally-unverified' }]),
    fallbacks: Object.freeze([]),
  }),
})

export const CONNECTOR_IDS = Object.freeze(Object.keys(CONNECTOR_REGISTRY))

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, limit = 160) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

export function isConnectorInstallation(value) { return typeof value === 'string' && CONNECTOR_INSTALLATIONS.has(value) }
export function isConnectorConfiguration(value) { return typeof value === 'string' && CONNECTOR_CONFIGURATIONS.has(value) }
export function isConnectorAuthorization(value) { return typeof value === 'string' && CONNECTOR_AUTHORIZATIONS.has(value) }
export function isConnectorAccess(value) { return typeof value === 'string' && CONNECTOR_ACCESS.has(value) }
export function isConnectorHealth(value) { return typeof value === 'string' && CONNECTOR_HEALTH.has(value) }
export function isConnectorReadiness(value) { return typeof value === 'string' && CONNECTOR_READINESS.has(value) }
export function isConnectorApproval(value) { return typeof value === 'string' && CONNECTOR_APPROVAL.has(value) }
export function isConnectorScope(value) { return typeof value === 'string' && CONNECTOR_SCOPES.has(value) }
export function isConnectorEvidence(value) { return typeof value === 'string' && CONNECTOR_EVIDENCE.has(value) }

export function getConnectorDefinition(id) {
  const definition = typeof id === 'string' ? CONNECTOR_REGISTRY[id] : null
  return definition || null
}

export function getConnectorAction(connectorId, actionId) {
  return getConnectorDefinition(connectorId)?.actions.find((action) => action.id === actionId) || null
}

/** Signals are shared metadata, so new connectors never require Chat-only routing tables. */
export function getConnectorSelectionSignals(connectorId) {
  const signals = getConnectorDefinition(connectorId)?.selectionSignals
  return Array.isArray(signals) ? Object.freeze([...signals]) : Object.freeze([])
}

export function getConnectorForAction(actionId) {
  return CONNECTOR_IDS.find((connectorId) => getConnectorAction(connectorId, actionId)) || ''
}

export function getDefaultConnectorRuntime(connectorId) {
  const definition = getConnectorDefinition(connectorId)
  if (!definition) return null
  if (definition.scope === 'founderlab') {
    return Object.freeze({ installation: 'installed', configuration: 'not-applicable', authorization: 'not-applicable', access: 'writable', health: 'healthy' })
  }
  if (definition.kind === 'tool') {
    return Object.freeze({ installation: 'installed', configuration: 'not-applicable', authorization: 'not-applicable', access: 'writable', health: 'healthy' })
  }
  if (definition.id === 'github') {
    return Object.freeze({ installation: 'installed', configuration: 'not-configured', authorization: 'not-authorized', access: 'not-applicable', health: 'healthy' })
  }
  return Object.freeze({ installation: 'not-installed', configuration: 'not-applicable', authorization: 'not-applicable', access: 'not-applicable', health: 'healthy' })
}

/** Normalize safe connector state passed from settings/session runtime. */
export function normalizeConnectorRuntime(connectorId, value = null) {
  const fallback = getDefaultConnectorRuntime(connectorId)
  if (!fallback) return null
  if (!isRecord(value)) return fallback
  if (value.temporarilyUnavailable === true || value.health === 'temporarily-unavailable') {
    return Object.freeze({ ...fallback, health: 'temporarily-unavailable' })
  }
  // Settings, Chat, and the action gateway intentionally exchange this
  // canonical safe shape. Accept it as-is so an already-resolved capability
  // cannot silently lose authorization on the next execution boundary.
  if (
    isConnectorInstallation(value.installation)
    && isConnectorConfiguration(value.configuration)
    && isConnectorAuthorization(value.authorization)
    && isConnectorAccess(value.access)
    && isConnectorHealth(value.health)
  ) {
    return Object.freeze({
      installation: value.installation,
      configuration: value.configuration,
      authorization: value.authorization,
      access: value.access,
      health: value.health,
    })
  }
  const installation = value.installed === false ? 'not-installed' : value.installed === true ? 'installed' : fallback.installation
  const configuration = value.configured === true || value.connected === true ? 'configured'
    : value.configured === false ? 'not-configured'
      : fallback.configuration
  const authorization = value.authorization === 'authorized' ? 'authorized'
    : value.authorization === 'denied' || value.authorization === 'not-authorized' ? 'not-authorized'
      : value.connected === true && typeof value.writable === 'boolean' ? 'authorized'
        : fallback.authorization
  const access = value.writable === true ? 'writable'
    : value.writable === false ? 'read-only'
      : fallback.access
  const health = value.health === 'unavailable' ? 'unavailable' : fallback.health
  return Object.freeze({ installation, configuration, authorization, access, health })
}

export function getConnectorReadiness(runtime) {
  if (!runtime) return 'temporarily-unavailable'
  if (runtime.health === 'temporarily-unavailable' || runtime.health === 'unavailable') return 'temporarily-unavailable'
  if (runtime.installation === 'not-installed') return 'not-installed'
  if (runtime.configuration === 'not-configured') return 'not-configured'
  if (runtime.authorization === 'not-authorized') return 'not-authorized'
  if (runtime.access === 'read-only') return 'read-only'
  if (runtime.access === 'writable') return 'writable'
  return 'available'
}

export function getConnectorActionReadiness(connectorId, actionId, runtime, { approvalRecorded = false } = {}) {
  const action = getConnectorAction(connectorId, actionId)
  if (!action) return 'temporarily-unavailable'
  if (action.localPreparation === true && runtime?.health === 'healthy') return 'available'
  if (action.publicRead === true && runtime?.health === 'healthy') return 'available'
  const readiness = getConnectorReadiness(runtime)
  if (!['available', 'writable'].includes(readiness)) return readiness
  if (action.access === 'write' && runtime?.access === 'read-only') return 'read-only'
  if (action.approval === 'required' && approvalRecorded !== true) return 'approval-required'
  return 'available'
}

export function resolveConnector(connectorId, runtime, { actionId = '', approvalRecorded = false } = {}) {
  const definition = getConnectorDefinition(connectorId)
  const normalizedRuntime = normalizeConnectorRuntime(connectorId, runtime)
  if (!definition || !normalizedRuntime) return null
  const action = actionId ? getConnectorAction(connectorId, actionId) : definition.actions[0] || null
  const readiness = getConnectorReadiness(normalizedRuntime)
  const actionReadiness = action ? getConnectorActionReadiness(connectorId, action.id, normalizedRuntime, { approvalRecorded }) : 'temporarily-unavailable'
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    kind: definition.kind,
    scope: definition.scope,
    installation: normalizedRuntime.installation,
    configuration: normalizedRuntime.configuration,
    authorization: normalizedRuntime.authorization,
    access: normalizedRuntime.access,
    health: normalizedRuntime.health,
    readiness,
    ...(action ? { action: action.id, actionLabel: action.label, actionReadiness, approval: action.approval } : {}),
  })
}

const BLOCK_COPY = Object.freeze({
  'not-installed': 'This connector is available but not installed for this workspace.',
  'not-configured': 'This connector is installed but needs setup before FounderLab can use it.',
  'not-authorized': 'This connector is configured but is not authorized for this action.',
  'read-only': 'This connector is connected read-only and cannot perform the requested change.',
  'temporarily-unavailable': 'This connector is temporarily unavailable. No external action was attempted.',
  'approval-required': 'This action requires explicit approval before FounderLab can continue.',
  'unsupported-action': 'This connector does not support the requested action.',
  'executor-unavailable': 'No verified executor is available for this connector action.',
  'execution-failed': 'The connector action did not complete. No successful external result is recorded.',
})

export function getConnectorBlockCopy(code) {
  return BLOCK_COPY[code] || BLOCK_COPY['execution-failed']
}

/**
 * Build a safe, portable execution request. It deliberately carries only
 * connector capability state and approval—not credentials, account data, or
 * the user's raw task—so it can be recorded alongside action evidence.
 */
export function createConnectorExecutionRequest({ connectorId = '', actionId = '', runtime = null, approvalRecorded = false } = {}) {
  const definition = getConnectorDefinition(connectorId)
  const action = getConnectorAction(connectorId, actionId)
  const normalizedRuntime = normalizeConnectorRuntime(connectorId, runtime)
  return Object.freeze({
    connectorId: definition?.id || text(connectorId, 60),
    actionId: action?.id || text(actionId, 80),
    runtime: normalizedRuntime,
    approvalRecorded: approvalRecorded === true,
  })
}

/**
 * One guarded action gateway shared by Chat and future execution surfaces.
 * A successful result is returned only when the supplied real executor
 * confirms it; this function never manufactures an external completion.
 */
export async function executeConnectorAction({ connectorId = '', actionId = '', runtime = null, approvalRecorded = false, executor = null } = {}) {
  const request = createConnectorExecutionRequest({ connectorId, actionId, runtime, approvalRecorded })
  const definition = getConnectorDefinition(request.connectorId)
  const action = getConnectorAction(request.connectorId, request.actionId)
  const normalizedRuntime = request.runtime
  if (!definition || !action || !normalizedRuntime) {
    return Object.freeze({ connector: request.connectorId, action: request.actionId, state: 'blocked', evidence: 'failure-recorded', reason: 'unsupported-action' })
  }
  const readiness = getConnectorActionReadiness(request.connectorId, request.actionId, normalizedRuntime, { approvalRecorded: request.approvalRecorded })
  if (readiness !== 'available') {
    return Object.freeze({ connector: request.connectorId, action: request.actionId, state: 'blocked', evidence: 'failure-recorded', reason: readiness })
  }
  if (typeof executor !== 'function') {
    return Object.freeze({ connector: request.connectorId, action: request.actionId, state: 'blocked', evidence: 'failure-recorded', reason: 'executor-unavailable' })
  }
  try {
    const result = await executor()
    return result === false
      ? Object.freeze({ connector: request.connectorId, action: request.actionId, state: 'blocked', evidence: 'failure-recorded', reason: 'execution-failed' })
      : Object.freeze({ connector: request.connectorId, action: request.actionId, state: 'completed', evidence: action.evidence || 'externally-unverified', result: result === undefined ? null : result })
  } catch {
    return Object.freeze({ connector: request.connectorId, action: request.actionId, state: 'blocked', evidence: 'failure-recorded', reason: 'execution-failed' })
  }
}

const READINESS_LABELS = Object.freeze({
  available: 'Ready',
  writable: 'Connected · writable',
  'not-installed': 'Available to install',
  'not-configured': 'Installed · setup needed',
  'not-authorized': 'Configured · authorization needed',
  'read-only': 'Connected · read-only',
  'temporarily-unavailable': 'Temporarily unavailable',
  'approval-required': 'Approval required',
})

export function getConnectorReadinessLabel(readiness) {
  return READINESS_LABELS[readiness] || 'Unavailable'
}

/** A compact, safe Settings view model for first-class external connectors. */
export function getIntegrationSettingsConnectors(runtimes = null) {
  return Object.freeze(CONNECTOR_IDS
    .map((id) => resolveConnector(id, runtimes?.[id]))
    // `external-app` is an internal discovery route, not a pretend connector
    // card. Settings shows only concrete integrations that users can assess
    // or configure today.
    .filter((connector) => connector?.kind === 'integration' && connector.id !== 'external-app'))
}
