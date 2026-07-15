import { requestAIResult } from '../../services/aiProviderService.js'
import { createBuilderProject, normalizeBuilderFile } from './builderProjectSchema.js'
import { buildBuilderFilesPrompt, buildBuilderManifestPrompt, buildBuilderPatchPrompt, buildBuilderPlanPrompt, BuilderFormatError, parseStrictBuilderJson } from './builderPrompts.js'
import { BUILDER_MAX_GENERATION_FILE_COUNT, validateBuilderFiles, validateBuilderManifest, validateBuilderPatch } from './builderValidation.js'
import { appendBuilderVersion } from './builderVersions.js'

export class BuilderGenerationError extends Error {
  constructor(code, message, { retryable = true, cause = null } = {}) {
    super(message)
    this.name = 'BuilderGenerationError'
    this.code = code
    this.retryable = retryable
    this.cause = cause
  }
}

function toGenerationError(error) {
  if (error instanceof BuilderGenerationError || error instanceof BuilderFormatError) return error
  return new BuilderGenerationError('GENERATION_FAILED', error?.message || 'FounderLab could not generate this project.', { cause: error })
}

function requireResult(result, label) {
  if (!result?.ok) {
    throw new BuilderGenerationError(result?.error?.code || 'PROVIDER_FAILURE', result?.error?.message || `${label} failed.`, { retryable: result?.error?.retryable !== false })
  }
  return result
}

function event(stage, message, details = null, result = null) {
  return { id: `builder-event-${Date.now()}-${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(), stage, message, details, provider: result?.provider || null, model: result?.model || null }
}

const GENERATION_MANIFEST_OPTIONS = Object.freeze({ maxFiles: BUILDER_MAX_GENERATION_FILE_COUNT })
const NON_RETRYABLE_REMOTE_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_INVALID',
  'AUTHENTICATION_UNAVAILABLE',
  'CANCELLED',
  'INVALID_MODEL',
  'MISSING_CONFIGURATION',
  'PROVIDER_RATE_LIMITED',
  'RATE_LIMITED',
  'RATE_LIMIT_BACKEND_UNAVAILABLE',
])

function shouldRetryGeneration(error) {
  return error?.retryable !== false && !NON_RETRYABLE_REMOTE_CODES.has(error?.code)
}

export function createBuilderGenerationService({ request = requestAIResult } = {}) {
  async function requestJson({ prompt, maxTokens, signal, label }) {
    if (signal?.aborted) throw new BuilderGenerationError('CANCELLED', 'Generation was cancelled.', { retryable: false })
    const result = requireResult(await request({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are FounderLab Builder. Follow the JSON response contract exactly.',
      maxTokens,
      responseFormat: { type: 'json_object' },
    }, { signal }), label)
    if (signal?.aborted) throw new BuilderGenerationError('CANCELLED', 'Generation was cancelled.', { retryable: false })
    try {
      return { value: parseStrictBuilderJson(result.text, label), result }
    } catch (error) {
      if (error instanceof BuilderFormatError) {
        throw new BuilderGenerationError(error.code, error.message, { retryable: true, cause: error })
      }
      throw error
    }
  }

  async function generateFiles({ brief, plan, manifest, files = [], targetPaths, signal, onActivity, repairInstructions = '' }) {
    const manifestCheck = validateBuilderManifest(manifest, GENERATION_MANIFEST_OPTIONS)
    if (!manifestCheck.valid) throw new BuilderGenerationError('INVALID_MANIFEST', manifestCheck.issues[0].message)
    const wanted = targetPaths
      ? manifest.files.filter((file) => targetPaths.includes(file.path))
      : manifest.files
    if (!wanted.length) return { files, addedPaths: [], provider: null, model: null }

    const existing = new Map(files.map((file) => [file.path, file]))
    const missing = wanted.filter((file) => !existing.has(file.path))
    if (!missing.length) return { files, addedPaths: [], provider: null, model: null }

    const generationManifest = { ...manifest, files: missing }
    let lastFailure = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        onActivity?.(event('generating', attempt ? 'Retrying the project files' : `Generating ${missing.length} project files`, { paths: missing.map((file) => file.path) }))
        const response = await requestJson({
          prompt: buildBuilderFilesPrompt({
            brief,
            plan,
            manifest: generationManifest,
            repairInstructions: [
              repairInstructions,
              attempt ? 'The prior response was incomplete. Return every requested file as valid JSON.' : '',
            ].filter(Boolean).join(' '),
          }),
          maxTokens: 7200,
          signal,
          label: 'project files',
        })
        const generatedRecords = Array.isArray(response.value.files) ? response.value.files : []
        const expected = new Map(missing.map((file) => [file.path, file]))
        const generatedPaths = new Set()
        const generatedFiles = []
        for (const record of generatedRecords) {
          const manifestFile = expected.get(record?.path)
          if (!manifestFile || generatedPaths.has(record.path) || typeof record.content !== 'string' || !record.content.trim()) {
            throw new BuilderGenerationError('FILE_BATCH_INVALID', 'FounderLab received an invalid project-file response.')
          }
          generatedPaths.add(record.path)
          generatedFiles.push(normalizeBuilderFile({
            path: manifestFile.path,
            content: record.content,
            role: manifestFile.role,
            state: 'generated',
          }))
        }
        const omittedPaths = missing.filter((file) => !generatedPaths.has(file.path)).map((file) => file.path)
        if (omittedPaths.length) {
          throw new BuilderGenerationError('FILE_BATCH_INCOMPLETE', `FounderLab received an incomplete response for ${omittedPaths.join(', ')}.`)
        }
        for (const file of generatedFiles) existing.set(file.path, file)
        return {
          files: [...existing.values()],
          addedPaths: missing.map((file) => file.path),
          provider: response.result.provider,
          model: response.result.model,
        }
      } catch (error) {
        lastFailure = toGenerationError(error)
        if (!shouldRetryGeneration(lastFailure)) break
      }
    }
    throw lastFailure || new BuilderGenerationError('GENERATION_INCOMPLETE', 'FounderLab could not generate the project files.')
  }

  return {
    async plan({ brief, signal }) {
      const response = await requestJson({ prompt: buildBuilderPlanPrompt(brief), maxTokens: 1400, signal, label: 'project plan' })
      if (!Array.isArray(response.value.pages) || !response.value.summary) {
        throw new BuilderGenerationError('INVALID_PLAN', 'The AI plan was incomplete. Please retry generation.')
      }
      return { plan: response.value, provider: response.result.provider, model: response.result.model }
    },

    async continueMissingFiles({ brief, plan, manifest, files = [], signal, onActivity, repairInstructions = '' }) {
      return generateFiles({ brief, plan, manifest, files, signal, onActivity, repairInstructions })
    },

    async generate({ brief, plan, ownerId, signal, onActivity }) {
      const activity = []
      const publish = (stage, message, details, result) => {
        const entry = event(stage, message, details, result)
        activity.push(entry)
        onActivity?.(entry)
      }
      try {
        publish('understanding', 'Understanding your request')
        const approvedPlan = plan || (await this.plan({ brief, signal })).plan
        publish('planning', 'Project plan ready')
        const manifestResponse = await requestJson({
          prompt: buildBuilderManifestPrompt({ brief, plan: approvedPlan }), maxTokens: 1300, signal, label: 'file manifest',
        })
        const manifestCheck = validateBuilderManifest(manifestResponse.value, GENERATION_MANIFEST_OPTIONS)
        if (!manifestCheck.valid) throw new BuilderGenerationError('INVALID_MANIFEST', manifestCheck.issues[0].message, { retryable: true })
        publish('manifest', `Planning ${manifestResponse.value.files.length} files`, null, manifestResponse.result)
        const continued = await this.continueMissingFiles({
          brief,
          plan: approvedPlan,
          manifest: manifestResponse.value,
          files: [],
          signal,
          onActivity: (item) => publish(item.stage, item.message, item.details),
        })
        let files = continued.files
        publish('validating', 'Validating project structure')
        let validation = validateBuilderFiles(files, { entryFile: manifestResponse.value.entryFile })
        const repairPaths = [...new Set(validation.issues.filter((item) => item.severity === 'error' && item.path && files.some((file) => file.path === item.path)).map((item) => item.path))].slice(0, 2)
        if (!validation.valid && repairPaths.length) {
          publish('repairing', 'Repairing recoverable generated files', { paths: repairPaths })
          const repairs = await generateFiles({
            brief,
            plan: approvedPlan,
            manifest: manifestResponse.value,
            files: files.filter((file) => !repairPaths.includes(file.path)),
            targetPaths: repairPaths,
            signal,
            repairInstructions: validation.issues.filter((item) => repairPaths.includes(item.path)).map((item) => `${item.path}: ${item.message}`).join(' '),
            onActivity: (item) => publish('repairing', item.message, item.details),
          })
          files = repairs.files
          validation = validateBuilderFiles(files, { entryFile: manifestResponse.value.entryFile })
        }
        if (!validation.valid) throw new BuilderGenerationError('VALIDATION_FAILED', validation.issues[0].message, { retryable: true })
        const now = new Date().toISOString()
        let project = createBuilderProject({ ownerId, prompt: brief, name: approvedPlan.name, plan: approvedPlan, now })
        project = {
          ...project,
          status: 'ready',
          files: validation.files,
          entryFile: manifestResponse.value.entryFile,
          validation: { valid: true, issues: validation.issues, checkedAt: now },
          preview: { status: 'building', lastSuccessfulVersionId: null, lastSuccessfulAt: null, lastError: null },
          generationHistory: activity,
        }
        project = appendBuilderVersion(project, {
          files: validation.files,
          origin: 'generation',
          summary: 'Initial generated project',
          provider: manifestResponse.result.provider,
          model: manifestResponse.result.model,
          validation: project.validation,
          changedPaths: validation.files.map((file) => file.path),
          now,
        })
        publish('building-preview', 'Building the isolated preview', null, manifestResponse.result)
        project.generationHistory = activity
        return project
      } catch (error) {
        throw toGenerationError(error)
      }
    },

    async applyEdit({ project, request: changeRequest, selectedPath, signal, onActivity }) {
      try {
        onActivity?.(event('editing', 'Preparing a scoped change'))
        const response = await requestJson({
          prompt: buildBuilderPatchPrompt({ request: changeRequest, project, selectedPath }),
          maxTokens: 6000,
          signal,
          label: 'project edit',
        })
        const patchCheck = validateBuilderPatch(response.value, project.files)
        if (!patchCheck.valid) throw new BuilderGenerationError('INVALID_PATCH', patchCheck.issues[0].message)
        const changed = new Map(response.value.changes.map((change) => [change.path, change.content]))
        const files = project.files.map((file) => changed.has(file.path)
          ? { ...file, content: changed.get(file.path).replace(/\r\n?/g, '\n'), state: 'edited', updatedAt: new Date().toISOString() }
          : file)
        const validation = validateBuilderFiles(files, { entryFile: project.entryFile })
        if (!validation.valid) throw new BuilderGenerationError('EDIT_VALIDATION_FAILED', validation.issues[0].message)
        const now = new Date().toISOString()
        const updated = appendBuilderVersion({
          ...project,
          files: validation.files,
          status: 'ready',
          validation: { valid: true, issues: validation.issues, checkedAt: now },
          preview: { ...project.preview, status: 'building', lastError: null },
          changeHistory: [...(project.changeHistory || []), event('edit', response.value.summary || 'Applied scoped change', { paths: [...changed.keys()] }, response.result)].slice(-30),
        }, {
          files: validation.files,
          origin: 'ai-edit',
          summary: response.value.summary || 'Applied scoped change',
          provider: response.result.provider,
          model: response.result.model,
          validation: { valid: true, issues: validation.issues, checkedAt: now },
          changedPaths: [...changed.keys()],
          now,
        })
        onActivity?.(event('building-preview', 'Change validated; rebuilding the isolated preview', null, response.result))
        return updated
      } catch (error) {
        throw toGenerationError(error)
      }
    },
  }
}

export const builderGenerationService = createBuilderGenerationService()
