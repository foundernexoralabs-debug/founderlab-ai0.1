/**
 * Explicit, browser-session GitHub file executor.
 *
 * The existing GitHub token remains in session memory and is never persisted,
 * logged, or sent through a FounderLab service. The bounded executor creates
 * one reviewed multi-file Git commit on an already approved branch. It cannot
 * force-push, merge, open a pull request, or run shell commands.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const MAX_FILE_BYTES = 200 * 1024
const MAX_MUTATION_FILES = 4
const MAX_MUTATION_BYTES = MAX_FILE_BYTES * MAX_MUTATION_FILES
const MAX_COMMIT_MESSAGE_LENGTH = 180
const SAFE_BLOB_MODES = new Set(['100644', '100755'])
const MUTATION_OPERATIONS = new Set(['update', 'create', 'delete'])

function text(value, limit = 200) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function safePath(value) {
  const path = text(value, 220)
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return ''
  return path
}

function safeSha(value) {
  const sha = text(value, 80)
  return /^[a-f0-9]{7,64}$/i.test(sha) ? sha : ''
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

function encodePath(path) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function fromBase64(value) {
  if (typeof value !== 'string') return null
  let binary
  try {
    binary = atob(value.replace(/\s+/g, ''))
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export class GithubFileExecutionError extends Error {
  constructor(code) {
    super(code)
    this.name = 'GithubFileExecutionError'
    this.code = code
  }
}

export class GithubMultiFileExecutionError extends GithubFileExecutionError {
  constructor(code, { commitSha = '' } = {}) {
    super(code)
    this.name = 'GithubMultiFileExecutionError'
    const safeCommit = safeSha(commitSha)
    if (safeCommit) this.commitSha = safeCommit
  }
}

function errorForStatus(status) {
  if (status === 401) return new GithubFileExecutionError('github-auth-required')
  if (status === 403) return new GithubFileExecutionError('github-permission-denied')
  if (status === 404) return new GithubFileExecutionError('repository-inaccessible')
  if ([409, 422].includes(status)) return new GithubFileExecutionError('execution-conflict')
  return new GithubFileExecutionError('execution-unavailable')
}

function headersFor(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token.trim()}`,
  }
}

async function requestGithub(fetchImpl, path, options = {}) {
  let response
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, options)
  } catch {
    throw new GithubFileExecutionError('execution-unavailable')
  }
  if (!response?.ok) throw errorForStatus(response?.status)
  try {
    return await response.json()
  } catch {
    throw new GithubFileExecutionError('execution-unavailable')
  }
}

function repositoryFor(value) {
  return parsePublicGithubRepositoryReference(value?.slug || `${value?.owner || ''}/${value?.name || ''}`)
}

function branchFor(value) {
  const branch = text(value, 96)
  if (!branch || branch.startsWith('.') || branch.startsWith('/') || branch.endsWith('.') || branch.endsWith('/') || branch.endsWith('.lock') || branch.includes('//') || branch.includes('..') || branch.includes('@{') || /[~^:?*\[\]@{}\s]/.test(branch)) return ''
  return branch
}

function normalizeMutation(value) {
  if (!value || typeof value !== 'object' || !MUTATION_OPERATIONS.has(value.operation)) return null
  const operation = value.operation
  const path = safePath(value.path)
  const expectedSha = operation === 'create' ? '' : safeSha(value.expectedSha)
  const content = operation === 'delete'
    ? ''
    : typeof value.content === 'string' ? value.content.replace(/\r\n/g, '\n') : null
  if (!path || (operation !== 'create' && !expectedSha) || content === null || content?.includes('\u0000') || (content !== null && byteLength(content) > MAX_FILE_BYTES)) return null
  return Object.freeze({ operation, path, ...(expectedSha ? { expectedSha } : {}), ...(operation !== 'delete' ? { content } : {}) })
}

function normalizeMutations(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MUTATION_FILES) return null
  const seen = new Set()
  let totalBytes = 0
  const changes = []
  for (const item of value) {
    const change = normalizeMutation(item)
    if (!change || seen.has(change.path)) return null
    seen.add(change.path)
    totalBytes += change.operation === 'delete' ? 0 : byteLength(change.content)
    if (totalBytes > MAX_MUTATION_BYTES) return null
    changes.push(change)
  }
  return Object.freeze(changes)
}

function operationSummary(changes) {
  return Object.freeze({
    updatedFiles: Object.freeze(changes.filter((change) => change.operation === 'update').map((change) => change.path)),
    createdFiles: Object.freeze(changes.filter((change) => change.operation === 'create').map((change) => change.path)),
    deletedFiles: Object.freeze(changes.filter((change) => change.operation === 'delete').map((change) => change.path)),
  })
}

function gitDataErrorForStatus(status) {
  if (status === 401) return new GithubMultiFileExecutionError('github-auth-required')
  if (status === 403) return new GithubMultiFileExecutionError('github-permission-denied')
  if (status === 404) return new GithubMultiFileExecutionError('repository-inaccessible')
  if ([409, 422].includes(status)) return new GithubMultiFileExecutionError('execution-conflict')
  return new GithubMultiFileExecutionError('execution-unavailable')
}

async function requestGitData(fetchImpl, path, options = {}) {
  let response
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, options)
  } catch {
    throw new GithubMultiFileExecutionError('execution-unavailable')
  }
  if (!response?.ok) throw gitDataErrorForStatus(response?.status)
  try {
    return await response.json()
  } catch {
    throw new GithubMultiFileExecutionError('execution-unavailable')
  }
}

function findTreeEntry(entries, path) {
  return entries.find((entry) => entry.path === path) || null
}

function safeTreeEntry(value) {
  const path = safePath(value?.path)
  const sha = safeSha(value?.sha)
  const mode = text(value?.mode, 16)
  return path && sha && value?.type === 'blob' && SAFE_BLOB_MODES.has(mode)
    ? Object.freeze({ path, sha, mode })
    : null
}

/** Read one existing text file plus its Git blob SHA; no mutation occurs. */
export async function getGithubRepositoryFile({ token, repository, branch, path, fetchImpl = globalThis.fetch } = {}) {
  const reference = repositoryFor(repository)
  const targetBranch = branchFor(branch)
  const targetPath = safePath(path)
  if (!text(token, 2048)) throw new GithubFileExecutionError('github-connection-required')
  if (!reference || !targetBranch || !targetPath || typeof fetchImpl !== 'function') throw new GithubFileExecutionError('execution-unavailable')
  const owner = encodeURIComponent(reference.owner)
  const name = encodeURIComponent(reference.name)
  const response = await requestGithub(
    fetchImpl,
    `/repos/${owner}/${name}/contents/${encodePath(targetPath)}?ref=${encodeURIComponent(targetBranch)}`,
    { headers: headersFor(token) },
  )
  const sha = safeSha(response?.sha)
  const content = fromBase64(response?.content)
  const responsePath = safePath(response?.path)
  if (!sha || responsePath !== targetPath || response?.encoding !== 'base64' || content === null || byteLength(content) > MAX_FILE_BYTES) {
    throw new GithubFileExecutionError('file-content-unavailable')
  }
  return Object.freeze({ repository: reference, branch: targetBranch, path: targetPath, sha, content, size: byteLength(content) })
}

/**
 * Apply up to four explicitly reviewed text changes as one real Git commit.
 * Git Data API is used rather than repeated Contents writes so update/create/
 * delete operations land together on the approved branch. The branch ref is
 * moved with force:false, preventing a stale branch head from being silently
 * overwritten. A ref-update uncertainty is reported as partial execution.
 */
export async function applyGithubMultiFileChange({ token, repository, branch, changes, commitMessage, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const reference = repositoryFor(repository)
  const targetBranch = branchFor(branch)
  const reviewedChanges = normalizeMutations(changes)
  const message = text(commitMessage, MAX_COMMIT_MESSAGE_LENGTH)
  if (!text(token, 2048)) throw new GithubMultiFileExecutionError('github-connection-required')
  if (!reference || !targetBranch || !reviewedChanges || !message || typeof fetchImpl !== 'function') {
    throw new GithubMultiFileExecutionError('execution-unavailable')
  }
  const owner = encodeURIComponent(reference.owner)
  const name = encodeURIComponent(reference.name)
  const headers = { ...headersFor(token), 'Content-Type': 'application/json' }

  const branchRef = await requestGitData(fetchImpl, `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(targetBranch)}`, { headers: headersFor(token) })
  const parentSha = safeSha(branchRef?.object?.sha)
  if (!parentSha) throw new GithubMultiFileExecutionError('execution-unavailable')
  const parentCommit = await requestGitData(fetchImpl, `/repos/${owner}/${name}/git/commits/${encodeURIComponent(parentSha)}`, { headers: headersFor(token) })
  const baseTreeSha = safeSha(parentCommit?.tree?.sha)
  if (!baseTreeSha) throw new GithubMultiFileExecutionError('execution-unavailable')
  const baseTree = await requestGitData(fetchImpl, `/repos/${owner}/${name}/git/trees/${encodeURIComponent(baseTreeSha)}?recursive=1`, { headers: headersFor(token) })
  if (baseTree?.truncated === true || !Array.isArray(baseTree?.tree)) throw new GithubMultiFileExecutionError('tree-unavailable')
  const entries = baseTree.tree.map(safeTreeEntry).filter(Boolean)

  for (const change of reviewedChanges) {
    const existing = findTreeEntry(entries, change.path)
    if (change.operation === 'create' && existing) throw new GithubMultiFileExecutionError('file-already-exists')
    if (change.operation !== 'create' && !existing) throw new GithubMultiFileExecutionError('file-missing')
    if (change.operation !== 'create' && existing.sha !== change.expectedSha) throw new GithubMultiFileExecutionError('file-change-conflict')
  }

  const tree = reviewedChanges.map((change) => {
    const existing = findTreeEntry(entries, change.path)
    if (change.operation === 'delete') return { path: change.path, mode: existing.mode, type: 'blob', sha: null }
    return {
      path: change.path,
      mode: existing?.mode || '100644',
      type: 'blob',
      content: change.content,
    }
  })
  const createdTree = await requestGitData(fetchImpl, `/repos/${owner}/${name}/git/trees`, {
    method: 'POST', headers, body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  })
  const nextTreeSha = safeSha(createdTree?.sha)
  if (!nextTreeSha) throw new GithubMultiFileExecutionError('execution-unavailable')
  const createdCommit = await requestGitData(fetchImpl, `/repos/${owner}/${name}/git/commits`, {
    method: 'POST', headers, body: JSON.stringify({ message, tree: nextTreeSha, parents: [parentSha] }),
  })
  const commitSha = safeSha(createdCommit?.sha)
  if (!commitSha) throw new GithubMultiFileExecutionError('execution-unavailable')
  let updatedRef
  try {
    updatedRef = await requestGitData(fetchImpl, `/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(targetBranch)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ sha: commitSha, force: false }),
    })
  } catch (error) {
    throw new GithubMultiFileExecutionError('partial-execution', { commitSha })
  }
  if (safeSha(updatedRef?.object?.sha) !== commitSha) throw new GithubMultiFileExecutionError('partial-execution', { commitSha })
  const summary = operationSummary(reviewedChanges)
  return Object.freeze({
    repository: reference,
    branch: targetBranch,
    commitSha,
    changedFiles: Object.freeze(reviewedChanges.map((change) => Object.freeze({ path: change.path, operation: change.operation }))),
    ...summary,
    committedAt: typeof now === 'function' ? now() : new Date().toISOString(),
  })
}

export function getGithubFileExecutionErrorPresentation(error) {
  const copy = {
    'github-connection-required': 'Connect GitHub in Settings before applying this approved file change.',
    'github-auth-required': 'GitHub needs a valid session token before applying this file change. Reconnect GitHub and try again.',
    'github-permission-denied': 'The connected GitHub account cannot write this repository or branch. No file change was applied.',
    'repository-inaccessible': 'This repository or approved branch is not accessible to the connected GitHub account.',
    'file-change-conflict': 'This file changed after it was loaded. Refresh it, review the latest content, and apply a new approved replacement.',
    'file-already-exists': 'The requested new file already exists on the approved branch. Refresh the review and choose an update instead.',
    'file-missing': 'A reviewed file is no longer present on the approved branch. Re-inspect the branch before retrying.',
    'tree-unavailable': 'FounderLab could not safely read the complete branch tree for this multi-file change. No branch update was attempted.',
    'file-content-unavailable': 'FounderLab could not safely load this file as a bounded text file. No change was attempted.',
    'partial-execution': 'GitHub did not return a complete mutation result. The file may have changed; re-inspect the branch before retrying.',
    'execution-conflict': 'GitHub reported a repository conflict. Refresh the inspection and branch state before retrying.',
    'execution-unavailable': 'FounderLab could not apply this file change right now. No successful change was recorded.',
  }
  return copy[error?.code] || 'FounderLab could not apply this file change. No successful change was recorded.'
}

export function getGithubMultiFileExecutionErrorPresentation(error) {
  const base = getGithubFileExecutionErrorPresentation(error)
  return error?.code === 'partial-execution' && safeSha(error?.commitSha)
    ? 'GitHub created a commit but did not confirm the approved branch update. Re-inspect the branch before retrying; FounderLab did not record the changes as applied.'
    : base.replace(/this file change/gi, 'these reviewed changes').replace(/No file change was applied/gi, 'No branch update was recorded')
}
