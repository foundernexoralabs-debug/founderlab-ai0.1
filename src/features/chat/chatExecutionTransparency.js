/**
 * Present only evidence Chat has actually recorded. This is intentionally a
 * view-model, not a prompt trick: the UI can make the boundary between a
 * recommendation, an opened handoff, and a FounderLab-local completion clear
 * without implying an external repo, deployment, or Builder action occurred.
 */

import { getExecutionBridgePresentation } from './chatExecutionBridge.js'
import { getCapabilityBridgePresentation } from './chatCapabilityBridge.js'
import { getExecutionWorkflowPresentation } from './chatExecutionWorkflow.js'
import { getExecutionEvidenceTrail } from './chatExecutionTrail.js'
import { getConnectorPlanPresentation } from './chatConnectorFramework.js'

const ACTION_COPY = Object.freeze({
  'save-note': 'Saved a note in FounderLab',
  'create-task': 'Created a task in FounderLab',
  builder: 'Opened a Builder handoff',
  code: 'Opened a Code AI handoff',
  github: 'Opened a GitHub-preparation handoff',
  youtube: 'Opened a YouTube AI handoff',
  'inspect-repo': 'Completed a read-only repository inspection',
  'prepare-branch': 'Prepared a branch-first change plan',
  'prepare-execution': 'Prepared a branch-first execution workflow',
  'approve-execution': 'Recorded execution approval',
  'create-branch': 'Created an approved GitHub branch',
  'apply-file-change': 'Applied a reviewed GitHub file change',
  validate: 'Read GitHub validation',
  review: 'Prepared a human review summary',
  'retry-execution': 'Restored a retryable execution path',
  'connect-github': 'Opened GitHub connection settings',
})

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getActionFact(action) {
  if (!action?.id || !action?.status) return null
  const label = ACTION_COPY[action.id]
  if (!label) return null
  if (action.status === 'completed') {
    return { kind: 'completed', label, detail: 'This FounderLab workspace action is recorded.' }
  }
  if (action.status === 'handoff-opened') {
    return { kind: 'handoff', label, detail: 'The destination was opened; no external work is confirmed.' }
  }
  if (action.id === 'inspect-repo' && action.status === 'inspection-completed') {
    return { kind: 'inspection', label, detail: 'Public GitHub metadata and a bounded file tree were read. No branch or file was changed.' }
  }
  if (action.id === 'prepare-branch' && action.status === 'branch-prepared') {
    return { kind: 'branch-prepared', label, detail: 'A proposed branch and scope were prepared. No Git branch was created and no files were changed.' }
  }
  if (action.id === 'prepare-execution' && action.status === 'execution-prepared') {
    return { kind: 'execution-prepared', label, detail: 'Candidate files, validation needs, and risk were prepared. No branch was created, no files changed, and no validation ran.' }
  }
  if (action.id === 'approve-execution' && action.status === 'approval-recorded') {
    return { kind: 'approval-recorded', label, detail: 'Approval for a branch-first workflow is recorded. GitHub branch creation remains a separate explicit action; no repository mutation ran.' }
  }
  if (action.id === 'create-branch' && action.status === 'branch-created') {
    return { kind: 'branch-created', label, detail: 'GitHub confirmed branch creation. No files, commits, tests, build, review, or merge are recorded.' }
  }
  if (action.id === 'apply-file-change' && action.status === 'change-applied') {
    return { kind: 'change-applied', label, detail: 'GitHub confirmed one reviewed file commit on the approved branch. Validation and human review remain explicit next steps.' }
  }
  if (action.id === 'apply-file-change' && action.status === 'execution-blocked') {
    return { kind: 'execution-blocked', label: 'File change blocked', detail: 'No successful file change is recorded. Review the scoped recovery state before retrying.' }
  }
  if (action.id === 'validate' && action.status === 'validation-passed') {
    return { kind: 'validation-complete', label, detail: 'GitHub supplied all required completed validation evidence. Human review is still explicit and no merge is implied.' }
  }
  if (action.id === 'validate' && action.status === 'validation-recorded') {
    return { kind: 'validation-pending', label, detail: 'GitHub validation was read, but required completed evidence is still missing. Review and merge remain blocked.' }
  }
  if (action.id === 'validate' && action.status === 'validation-failed') {
    return { kind: 'execution-blocked', label: 'Validation failed', detail: 'GitHub supplied a failed validation result. No review or merge readiness is claimed.' }
  }
  if (action.id === 'review' && action.status === 'review-ready') {
    return { kind: 'review-ready', label, detail: 'The committed change and validation evidence are ready for human review. No pull request or merge was created.' }
  }
  if (action.id === 'retry-execution' && action.status === 'execution-retried') {
    return { kind: 'retry-restored', label, detail: 'A retryable block was cleared. No new external action is claimed.' }
  }
  if (action.id === 'create-branch' && action.status === 'execution-blocked') {
    return { kind: 'execution-blocked', label: 'Branch action blocked', detail: 'The branch action did not complete. The recorded recovery state explains the next boundary.' }
  }
  return null
}

function getRouteFact(routing) {
  if (!routing || typeof routing !== 'object') return null
  const provider = text(routing.selected?.provider || routing.recommended?.provider)
  const model = text(routing.selected?.model || routing.recommended?.model)
  const path = text(routing.selected?.path || routing.recommended?.path)
  if (!provider || !model || !['local', 'cloud'].includes(path)) return null
  return {
    label: `Route: ${path === 'local' ? 'Local' : 'Cloud'} ${provider} · ${model}`,
    detail: routing.selected ? 'This response used the selected route.' : 'This is a recommendation, not an automatic route change.',
  }
}

function getIntentLabel(mode, operation) {
  if (mode === 'planning') return `Understanding: a planning request${operation === 'plan' ? '' : ` · ${operation}`}`
  if (mode === 'follow-up') return `Understanding: a continuation of the current thread · ${operation}`
  return `Understanding: an operator request · ${operation}`
}

const EXECUTION_STATE_COPY = Object.freeze({
  'conversational-only': Object.freeze({ label: 'Conversational only', detail: 'No FounderLab action has been prepared or performed.' }),
  'plan-prepared': Object.freeze({ label: 'Plan prepared', detail: 'FounderLab prepared guidance; no execution has started.' }),
  'inspection-needed': Object.freeze({ label: 'Inspection needed', detail: 'FounderLab needs a scoped inspection before any execution claim.' }),
  'inspection-completed': Object.freeze({ label: 'Inspection completed', detail: 'A bounded, read-only inspection is recorded. No repository mutation is confirmed.' }),
  'branch-prepared': Object.freeze({ label: 'Branch plan prepared', detail: 'A branch-first change plan is recorded. No Git branch was created.' }),
  'execution-prepared': Object.freeze({ label: 'Execution workflow prepared', detail: 'Candidate scope and validation are recorded. No repository mutation or validation ran.' }),
  'approval-recorded': Object.freeze({ label: 'Approval recorded', detail: 'Approval is recorded. GitHub branch creation remains a separate explicit action; no repository mutation has run.' }),
  'branch-created': Object.freeze({ label: 'Branch created', detail: 'GitHub confirmed branch creation. File changes, validation, review, and merge remain unverified.' }),
  'change-applied': Object.freeze({ label: 'File change applied', detail: 'GitHub confirmed one reviewed file commit. Validation and human review remain explicit next steps.' }),
  'validation-complete': Object.freeze({ label: 'Validation complete', detail: 'Required completed validation evidence is recorded. Human review is still required and no merge is implied.' }),
  'review-ready': Object.freeze({ label: 'Ready for review', detail: 'The committed change and validation evidence are ready for human review. No pull request or merge is recorded.' }),
  'merge-ready': Object.freeze({ label: 'Ready to merge', detail: 'A future review record marked this ready to merge. No merge has been performed.' }),
  'execution-blocked': Object.freeze({ label: 'Execution blocked', detail: 'The next action is blocked by a recorded capability, conflict, failure, or recovery boundary.' }),
  'ready-for-execution': Object.freeze({ label: 'Ready for execution', detail: 'A scoped path is prepared. The user still chooses the explicit next action.' }),
  'handoff-opened': Object.freeze({ label: 'Handoff opened', detail: 'The destination was opened; no downstream result is confirmed.' }),
  'external-integration-needed': Object.freeze({ label: 'External integration needed', detail: 'A connection is required before FounderLab can perform this external action.' }),
  'connector-install-needed': Object.freeze({ label: 'Connector available to install', detail: 'This capability is available, but its connector is not installed. FounderLab did not attempt an external action.' }),
  'connector-configuration-needed': Object.freeze({ label: 'Connector setup needed', detail: 'This connector is installed but not configured for this workspace. FounderLab did not attempt an external action.' }),
  'connector-unavailable': Object.freeze({ label: 'Connector temporarily unavailable', detail: 'The connector is temporarily unavailable. FounderLab did not attempt an external action.' }),
  'authorization-needed': Object.freeze({ label: 'Authorization needed', detail: 'The connected integration is not authorized for this workflow.' }),
  'read-only-integration': Object.freeze({ label: 'Read-only boundary', detail: 'The integration can inspect state but cannot perform the requested mutation.' }),
  'waiting-for-approval': Object.freeze({ label: 'Waiting for approval', detail: 'The prepared change path requires explicit approval before any future repository mutation.' }),
  'completed-locally': Object.freeze({ label: 'Completed locally', detail: 'A FounderLab-local workspace action is recorded.' }),
  'externally-unverified': Object.freeze({ label: 'Externally unverified', detail: 'No external result is recorded or verified.' }),
})

/**
 * A reusable status projection for future action logs. It deliberately keeps
 * execution evidence and external integration availability separate.
 */
export function getChatExecutionState({ mode = 'conversation', actions = [], execution = null, capability = null, connector = null, workflow = null } = {}) {
  const connectorState = ['connector-install-needed', 'connector-configuration-needed', 'connector-unavailable', 'authorization-needed', 'read-only-integration', 'waiting-for-approval'].includes(connector?.state)
    ? connector.state
    : connector?.decision === 'integration-blocked'
      ? 'external-integration-needed'
      : connector?.decision === 'approval-required'
        ? 'waiting-for-approval'
        : ''
  if (connectorState) return Object.freeze({ key: connectorState, ...EXECUTION_STATE_COPY[connectorState] })
  const capabilityState = ['connector-install-needed', 'connector-configuration-needed', 'connector-unavailable', 'authorization-needed', 'read-only-integration'].includes(capability?.state)
    ? capability.state
    : capability?.state === 'external-integration-needed' && ['email', 'calendar', 'external-app'].includes(capability.id)
      ? 'external-integration-needed'
      : ''
  if (capabilityState) return Object.freeze({ key: capabilityState, ...EXECUTION_STATE_COPY[capabilityState] })

  const blocked = actions.find((action) => action.kind === 'execution-blocked')
  if (blocked || workflow?.state === 'execution-blocked') return Object.freeze({ key: 'execution-blocked', ...EXECUTION_STATE_COPY['execution-blocked'] })

  const changeApplied = actions.find((action) => action.kind === 'change-applied')
  const validationComplete = actions.find((action) => action.kind === 'validation-complete')
  const reviewReady = actions.find((action) => action.kind === 'review-ready')
  if (reviewReady || workflow?.state === 'review-ready') return Object.freeze({ key: 'review-ready', ...EXECUTION_STATE_COPY['review-ready'] })
  if (workflow?.state === 'merge-ready') return Object.freeze({ key: 'merge-ready', ...EXECUTION_STATE_COPY['merge-ready'] })
  if (validationComplete || workflow?.state === 'validation-complete') return Object.freeze({ key: 'validation-complete', ...EXECUTION_STATE_COPY['validation-complete'] })
  if (changeApplied || workflow?.state === 'change-applied') return Object.freeze({ key: 'change-applied', ...EXECUTION_STATE_COPY['change-applied'] })
  const branchCreated = actions.find((action) => action.kind === 'branch-created')
  if (branchCreated || workflow?.state === 'branch-created') return Object.freeze({ key: 'branch-created', ...EXECUTION_STATE_COPY['branch-created'] })

  const completed = actions.find((action) => action.kind === 'completed')
  if (completed || execution?.readiness === 'completed-locally') return Object.freeze({ key: 'completed-locally', ...EXECUTION_STATE_COPY['completed-locally'] })

  const approvalRecorded = actions.find((action) => action.kind === 'approval-recorded')
  if (approvalRecorded || workflow?.state === 'approval-recorded') return Object.freeze({ key: 'approval-recorded', ...EXECUTION_STATE_COPY['approval-recorded'] })

  const executionPrepared = actions.find((action) => action.kind === 'execution-prepared')
  if (executionPrepared || workflow?.state === 'execution-prepared') return Object.freeze({ key: 'execution-prepared', ...EXECUTION_STATE_COPY['execution-prepared'] })

  const branchPrepared = actions.find((action) => action.kind === 'branch-prepared')
  if (branchPrepared) return Object.freeze({ key: 'branch-prepared', ...EXECUTION_STATE_COPY['branch-prepared'] })

  const inspection = actions.find((action) => action.kind === 'inspection')
  if (inspection) return Object.freeze({ key: 'inspection-completed', ...EXECUTION_STATE_COPY['inspection-completed'] })

  const handoff = actions.find((action) => action.kind === 'handoff')
  if (handoff) return Object.freeze({ key: 'handoff-opened', ...EXECUTION_STATE_COPY['handoff-opened'] })

  const executionState = {
    'ready-to-inspect': 'inspection-needed',
    'ready-to-handoff': 'ready-for-execution',
    'execution-path-selected': 'ready-for-execution',
    'waiting-for-approval': 'waiting-for-approval',
    'externally-unverified': 'externally-unverified',
  }[execution?.readiness]
  if (executionState) return Object.freeze({ key: executionState, ...EXECUTION_STATE_COPY[executionState] })

  if (mode === 'planning') return Object.freeze({ key: 'plan-prepared', ...EXECUTION_STATE_COPY['plan-prepared'] })
  return Object.freeze({ key: 'conversational-only', ...EXECUTION_STATE_COPY['conversational-only'] })
}

function getExecutionNextStep({ state, completed, handoff }) {
  if (state.key === 'connector-install-needed') return 'Install or connect the required connector before FounderLab attempts this external action; it can still prepare guidance in Chat now.'
  if (state.key === 'connector-configuration-needed') return 'Finish the connector setup before FounderLab attempts this external action; it can still prepare guidance in Chat now.'
  if (state.key === 'connector-unavailable') return 'Retry when the connector is available, or use the recorded safe fallback. FounderLab did not attempt the external action.'
  if (state.key === 'external-integration-needed') return 'Connect the required integration before FounderLab attempts an external action; it can still prepare the draft or plan now.'
  if (state.key === 'authorization-needed') return 'Reconnect the integration with the required authorization before attempting the requested external action.'
  if (state.key === 'read-only-integration') return 'Use the available read-only inspection path, then obtain writable authorization before any branch or file mutation.'
  if (state.key === 'inspection-needed') return 'Start the scoped inspection before deciding on a branch or implementation change.'
  if (state.key === 'inspection-completed') return 'Review the recorded findings, then prepare a branch-first plan or explicit Code AI handoff when appropriate.'
  if (state.key === 'branch-prepared') return 'Review the proposed branch scope and explicitly approve any future repository mutation.'
  if (state.key === 'execution-prepared') return 'Review the candidate file scope, risk, and validation needs, then explicitly approve the future branch-first workflow.'
  if (state.key === 'approval-recorded') return 'Approval is recorded. Connect GitHub if needed, then explicitly create the approved branch. File changes, validation, review, and merge require later explicit execution steps.'
  if (state.key === 'branch-created') return 'Inspect the selected file scope before an explicit file-change action. Tests, build, review, and merge are not ready yet.'
  if (state.key === 'change-applied') return 'Read the native GitHub validation evidence for this commit before preparing it for human review.'
  if (state.key === 'validation-complete') return 'Prepare the review summary. A human review remains required and no merge is implied.'
  if (state.key === 'review-ready') return 'Review the recorded changed-file scope and validation evidence. A pull request or merge still requires a later explicit workflow.'
  if (state.key === 'merge-ready') return 'A future review workflow may explicitly create or merge a pull request. No merge is recorded here.'
  if (state.key === 'execution-blocked') return 'Resolve the recorded recovery boundary before attempting another branch, change, validation, or review action.'
  if (state.key === 'waiting-for-approval') return 'Review the proposed scope, risk, and verification, then explicitly approve any future branch-first change.'
  if (state.key === 'ready-for-execution') return 'Choose the explicit FounderLab handoff when you want to continue with this prepared path.'
  if (state.key === 'externally-unverified') return 'Confirm the downstream result with evidence before reporting external completion.'
  if (completed) return 'You can continue from the recorded FounderLab action.'
  if (handoff) return 'Continue in the opened destination to perform the next scoped action.'
  return 'Choose an explicit action when you want FounderLab to continue beyond this recommendation.'
}

export function getChatExecutionTransparency(orchestration) {
  if (!orchestration || typeof orchestration !== 'object') return null
  const mode = text(orchestration.mode) || 'conversation'
  const operation = text(orchestration.operation) || 'explain'
  const actions = Array.isArray(orchestration.actions) ? orchestration.actions.map(getActionFact).filter(Boolean) : []
  const route = getRouteFact(orchestration.routing)
  const execution = getExecutionBridgePresentation(orchestration.execution)
  const capability = getCapabilityBridgePresentation(orchestration.capabilities)
  const connector = getConnectorPlanPresentation(orchestration.connectorPlan)
  const workflow = getExecutionWorkflowPresentation(orchestration.workflow)
  const trail = getExecutionEvidenceTrail(orchestration)
  const operational = mode !== 'conversation' || actions.length > 0 || execution || capability || connector || workflow
  if (!operational) return null

  const completed = actions.find((action) => action.kind === 'completed')
  const inspection = actions.find((action) => action.kind === 'inspection')
  const branchPrepared = actions.find((action) => action.kind === 'branch-prepared')
  const executionPrepared = actions.find((action) => action.kind === 'execution-prepared')
  const approvalRecorded = actions.find((action) => action.kind === 'approval-recorded')
  const branchCreated = actions.find((action) => action.kind === 'branch-created')
  const changeApplied = actions.find((action) => action.kind === 'change-applied')
  const validationComplete = actions.find((action) => action.kind === 'validation-complete')
  const reviewReady = actions.find((action) => action.kind === 'review-ready')
  const executionBlocked = actions.find((action) => action.kind === 'execution-blocked')
  const handoff = actions.find((action) => action.kind === 'handoff')
  let outcome = {
    kind: 'recommendation',
    label: mode === 'planning' ? 'Plan prepared' : 'Recommendation prepared',
    detail: 'FounderLab has not performed a workspace or external action from this reply.',
  }
  if (handoff) outcome = { kind: 'handoff', label: handoff.label, detail: handoff.detail }
  if (inspection) outcome = { kind: 'inspection', label: inspection.label, detail: inspection.detail }
  if (branchPrepared) outcome = { kind: 'branch-prepared', label: branchPrepared.label, detail: branchPrepared.detail }
  if (executionPrepared) outcome = { kind: 'execution-prepared', label: executionPrepared.label, detail: executionPrepared.detail }
  if (approvalRecorded) outcome = { kind: 'approval-recorded', label: approvalRecorded.label, detail: approvalRecorded.detail }
  if (branchCreated) outcome = { kind: 'branch-created', label: branchCreated.label, detail: branchCreated.detail }
  if (changeApplied) outcome = { kind: 'change-applied', label: changeApplied.label, detail: changeApplied.detail }
  if (validationComplete) outcome = { kind: 'validation-complete', label: validationComplete.label, detail: validationComplete.detail }
  if (reviewReady) outcome = { kind: 'review-ready', label: reviewReady.label, detail: reviewReady.detail }
  if (executionBlocked) outcome = { kind: 'execution-blocked', label: executionBlocked.label, detail: executionBlocked.detail }
  if (completed) outcome = { kind: 'completed', label: completed.label, detail: completed.detail }

  const state = getChatExecutionState({ mode, actions, execution, capability, connector, workflow })

  return Object.freeze({
    mode,
    operation,
    intentLabel: getIntentLabel(mode, operation),
    outcome,
    route,
    execution,
    capability,
    connector,
    workflow,
    trail,
    state,
    facts: Object.freeze(actions),
    nextStep: getExecutionNextStep({ state, completed, handoff }),
  })
}
