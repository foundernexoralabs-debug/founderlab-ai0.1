/**
 * A bounded, evidence-first execution workflow for Chat. It can record a
 * prepared change path and explicit approval, but it never performs a git
 * mutation, file edit, test run, build, or merge. Those operations require a
 * future authenticated server-side executor.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'

const MAX_FILE_TARGETS = 6
const MAX_BRANCH_LENGTH = 96
const MAX_TEXT_LENGTH = 180
const BRANCH_STATES = new Set(['not-needed', 'planned', 'created'])
const CHANGE_STATES = new Set(['not-started', 'prepared', 'applied'])
const VALIDATION_STATES = new Set(['not-needed', 'required', 'not-run', 'passed', 'failed'])
const APPROVAL_STATES = new Set(['not-required', 'required', 'approved', 'rejected'])
const REVIEW_STATES = new Set(['not-required', 'awaiting-approval', 'awaiting-executor', 'awaiting-validation', 'ready-to-merge', 'not-ready'])
const EXECUTION_STATES = new Set(['not-started', 'prepared', 'awaiting-approval', 'awaiting-executor', 'change-applied', 'validation-complete', 'reported', 'externally-unverified'])
const EXECUTOR_STATES = new Set(['not-available', 'available', 'started'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, limit = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function safePath(value) {
  const path = text(value, 220)
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) return ''
  return path
}

function normalizeRepository(value) {
  if (!isRecord(value) || value.provider !== 'github') return null
  return parsePublicGithubRepositoryReference(value.slug || `${value.owner || ''}/${value.name || ''}`)
}

function normalizeFileTargets(value) {
  if (!Array.isArray(value)) return Object.freeze([])
  const seen = new Set()
  return Object.freeze(value.reduce((items, entry) => {
    const path = safePath(entry)
    if (!path || seen.has(path) || items.length >= MAX_FILE_TARGETS) return items
    seen.add(path)
    items.push(path)
    return items
  }, []))
}

function normalizeBranch(value, repository) {
  if (!isRecord(value) || !BRANCH_STATES.has(value.state)) return null
  const base = text(value.base, 100)
  const proposed = text(value.proposed, MAX_BRANCH_LENGTH)
  if (value.state === 'not-needed') return Object.freeze({ state: 'not-needed' })
  if (!repository || !base || !proposed) return null
  return Object.freeze({ state: value.state, base, proposed })
}

function normalizeValidation(value) {
  if (!isRecord(value)) return null
  const tests = VALIDATION_STATES.has(value.tests) ? value.tests : ''
  const build = VALIDATION_STATES.has(value.build) ? value.build : ''
  const report = VALIDATION_STATES.has(value.report) ? value.report : ''
  if (!tests || !build || !report) return null
  return Object.freeze({ tests, build, report })
}

function normalizeChange(value) {
  if (!isRecord(value) || !CHANGE_STATES.has(value.state)) return null
  const risk = ['low', 'medium', 'high'].includes(value.risk) ? value.risk : ''
  if (!risk) return null
  return Object.freeze({ state: value.state, risk, fileTargets: normalizeFileTargets(value.fileTargets) })
}

/** Persist only compact execution evidence, never raw repository data or credentials. */
export function normalizeExecutionWorkflow(value) {
  if (!isRecord(value) || value.version !== 1) return null
  const repository = normalizeRepository(value.repository)
  const branch = normalizeBranch(value.branch, repository)
  const change = normalizeChange(value.change)
  const validation = normalizeValidation(value.validation)
  const approval = APPROVAL_STATES.has(value.approval) ? value.approval : ''
  const review = REVIEW_STATES.has(value.review) ? value.review : ''
  const execution = EXECUTION_STATES.has(value.execution) ? value.execution : ''
  const executor = EXECUTOR_STATES.has(value.executor) ? value.executor : ''
  if (!repository || !branch || !change || !validation || !approval || !review || !execution || !executor) return null
  return Object.freeze({ version: 1, repository, branch, change, validation, approval, review, execution, executor })
}

function requestTerms(value) {
  return text(value, 800).toLowerCase()
}

function isDocumentationScope(request, fileTargets) {
  if (/\b(?:readme|docs?|documentation)\b/.test(request)) return true
  return fileTargets.length > 0 && fileTargets.every((path) => /(?:^|\/)(?:readme(?:\.md)?|docs?\/)/i.test(path))
}

function scoreFile(path, request) {
  let score = 0
  if (/package\.json$/i.test(path)) score += 12
  if (/^(?:src|app|pages|components)\//i.test(path)) score += 8
  if (/(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)) score += /\b(?:test|coverage|regression)\b/.test(request) ? 16 : 4
  if (/readme(?:\.md)?$/i.test(path)) score += /\b(?:docs?|readme|document)\b/.test(request) ? 16 : 3
  if (/\b(?:api|server|route|endpoint)\b/.test(request) && /(?:api|server|route)/i.test(path)) score += 12
  if (/\b(?:component|ui|screen|onboarding|frontend)\b/.test(request) && /(?:src|app|pages|components)/i.test(path)) score += 8
  return score
}

/** Select candidates to review, never claim that any of them will be edited. */
export function getExecutionFileTargets({ inspection = null, request = '' } = {}) {
  const paths = [
    ...(Array.isArray(inspection?.tree?.importantFiles) ? inspection.tree.importantFiles : []),
    ...(Array.isArray(inspection?.tree?.sampleFiles) ? inspection.tree.sampleFiles : []),
  ]
  const unique = [...new Set(paths.map(safePath).filter(Boolean))]
  const normalizedRequest = requestTerms(request)
  return Object.freeze(unique
    .map((path) => ({ path, score: scoreFile(path, normalizedRequest) }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_FILE_TARGETS)
    .map((entry) => entry.path))
}

/**
 * Build a local execution record after a repository was inspected and a
 * branch-first plan was deliberately prepared. Its executor is explicitly
 * unavailable until a future authenticated server-side action runner exists.
 */
export function createExecutionWorkflow({ inspection = null, preparation = null, request = '' } = {}) {
  const repository = normalizeRepository(preparation?.repository || inspection?.reference)
  const base = text(preparation?.baseBranch || inspection?.repository?.defaultBranch, 100)
  const proposed = text(preparation?.proposedBranch, MAX_BRANCH_LENGTH)
  if (!repository || !base || !proposed) return null
  const fileTargets = getExecutionFileTargets({ inspection, request })
  const documentationScope = isDocumentationScope(requestTerms(request), fileTargets)
  const risk = ['low', 'medium', 'high'].includes(preparation?.risk) ? preparation.risk : 'medium'
  return normalizeExecutionWorkflow({
    version: 1,
    repository,
    branch: { state: 'planned', base, proposed },
    change: { state: 'prepared', risk, fileTargets },
    validation: {
      tests: documentationScope ? 'not-needed' : 'required',
      build: documentationScope ? 'not-needed' : 'required',
      report: 'required',
    },
    approval: 'required',
    review: 'awaiting-approval',
    execution: 'awaiting-approval',
    executor: 'not-available',
  })
}

/** Record explicit user approval without mistaking it for a repository mutation. */
export function approveExecutionWorkflow(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || workflow.approval !== 'required' || workflow.execution !== 'awaiting-approval') return null
  return normalizeExecutionWorkflow({
    ...workflow,
    approval: 'approved',
    review: 'awaiting-executor',
    execution: 'awaiting-executor',
  })
}

/**
 * Future executors can use this restricted transition helper to record real
 * branch, change, validation, and report evidence. It performs no operation.
 */
export function applyExecutionWorkflowEvidence(value, evidence = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || !isRecord(evidence)) return workflow
  const secureExecutorEvidence = evidence.source === 'secure-executor' && evidence.executor === 'started'
  const requestedBranch = isRecord(evidence.branch) ? evidence.branch : {}
  const requestedChange = isRecord(evidence.change) ? evidence.change : {}
  const requestedValidation = isRecord(evidence.validation) ? evidence.validation : {}
  const branchEvidence = requestedBranch.state === 'created' && !secureExecutorEvidence ? {} : requestedBranch
  const changeEvidence = requestedChange.state === 'applied' && !secureExecutorEvidence ? {} : requestedChange
  const validationEvidence = (!secureExecutorEvidence && ['passed', 'failed'].some((state) => [requestedValidation.tests, requestedValidation.build, requestedValidation.report].includes(state))) ? {} : requestedValidation
  const next = {
    ...workflow,
    branch: normalizeBranch({ ...workflow.branch, ...branchEvidence }, workflow.repository) || workflow.branch,
    change: normalizeChange({ ...workflow.change, ...changeEvidence }) || workflow.change,
    validation: normalizeValidation({ ...workflow.validation, ...validationEvidence }) || workflow.validation,
    approval: APPROVAL_STATES.has(evidence.approval) ? evidence.approval : workflow.approval,
    review: REVIEW_STATES.has(evidence.review) ? evidence.review : workflow.review,
    execution: EXECUTION_STATES.has(evidence.execution) ? evidence.execution : workflow.execution,
    executor: secureExecutorEvidence ? 'started' : workflow.executor,
  }
  return normalizeExecutionWorkflow(next)
}

const VALIDATION_LABELS = Object.freeze({
  'not-needed': 'Not needed',
  required: 'Required',
  'not-run': 'Not run',
  passed: 'Passed',
  failed: 'Failed',
})

/** Compact, honest view model for the Operator report. */
export function getExecutionWorkflowPresentation(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow) return null
  const approvalRecorded = workflow.approval === 'approved'
  const label = approvalRecorded ? 'Execution approval recorded' : 'Execution workflow prepared'
  const detail = approvalRecorded
    ? 'Approval is recorded in FounderLab. No branch was created, no files were changed, and execution access is still required.'
    : 'Candidate files and validation needs are prepared. No branch was created, no files were changed, and no validation ran.'
  const validation = `Tests: ${VALIDATION_LABELS[workflow.validation.tests]} · Build: ${VALIDATION_LABELS[workflow.validation.build]} · Report: ${VALIDATION_LABELS[workflow.validation.report]}`
  return Object.freeze({
    state: approvalRecorded ? 'approval-recorded' : 'execution-prepared',
    label,
    detail,
    repository: workflow.repository.slug,
    branch: `${workflow.branch.state === 'created' ? 'Created' : 'Planned'}: ${workflow.branch.proposed} ← ${workflow.branch.base}`,
    change: `${workflow.change.state === 'applied' ? 'Change applied' : 'Change prepared'} · ${workflow.change.risk} risk`,
    ...(workflow.change.fileTargets.length ? { fileTargets: workflow.change.fileTargets } : {}),
    validation,
    review: workflow.review === 'ready-to-merge' ? 'Ready to merge' : workflow.review.replace(/-/g, ' '),
    executor: workflow.executor === 'not-available' ? 'Secure execution access is not connected' : workflow.executor.replace(/-/g, ' '),
  })
}

export function getExecutionWorkflowGuidance(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow) return ''
  const files = workflow.change.fileTargets.length
    ? `Candidate files to review: ${workflow.change.fileTargets.join(', ')}. These are candidates from the bounded inspection, not files that were changed.`
    : 'No candidate files are recorded; inspect the scoped repository paths before choosing a mutation target.'
  const validation = `Validation state: tests ${workflow.validation.tests}, build ${workflow.validation.build}, report ${workflow.validation.report}.`
  if (workflow.approval === 'approved') {
    return `A branch-first execution workflow is approved for ${workflow.repository.slug}, but no secure executor is connected. ${files} ${validation} Do not claim a branch was created, a file changed, tests ran, or a merge is ready.`
  }
  return `A branch-first execution workflow is prepared for ${workflow.repository.slug} and still needs explicit approval. ${files} ${validation} Do not claim a branch was created, a file changed, tests ran, or a merge is ready.`
}

export function formatExecutionWorkflowReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation) return ''
  return [
    '## Execution workflow prepared',
    `**Repository:** \`${presentation.repository}\``,
    `**Branch:** \`${presentation.branch}\``,
    `**Change scope:** ${presentation.change}`,
    presentation.fileTargets ? `**Candidate files to review:** ${presentation.fileTargets.map((path) => `\`${path}\``).join(', ')}` : '**Candidate files to review:** inspect scope before selecting files',
    `**Validation:** ${presentation.validation}`,
    '',
    'Approval is required before any future branch creation or file mutation. No branch was created, no files were changed, and no tests or build were run.',
  ].join('\n')
}

export function formatExecutionApprovalReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation || presentation.state !== 'approval-recorded') return ''
  return [
    '## Execution approval recorded',
    `**Repository:** \`${presentation.repository}\``,
    `**Planned branch:** \`${presentation.branch}\``,
    '',
    'FounderLab recorded approval for a future branch-first mutation workflow. No branch was created, no files were changed, no tests or build were run, and external execution remains unverified until a secure executor is connected.',
  ].join('\n')
}
