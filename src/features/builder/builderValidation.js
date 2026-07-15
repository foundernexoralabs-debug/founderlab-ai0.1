import { BUILDER_ENTRY_FILE, BUILDER_RUNTIME, inferFileLanguage, normalizeBuilderFile } from './builderProjectSchema.js'

export const BUILDER_MAX_FILE_BYTES = 64 * 1024
export const BUILDER_MAX_TOTAL_BYTES = 420 * 1024
export const BUILDER_MAX_FILE_COUNT = 40

const ALLOWED_PATH = /^(?:index\.html|styles\.css|app\.js|pages\/[a-z0-9][a-z0-9._-]*\.html|assets\/[a-z0-9][a-z0-9._/-]*)$/i
const FORBIDDEN_CONTENT = [
  { code: 'EXTERNAL_NETWORK', expression: /\bhttps?:\/\//i, message: 'External network resources are not supported in the isolated preview.' },
  { code: 'UNSAFE_EVAL', expression: /\b(?:eval|Function)\s*\(/, message: 'Dynamic code execution is not allowed.' },
  { code: 'PARENT_ACCESS', expression: /\b(?:window\s*\.\s*)?(?:parent|top|opener)\s*(?:\.|\[)/i, message: 'Generated projects cannot access a parent window.' },
  { code: 'EMBEDDED_DOCUMENT', expression: /<\s*(?:iframe|object|embed|base)\b/i, message: 'Embedded documents are not supported.' },
  { code: 'INLINE_RUNTIME_TAG', expression: /<\s*(?:script|link|style)\b/i, message: 'Use the project styles.css and app.js files instead of inline runtime tags.' },
  { code: 'REMOTE_RESOURCE', expression: /(?:<\s*(?:script|link|img)[^>]+(?:src|href)\s*=|url\s*\()\s*['"]?\s*(?:\/\/|data:text\/html)/i, message: 'Only local project resources are supported.' },
]

function issue(code, message, path = null, severity = 'error') {
  return { code, message, path, severity }
}

export function normalizeBuilderPath(value) {
  if (typeof value !== 'string') return null
  const path = value.replace(/\\/g, '/').replace(/\r|\n|\0/g, '').trim()
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('//') || !ALLOWED_PATH.test(path)) return null
  return path
}

export function validateBuilderFiles(inputFiles, { entryFile = BUILDER_ENTRY_FILE, runtime = BUILDER_RUNTIME } = {}) {
  const issues = []
  if (runtime !== BUILDER_RUNTIME) {
    return { valid: false, issues: [issue('UNSUPPORTED_RUNTIME', 'This legacy runtime cannot be safely previewed by Builder 2.0.')], files: [] }
  }
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    return { valid: false, issues: [issue('FILES_REQUIRED', 'At least one project file is required.')], files: [] }
  }
  if (inputFiles.length > BUILDER_MAX_FILE_COUNT) issues.push(issue('TOO_MANY_FILES', `Projects are limited to ${BUILDER_MAX_FILE_COUNT} files.`))
  const paths = new Set()
  let totalBytes = 0
  const files = []

  for (const rawFile of inputFiles) {
    const file = normalizeBuilderFile(rawFile)
    const path = normalizeBuilderPath(file?.path)
    if (!file || !path) {
      issues.push(issue('INVALID_PATH', 'A file path is invalid or outside the supported project format.', file?.path || null))
      continue
    }
    if (paths.has(path)) {
      issues.push(issue('DUPLICATE_PATH', 'Project file paths must be unique.', path))
      continue
    }
    paths.add(path)
    const bytes = new TextEncoder().encode(file.content).length
    totalBytes += bytes
    if (bytes > BUILDER_MAX_FILE_BYTES) issues.push(issue('FILE_TOO_LARGE', 'This file exceeds the supported size limit.', path))
    if (!file.content.trim()) issues.push(issue('EMPTY_FILE', 'Generated files cannot be empty.', path))
    for (const rule of FORBIDDEN_CONTENT) {
      if (rule.expression.test(file.content)) issues.push(issue(rule.code, rule.message, path))
    }
    if (path.endsWith('.js') && /\b(?:import|export)\s/.test(file.content)) {
      issues.push(issue('UNSUPPORTED_MODULE_IMPORT', 'JavaScript modules are not supported by this portable Builder runtime.', path))
    }
    if (path.endsWith('.css') && /@import\b/i.test(file.content)) {
      issues.push(issue('UNSUPPORTED_CSS_IMPORT', 'External CSS imports are not supported.', path))
    }
    if (path.endsWith('.html') && path !== BUILDER_ENTRY_FILE && !/<\s*(?:main|body|section|article)\b/i.test(file.content)) {
      issues.push(issue('MALFORMED_PAGE', 'A generated page needs meaningful HTML content.', path, 'warning'))
    }
    files.push({ ...file, path, language: file.language || inferFileLanguage(path) })
  }
  if (totalBytes > BUILDER_MAX_TOTAL_BYTES) issues.push(issue('PROJECT_TOO_LARGE', 'The generated project exceeds the supported total size limit.'))
  const normalizedEntry = normalizeBuilderPath(entryFile)
  if (normalizedEntry !== BUILDER_ENTRY_FILE || !paths.has(BUILDER_ENTRY_FILE)) {
    issues.push(issue('ENTRY_FILE_REQUIRED', 'A valid index.html entry file is required.', BUILDER_ENTRY_FILE))
  }

  const invalidPaths = new Set(issues.filter((item) => item.path).map((item) => item.path))
  const validatedFiles = files.map((file) => ({
    ...file,
    validation: {
      valid: !invalidPaths.has(file.path),
      issues: issues.filter((item) => item.path === file.path),
    },
  }))
  return {
    valid: !issues.some((item) => item.severity === 'error'),
    issues,
    files: validatedFiles,
    totalBytes,
  }
}

export function validateBuilderManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, issues: [issue('INVALID_MANIFEST', 'The generation manifest was not valid JSON.')] }
  }
  const files = Array.isArray(manifest.files) ? manifest.files : []
  if (!files.length) return { valid: false, issues: [issue('MANIFEST_FILES_REQUIRED', 'The generation manifest did not include files.')] }
  const seen = new Set()
  const issues = []
  for (const file of files) {
    const path = normalizeBuilderPath(file?.path)
    if (!path) issues.push(issue('INVALID_MANIFEST_PATH', 'The manifest includes an unsupported file path.', file?.path || null))
    else if (seen.has(path)) issues.push(issue('DUPLICATE_MANIFEST_PATH', 'The manifest includes the same file more than once.', path))
    else seen.add(path)
  }
  if (!seen.has(BUILDER_ENTRY_FILE)) issues.push(issue('ENTRY_FILE_REQUIRED', 'The manifest must include index.html.', BUILDER_ENTRY_FILE))
  if (files.length > BUILDER_MAX_FILE_COUNT) issues.push(issue('TOO_MANY_FILES', `The manifest exceeds ${BUILDER_MAX_FILE_COUNT} files.`))
  return { valid: !issues.length, issues }
}

export function validateBuilderPatch(patch, files) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { valid: false, issues: [issue('INVALID_PATCH', 'The edit response was not valid JSON.')] }
  const changes = Array.isArray(patch.changes) ? patch.changes : []
  if (!changes.length) return { valid: false, issues: [issue('PATCH_REQUIRED', 'The edit response did not include any changes.')] }
  const existing = new Set((files || []).map((file) => file.path))
  const issues = []
  const paths = new Set()
  for (const change of changes) {
    const path = normalizeBuilderPath(change?.path)
    if (!path || !existing.has(path)) issues.push(issue('PATCH_PATH_INVALID', 'The edit attempted to modify a file outside this project.', change?.path || null))
    else if (paths.has(path)) issues.push(issue('PATCH_DUPLICATE_PATH', 'Each file can only be changed once per edit.', path))
    else paths.add(path)
    if (typeof change?.content !== 'string' || !change.content.trim()) issues.push(issue('PATCH_CONTENT_REQUIRED', 'Each edit needs complete replacement content.', path || null))
  }
  return { valid: !issues.length, issues }
}
