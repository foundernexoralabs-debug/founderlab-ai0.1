import { uid } from '../../lib/ids.js'

export const BUILDER_PROJECT_SCHEMA_VERSION = 2
export const BUILDER_PROJECT_TYPE = 'builder-project'
export const BUILDER_RUNTIME = 'static-html'
export const BUILDER_TEMPLATE = 'founderlab-static-v1'
export const BUILDER_ENTRY_FILE = 'index.html'
export const BUILDER_PROJECT_STATUSES = new Set([
  'draft', 'planning', 'generating', 'validating', 'repairing', 'saving', 'ready', 'error', 'interrupted', 'archived', 'legacy',
])
export const BUILDER_FILE_STATES = new Set(['generated', 'edited', 'repaired'])

const MAX_HISTORY_ITEMS = 30
const MAX_VERSIONS = 12

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function content(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''
}

function timestamp(value, fallback) {
  return Number.isFinite(Date.parse(value || '')) ? value : fallback
}

function safeArray(value, map) {
  return Array.isArray(value) ? value.map(map).filter(Boolean) : []
}

export function inferFileLanguage(path = '') {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'html') return 'html'
  if (extension === 'css') return 'css'
  if (extension === 'js') return 'javascript'
  if (extension === 'json') return 'json'
  if (extension === 'svg') return 'svg'
  return 'text'
}

export function normalizeBuilderFile(value, { now = new Date().toISOString() } = {}) {
  if (!isRecord(value)) return null
  const path = text(value.path || value.name)
  if (!path) return null
  const createdAt = timestamp(value.createdAt || value.created_at, now)
  const updatedAt = timestamp(value.updatedAt || value.updated_at, createdAt)
  return {
    path,
    content: content(value.content),
    language: text(value.language || value.type, inferFileLanguage(path)),
    role: text(value.role, path === BUILDER_ENTRY_FILE ? 'entry' : 'source'),
    state: BUILDER_FILE_STATES.has(value.state) ? value.state : 'generated',
    createdAt,
    updatedAt,
    validation: isRecord(value.validation) ? value.validation : { valid: true, issues: [] },
    versionId: text(value.versionId || value.version_id) || null,
  }
}

function normalizeValidation(value, fallbackValid = false) {
  const issues = safeArray(value?.issues, (issue) => {
    if (!isRecord(issue)) return null
    return {
      code: text(issue.code, 'VALIDATION_ISSUE'),
      message: text(issue.message, 'The project needs attention.'),
      path: text(issue.path) || null,
      severity: ['error', 'warning'].includes(issue.severity) ? issue.severity : 'error',
    }
  })
  return {
    valid: value?.valid === true || (fallbackValid && issues.every((issue) => issue.severity !== 'error')),
    issues,
    checkedAt: timestamp(value?.checkedAt || value?.checked_at, new Date().toISOString()),
  }
}

function normalizeVersion(value, { now, fallbackFiles = [] } = {}) {
  if (!isRecord(value)) return null
  const files = safeArray(value.files, (file) => normalizeBuilderFile(file, { now }))
  const safeFiles = files.length ? files : fallbackFiles.map((file) => ({ ...file, validation: { ...file.validation } }))
  if (!safeFiles.length) return null
  return {
    id: text(value.id) || `builder-version-${uid()}`,
    createdAt: timestamp(value.createdAt || value.ts, now),
    origin: ['generation', 'ai-edit', 'manual-edit', 'repair', 'restore', 'migration'].includes(value.origin)
      ? value.origin
      : 'migration',
    summary: text(value.summary || value.label, 'Recovered project version'),
    files: safeFiles,
    changedPaths: safeArray(value.changedPaths, (path) => text(path)).filter(Boolean),
    provider: text(value.provider) || null,
    model: text(value.model) || null,
    validation: normalizeValidation(value.validation, true),
  }
}

function boundedHistory(value, now) {
  return safeArray(value, (item) => {
    if (!isRecord(item)) return null
    return {
      id: text(item.id) || `builder-event-${uid()}`,
      at: timestamp(item.at || item.createdAt || item.ts, now),
      stage: text(item.stage, 'updated'),
      message: text(item.message, 'Project updated.'),
      provider: text(item.provider) || null,
      model: text(item.model) || null,
      details: isRecord(item.details) ? item.details : null,
    }
  }).slice(-MAX_HISTORY_ITEMS)
}

function normalizedSettings(value) {
  return {
    device: ['desktop', 'tablet', 'mobile'].includes(value?.device) ? value.device : 'desktop',
    previewPath: text(value?.previewPath, BUILDER_ENTRY_FILE),
  }
}

function normalizedBrand(value) {
  return {
    name: text(value?.name),
    tone: text(value?.tone),
    visualDirection: text(value?.visualDirection || value?.style),
    colors: safeArray(value?.colors, (color) => text(color)).filter(Boolean).slice(0, 8),
  }
}

export function createBuilderProject({ ownerId, prompt = '', name = '', plan = null, now = new Date().toISOString() } = {}) {
  const id = `builder-project-${uid()}`
  const projectName = text(name) || text(plan?.name) || 'Untitled FounderLab project'
  return {
    schemaVersion: BUILDER_PROJECT_SCHEMA_VERSION,
    type: BUILDER_PROJECT_TYPE,
    id,
    ownerId: text(ownerId) || null,
    name: projectName,
    description: text(plan?.summary || prompt),
    originalPrompt: text(prompt),
    projectType: text(plan?.projectType, 'website'),
    status: 'draft',
    framework: BUILDER_RUNTIME,
    template: BUILDER_TEMPLATE,
    files: [],
    entryFile: BUILDER_ENTRY_FILE,
    createdAt: now,
    updatedAt: now,
    currentVersionId: null,
    versions: [],
    generationHistory: [],
    changeHistory: [],
    validation: { valid: false, issues: [], checkedAt: now },
    preview: { status: 'idle', lastSuccessfulVersionId: null, lastSuccessfulAt: null, lastError: null },
    settings: normalizedSettings(),
    brand: normalizedBrand(plan?.brand),
    recovery: { errorCode: null, message: null, retryable: false, interruptedAt: null },
  }
}

function migrateLegacyProject(value, { ownerId, now }) {
  const legacyFiles = safeArray(value.files, (file) => normalizeBuilderFile(file, { now }))
  if (!legacyFiles.length) return null
  const project = createBuilderProject({
    ownerId: text(value.ownerId || value.user_id) || ownerId,
    prompt: text(value.desc || value.prompt || value.description),
    name: text(value.name) || 'Recovered Builder project',
    now,
  })
  const version = normalizeVersion({
    id: value.currentVersionId || value.versions?.[value.activeIdx]?.id,
    files: legacyFiles,
    summary: 'Migrated Builder project',
    origin: 'migration',
    createdAt: value.updated_at || value.created_at || now,
  }, { now, fallbackFiles: legacyFiles })
  return {
    ...project,
    id: text(value.id) || project.id,
    description: text(value.desc || value.description || project.description),
    projectType: text(value.projectType, 'website'),
    status: 'legacy',
    framework: 'legacy-next-preview',
    template: 'legacy-next-v1',
    files: legacyFiles,
    entryFile: text(value.entryFile, legacyFiles[0]?.path || BUILDER_ENTRY_FILE),
    currentVersionId: version?.id || null,
    versions: version ? [version] : [],
    brand: normalizedBrand({ style: value.style }),
    recovery: {
      errorCode: 'LEGACY_PROJECT',
      message: 'This project was created with the earlier Builder runtime. Its files are preserved and can be recreated in Builder 2.0.',
      retryable: false,
      interruptedAt: null,
    },
  }
}

export function normalizeBuilderProject(value, { ownerId, now = new Date().toISOString() } = {}) {
  if (!isRecord(value)) return { project: null, repaired: false, migrated: false }
  if (value.type === 'builder' && value.schemaVersion !== BUILDER_PROJECT_SCHEMA_VERSION) {
    const project = migrateLegacyProject(value, { ownerId, now })
    return { project, repaired: Boolean(project), migrated: Boolean(project) }
  }
  if (value.type !== BUILDER_PROJECT_TYPE) return { project: null, repaired: false, migrated: false }

  const fallback = createBuilderProject({ ownerId: text(value.ownerId) || ownerId, prompt: value.originalPrompt, name: value.name, now })
  const files = safeArray(value.files, (file) => normalizeBuilderFile(file, { now }))
  const versions = safeArray(value.versions, (version) => normalizeVersion(version, { now, fallbackFiles: files })).slice(-MAX_VERSIONS)
  const entryFile = text(value.entryFile, BUILDER_ENTRY_FILE)
  const currentVersionId = text(value.currentVersionId) || versions.at(-1)?.id || null
  const validation = normalizeValidation(value.validation, false)
  const status = BUILDER_PROJECT_STATUSES.has(value.status) ? value.status : files.length ? 'interrupted' : 'draft'
  const project = {
    ...fallback,
    id: text(value.id) || fallback.id,
    ownerId: text(value.ownerId) || ownerId || null,
    name: text(value.name, fallback.name),
    description: text(value.description, fallback.description),
    originalPrompt: text(value.originalPrompt, fallback.originalPrompt),
    projectType: text(value.projectType, fallback.projectType),
    status,
    framework: text(value.framework, BUILDER_RUNTIME),
    template: text(value.template, BUILDER_TEMPLATE),
    files,
    entryFile,
    createdAt: timestamp(value.createdAt || value.created_at, fallback.createdAt),
    updatedAt: timestamp(value.updatedAt || value.updated_at, fallback.updatedAt),
    currentVersionId,
    versions,
    generationHistory: boundedHistory(value.generationHistory, now),
    changeHistory: boundedHistory(value.changeHistory, now),
    validation,
    preview: {
      status: ['idle', 'building', 'ready', 'error', 'stale'].includes(value.preview?.status) ? value.preview.status : 'idle',
      lastSuccessfulVersionId: text(value.preview?.lastSuccessfulVersionId) || null,
      lastSuccessfulAt: timestamp(value.preview?.lastSuccessfulAt, null),
      lastError: text(value.preview?.lastError) || null,
    },
    settings: normalizedSettings(value.settings),
    brand: normalizedBrand(value.brand),
    recovery: {
      errorCode: text(value.recovery?.errorCode) || null,
      message: text(value.recovery?.message) || null,
      retryable: value.recovery?.retryable === true,
      interruptedAt: timestamp(value.recovery?.interruptedAt, null),
    },
  }
  const repaired = JSON.stringify(project) !== JSON.stringify(value)
  return { project, repaired, migrated: false }
}

export function isBuilderProject(value) {
  return value?.type === BUILDER_PROJECT_TYPE && value?.schemaVersion === BUILDER_PROJECT_SCHEMA_VERSION
}

export function isLegacyBuilderProject(value) {
  return value?.type === 'builder'
}
