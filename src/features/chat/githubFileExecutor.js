/**
 * Explicit, browser-session GitHub file executor.
 *
 * The existing GitHub token remains in session memory and is never persisted,
 * logged, or sent through a FounderLab service. This narrow executor updates
 * one existing, inspected text file on an already approved branch. It cannot
 * create arbitrary files, force-push, merge, or run shell commands.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const MAX_FILE_BYTES = 200 * 1024
const MAX_COMMIT_MESSAGE_LENGTH = 180

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

function toBase64(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function fromBase64(value) {
  if (typeof value !== 'string') return null
  let binary
  try {
    binary = atob(value.replace(/\s+/g, ''))
  } catch {
    return ''
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

function errorForStatus(status, operation) {
  if (status === 401) return new GithubFileExecutionError('github-auth-required')
  if (status === 403) return new GithubFileExecutionError('github-permission-denied')
  if (status === 404) return new GithubFileExecutionError('repository-inaccessible')
  if ([409, 422].includes(status) && operation === 'write') return new GithubFileExecutionError('file-change-conflict')
  if (status === 409) return new GithubFileExecutionError('execution-conflict')
  return new GithubFileExecutionError('execution-unavailable')
}

function headersFor(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token.trim()}`,
  }
}

async function requestGithub(fetchImpl, path, options = {}, { operation = 'read', mutationMayHaveStarted = false } = {}) {
  let response
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, options)
  } catch {
    throw new GithubFileExecutionError(mutationMayHaveStarted ? 'partial-execution' : 'execution-unavailable')
  }
  if (!response?.ok) throw errorForStatus(response?.status, operation)
  try {
    return await response.json()
  } catch {
    throw new GithubFileExecutionError(mutationMayHaveStarted ? 'partial-execution' : 'execution-unavailable')
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
 * Replace exactly one existing text file on the named branch. GitHub creates
 * the underlying blob/tree/commit/ref update atomically through Contents API.
 */
export async function applyGithubFileChange({ token, repository, branch, path, content, expectedSha, commitMessage, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const reference = repositoryFor(repository)
  const targetBranch = branchFor(branch)
  const targetPath = safePath(path)
  const sha = safeSha(expectedSha)
  const nextContent = typeof content === 'string' ? content.replace(/\r\n/g, '\n') : ''
  const message = text(commitMessage, MAX_COMMIT_MESSAGE_LENGTH)
  if (!text(token, 2048)) throw new GithubFileExecutionError('github-connection-required')
  if (!reference || !targetBranch || !targetPath || !sha || !message || !nextContent || nextContent.includes('\u0000') || byteLength(nextContent) > MAX_FILE_BYTES || typeof fetchImpl !== 'function') {
    throw new GithubFileExecutionError('execution-unavailable')
  }
  const owner = encodeURIComponent(reference.owner)
  const name = encodeURIComponent(reference.name)
  const response = await requestGithub(
    fetchImpl,
    `/repos/${owner}/${name}/contents/${encodePath(targetPath)}`,
    {
      method: 'PUT',
      headers: { ...headersFor(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toBase64(nextContent), sha, branch: targetBranch }),
    },
    { operation: 'write', mutationMayHaveStarted: true },
  )
  const commitSha = safeSha(response?.commit?.sha)
  const responsePath = safePath(response?.content?.path)
  if (!commitSha || responsePath !== targetPath) throw new GithubFileExecutionError('partial-execution')
  return Object.freeze({
    repository: reference,
    branch: targetBranch,
    path: targetPath,
    commitSha,
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
    'file-content-unavailable': 'FounderLab could not safely load this file as a bounded text file. No change was attempted.',
    'partial-execution': 'GitHub did not return a complete mutation result. The file may have changed; re-inspect the branch before retrying.',
    'execution-conflict': 'GitHub reported a repository conflict. Refresh the inspection and branch state before retrying.',
    'execution-unavailable': 'FounderLab could not apply this file change right now. No successful change was recorded.',
  }
  return copy[error?.code] || 'FounderLab could not apply this file change. No successful change was recorded.'
}
