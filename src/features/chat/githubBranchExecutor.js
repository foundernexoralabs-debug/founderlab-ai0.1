/**
 * Deliberate browser-side GitHub branch action. The token remains in the
 * existing session-memory boundary; this module never persists it, logs it,
 * sends it to a FounderLab server, edits a file, creates a commit, or merges.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'

const GITHUB_API_ORIGIN = 'https://api.github.com'

function text(value, limit = 140) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function branchName(value) {
  const name = text(value, 96)
  if (!name || name.startsWith('.') || name.startsWith('/') || name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock') || name.includes('//') || name.includes('..') || name.includes('@{') || /[~^:?*\\[\]@{}\s]/.test(name)) return ''
  return name
}

export class GithubBranchExecutionError extends Error {
  constructor(code) {
    super(code)
    this.name = 'GithubBranchExecutionError'
    this.code = code
  }
}

function errorForStatus(status, { creating = false } = {}) {
  if (status === 401) return new GithubBranchExecutionError('github-auth-required')
  if (status === 403) return new GithubBranchExecutionError('github-permission-denied')
  if (status === 404) return new GithubBranchExecutionError('repository-inaccessible')
  if (status === 409) return new GithubBranchExecutionError('execution-conflict')
  if (status === 422 && creating) return new GithubBranchExecutionError('branch-conflict')
  return new GithubBranchExecutionError('execution-unavailable')
}

async function requestGithub(fetchImpl, path, options = {}) {
  let response
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, options)
  } catch {
    throw new GithubBranchExecutionError('execution-unavailable')
  }
  if (!response?.ok) throw errorForStatus(response?.status, { creating: options.method === 'POST' })
  try {
    return await response.json()
  } catch {
    throw new GithubBranchExecutionError('execution-unavailable')
  }
}

/** Explain the capability truth without treating token presence as authorization. */
export function getGithubBranchExecutionCapability(token) {
  if (!text(token, 2048)) {
    return Object.freeze({ connection: 'not-connected', authorization: 'not-authorized', execution: 'unavailable' })
  }
  return Object.freeze({ connection: 'connected', authorization: 'unverified', execution: 'unverified' })
}

/**
 * Creates only the approved branch ref through GitHub's API. The caller must
 * have already persisted an approval record. No token or raw API response is
 * returned for storage.
 */
export async function createGithubBranch({ token, repository, baseBranch, proposedBranch, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const reference = parsePublicGithubRepositoryReference(repository?.slug || `${repository?.owner || ''}/${repository?.name || ''}`)
  const base = branchName(baseBranch)
  const proposed = branchName(proposedBranch)
  if (!text(token, 2048)) throw new GithubBranchExecutionError('github-connection-required')
  if (!reference || !base || !proposed) throw new GithubBranchExecutionError('execution-unavailable')
  if (typeof fetchImpl !== 'function') throw new GithubBranchExecutionError('execution-unavailable')

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token.trim()}`,
  }
  const owner = encodeURIComponent(reference.owner)
  const name = encodeURIComponent(reference.name)
  const baseRef = await requestGithub(fetchImpl, `/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(base)}`, { headers })
  const sha = text(baseRef?.object?.sha, 80)
  if (!sha) throw new GithubBranchExecutionError('execution-unavailable')
  const created = await requestGithub(fetchImpl, `/repos/${owner}/${name}/git/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${proposed}`, sha }),
  })
  if (created?.ref !== `refs/heads/${proposed}`) throw new GithubBranchExecutionError('execution-unavailable')
  return Object.freeze({ repository: reference, baseBranch: base, proposedBranch: proposed, createdAt: typeof now === 'function' ? now() : new Date().toISOString() })
}

export function getGithubBranchExecutionErrorPresentation(error) {
  const messages = {
    'github-connection-required': 'Connect GitHub in Settings before creating this approved branch.',
    'github-auth-required': 'GitHub needs a valid session token before creating this branch. Reconnect GitHub and try again.',
    'github-permission-denied': 'The connected GitHub account cannot create a branch in this repository. Check repository access and token permissions.',
    'repository-inaccessible': 'This repository is not accessible to the connected GitHub account.',
    'branch-conflict': 'The proposed branch already exists or conflicts with the current repository state. Prepare a new branch plan before retrying.',
    'execution-conflict': 'GitHub reported a repository conflict. Refresh the inspection and prepare a new branch plan.',
    'execution-unavailable': 'FounderLab could not create the branch right now. No file, commit, or merge action was attempted.',
  }
  return messages[error?.code] || 'FounderLab could not complete this branch action. No file, commit, or merge action was attempted.'
}
