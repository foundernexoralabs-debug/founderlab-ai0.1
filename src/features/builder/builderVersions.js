import { uid } from '../../lib/ids.js'

export const BUILDER_MAX_VERSIONS = 12

function cloneFile(file) {
  return {
    ...file,
    validation: file.validation ? { ...file.validation, issues: [...(file.validation.issues || [])] } : { valid: true, issues: [] },
  }
}

function cloneFiles(files) {
  return Array.isArray(files) ? files.map(cloneFile) : []
}

export function createBuilderVersion({ files, origin, summary, provider = null, model = null, validation, changedPaths = [], now = new Date().toISOString() } = {}) {
  return {
    id: `builder-version-${uid()}`,
    createdAt: now,
    origin: origin || 'manual-edit',
    summary: summary || 'Project updated',
    files: cloneFiles(files),
    changedPaths: [...new Set(changedPaths)].filter(Boolean),
    provider,
    model,
    validation: validation ? { ...validation, issues: [...(validation.issues || [])] } : { valid: true, issues: [], checkedAt: now },
  }
}

export function appendBuilderVersion(project, options) {
  const version = createBuilderVersion({ ...options, files: options?.files || project.files })
  const versions = [...(project.versions || []), version].slice(-BUILDER_MAX_VERSIONS)
  return {
    ...project,
    files: cloneFiles(version.files),
    versions,
    currentVersionId: version.id,
    updatedAt: version.createdAt,
  }
}

export function restoreBuilderVersion(project, versionId, { now = new Date().toISOString() } = {}) {
  const target = (project.versions || []).find((version) => version.id === versionId)
  if (!target) return { project, restored: false }
  return {
    project: appendBuilderVersion(project, {
      files: target.files,
      origin: 'restore',
      summary: `Restored ${target.summary}`,
      provider: target.provider,
      model: target.model,
      validation: target.validation,
      changedPaths: target.files.map((file) => file.path),
      now,
    }),
    restored: true,
  }
}

export function getCurrentBuilderVersion(project) {
  return (project?.versions || []).find((version) => version.id === project.currentVersionId) || null
}
