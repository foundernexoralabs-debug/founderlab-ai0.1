/**
 * The execution bridge describes the next *possible* operational step in a
 * Chat request. It is deliberately evidence-only: it can prepare a scoped
 * inspection or handoff, but it cannot claim that a repository, branch, or
 * external tool was changed.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'
import { isChatExecutionActionId, isChatExecutionActionStatus } from './chatExecutionVocabulary.js'

const SURFACES = new Set(['workspace', 'builder', 'code', 'repository', 'github', 'project'])
const OPERATIONS = new Set(['explain', 'plan', 'capture', 'create', 'change', 'inspect', 'handoff', 'continue'])
const REPO_AWARENESS = new Set(['not-needed', 'needed', 'not-yet-known'])
const READINESS = new Set([
  'not-started',
  'ready-to-inspect',
  'ready-to-handoff',
  'execution-path-selected',
  'waiting-for-approval',
  'completed-locally',
  'externally-unverified',
])
const RISK_LEVELS = new Set(['none', 'low', 'medium', 'high'])
const BRANCH_REQUIREMENTS = new Set(['not-needed', 'recommended', 'required'])
const INSPECTION_REQUIREMENTS = new Set(['not-needed', 'recommended', 'required', 'completed'])
const APPROVAL_REQUIREMENTS = new Set(['not-required', 'required'])
const HANDOFFS = new Set(['builder', 'code', 'github'])

function text(value, limit = 160) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeProject(value) {
  if (!isRecord(value)) return null
  const id = text(value.id)
  const name = text(value.name || value.title, 120)
  const type = text(value.type || value.kind || 'project', 36) || 'project'
  if (!id || !name) return null
  return Object.freeze({ id, name, type })
}

function normalizeTask(value) {
  if (!isRecord(value)) return null
  const id = text(value.id)
  const title = text(value.title || value.name, 120)
  const status = text(value.status || 'todo', 28) || 'todo'
  if (!id || !title) return null
  return Object.freeze({ id, title, status })
}

function normalizeRepository(value) {
  if (!isRecord(value) || value.provider !== 'github') return null
  const parsed = parsePublicGithubRepositoryReference(value.slug || `${value.owner || ''}/${value.name || ''}`)
  return parsed || null
}

function normalizeTarget(value) {
  if (!isRecord(value) || !SURFACES.has(value.surface)) return null
  const project = normalizeProject(value.project)
  const task = normalizeTask(value.task)
  const repository = normalizeRepository(value.repository)
  return Object.freeze({
    surface: value.surface,
    ...(project ? { project } : {}),
    ...(task ? { task } : {}),
    ...(repository ? { repository } : {}),
  })
}

/**
 * Restrict persisted bridge evidence to bounded workspace identifiers and
 * explicit state. Request text, repository paths, credentials, and provider
 * internals never enter a message's orchestration metadata.
 */
export function normalizeExecutionBridgeEvidence(value) {
  if (!isRecord(value)) return null
  const target = normalizeTarget(value.target)
  if (!target || !OPERATIONS.has(value.requestedOperation) || !READINESS.has(value.readiness)) return null
  const handoff = HANDOFFS.has(value.handoff) ? value.handoff : ''
  return Object.freeze({
    version: 1,
    target,
    requestedOperation: value.requestedOperation,
    repoAwareness: REPO_AWARENESS.has(value.repoAwareness) ? value.repoAwareness : 'not-yet-known',
    readiness: value.readiness,
    risk: RISK_LEVELS.has(value.risk) ? value.risk : 'none',
    branch: BRANCH_REQUIREMENTS.has(value.branch) ? value.branch : 'not-needed',
    inspection: INSPECTION_REQUIREMENTS.has(value.inspection) ? value.inspection : 'not-needed',
    approval: APPROVAL_REQUIREMENTS.has(value.approval) ? value.approval : 'not-required',
    ...(handoff ? { handoff } : {}),
  })
}

function normalizedRequest(value) {
  return text(value, 900).toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasRequestTerm(request, terms) {
  const padded = ` ${normalizedRequest(request)} `
  return terms.some((term) => padded.includes(` ${term} `))
}

function repositoryFromInspectionAction(action) {
  const identifier = typeof action?.resource?.id === 'string' ? action.resource.id : ''
  const value = identifier.startsWith('github:') ? identifier.slice('github:'.length).split('@')[0] : action?.resource?.title
  return parsePublicGithubRepositoryReference(value)
}

function latestInspectedRepository(actions) {
  if (!Array.isArray(actions)) return null
  const action = [...actions].reverse().find((entry) => entry?.id === 'inspect-repo' && entry?.status === 'inspection-completed')
  return repositoryFromInspectionAction(action)
}

function targetSurface({ intent, request, knownRepository = null }) {
  if ((parsePublicGithubRepositoryReference(request) || knownRepository) && ['inspect', 'change', 'create', 'continue', 'handoff'].includes(intent?.operation)) return 'repository'
  if (intent?.primaryTool === 'builder') return 'builder'
  if (intent?.primaryTool === 'github') return 'github'
  if (intent?.wantsTask || intent?.wantsNote || intent?.operation === 'capture') return 'workspace'
  const repoLanguage = hasRequestTerm(request, ['bug', 'crash', 'error', 'codebase', 'repository', 'repo', 'branch', 'pull request', 'commit', 'implementation', 'feature', 'test', 'tests', 'api', 'component', 'refactor', 'debug'])
    || (intent?.operation === 'inspect' && hasRequestTerm(request, ['project']))
  if (repoLanguage && ['inspect', 'change', 'create', 'continue', 'handoff'].includes(intent?.operation)) return 'repository'
  if (intent?.primaryTool === 'code') return 'code'
  if (intent?.operation === 'inspect' || intent?.operation === 'change') return 'project'
  return 'project'
}

function needsRepository(surface, intent, request, knownRepository = null) {
  if (knownRepository) return true
  if (['repository', 'code', 'github'].includes(surface)) return true
  if (surface === 'builder' || surface === 'workspace') return false
  return hasRequestTerm(request, ['repository', 'repo', 'codebase', 'branch', 'pull request', 'commit', 'bug', 'debug', 'refactor', 'test', 'implementation', 'api'])
    && ['inspect', 'change', 'create', 'continue', 'handoff'].includes(intent?.operation)
}

function selectHandoff(surface, intent) {
  if (surface === 'builder') return 'builder'
  if (surface === 'github' || intent?.primaryTool === 'github') return 'github'
  if (['repository', 'code'].includes(surface)) return 'code'
  return ''
}

function latestMatchingAction(actions, handoff) {
  if (!Array.isArray(actions)) return null
  return [...actions].reverse().find((action) => isChatExecutionActionId(action?.id)
    && isChatExecutionActionStatus(action?.status)
    && (!handoff || action.id === handoff || (handoff === 'github' && action.id === 'code'))) || null
}

function latestAction(actions, id, status) {
  if (!Array.isArray(actions)) return null
  return [...actions].reverse().find((action) => action?.id === id && action?.status === status) || null
}

function determineReadiness({ intent, surface, repoAwareness, branch, inspection, handoff, actions, modelRouting }) {
  const action = latestMatchingAction(actions, handoff)
  if (action?.status === 'completed') return 'completed-locally'
  if (action?.status === 'handoff-opened') return 'externally-unverified'
  if (repoAwareness === 'needed' && inspection !== 'completed') return 'ready-to-inspect'
  if (branch === 'required') return 'waiting-for-approval'
  if (handoff) return 'ready-to-handoff'
  if (intent?.isOperational && modelRouting?.recommendation) return 'execution-path-selected'
  if (surface === 'workspace' && intent?.isOperational) return 'ready-to-handoff'
  return 'not-started'
}

function riskFor({ surface, operation, repoAwareness, mutatingRequest = false }) {
  if (surface === 'github') return 'high'
  if (repoAwareness === 'needed' && (mutatingRequest || ['change', 'create'].includes(operation))) return 'medium'
  if (repoAwareness === 'needed' || surface === 'builder' || surface === 'code') return 'low'
  return 'none'
}

function inspectionRequirement({ repoAwareness, operation, actions, request, repository }) {
  const matchingInspection = Array.isArray(actions) && repository
    ? [...actions].reverse().find((action) => action?.id === 'inspect-repo'
      && action?.status === 'inspection-completed'
      && repositoryFromInspectionAction(action)?.slug === repository.slug)
    : null
  if (repoAwareness === 'needed' && matchingInspection) return 'completed'
  if (repoAwareness !== 'needed') return 'not-needed'
  if (['inspect', 'change', 'create'].includes(operation) || hasRequestTerm(request, ['fix', 'debug', 'repair', 'refactor', 'improve', 'change', 'update', 'implement'])) return 'required'
  return 'recommended'
}

/**
 * Derive a concrete, honest execution-preparation state from the request,
 * saved project metadata, model routing, and recorded Chat actions. This does
 * not inspect a repo, create a branch, or execute a destination action.
 */
export function getChatExecutionBridge({ request = '', intent = null, projectAwareness = null, modelRouting = null } = {}) {
  const safeIntent = intent || {}
  const knownRepository = latestInspectedRepository(projectAwareness?.actions)
  const surface = targetSurface({ intent: safeIntent, request, knownRepository })
  const repoAwareness = needsRepository(surface, safeIntent, request, knownRepository) ? 'needed' : 'not-needed'
  const mutatingRequest = ['change', 'create'].includes(safeIntent.operation)
    || hasRequestTerm(request, ['fix', 'debug', 'repair', 'refactor', 'improve', 'change', 'update', 'implement'])
  const branch = repoAwareness === 'needed'
    ? mutatingRequest || (surface === 'github' && safeIntent.operation === 'handoff')
      ? 'required'
      : 'recommended'
    : 'not-needed'
  const approval = branch === 'required' ? 'required' : 'not-required'
  const requestedRepository = parsePublicGithubRepositoryReference(request)
  const repository = repoAwareness === 'needed' ? requestedRepository || knownRepository : null
  const inspection = inspectionRequirement({
    repoAwareness,
    operation: safeIntent.operation,
    actions: projectAwareness?.actions,
    request,
    repository,
  })
  const handoff = selectHandoff(surface, safeIntent)
  const project = normalizeProject(projectAwareness?.project)
  const task = normalizeTask(projectAwareness?.task)
  const target = {
    surface,
    ...(project ? { project } : {}),
    ...(task ? { task } : {}),
    ...(repository ? { repository } : {}),
  }
  const readiness = determineReadiness({
    intent: safeIntent,
    surface,
    repoAwareness,
    branch,
    inspection,
    handoff,
    actions: projectAwareness?.actions,
    modelRouting,
  })
  return normalizeExecutionBridgeEvidence({
    target,
    requestedOperation: OPERATIONS.has(safeIntent.operation) ? safeIntent.operation : 'explain',
    repoAwareness,
    readiness,
    risk: riskFor({ surface, operation: safeIntent.operation, repoAwareness, mutatingRequest }),
    branch,
    inspection,
    approval,
    ...(handoff ? { handoff } : {}),
  })
}

const READINESS_COPY = Object.freeze({
  'not-started': 'Not started',
  'ready-to-inspect': 'Ready to inspect',
  'ready-to-handoff': 'Ready to hand off',
  'execution-path-selected': 'Execution path selected',
  'waiting-for-approval': 'Waiting for approval',
  'completed-locally': 'Completed locally',
  'externally-unverified': 'Externally unverified',
})

function targetLabel(target) {
  const surface = {
    workspace: 'FounderLab workspace',
    builder: 'Builder',
    code: 'Code AI',
    repository: 'repository work',
    github: 'GitHub preparation',
    project: 'project work',
  }[target?.surface] || 'project work'
  const scope = target?.repository?.slug || target?.project?.name || ''
  return scope ? `${scope} · ${surface}` : surface
}

/** Prompt-ready transparency guidance. It explicitly prevents an execution plan from becoming a claim. */
export function getExecutionBridgeGuidance(bridge) {
  const execution = normalizeExecutionBridgeEvidence(bridge)
  if (!execution || execution.readiness === 'not-started') return ''
  const notes = [
    `Execution bridge: target ${targetLabel(execution.target)}; requested operation ${execution.requestedOperation}; state ${READINESS_COPY[execution.readiness].toLowerCase()}. This is preparation evidence, not proof that a tool, repository, branch, or external system was changed.`,
  ]
  if (execution.repoAwareness === 'needed') {
    notes.push(execution.target.repository
      ? execution.inspection === 'completed'
        ? `Requested repository reference: ${execution.target.repository.slug}. A bounded, read-only inspection is recorded; it does not confirm every file, test, branch, or external state.`
        : `Requested repository reference: ${execution.target.repository.slug}. Its contents, branch, tests, and external state have not been inspected in this Chat turn.`
      : 'Repository awareness is needed, but no repository reference is selected yet. No repository contents, branch, tests, or external state have been inspected. Ask for or offer a public GitHub URL or owner/repository reference before claiming inspection findings.')
  }
  if (execution.inspection === 'required') {
    notes.push('Inspection is required before any future execution: identify scope and verification first, then wait for the separate branch or approval boundary when applicable.')
  } else if (execution.inspection === 'recommended') {
    notes.push('A scoped inspection is recommended before a future execution handoff. No inspection result is currently recorded.')
  } else if (execution.inspection === 'completed') {
    notes.push('A bounded, read-only repository inspection is recorded in this thread. It does not prove that every file, test, branch, or external state was inspected; use the recorded findings before a future change.')
  }
  if (execution.branch === 'required') {
    notes.push('This change path should be branch-first and requires explicit approval before any future branch or repository mutation. State the intended scope, verification, and risk clearly; do not imply a branch exists.')
  } else if (execution.branch === 'recommended') {
    notes.push('A future branch-first workflow is recommended if inspection becomes a change. No branch has been selected or created.')
  }
  if (execution.readiness === 'ready-to-handoff') notes.push('Offer the scoped destination handoff as the next explicit action; opening it is not downstream execution.')
  if (execution.readiness === 'externally-unverified') notes.push('A destination handoff was opened, but no external outcome is verified. Ask for or prepare the next scoped inspection rather than reporting completion.')
  if (execution.readiness === 'completed-locally') notes.push('Only the recorded FounderLab-local workspace action is complete. Keep any external consequence unverified unless explicit evidence is present.')
  return notes.join(' ')
}

/** A compact UI view-model for the existing Operator report. */
export function getExecutionBridgePresentation(value) {
  const execution = normalizeExecutionBridgeEvidence(value)
  if (!execution || execution.readiness === 'not-started') return null
  const detailByState = {
    'ready-to-inspect': 'FounderLab has a scoped inspection path. Repository contents and branch state have not been inspected.',
    'ready-to-handoff': 'FounderLab prepared a scoped destination handoff. No work has run in that destination.',
    'execution-path-selected': 'FounderLab selected a preparation path. No execution has started.',
    'waiting-for-approval': 'A branch-first change path is prepared. Explicit approval is still required before any future repository mutation.',
    'completed-locally': 'A FounderLab-local workspace action is recorded. External work remains unverified.',
    'externally-unverified': 'A destination was opened, but no downstream result is verified.',
  }
  const branch = execution.branch === 'required'
    ? 'Branch-first change required'
    : execution.branch === 'recommended'
      ? 'Branch-first change recommended'
      : ''
  const inspection = execution.inspection === 'required'
    ? 'Inspection required before execution'
    : execution.inspection === 'recommended'
      ? 'Inspection recommended before execution'
      : execution.inspection === 'completed'
        ? 'Read-only inspection completed'
      : ''
  return Object.freeze({
    readiness: execution.readiness,
    label: `Execution bridge: ${READINESS_COPY[execution.readiness]}`,
    detail: detailByState[execution.readiness] || 'FounderLab has not started execution.',
    target: targetLabel(execution.target),
    ...(branch ? { branch } : {}),
    ...(inspection ? { inspection } : {}),
  })
}

/** Return only a real, existing destination action; this never triggers execution itself. */
export function getExecutionBridgeHandoffAction(value) {
  const execution = normalizeExecutionBridgeEvidence(value)
  if (!execution || !execution.handoff || ['completed-locally', 'externally-unverified', 'waiting-for-approval'].includes(execution.readiness)) return ''
  if (execution.inspection === 'required') return ''
  return execution.handoff
}
