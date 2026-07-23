/**
 * A bounded, evidence-first execution workflow for Chat. It can record a
 * prepared change path and explicit approval. Browser-session GitHub actions
 * can create an approved branch, apply one reviewed file replacement, and
 * inspect native GitHub validation evidence. It never runs arbitrary shell
 * commands, force-pushes, creates pull requests, or merges.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'

const MAX_FILE_TARGETS = 6
const MAX_APPLIED_FILES = 1
const MAX_BRANCH_LENGTH = 96
const MAX_TEXT_LENGTH = 180
const BRANCH_STATES = new Set(['not-needed', 'planned', 'created'])
const CHANGE_STATES = new Set(['not-started', 'prepared', 'applied'])
const VALIDATION_STATES = new Set(['not-needed', 'required', 'not-run', 'passed', 'failed'])
const APPROVAL_STATES = new Set(['not-required', 'required', 'approved', 'rejected'])
const REVIEW_STATES = new Set(['not-required', 'awaiting-approval', 'awaiting-executor', 'awaiting-validation', 'ready-for-review', 'ready-to-merge', 'not-ready'])
const EXECUTION_STATES = new Set(['not-started', 'prepared', 'awaiting-approval', 'awaiting-executor', 'branch-created', 'change-applied', 'validation-complete', 'reported', 'blocked', 'cancelled', 'externally-unverified'])
const EXECUTOR_STATES = new Set(['not-available', 'available', 'started'])
const CONNECTION_STATES = new Set(['not-connected', 'connected', 'unavailable'])
const AUTHORIZATION_STATES = new Set(['not-authorized', 'unverified', 'read-only', 'writable', 'denied'])
const EXECUTION_ACCESS_STATES = new Set(['unavailable', 'unverified', 'read-only', 'write-ready', 'blocked'])
const BLOCK_PHASES = new Set(['inspection', 'branch', 'change', 'validation', 'report', 'approval', 'integration', 'provider'])
const BLOCK_CODES = new Set([
  'github-connection-required',
  'github-auth-required',
  'github-permission-denied',
  'repository-inaccessible',
  'repository-read-only',
  'branch-conflict',
  'execution-conflict',
  'file-change-conflict',
  'file-content-unavailable',
  'execution-cancelled',
  'provider-unavailable',
  'validation-failed',
  'build-failed',
  'partial-execution',
  'executor-unavailable',
  'approval-required',
  'execution-unavailable',
])

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

function normalizeCommitSha(value) {
  const sha = text(value, 80)
  return /^[a-f0-9]{7,64}$/i.test(sha) ? sha : ''
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
  const fileTargets = normalizeFileTargets(value.fileTargets)
  if (value.state !== 'applied') return Object.freeze({ state: value.state, risk, fileTargets })
  const appliedFiles = normalizeFileTargets(value.appliedFiles).slice(0, MAX_APPLIED_FILES)
  const commitSha = normalizeCommitSha(value.commitSha)
  if (appliedFiles.length !== 1 || !fileTargets.includes(appliedFiles[0]) || !commitSha) return null
  return Object.freeze({ state: value.state, risk, fileTargets, appliedFiles, commitSha })
}

function normalizeCapability(value) {
  if (!isRecord(value)) return Object.freeze({ connection: 'not-connected', authorization: 'not-authorized', execution: 'unavailable' })
  const connection = CONNECTION_STATES.has(value.connection) ? value.connection : 'not-connected'
  const authorization = AUTHORIZATION_STATES.has(value.authorization) ? value.authorization : 'not-authorized'
  const execution = EXECUTION_ACCESS_STATES.has(value.execution) ? value.execution : 'unavailable'
  return Object.freeze({ connection, authorization, execution })
}

function normalizeBlock(value) {
  if (!isRecord(value) || !BLOCK_CODES.has(value.code) || !BLOCK_PHASES.has(value.phase)) return null
  return Object.freeze({ code: value.code, phase: value.phase, retryable: value.retryable === true })
}

function isTrustedExecutionSource(value) {
  return value === 'secure-executor' || value === 'github-api'
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
  const capability = normalizeCapability(value.capability)
  const block = normalizeBlock(value.block)
  if (!repository || !branch || !change || !validation || !approval || !review || !execution || !executor) return null
  return Object.freeze({ version: 1, repository, branch, change, validation, approval, review, execution, executor, capability, ...(block ? { block } : {}) })
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
export function createExecutionWorkflow({ inspection = null, preparation = null, request = '', capability = null } = {}) {
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
    capability,
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

function capabilityForBlock(capability, code) {
  if (code === 'github-connection-required') return { connection: 'not-connected', authorization: 'not-authorized', execution: 'unavailable' }
  if (['github-auth-required', 'github-permission-denied'].includes(code)) return { connection: 'connected', authorization: 'denied', execution: 'blocked' }
  if (code === 'repository-read-only') return { ...capability, authorization: 'read-only', execution: 'read-only' }
  if (['repository-inaccessible', 'executor-unavailable', 'execution-unavailable', 'file-content-unavailable'].includes(code)) return { ...capability, execution: 'unavailable' }
  return { ...capability, execution: 'blocked' }
}

/** Record a safe, classified block without storing raw upstream errors or claiming partial work succeeded. */
export function recordExecutionWorkflowBlock(value, { code = 'execution-unavailable', phase = 'integration', retryable = false } = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || !BLOCK_CODES.has(code) || !BLOCK_PHASES.has(phase)) return workflow
  return normalizeExecutionWorkflow({
    ...workflow,
    capability: capabilityForBlock(workflow.capability, code),
    block: { code, phase, retryable: retryable === true },
    execution: code === 'execution-cancelled' ? 'cancelled' : 'blocked',
    review: 'not-ready',
  })
}

/** Clear only a retryable recorded block; the underlying approval boundary remains intact. */
export function retryExecutionWorkflow(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow?.block?.retryable || workflow.approval !== 'approved') return null
  const resumesValidation = workflow.branch.state === 'created' && workflow.change.state === 'applied'
  return normalizeExecutionWorkflow({
    ...workflow,
    block: undefined,
    execution: resumesValidation ? 'change-applied' : 'awaiting-executor',
    review: resumesValidation ? 'awaiting-validation' : 'awaiting-executor',
    capability: { ...workflow.capability, execution: workflow.capability.connection === 'connected' ? 'unverified' : 'unavailable' },
  })
}

/** Record a GitHub-confirmed branch creation after an explicit approved action. */
export function recordExecutionWorkflowBranchCreated(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || workflow.approval !== 'approved' || workflow.branch.state !== 'planned') return null
  return normalizeExecutionWorkflow({
    ...workflow,
    branch: { ...workflow.branch, state: 'created' },
    capability: { connection: 'connected', authorization: 'writable', execution: 'write-ready' },
    execution: 'branch-created',
    review: 'awaiting-executor',
    executor: 'available',
    block: undefined,
  })
}

/**
 * A browser-side branch action must be backed by the recorded inspect → plan
 * → approve sequence. This is intentionally separate from rendering controls
 * so stale or malformed persisted message state cannot issue a GitHub request.
 */
export function canCreateApprovedBranchAction(value, {
  inspectionRecorded = false,
  branchPlanRecorded = false,
  approvalRecorded = false,
} = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  return Boolean(
    workflow
    && workflow.approval === 'approved'
    && workflow.branch.state === 'planned'
    && (!workflow.block || workflow.block.retryable)
    && inspectionRecorded === true
    && branchPlanRecorded === true
    && approvalRecorded === true,
  )
}

/** Guard the narrow mutation boundary: one inspected candidate file, on the recorded branch, after approval. */
export function canApplyApprovedFileChange(value, {
  inspectionRecorded = false,
  branchCreatedRecorded = false,
  approvalRecorded = false,
} = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  return Boolean(
    workflow
    && workflow.approval === 'approved'
    && workflow.branch.state === 'created'
    && workflow.change.state === 'prepared'
    && workflow.change.fileTargets.length > 0
    && !workflow.block
    && inspectionRecorded === true
    && branchCreatedRecorded === true
    && approvalRecorded === true,
  )
}

/** Record a GitHub-confirmed one-file commit. The caller must have completed the external API mutation. */
export function recordExecutionWorkflowFileChange(value, { path, commitSha, source = '' } = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  const targetPath = safePath(path)
  const verifiedCommit = normalizeCommitSha(commitSha)
  if (!workflow || !isTrustedExecutionSource(source) || workflow.approval !== 'approved' || workflow.branch.state !== 'created' || workflow.change.state !== 'prepared' || !workflow.change.fileTargets.includes(targetPath) || !verifiedCommit) return null
  return normalizeExecutionWorkflow({
    ...workflow,
    change: { ...workflow.change, state: 'applied', appliedFiles: [targetPath], commitSha: verifiedCommit },
    validation: {
      tests: workflow.validation.tests === 'not-needed' ? 'not-needed' : 'not-run',
      build: workflow.validation.build === 'not-needed' ? 'not-needed' : 'not-run',
      report: 'not-run',
    },
    capability: { connection: 'connected', authorization: 'writable', execution: 'write-ready' },
    execution: 'change-applied',
    review: 'awaiting-validation',
    executor: 'started',
    block: undefined,
  })
}

/** Record actual validation evidence without implying a review, pull request, or merge. */
export function recordExecutionWorkflowValidation(value, { tests, build, report, source = '' } = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || !isTrustedExecutionSource(source) || workflow.branch.state !== 'created' || workflow.change.state !== 'applied') return null
  const validation = normalizeValidation({ tests, build, report })
  if (!validation) return null
  const failed = ['failed'].some((state) => Object.values(validation).includes(state))
  if (failed) {
    return recordExecutionWorkflowBlock({ ...workflow, validation }, { code: validation.build === 'failed' ? 'build-failed' : 'validation-failed', phase: 'validation' })
  }
  const complete = [validation.tests, validation.build, validation.report].every((state) => ['passed', 'not-needed'].includes(state))
  return normalizeExecutionWorkflow({
    ...workflow,
    validation,
    execution: complete ? 'validation-complete' : 'change-applied',
    review: complete ? 'awaiting-executor' : 'awaiting-validation',
    executor: 'started',
    capability: { connection: 'connected', authorization: 'writable', execution: 'write-ready' },
    block: undefined,
  })
}

/** Prepare review readiness only after verified validation; this never performs a merge. */
export function recordExecutionWorkflowReviewReadiness(value, { source = 'secure-executor' } = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || !isTrustedExecutionSource(source) || workflow.branch.state !== 'created' || workflow.change.state !== 'applied') return null
  if (workflow.block) return normalizeExecutionWorkflow({ ...workflow, review: 'not-ready' })
  const valid = [workflow.validation.tests, workflow.validation.build, workflow.validation.report]
    .every((state) => ['passed', 'not-needed'].includes(state))
  if (!valid) return normalizeExecutionWorkflow({ ...workflow, review: 'not-ready', execution: 'validation-complete' })
  return normalizeExecutionWorkflow({ ...workflow, review: 'ready-for-review', execution: 'reported', executor: 'started' })
}

/** Reserved for a later, explicitly evidenced human/PR review; this never performs a merge. */
export function recordExecutionWorkflowMergeReadiness(value, { source = '' } = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || source !== 'approved-review' || workflow.review !== 'ready-for-review') return null
  return normalizeExecutionWorkflow({ ...workflow, review: 'ready-to-merge', execution: 'reported' })
}

/**
 * Future executors can use this restricted transition helper to record real
 * branch, change, validation, and report evidence. It performs no operation.
 */
export function applyExecutionWorkflowEvidence(value, evidence = {}) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow || !isRecord(evidence)) return workflow
  const secureExecutorEvidence = isTrustedExecutionSource(evidence.source) && evidence.executor === 'started'
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
    capability: secureExecutorEvidence ? { connection: 'connected', authorization: 'writable', execution: 'write-ready' } : workflow.capability,
    block: secureExecutorEvidence ? undefined : workflow.block,
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

const BLOCK_COPY = Object.freeze({
  'github-connection-required': 'GitHub is not connected for this browser session.',
  'github-auth-required': 'GitHub requires a valid session token before this branch can be created.',
  'github-permission-denied': 'The connected GitHub identity does not have permission to create this branch.',
  'repository-inaccessible': 'This repository is inaccessible to the connected GitHub identity.',
  'repository-read-only': 'This repository is available only as read-only for the requested workflow.',
  'branch-conflict': 'The proposed branch already exists or conflicts with repository state.',
  'execution-conflict': 'GitHub reported a conflict while preparing the branch.',
  'file-change-conflict': 'The selected file changed after it was loaded. Refresh its current content before applying another reviewed replacement.',
  'file-content-unavailable': 'The selected file could not be safely loaded as a bounded text file.',
  'execution-cancelled': 'The execution was cancelled before a completed result was recorded.',
  'provider-unavailable': 'The selected provider is unavailable for this execution step.',
  'validation-failed': 'Required validation failed; review the result before continuing.',
  'build-failed': 'The required build failed; review the result before continuing.',
  'partial-execution': 'Only part of the execution path is recorded; remaining steps are still unverified.',
  'executor-unavailable': 'A secure executor is not connected for the next repository mutation step.',
  'approval-required': 'Explicit approval is required before this mutating workflow can continue.',
  'execution-unavailable': 'This execution path is unavailable in the current FounderLab session.',
})

function capabilityLabel(capability) {
  if (capability.connection === 'not-connected') return 'GitHub not connected'
  if (capability.authorization === 'denied') return 'GitHub permission denied'
  if (capability.authorization === 'read-only') return 'GitHub read-only'
  if (capability.authorization === 'writable') return 'GitHub writable'
  if (capability.authorization === 'unverified') return 'GitHub connected · write permission unverified'
  return 'Execution capability unavailable'
}

/** Compact, honest view model for the Operator report. */
export function getExecutionWorkflowPresentation(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow) return null
  const branchCreated = workflow.branch.state === 'created'
  const changeApplied = workflow.change.state === 'applied'
  const reviewReady = workflow.review === 'ready-for-review'
  const mergeReady = workflow.review === 'ready-to-merge'
  const validationComplete = [workflow.validation.tests, workflow.validation.build, workflow.validation.report]
    .every((state) => ['passed', 'not-needed'].includes(state))
  const blocked = workflow.block
  const approvalRecorded = workflow.approval === 'approved'
  const state = blocked ? 'execution-blocked' : mergeReady ? 'merge-ready' : reviewReady ? 'review-ready' : validationComplete && changeApplied ? 'validation-complete' : changeApplied ? 'change-applied' : branchCreated ? 'branch-created' : approvalRecorded ? 'approval-recorded' : 'execution-prepared'
  const label = blocked ? 'Execution blocked' : mergeReady ? 'Ready to merge' : reviewReady ? 'Ready for review' : validationComplete && changeApplied ? 'Validation complete' : changeApplied ? 'File change applied' : branchCreated ? 'Branch created' : approvalRecorded ? 'Execution approval recorded' : 'Execution workflow prepared'
  const detail = blocked
    ? BLOCK_COPY[blocked.code]
    : mergeReady
      ? 'Review approval and validation evidence are recorded. No merge has been performed.'
      : reviewReady
        ? 'The approved file change and required validation evidence are recorded. This is ready for human review, not a merge.'
        : validationComplete && changeApplied
          ? 'Required validation evidence is recorded. Review is the next explicit boundary; no merge is implied.'
          : changeApplied
            ? 'GitHub confirmed a single reviewed file change and commit on the approved branch. Validation and review remain outstanding.'
            : branchCreated
              ? 'GitHub confirmed the branch creation. One explicitly reviewed candidate file may now be changed; no file, test, build, review, or merge result is recorded yet.'
              : approvalRecorded
                ? workflow.capability.connection === 'connected'
                  ? 'Approval is recorded. GitHub is connected, but write permission will be verified only when the user explicitly creates this branch.'
                  : 'Approval is recorded. Connect GitHub before the user can explicitly create this branch.'
                : 'Candidate files and validation needs are prepared. No branch was created, no files were changed, and no validation ran.'
  const validation = `Tests: ${VALIDATION_LABELS[workflow.validation.tests]} · Build: ${VALIDATION_LABELS[workflow.validation.build]} · Report: ${VALIDATION_LABELS[workflow.validation.report]}`
  return Object.freeze({
    state,
    label,
    detail,
    repository: workflow.repository.slug,
    branch: `${workflow.branch.state === 'created' ? 'Created' : 'Planned'}: ${workflow.branch.proposed} ← ${workflow.branch.base}`,
    change: `${workflow.change.state === 'applied' ? 'Change applied' : 'Change prepared'} · ${workflow.change.risk} risk`,
    ...(workflow.change.fileTargets.length ? { fileTargets: workflow.change.fileTargets } : {}),
    ...(workflow.change.appliedFiles?.length ? { appliedFiles: workflow.change.appliedFiles, commitSha: workflow.change.commitSha } : {}),
    validation,
    review: workflow.review === 'ready-to-merge' ? 'Ready to merge' : workflow.review.replace(/-/g, ' '),
    capability: capabilityLabel(workflow.capability),
    executor: workflow.executor === 'not-available' ? 'No GitHub mutation has started' : workflow.executor.replace(/-/g, ' '),
    ...(blocked ? { block: { code: blocked.code, phase: blocked.phase, retryable: blocked.retryable } } : {}),
  })
}

export function getExecutionWorkflowGuidance(value) {
  const workflow = normalizeExecutionWorkflow(value)
  if (!workflow) return ''
  const files = workflow.change.fileTargets.length
    ? `Candidate files to review: ${workflow.change.fileTargets.join(', ')}. These are candidates from the bounded inspection, not files that were changed.`
    : 'No candidate files are recorded; inspect the scoped repository paths before choosing a mutation target.'
  const validation = `Validation state: tests ${workflow.validation.tests}, build ${workflow.validation.build}, report ${workflow.validation.report}.`
  if (workflow.block) {
    const recovery = workflow.block.retryable
      ? 'A retry is possible after confirming the same scope and connection.'
      : 'Resolve the stated connection, permission, repository, or review boundary before continuing.'
    return `The execution workflow for ${workflow.repository.slug} is blocked during ${workflow.block.phase}: ${BLOCK_COPY[workflow.block.code]} ${recovery} ${files} ${validation} Do not claim a branch, file change, test, build, or merge completed.`
  }
  if (workflow.change.state === 'applied') {
    const changed = `GitHub confirmed a reviewed replacement of ${workflow.change.appliedFiles.join(', ')} on ${workflow.branch.proposed} (commit ${workflow.change.commitSha.slice(0, 12)}).`
    const review = workflow.review === 'ready-for-review'
      ? 'Required validation is recorded and the change is ready for human review, not a merge.'
      : workflow.review === 'ready-to-merge'
        ? 'Review approval is recorded; no merge has been performed.'
        : 'Validation and review evidence are still required before this can be reviewed or merged.'
    return `${changed} ${review} ${validation}`
  }
  if (workflow.branch.state === 'created') {
    return `GitHub confirmed creation of ${workflow.branch.proposed} for ${workflow.repository.slug}. No file, test, build, review, or merge result is recorded yet. ${files} ${validation}`
  }
  if (workflow.approval === 'approved') {
    const next = workflow.capability.connection === 'connected'
      ? 'GitHub write permission remains unverified until the user explicitly chooses branch creation.'
      : 'Connect GitHub before the user can explicitly create the branch.'
    return `A branch-first execution workflow is approved for ${workflow.repository.slug}. ${next} ${files} ${validation} Do not claim a branch was created, a file changed, tests ran, or a merge is ready.`
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
  const next = presentation.capability === 'GitHub not connected'
    ? 'Connect GitHub in this browser session, then explicitly choose branch creation.'
    : 'Explicitly choose branch creation when ready; GitHub will verify write permission at that point.'
  return [
    '## Execution approval recorded',
    `**Repository:** \`${presentation.repository}\``,
    `**Planned branch:** \`${presentation.branch}\``,
    '',
    `FounderLab recorded approval for a future branch-first mutation workflow. ${next} No branch was created, no files were changed, and no tests or build were run.`,
  ].join('\n')
}

export function formatExecutionBranchCreatedReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation || presentation.state !== 'branch-created') return ''
  return [
    '## Branch created',
    `**Repository:** \`${presentation.repository}\``,
    `**Branch:** \`${presentation.branch}\``,
    '',
    'GitHub confirmed branch creation. The next explicit action may replace one reviewed candidate text file on this approved branch. No file, test, build, review, or merge result is recorded yet.',
  ].join('\n')
}

export function formatExecutionFileChangeReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation || presentation.state !== 'change-applied') return ''
  return [
    '## File change applied',
    `**Repository:** \`${presentation.repository}\``,
    `**Branch:** \`${presentation.branch}\``,
    `**Changed file:** \`${presentation.appliedFiles[0]}\``,
    `**GitHub commit:** \`${presentation.commitSha}\``,
    '',
    'GitHub confirmed this one-file commit. Required validation and human review remain explicit next steps; no merge is implied.',
  ].join('\n')
}

export function formatExecutionValidationReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation || !['validation-complete', 'execution-blocked', 'change-applied'].includes(presentation.state)) return ''
  return [
    '## Validation status recorded',
    `**Repository:** \`${presentation.repository}\``,
    `**Branch:** \`${presentation.branch}\``,
    `**Validation:** ${presentation.validation}`,
    '',
    presentation.state === 'validation-complete'
      ? 'GitHub validation evidence is complete. The change is ready for an explicit human review, not a merge.'
      : presentation.state === 'execution-blocked'
        ? `${presentation.detail} No review or merge readiness is claimed.`
        : 'GitHub has not yet supplied all required validation evidence. Review and merge are not ready.',
  ].join('\n')
}

export function formatExecutionReviewReadyReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation || presentation.state !== 'review-ready') return ''
  return [
    '## Ready for review',
    `**Repository:** \`${presentation.repository}\``,
    `**Branch:** \`${presentation.branch}\``,
    `**Changed file:** \`${presentation.appliedFiles[0]}\``,
    `**Validation:** ${presentation.validation}`,
    '',
    'The one-file change and validation evidence are ready for human review. No pull request or merge has been created.',
  ].join('\n')
}

export function formatExecutionBlockedReport(workflow) {
  const presentation = getExecutionWorkflowPresentation(workflow)
  if (!presentation?.block) return ''
  const recovery = presentation.block.retryable
    ? 'Retry after confirming the connection and current repository state.'
    : 'Resolve the stated boundary, then prepare the next explicit action.'
  return [
    '## Execution blocked',
    `**Repository:** \`${presentation.repository}\``,
    `**State:** ${presentation.detail}`,
    `**Next step:** ${recovery}`,
    '',
    'No additional branch, file, test, build, review, or merge result is claimed.',
  ].join('\n')
}
