/**
 * Present only evidence Chat has actually recorded. This is intentionally a
 * view-model, not a prompt trick: the UI can make the boundary between a
 * recommendation, an opened handoff, and a FounderLab-local completion clear
 * without implying an external repo, deployment, or Builder action occurred.
 */

const ACTION_COPY = Object.freeze({
  'save-note': 'Saved a note in FounderLab',
  'create-task': 'Created a task in FounderLab',
  builder: 'Opened a Builder handoff',
  code: 'Opened a Code AI handoff',
  github: 'Opened a GitHub-preparation handoff',
  youtube: 'Opened a YouTube AI handoff',
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

export function getChatExecutionTransparency(orchestration) {
  if (!orchestration || typeof orchestration !== 'object') return null
  const mode = text(orchestration.mode) || 'conversation'
  const operation = text(orchestration.operation) || 'explain'
  const actions = Array.isArray(orchestration.actions) ? orchestration.actions.map(getActionFact).filter(Boolean) : []
  const route = getRouteFact(orchestration.routing)
  const operational = mode !== 'conversation' || actions.length > 0
  if (!operational) return null

  const completed = actions.find((action) => action.kind === 'completed')
  const handoff = actions.find((action) => action.kind === 'handoff')
  const outcome = completed
    ? { kind: 'completed', label: completed.label, detail: completed.detail }
    : handoff
      ? { kind: 'handoff', label: handoff.label, detail: handoff.detail }
      : {
          kind: 'recommendation',
          label: mode === 'planning' ? 'Plan prepared' : 'Recommendation prepared',
          detail: 'FounderLab has not performed a workspace or external action from this reply.',
        }

  return Object.freeze({
    mode,
    operation,
    intentLabel: getIntentLabel(mode, operation),
    outcome,
    route,
    facts: Object.freeze(actions),
    nextStep: completed
      ? 'You can continue from the recorded FounderLab action.'
      : handoff
        ? 'Continue in the opened destination to perform the next scoped action.'
        : 'Choose an explicit action when you want FounderLab to continue beyond this recommendation.',
  })
}
