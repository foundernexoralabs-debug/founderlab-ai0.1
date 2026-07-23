/**
 * Read native GitHub Checks evidence for the commit created by the narrow
 * executor. This observes a repository's configured CI; it deliberately does
 * not dispatch arbitrary workflows from the browser because those workflows
 * can deploy or mutate external systems.
 */

import { parsePublicGithubRepositoryReference } from './chatRepositoryInspection.js'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const MAX_CHECKS = 24

function text(value, limit = 120) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function safeSha(value) {
  const sha = text(value, 80)
  return /^[a-f0-9]{7,64}$/i.test(sha) ? sha : ''
}

function repositoryFor(value) {
  return parsePublicGithubRepositoryReference(value?.slug || `${value?.owner || ''}/${value?.name || ''}`)
}

export class GithubValidationExecutionError extends Error {
  constructor(code) {
    super(code)
    this.name = 'GithubValidationExecutionError'
    this.code = code
  }
}

function errorForStatus(status) {
  if (status === 401) return new GithubValidationExecutionError('github-auth-required')
  if (status === 403) return new GithubValidationExecutionError('github-permission-denied')
  if (status === 404) return new GithubValidationExecutionError('repository-inaccessible')
  return new GithubValidationExecutionError('execution-unavailable')
}

async function requestGithub(fetchImpl, path, token) {
  let response
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token.trim()}`,
      },
    })
  } catch {
    throw new GithubValidationExecutionError('execution-unavailable')
  }
  if (!response?.ok) throw errorForStatus(response?.status)
  try {
    return await response.json()
  } catch {
    throw new GithubValidationExecutionError('execution-unavailable')
  }
}

function checkState(value) {
  const status = text(value?.status, 32).toLowerCase()
  const conclusion = text(value?.conclusion, 32).toLowerCase()
  if (status !== 'completed') return 'pending'
  if (['success', 'neutral', 'skipped'].includes(conclusion)) return 'passed'
  return 'failed'
}

function bucketState(checks) {
  if (!checks.length) return 'not-run'
  if (checks.some((check) => check.state === 'failed')) return 'failed'
  if (checks.every((check) => check.state === 'passed')) return 'passed'
  return 'not-run'
}

function matches(check, pattern) {
  return pattern.test(check.name)
}

/**
 * Returns bounded, sanitized check metadata and honest test/build/report
 * states. “not-run” means GitHub has not supplied relevant completed evidence.
 */
export async function getGithubCommitValidation({ token, repository, commitSha, fetchImpl = globalThis.fetch } = {}) {
  const reference = repositoryFor(repository)
  const sha = safeSha(commitSha)
  if (!text(token, 2048)) throw new GithubValidationExecutionError('github-connection-required')
  if (!reference || !sha || typeof fetchImpl !== 'function') throw new GithubValidationExecutionError('execution-unavailable')
  const owner = encodeURIComponent(reference.owner)
  const name = encodeURIComponent(reference.name)
  const response = await requestGithub(fetchImpl, `/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}/check-runs?per_page=${MAX_CHECKS}`, token)
  const checks = (Array.isArray(response?.check_runs) ? response.check_runs : [])
    .slice(0, MAX_CHECKS)
    .map((check) => ({ name: text(check?.name, 100), state: checkState(check) }))
    .filter((check) => check.name)
  const tests = bucketState(checks.filter((check) => matches(check, /(?:test|spec|coverage|typecheck|lint)/i)))
  const build = bucketState(checks.filter((check) => matches(check, /(?:build|compile|bundle|deploy preview)/i)))
  const report = bucketState(checks)
  return Object.freeze({
    repository: reference,
    commitSha: sha,
    checks: Object.freeze(checks),
    validation: Object.freeze({ tests, build, report }),
  })
}

export function getGithubValidationErrorPresentation(error) {
  const copy = {
    'github-connection-required': 'Connect GitHub in Settings before checking this commit’s validation.',
    'github-auth-required': 'GitHub needs a valid session token before it can read commit validation. Reconnect GitHub and try again.',
    'github-permission-denied': 'The connected GitHub account cannot read validation for this repository.',
    'repository-inaccessible': 'This repository or commit is not accessible to the connected GitHub account.',
    'execution-unavailable': 'FounderLab could not read GitHub validation right now. No validation result was recorded.',
  }
  return copy[error?.code] || 'FounderLab could not read GitHub validation. No validation result was recorded.'
}
