/**
 * Shared, persisted Chat execution evidence vocabulary. Keeping this contract
 * in one place prevents the orchestration, capability, and execution bridges
 * from drifting as real action runners are introduced.
 */

import {
  isConnectorAccess,
  isConnectorApproval,
  isConnectorAuthorization,
  isConnectorConfiguration,
  isConnectorHealth,
  isConnectorInstallation,
  isConnectorReadiness,
  isConnectorScope,
} from '../integrations/connectorPlatform.js'

const ACTION_IDS = Object.freeze([
  'save-note',
  'create-task',
  'builder',
  'code',
  'github',
  'youtube',
  'send-email',
  'schedule-event',
  'external-action',
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
  'manage-integrations',
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

const RESOURCE_TYPES = Object.freeze(['task', 'note', 'project', 'repository', 'branch', 'file', 'commit', 'connector', 'integration'])

// Shared connector/operator vocabulary. Connector implementations describe
// their runtime through these terms instead of inventing per-app labels.
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
  return isConnectorInstallation(value)
}

export function isChatConnectorConfiguration(value) {
  return isConnectorConfiguration(value)
}

export function isChatConnectorAuthorization(value) {
  return isConnectorAuthorization(value)
}

export function isChatConnectorAccess(value) {
  return isConnectorAccess(value)
}

export function isChatConnectorHealth(value) {
  return isConnectorHealth(value)
}

export function isChatConnectorReadiness(value) {
  return isConnectorReadiness(value)
}

export function isChatConnectorApproval(value) {
  return isConnectorApproval(value)
}

export function isChatConnectorScope(value) {
  return isConnectorScope(value)
}

export function isChatConnectorPlanDecision(value) {
  return typeof value === 'string' && CONNECTOR_PLAN_DECISIONS.includes(value)
}

export function isChatConnectorEvidence(value) {
  return typeof value === 'string' && CONNECTOR_EVIDENCE.includes(value)
}
