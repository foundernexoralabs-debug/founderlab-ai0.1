/**
 * Present only evidence Chat has actually recorded. This is intentionally a
 * view-model, not a prompt trick: the UI can make the boundary between a
 * recommendation, an opened handoff, and a FounderLab-local completion clear
 * without implying an external repo, deployment, or Builder action occurred.
 */

import { getExecutionBridgePresentation } from './chatExecutionBridge.js'
import { getCapabilityBridgePresentation } from './chatCapabilityBridge.js'

const ACTION_COPY = Object.freeze({
  'save-note': 'Saved a note in FounderLab',
  'create-task': 'Created a task in FounderLab',
  builder: 'Opened a Builder handoff',
  code: 'Opened a Code AI handoff',
  github: 'Opened a GitHub-preparation handoff',
  youtube: 'Opened a YouTube AI handoff',
  'inspect-repo': 'Completed a read-only repository inspection',
  'prepare-branch': 'Prepared a branch-first change plan',
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
  'ready-for-execution': Object.freeze({ label: 'Ready for execution', detail: 'A scoped path is prepared. The user still chooses the explicit next action.' }),
  'handoff-opened': Object.freeze({ label: 'Handoff opened', detail: 'The destination was opened; no downstream result is confirmed.' }),
  'external-integration-needed': Object.freeze({ label: 'External integration needed', detail: 'A connection is required before FounderLab can perform this external action.' }),
  'waiting-for-approval': Object.freeze({ label: 'Waiting for approval', detail: 'The prepared change path requires explicit approval before any future repository mutation.' }),
  'completed-locally': Object.freeze({ label: 'Completed locally', detail: 'A FounderLab-local workspace action is recorded.' }),
  'externally-unverified': Object.freeze({ label: 'Externally unverified', detail: 'No external result is recorded or verified.' }),
})

/**
 * A reusable status projection for future action logs. It deliberately keeps
 * execution evidence and external integration availability separate.
 */
export function getChatExecutionState({ mode = 'conversation', actions = [], execution = null, capability = null } = {}) {
  const externalRoute = capability?.state === 'external-integration-needed'
    && ['email', 'calendar', 'external-app'].includes(capability.id)
  if (externalRoute) return Object.freeze({ key: 'external-integration-needed', ...EXECUTION_STATE_COPY['external-integration-needed'] })

  const completed = actions.find((action) => action.kind === 'completed')
  if (completed || execution?.readiness === 'completed-locally') return Object.freeze({ key: 'completed-locally', ...EXECUTION_STATE_COPY['completed-locally'] })

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
  if (state.key === 'external-integration-needed') return 'Connect the required integration before FounderLab attempts an external action; it can still prepare the draft or plan now.'
  if (state.key === 'inspection-needed') return 'Start the scoped inspection before deciding on a branch or implementation change.'
  if (state.key === 'inspection-completed') return 'Review the recorded findings, then prepare a branch-first plan or explicit Code AI handoff when appropriate.'
  if (state.key === 'branch-prepared') return 'Review the proposed branch scope and explicitly approve any future repository mutation.'
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
  const operational = mode !== 'conversation' || actions.length > 0 || execution || capability
  if (!operational) return null

  const completed = actions.find((action) => action.kind === 'completed')
  const inspection = actions.find((action) => action.kind === 'inspection')
  const branchPrepared = actions.find((action) => action.kind === 'branch-prepared')
  const handoff = actions.find((action) => action.kind === 'handoff')
  const outcome = completed
    ? { kind: 'completed', label: completed.label, detail: completed.detail }
    : branchPrepared
      ? { kind: 'branch-prepared', label: branchPrepared.label, detail: branchPrepared.detail }
      : inspection
        ? { kind: 'inspection', label: inspection.label, detail: inspection.detail }
        : handoff
          ? { kind: 'handoff', label: handoff.label, detail: handoff.detail }
          : {
              kind: 'recommendation',
              label: mode === 'planning' ? 'Plan prepared' : 'Recommendation prepared',
              detail: 'FounderLab has not performed a workspace or external action from this reply.',
            }

  const state = getChatExecutionState({ mode, actions, execution, capability })

  return Object.freeze({
    mode,
    operation,
    intentLabel: getIntentLabel(mode, operation),
    outcome,
    route,
    execution,
    capability,
    state,
    facts: Object.freeze(actions),
    nextStep: getExecutionNextStep({ state, completed, handoff }),
  })
}
