import { loadWorkspaceData, saveWorkspaceData } from '../../services/workspaceStore.js'
import {
  BUILDER_PROJECT_TYPE,
  createBuilderProject,
  isBuilderProject,
  normalizeBuilderProject,
} from './builderProjectSchema.js'
import { appendBuilderVersion } from './builderVersions.js'
import { validateBuilderFiles } from './builderValidation.js'

export const BUILDER_PROJECTS_STORAGE_KEY = 'fl_projects'

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sortNewestFirst(projects) {
  return [...projects].sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
}

function attachRuntimeValidation(project) {
  if (!project || project.framework !== 'static-html') return project
  const result = validateBuilderFiles(project.files, { entryFile: project.entryFile })
  const validation = { valid: result.valid, issues: result.issues, checkedAt: new Date().toISOString() }
  if (result.valid) return { ...project, validation }
  return {
    ...project,
    status: project.status === 'archived' ? 'archived' : 'error',
    validation,
    preview: { ...project.preview, status: 'error', lastError: 'The saved project did not pass Builder safety validation.' },
    recovery: {
      errorCode: 'PERSISTED_PROJECT_INVALID',
      message: 'FounderLab preserved this project, but it needs a safe recovery before it can preview.',
      retryable: true,
      interruptedAt: project.recovery?.interruptedAt || null,
    },
  }
}

/**
 * Builder projects live in the same authenticated workspace collection as Code
 * AI projects. This repository only ever replaces a Builder 2.0 record and
 * deliberately preserves unknown records so features can evolve independently.
 */
export function createBuilderProjectRepository({
  load = loadWorkspaceData,
  save = saveWorkspaceData,
  now = () => new Date().toISOString(),
} = {}) {
  async function readAll() {
    const value = await load(BUILDER_PROJECTS_STORAGE_KEY, [])
    return Array.isArray(value) ? value.filter(isRecord) : []
  }

  return {
    async list(ownerId) {
      const rawRecords = await readAll()
      const normalized = rawRecords.map((record) => normalizeBuilderProject(record, { ownerId, now: now() }))
      const projects = normalized
        .map((result) => attachRuntimeValidation(result.project))
        .filter((project) => project && (!ownerId || project.ownerId === ownerId))
      return sortNewestFirst(projects)
    },

    async get(projectId, ownerId) {
      const projects = await this.list(ownerId)
      return projects.find((project) => project.id === projectId) || null
    },

    async save(project, ownerId) {
      const normalized = normalizeBuilderProject({ ...project, ownerId: project?.ownerId || ownerId }, { ownerId, now: now() })
      if (!normalized.project || !isBuilderProject(normalized.project) || (ownerId && normalized.project.ownerId !== ownerId)) {
        return { saved: false, project: null, reason: 'INVALID_PROJECT' }
      }
      const validatedProject = attachRuntimeValidation(normalized.project)
      if (!validatedProject.validation.valid) {
        return { saved: false, project: validatedProject, reason: 'INVALID_PROJECT' }
      }
      const records = await readAll()
      const withoutCurrent = records.filter((record) => {
        const result = normalizeBuilderProject(record, { ownerId, now: now() })
        return !result.project || result.project.id !== validatedProject.id
      })
      const result = await save(BUILDER_PROJECTS_STORAGE_KEY, [...withoutCurrent, validatedProject])
      return {
        saved: result?.cloudSaved === true,
        locallyRecovered: result?.localSaved === true,
        project: validatedProject,
        reason: result?.cloudSaved === false ? 'REMOTE_SAVE_FAILED' : null,
      }
    },

    async remove(projectId, ownerId) {
      const records = await readAll()
      const retained = records.filter((record) => {
        const result = normalizeBuilderProject(record, { ownerId, now: now() })
        return !result.project || result.project.id !== projectId || (ownerId && result.project.ownerId !== ownerId)
      })
      const result = await save(BUILDER_PROJECTS_STORAGE_KEY, retained)
      return { saved: result?.cloudSaved === true, locallyRecovered: result?.localSaved === true }
    },

    async duplicate(project, ownerId) {
      const createdAt = now()
      let copy = createBuilderProject({ ownerId, prompt: project.originalPrompt, name: `${project.name} copy`, now: createdAt })
      copy = {
        ...copy,
        description: project.description,
        projectType: project.projectType,
        files: project.files,
        entryFile: project.entryFile,
        status: project.validation?.valid ? 'ready' : 'draft',
        validation: project.validation,
        brand: project.brand,
        settings: project.settings,
        preview: { status: project.validation?.valid ? 'ready' : 'idle', lastSuccessfulVersionId: null, lastSuccessfulAt: null, lastError: null },
      }
      if (project.files?.length) {
        copy = appendBuilderVersion(copy, {
          files: project.files,
          origin: 'migration',
          summary: `Duplicated from ${project.name}`,
          validation: project.validation,
          changedPaths: project.files.map((file) => file.path),
          now: createdAt,
        })
        copy.preview.lastSuccessfulVersionId = copy.currentVersionId
        copy.preview.lastSuccessfulAt = createdAt
      }
      return this.save(copy, ownerId)
    },

    projectType: BUILDER_PROJECT_TYPE,
  }
}

export const builderProjectRepository = createBuilderProjectRepository()
