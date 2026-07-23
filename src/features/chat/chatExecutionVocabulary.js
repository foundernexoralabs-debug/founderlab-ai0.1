/**
 * Shared, persisted Chat execution evidence vocabulary. Keeping this contract
 * in one place prevents the orchestration, capability, and execution bridges
 * from drifting as real action runners are introduced.
 */

const ACTION_IDS = Object.freeze([
  'save-note',
  'create-task',
  'builder',
  'code',
  'github',
  'youtube',
  'inspect-repo',
  'prepare-branch',
  'prepare-execution',
  'approve-execution',
  'create-branch',
  'apply-file-change',
  'validate',
  'review',
  'merge',
  'retry-execution',
  'connect-github',
])

const ACTION_STATUSES = Object.freeze([
  'completed',
  'handoff-opened',
  'inspection-completed',
  'branch-prepared',
  'execution-prepared',
  'approval-recorded',
  'branch-created',
  'change-applied',
  'execution-blocked',
  'execution-cancelled',
  'execution-retried',
  'validation-recorded',
  'validation-passed',
  'validation-failed',
  'review-ready',
  'merge-ready',
  'merge-not-ready',
])

const RESOURCE_TYPES = Object.freeze(['task', 'note', 'project', 'repository', 'branch', 'file', 'commit'])

// Shared connector/operator vocabulary. Connector implementations describe
// their runtime through these terms instead of inventing per-app labels.
const CONNECTOR_INSTALLATIONS = Object.freeze(['not-installed', 'installed', 'not-applicable'])
const CONNECTOR_CONFIGURATIONS = Object.freeze(['not-configured', 'configured', 'not-applicable'])
const CONNECTOR_AUTHORIZATIONS = Object.freeze(['not-authorized', 'authorized', 'not-applicable'])
const CONNECTOR_ACCESS = Object.freeze(['read-only', 'writable', 'not-applicable'])
const CONNECTOR_HEALTH = Object.freeze(['healthy', 'temporarily-unavailable', 'unavailable'])
const CONNECTOR_READINESS = Object.freeze([
  'available',
  'writable',
  'not-installed',
  'not-configured',
  'not-authorized',
  'read-only',
  'temporarily-unavailable',
  'approval-required',
])
const CONNECTOR_APPROVAL = Object.freeze(['not-required', 'required'])
const CONNECTOR_SCOPES = Object.freeze(['founderlab', 'local', 'cloud', 'external'])
const CONNECTOR_PLAN_DECISIONS = Object.freeze(['chat-only', 'tool-recommended', 'tool-required', 'integration-blocked', 'approval-required', 'manual-fallback'])
const CONNECTOR_EVIDENCE = Object.freeze(['locally-verified', 'externally-verified', 'externally-unverified', 'failure-recorded'])

export function isChatExecutionActionId(value) {
  return typeof value === 'string' && ACTION_IDS.includes(value)
}

export function isChatExecutionActionStatus(value) {
  return typeof value === 'string' && ACTION_STATUSES.includes(value)
}

export function isChatExecutionResourceType(value) {
  return typeof value === 'string' && RESOURCE_TYPES.includes(value)
}

export function isChatConnectorInstallation(value) {
  return typeof value === 'string' && CONNECTOR_INSTALLATIONS.includes(value)
}

export function isChatConnectorConfiguration(value) {
  return typeof value === 'string' && CONNECTOR_CONFIGURATIONS.includes(value)
}

export function isChatConnectorAuthorization(value) {
  return typeof value === 'string' && CONNECTOR_AUTHORIZATIONS.includes(value)
}

export function isChatConnectorAccess(value) {
  return typeof value === 'string' && CONNECTOR_ACCESS.includes(value)
}

export function isChatConnectorHealth(value) {
  return typeof value === 'string' && CONNECTOR_HEALTH.includes(value)
}

export function isChatConnectorReadiness(value) {
  return typeof value === 'string' && CONNECTOR_READINESS.includes(value)
}

export function isChatConnectorApproval(value) {
  return typeof value === 'string' && CONNECTOR_APPROVAL.includes(value)
}

export function isChatConnectorScope(value) {
  return typeof value === 'string' && CONNECTOR_SCOPES.includes(value)
}

export function isChatConnectorPlanDecision(value) {
  return typeof value === 'string' && CONNECTOR_PLAN_DECISIONS.includes(value)
}

export function isChatConnectorEvidence(value) {
  return typeof value === 'string' && CONNECTOR_EVIDENCE.includes(value)
}
