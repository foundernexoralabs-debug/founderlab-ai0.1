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
  'validate',
  'review',
  'merge',
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
  'execution-blocked',
  'execution-cancelled',
  'validation-passed',
  'validation-failed',
  'review-ready',
  'merge-ready',
  'merge-not-ready',
])

const RESOURCE_TYPES = Object.freeze(['task', 'note', 'project', 'repository', 'branch'])

export function isChatExecutionActionId(value) {
  return typeof value === 'string' && ACTION_IDS.includes(value)
}

export function isChatExecutionActionStatus(value) {
  return typeof value === 'string' && ACTION_STATUSES.includes(value)
}

export function isChatExecutionResourceType(value) {
  return typeof value === 'string' && RESOURCE_TYPES.includes(value)
}
