/**
 * Derives a compact, persistent evidence trail from message orchestration.
 * It is presentation-only: entries describe recorded facts, never inferred
 * external work. The source data survives conversation reloads.
 */

import { getExecutionWorkflowPresentation } from './chatExecutionWorkflow.js'

const EVENT_COPY = Object.freeze({
  'inspect-repo:inspection-completed': Object.freeze({ phase: 'Inspect', label: 'Repository inspected', detail: 'Read-only GitHub metadata and a bounded file tree were recorded.' }),
  'prepare-branch:branch-prepared': Object.freeze({ phase: 'Branch', label: 'Branch plan prepared', detail: 'A branch name and bounded scope were prepared.' }),
  'prepare-execution:execution-prepared': Object.freeze({ phase: 'Change', label: 'Execution workflow prepared', detail: 'Candidate files, risk, and validation requirements were recorded.' }),
  'approve-execution:approval-recorded': Object.freeze({ phase: 'Approve', label: 'Execution approval recorded', detail: 'Approval was recorded; no mutation is implied.' }),
  'create-branch:branch-created': Object.freeze({ phase: 'Branch', label: 'Branch created', detail: 'GitHub confirmed branch creation; no files, commits, tests, or build are implied.' }),
  'create-branch:execution-blocked': Object.freeze({ phase: 'Branch', label: 'Branch action blocked', detail: 'The branch action did not complete. Review the scoped recovery state.' }),
  'create-branch:execution-cancelled': Object.freeze({ phase: 'Branch', label: 'Branch action cancelled', detail: 'No completed branch action is recorded.' }),
  'apply-file-change:change-applied': Object.freeze({ phase: 'Change', label: 'Reviewed commit applied', detail: 'GitHub confirmed the reviewed multi-file commit on the approved branch.' }),
  'apply-file-change:execution-blocked': Object.freeze({ phase: 'Change', label: 'File change blocked', detail: 'No successful file change is recorded. Review the scoped recovery state.' }),
  'validate:validation-recorded': Object.freeze({ phase: 'Validate', label: 'Validation still pending', detail: 'GitHub validation was read, but required completed evidence is still missing.' }),
  'validate:validation-passed': Object.freeze({ phase: 'Validate', label: 'Validation passed', detail: 'GitHub supplied all required completed validation evidence.' }),
  'validate:validation-failed': Object.freeze({ phase: 'Validate', label: 'Validation failed', detail: 'GitHub supplied a failed validation result.' }),
  'validate:execution-blocked': Object.freeze({ phase: 'Validate', label: 'Validation check blocked', detail: 'FounderLab could not read a complete GitHub validation result.' }),
  'review:review-ready': Object.freeze({ phase: 'Review', label: 'Review ready', detail: 'The committed change and validation evidence are ready for human review; no merge is implied.' }),
  'merge:merge-ready': Object.freeze({ phase: 'Merge', label: 'Merge ready', detail: 'An explicit future review record marked this merge-ready; it does not mean a merge occurred.' }),
  'merge:merge-not-ready': Object.freeze({ phase: 'Merge', label: 'Not ready to merge', detail: 'Review, validation, or approval requirements remain unresolved.' }),
  'retry-execution:execution-retried': Object.freeze({ phase: 'Recovery', label: 'Retry path restored', detail: 'A retryable block was cleared. No new external action is claimed.' }),
})

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) return ''
  return value
}

function getEntry(action, index) {
  const copy = EVENT_COPY[`${action?.id}:${action?.status}`]
  if (!copy) return null
  return Object.freeze({
    id: `${action.id}:${action.status}:${index}`,
    phase: copy.phase,
    label: copy.label,
    detail: copy.detail,
    ...(timestamp(action.at) ? { at: timestamp(action.at) } : {}),
    ...(action.resource?.title ? { resource: action.resource.title } : {}),
  })
}

/** A reusable source for later action-log, review, and merge surfaces. */
export function getExecutionEvidenceTrail(orchestration) {
  const actions = Array.isArray(orchestration?.actions) ? orchestration.actions : []
  const entries = actions.map(getEntry).filter(Boolean).slice(-12)
  const workflow = getExecutionWorkflowPresentation(orchestration?.workflow)
  if (workflow?.block) {
    entries.push(Object.freeze({
      id: `block:${workflow.block.code}`,
      phase: workflow.block.phase[0].toUpperCase() + workflow.block.phase.slice(1),
      label: 'Blocked next step',
      detail: workflow.detail,
    }))
  }
  return Object.freeze({
    version: 1,
    entries: Object.freeze(entries),
    ...(workflow ? { state: workflow.state } : {}),
  })
}
