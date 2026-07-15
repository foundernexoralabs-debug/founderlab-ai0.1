import { requestAIResult } from '../../services/aiProviderService.js'
import { createBuilderProject, normalizeBuilderFile } from './builderProjectSchema.js'
import { buildBuilderFilePrompt, buildBuilderManifestPrompt, buildBuilderPatchPrompt, buildBuilderPlanPrompt, BuilderFormatError, parseStrictBuilderJson } from './builderPrompts.js'
import { validateBuilderFiles, validateBuilderManifest, validateBuilderPatch } from './builderValidation.js'
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

export function createBuilderGenerationService({ request = requestAIResult } = {}) {
  async function requestJson({ prompt, maxTokens, signal, label }) {
    if (signal?.aborted) throw new BuilderGenerationError('CANCELLED', 'Generation was cancelled.', { retryable: false })
    const result = requireResult(await request({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are FounderLab Builder. Follow the JSON response contract exactly.',
      maxTokens,
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

  return {
    async plan({ brief, signal }) {
      const response = await requestJson({ prompt: buildBuilderPlanPrompt(brief), maxTokens: 1400, signal, label: 'project plan' })
      if (!Array.isArray(response.value.pages) || !response.value.summary) {
        throw new BuilderGenerationError('INVALID_PLAN', 'The AI plan was incomplete. Please retry generation.')
      }
      return { plan: response.value, provider: response.result.provider, model: response.result.model }
    },

    async continueMissingFiles({ brief, plan, manifest, files = [], signal, onActivity, repairInstructions = '' }) {
      const manifestCheck = validateBuilderManifest(manifest)
      if (!manifestCheck.valid) throw new BuilderGenerationError('INVALID_MANIFEST', manifestCheck.issues[0].message)
      const existing = new Map(files.map((file) => [file.path, file]))
      const missing = manifest.files.filter((file) => !existing.has(file.path))
      if (!missing.length) return { files, addedPaths: [], provider: null, model: null }
      let lastResult = null
      for (const manifestFile of missing) {
        onActivity?.(event('continuing', `Generating missing ${manifestFile.path}`, { path: manifestFile.path }))
        let generated = null
        let lastFailure = null
        for (let attempt = 0; attempt < 2 && !generated; attempt += 1) {
          try {
            const response = await requestJson({
              prompt: buildBuilderFilePrompt({
                brief,
                plan,
                file: manifestFile,
                manifest,
                repairInstructions: [repairInstructions, attempt ? 'The prior response was incomplete. Return the complete requested file as valid JSON.' : ''].filter(Boolean).join(' '),
              }),
              maxTokens: Math.min(6000, manifestFile.path === 'styles.css' ? 4200 : 5000),
              signal,
              label: `${manifestFile.path} continuation`,
            })
            if (response.value.path !== manifestFile.path || typeof response.value.content !== 'string') {
              throw new BuilderGenerationError('FILE_RESPONSE_INVALID', `FounderLab received an invalid response for ${manifestFile.path}.`)
            }
            generated = normalizeBuilderFile({ ...response.value, path: manifestFile.path, role: manifestFile.role, state: 'generated' })
            lastResult = response.result
          } catch (error) { lastFailure = toGenerationError(error) }
        }
        if (!generated) throw lastFailure || new BuilderGenerationError('GENERATION_INCOMPLETE', `FounderLab could not generate ${manifestFile.path}.`)
        existing.set(generated.path, generated)
      }
      return { files: [...existing.values()], addedPaths: missing.map((file) => file.path), provider: lastResult?.provider || null, model: lastResult?.model || null }
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
        const manifestCheck = validateBuilderManifest(manifestResponse.value)
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
          const repairs = await this.continueMissingFiles({
            brief,
            plan: approvedPlan,
            manifest: manifestResponse.value,
            files: files.filter((file) => !repairPaths.includes(file.path)),
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
          preview: { status: 'ready', lastSuccessfulVersionId: null, lastSuccessfulAt: now, lastError: null },
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
        project.preview.lastSuccessfulVersionId = project.currentVersionId
        publish('ready', 'Project is ready', null, manifestResponse.result)
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
          preview: { ...project.preview, status: 'ready', lastError: null },
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
        updated.preview.lastSuccessfulVersionId = updated.currentVersionId
        updated.preview.lastSuccessfulAt = now
        onActivity?.(event('ready', 'Change validated and ready', null, response.result))
        return updated
      } catch (error) {
        throw toGenerationError(error)
      }
    },
  }
}

export const builderGenerationService = createBuilderGenerationService()
