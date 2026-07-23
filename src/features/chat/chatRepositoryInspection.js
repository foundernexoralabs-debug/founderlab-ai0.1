/**
 * Read-only public GitHub inspection for Chat. The user must explicitly
 * choose the inspection action; this module never authenticates, creates a
 * branch, edits files, or sends repository contents to an AI provider.
 */

const GITHUB_API_ORIGIN = 'https://api.github.com'
const MAX_PATHS = 80
const MAX_DIRECTORIES = 12
const MAX_DESCRIPTION_LENGTH = 240
const MAX_BRANCH_SEGMENT_LENGTH = 42
const BRANCH_STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'that', 'the', 'this', 'to', 'with'])

function safeText(value, limit = 160) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function safeIdentifier(value) {
  const candidate = safeText(value, 100)
  return /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate : ''
}

function safePath(value) {
  const path = safeText(value, 220)
  if (!path || path.startsWith('/') || path.includes('..')) return ''
  return path
}

function freezeReference(owner, name) {
  return Object.freeze({ provider: 'github', owner, name, slug: `${owner}/${name}` })
}

/** Accept a deliberate public GitHub URL or owner/repository reference only. */
export function parsePublicGithubRepositoryReference(value) {
  const input = safeText(value, 700)
  if (!input) return null
  const urlMatch = input.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(?:[/?#\s]|$)/i)
  const shorthandMatch = input.match(/(?:^|\s)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?(?:\s|$)/)
  const match = urlMatch || shorthandMatch
  if (!match) return null
  const owner = safeIdentifier(match[1])
  const name = safeIdentifier(match[2].replace(/(?:\.git)?[.,;:!?]+$/i, '').replace(/\.git$/i, ''))
  return owner && name ? freezeReference(owner, name) : null
}

export class RepositoryInspectionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RepositoryInspectionError'
    this.code = code
  }
}

function inspectionErrorForStatus(status) {
  if (status === 404) return new RepositoryInspectionError('REPOSITORY_NOT_FOUND', 'This public GitHub repository is not available to inspect.')
  if (status === 401 || status === 403 || status === 429) return new RepositoryInspectionError('GITHUB_RATE_LIMITED', 'GitHub cannot complete the public inspection right now. Please try again shortly.')
  return new RepositoryInspectionError('REPOSITORY_INSPECTION_FAILED', 'FounderLab could not inspect this repository right now.')
}

async function requestJSON(fetchImpl, path) {
  let response
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    throw new RepositoryInspectionError('REPOSITORY_NETWORK_UNAVAILABLE', 'FounderLab could not reach GitHub for this inspection.')
  }
  if (!response?.ok) throw inspectionErrorForStatus(response?.status)
  try {
    return await response.json()
  } catch {
    throw new RepositoryInspectionError('REPOSITORY_RESPONSE_INVALID', 'GitHub returned an unreadable inspection response.')
  }
}

function sortPaths(paths) {
  const priority = (path) => {
    if (/^(readme|package\.json|pnpm-lock|yarn\.lock|package-lock|vite\.config|next\.config|tsconfig|src\/)/i.test(path)) return 0
    return 1
  }
  return [...paths].sort((left, right) => priority(left) - priority(right) || left.localeCompare(right))
}

function summarizeTree(tree) {
  const entries = Array.isArray(tree?.tree) ? tree.tree : []
  const files = entries.filter((entry) => entry?.type === 'blob').map((entry) => safePath(entry.path)).filter(Boolean)
  const directories = [...new Set(files.map((path) => path.split('/')[0]).filter(Boolean))].slice(0, MAX_DIRECTORIES)
  const importantFiles = sortPaths(files.filter((path) => /(?:^|\/)(?:readme(?:\.md)?|package\.json|tsconfig\.json|vite\.config\.[jt]s|next\.config\.[jt]s|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml)$/i.test(path))).slice(0, 12)
  const sourceFiles = files.filter((path) => /\.(?:[cm]?[jt]sx?|tsx?|py|go|rs|java|rb|php|cs|swift)$/i.test(path)).length
  return Object.freeze({
    state: tree?.truncated === true ? 'partial' : 'complete',
    truncated: tree?.truncated === true,
    totalFiles: files.length,
    sourceFiles,
    directories: Object.freeze(directories),
    importantFiles: Object.freeze(importantFiles),
    sampleFiles: Object.freeze(sortPaths(files).slice(0, MAX_PATHS)),
  })
}

/**
 * Performs a read-only public inspection. Returned state is purposefully
 * bounded to metadata and paths; file contents, tokens, and private data are
 * never included in the Chat inspection evidence.
 */
export async function inspectPublicGithubRepository(value, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const reference = typeof value === 'object' && value?.provider === 'github'
    ? parsePublicGithubRepositoryReference(value.slug || `${value.owner || ''}/${value.name || ''}`)
    : parsePublicGithubRepositoryReference(value)
  if (!reference) throw new RepositoryInspectionError('REPOSITORY_REFERENCE_REQUIRED', 'Add a public GitHub repository URL or owner/repository reference before inspecting.')
  if (typeof fetchImpl !== 'function') throw new RepositoryInspectionError('REPOSITORY_NETWORK_UNAVAILABLE', 'FounderLab cannot start a repository inspection in this browser.')

  const encodedOwner = encodeURIComponent(reference.owner)
  const encodedName = encodeURIComponent(reference.name)
  const repository = await requestJSON(fetchImpl, `/repos/${encodedOwner}/${encodedName}`)
  if (repository?.private === true) throw new RepositoryInspectionError('PRIVATE_REPOSITORY_UNSUPPORTED', 'This inspection path is read-only and supports public GitHub repositories only.')
  const defaultBranch = safeIdentifier(repository?.default_branch) || 'main'
  let tree
  try {
    tree = await requestJSON(fetchImpl, `/repos/${encodedOwner}/${encodedName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`)
  } catch (error) {
    if (!(error instanceof RepositoryInspectionError)) throw error
    tree = { tree: [], truncated: true, unavailable: true }
  }
  const treeSummary = tree?.unavailable
    ? Object.freeze({ state: 'unavailable', truncated: true, totalFiles: 0, sourceFiles: 0, directories: Object.freeze([]), importantFiles: Object.freeze([]), sampleFiles: Object.freeze([]) })
    : summarizeTree(tree)
  return Object.freeze({
    version: 1,
    reference,
    inspectedAt: typeof now === 'function' ? now() : new Date().toISOString(),
    repository: Object.freeze({
      name: safeText(repository?.name, 120) || reference.name,
      fullName: safeText(repository?.full_name, 180) || reference.slug,
      description: safeText(repository?.description, MAX_DESCRIPTION_LENGTH),
      defaultBranch,
      language: safeText(repository?.language, 80),
      visibility: repository?.private === true ? 'private' : 'public',
      updatedAt: typeof repository?.updated_at === 'string' ? repository.updated_at : '',
    }),
    tree: treeSummary,
  })
}

/** User-facing, evidence-based summary; it never claims a branch or file was modified. */
export function formatRepositoryInspectionReport(inspection) {
  if (!inspection?.reference || !inspection?.repository || !inspection?.tree) return ''
  const lines = [
    '## Repository inspection complete',
    `**Repository:** \`${inspection.repository.fullName}\` · public GitHub metadata read`,
    `**Default branch:** \`${inspection.repository.defaultBranch}\``,
    inspection.repository.language ? `**Primary language:** ${inspection.repository.language}` : '',
    `**File tree:** ${inspection.tree.state === 'complete' ? 'read' : inspection.tree.state === 'partial' ? 'partially read' : 'not available'}${inspection.tree.totalFiles ? ` · ${inspection.tree.totalFiles} files, ${inspection.tree.sourceFiles} source files` : ''}`,
    inspection.tree.directories.length ? `**Top-level areas:** ${inspection.tree.directories.map((directory) => `\`${directory}\``).join(', ')}` : '',
    inspection.tree.importantFiles.length ? `**Key files found:** ${inspection.tree.importantFiles.map((path) => `\`${path}\``).join(', ')}` : '',
    inspection.tree.truncated ? 'The returned tree was incomplete, so this is a bounded inspection rather than a full repository audit.' : '',
    '',
    'No branch was created and no files were changed. Review this inspection before preparing a branch-first change.',
  ].filter(Boolean)
  return lines.join('\n')
}

export function getRepositoryInspectionErrorPresentation(error) {
  const code = error?.code || ''
  const messages = {
    REPOSITORY_REFERENCE_REQUIRED: 'Add a public GitHub repository URL or owner/repository reference, then try again.',
    REPOSITORY_NOT_FOUND: 'This public GitHub repository is not available to inspect.',
    PRIVATE_REPOSITORY_UNSUPPORTED: 'This read-only inspection path currently supports public GitHub repositories only.',
    GITHUB_RATE_LIMITED: 'GitHub cannot complete the public inspection right now. Please try again shortly.',
    REPOSITORY_NETWORK_UNAVAILABLE: 'FounderLab could not reach GitHub for this inspection. Check your connection and try again.',
    REPOSITORY_RESPONSE_INVALID: 'GitHub returned an unreadable response. Please try again.',
  }
  return messages[code] || 'FounderLab could not inspect this repository right now. Please try again.'
}

function branchSegment(value) {
  const words = safeText(value, 320)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter((word) => word.length > 1 && !BRANCH_STOP_WORDS.has(word))
    .slice(0, 6)
  return words.join('-').slice(0, MAX_BRANCH_SEGMENT_LENGTH).replace(/-+$/g, '')
}

function branchKindForRequest(value) {
  const request = safeText(value, 420).toLowerCase()
  if (/\b(?:fix|repair|bug|crash|regression|error)\b/.test(request)) return 'fix'
  if (/\b(?:refactor|cleanup|clean up|improve|optimi[sz]e)\b/.test(request)) return 'improve'
  if (/\b(?:test|coverage)\b/.test(request)) return 'test'
  if (/\b(?:document|docs|readme)\b/.test(request)) return 'docs'
  return 'change'
}

/**
 * Create a deterministic branch proposal from an inspection result. This is
 * intentionally not a git operation: it gives the user an auditable
 * branch-first boundary without claiming that a branch was created.
 */
export function createRepositoryBranchPreparation({ inspection = null, request = '' } = {}) {
  if (!inspection?.reference?.slug || !inspection?.repository?.defaultBranch) return null
  const kind = branchKindForRequest(request)
  const requestWithoutRepository = request
    .replace(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?(?:[/?#][^\s]*)?/gi, '')
    .replace(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g, '')
    .replace(/\b(?:please|can you|could you|founderlab|repository|repo|project|branch|work)\b/gi, '')
  const rawScope = branchSegment(requestWithoutRepository)
  const scope = rawScope.replace(new RegExp(`^${kind}-`), '') || 'scoped-work'
  return Object.freeze({
    version: 1,
    repository: inspection.reference,
    baseBranch: inspection.repository.defaultBranch,
    proposedBranch: `founderlab/${kind}-${scope}`,
    risk: ['fix', 'improve', 'test'].includes(kind) ? 'medium' : 'low',
    state: 'prepared',
  })
}

/** A transparent report for a proposed branch only; no mutation is implied. */
export function formatRepositoryBranchPreparationReport(preparation) {
  if (!preparation?.repository?.slug || !preparation?.baseBranch || !preparation?.proposedBranch) return ''
  return [
    '## Branch-first change prepared',
    `**Repository:** \`${preparation.repository.slug}\``,
    `**Base branch:** \`${preparation.baseBranch}\``,
    `**Proposed branch:** \`${preparation.proposedBranch}\``,
    `**Risk:** ${preparation.risk}`,
    '',
    'This is a prepared branch plan only. No branch was created, no files were changed, and no tests were run. Review the inspected scope, then explicitly approve a future mutation workflow.',
  ].join('\n')
}
