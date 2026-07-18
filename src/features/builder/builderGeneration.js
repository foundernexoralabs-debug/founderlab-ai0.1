import { requestCodeGenerationAI } from '../../services/aiProviderService.js'
import { createBuilderProject, normalizeBuilderFile } from './builderProjectSchema.js'
import { buildBuilderFilePrompt, buildBuilderFilesPrompt, buildBuilderManifestPrompt, buildBuilderPatchPrompt, buildBuilderPlanPrompt, BuilderFormatError, canUseLandingPageManifest, createLandingPageManifest, normalizeBuilderPlan, parseStrictBuilderJson, recoverBuilderFileJson } from './builderPrompts.js'
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

// The generation prompt explicitly tells the model: "Do not include script
// or link tags in HTML; styles.css and app.js are injected by the isolated
// runtime." Small local coding models frequently ignore this — pairing a
// page with a <link rel="stylesheet" href="styles.css"> and a
// <script src="app.js"></script> is such a deeply ingrained HTML authoring
// pattern that a single prompt line often isn't enough to override it,
// where a larger cloud model follows the instruction reliably. These exact
// self-references are completely safe: they only ever point at the
// project's own styles.css/app.js, which the isolated preview harness
// already injects itself regardless — they are never the arbitrary inline
// or externally-sourced runtime tag validateBuilderFiles' INLINE_RUNTIME_TAG
// rule exists to catch. Normalizing them away here, at generation time,
// fixes real local-model output without touching that safety rule at all:
// an actually-unsafe inline <script>…</script> or a <link> to any other
// path/URL is left completely alone and still correctly fails validation.
const SELF_REFERENCING_STYLESHEET_LINK = /<link\b[^>]*\bhref\s*=\s*(['"])\.?\/?styles\.css\1[^>]*>/gi
const SELF_REFERENCING_SCRIPT_TAG = /<script\b[^>]*\bsrc\s*=\s*(['"])\.?\/?app\.js\1[^>]*>\s*<\/script>/gi

function stripHarnessInjectedReferences(path, content) {
  if (typeof content !== 'string' || !path?.endsWith('.html')) return content
  return content
    .replace(SELF_REFERENCING_STYLESHEET_LINK, '')
    .replace(SELF_REFERENCING_SCRIPT_TAG, '')
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
export const BUILDER_FILE_GENERATION_MAX_TOKENS = 5200
export const BUILDER_GEMINI_FILE_MAX_TOKENS = 3400
export const BUILDER_GEMINI_FILE_RETRY_MAX_TOKENS = 4800
// Local coding models have considerably less reliable structured-output
// headroom than the cloud providers. Generate each small project file in its
// own bounded turn rather than asking one local response to contain the
// entire website.
export const BUILDER_LOCAL_FILE_MAX_TOKENS = 2400
export const BUILDER_LOCAL_FILE_RETRY_MAX_TOKENS = 3000
const NON_RETRYABLE_REMOTE_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_INVALID',
  'AUTHENTICATION_UNAVAILABLE',
  'CANCELLED',
  'INVALID_MODEL',
  'MISSING_CONFIGURATION',
  'GENERATION_OUTPUT_TRUNCATED',
  'GEMINI_OUTPUT_TRUNCATED',
  'GEMINI_STRUCTURED_OUTPUT_INVALID',
  'PROVIDER_REQUEST_TOO_LARGE',
  'PROVIDER_RATE_LIMITED',
  'RATE_LIMITED',
  'RATE_LIMIT_BACKEND_UNAVAILABLE',
  'OLLAMA_CODE_MODEL_REQUIRED',
  'OLLAMA_MODEL_REQUIRED',
  'OLLAMA_MODEL_UNAVAILABLE',
  'OLLAMA_UNAVAILABLE',
  'OLLAMA_BROWSER_UNSUPPORTED',
  'OLLAMA_BROWSER_ACCESS_DENIED',
  'OLLAMA_BROWSER_ACCESS_BLOCKED',
  'OLLAMA_TIMEOUT',
])

function shouldRetryGeneration(error) {
  return error?.retryable !== false && !NON_RETRYABLE_REMOTE_CODES.has(error?.code)
}

function isTruncatedStructuredResult(result) {
  const finishReason = String(result?.meta?.finishReason || '').toUpperCase()
  return ['MAX_TOKENS', 'MAX_OUTPUT_TOKENS', 'LENGTH'].includes(finishReason)
}

function structuredFailure(error, { provider, label } = {}) {
  if (error instanceof BuilderFormatError && provider === 'gemini') {
    return new BuilderGenerationError(
      'GEMINI_STRUCTURED_OUTPUT_INVALID',
      `Gemini did not return a complete structured ${label}.`,
      { retryable: false, cause: error }
    )
  }
  if (error instanceof BuilderFormatError && provider === 'ollama') {
    return new BuilderGenerationError(
      'OLLAMA_STRUCTURED_OUTPUT_INVALID',
      `The selected local coding model did not return a complete structured ${label}.`,
      { retryable: true, cause: error }
    )
  }
  return error instanceof BuilderFormatError
    ? new BuilderGenerationError(error.code, error.message, { retryable: true, cause: error })
    : toGenerationError(error)
}

export function createBuilderGenerationService({ request = requestCodeGenerationAI } = {}) {
  async function requestJson({ prompt, maxTokens, signal, label, provider, model, retries = 1, onRetry, recover }) {
    let lastFailure = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let result
      try {
        if (signal?.aborted) throw new BuilderGenerationError('CANCELLED', 'Generation was cancelled.', { retryable: false })
        result = requireResult(await request({
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          messages: [{ role: 'user', content: prompt }],
          system: 'You are FounderLab Builder. Follow the JSON response contract exactly.',
          maxTokens,
          responseFormat: { type: 'json_object' },
        }, { signal }), label)
        if (signal?.aborted) throw new BuilderGenerationError('CANCELLED', 'Generation was cancelled.', { retryable: false })
        if (isTruncatedStructuredResult(result)) {
          throw new BuilderGenerationError(
            provider === 'gemini' ? 'GEMINI_OUTPUT_TRUNCATED' : 'GENERATION_OUTPUT_TRUNCATED',
            `${provider === 'gemini' ? 'Gemini' : 'The provider'} reached its output limit before completing the ${label}.`,
            { retryable: false }
          )
        }
        return { value: parseStrictBuilderJson(result.text, label), result }
      } catch (error) {
        // Small local coding models occasionally produce almost-valid JSON
        // for the single-file shape (raw unescaped characters in a long
        // HTML/CSS string, or an unterminated string when they run out of
        // budget). Recover the file directly from the raw text instead of
        // discarding a response that already contains the real content.
        if (error instanceof BuilderFormatError && typeof recover === 'function' && result?.text) {
          const recovered = recover(result.text)
          if (recovered) return { value: recovered, result }
        }
        const failure = structuredFailure(error, { provider, label })
        lastFailure = failure
        if (attempt >= retries || !shouldRetryGeneration(failure)) break
        onRetry?.(failure, attempt + 1)
      }
    }
    throw lastFailure || new BuilderGenerationError('GENERATION_FAILED', `FounderLab could not complete the ${label}.`)
  }

  async function generateFiles({ brief, plan, manifest, files = [], targetPaths, provider, model, signal, onActivity, repairInstructions = '' }) {
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
    if (provider === 'gemini' || provider === 'ollama') {
      for (const file of missing) {
        const isLocalCodeGeneration = provider === 'ollama'
        const initialMaxTokens = isLocalCodeGeneration ? BUILDER_LOCAL_FILE_MAX_TOKENS : BUILDER_GEMINI_FILE_MAX_TOKENS
        const retryMaxTokens = isLocalCodeGeneration ? BUILDER_LOCAL_FILE_RETRY_MAX_TOKENS : BUILDER_GEMINI_FILE_RETRY_MAX_TOKENS
        const requestFile = async (maxTokens) => requestJson({
          prompt: buildBuilderFilePrompt({ brief, plan, file, manifest: generationManifest, repairInstructions }),
          maxTokens,
          signal,
          label: `project file ${file.path}`,
          provider,
          model,
          // One small format retry is useful for local coding models without
          // ever creating a hidden generation loop. Gemini retains its
          // provider-specific truncation retry below.
          retries: isLocalCodeGeneration ? 1 : 0,
          recover: isLocalCodeGeneration ? (text) => recoverBuilderFileJson(text, file.path) : undefined,
        })
        let response
        try {
          onActivity?.(event('generating', `Generating ${file.path}`, { path: file.path }))
          response = await requestFile(initialMaxTokens)
        } catch (error) {
          const truncated = error?.code === 'GEMINI_OUTPUT_TRUNCATED' || error?.code === 'GENERATION_OUTPUT_TRUNCATED'
          if (!truncated) throw error
          onActivity?.(event('retrying', `Giving ${isLocalCodeGeneration ? 'your local coding model' : 'Gemini'} more room for ${file.path}`, { path: file.path }))
          response = await requestFile(retryMaxTokens)
        }
        const record = response.value
        // The file's path is already authoritatively known from the manifest
        // (it's what gets stored below, regardless of what the model echoes
        // back) — so for local models, which are considerably less reliable
        // at exactly repeating a JSON key's value verbatim, don't reject an
        // otherwise-valid file purely because the echoed path didn't match.
        const pathValid = isLocalCodeGeneration ? true : record?.path === file.path
        const contentValid = typeof record?.content === 'string' && record.content.trim().length > 0
        if (!pathValid || !contentValid) {
          throw new BuilderGenerationError(
            isLocalCodeGeneration ? 'OLLAMA_STRUCTURED_OUTPUT_INVALID' : 'GEMINI_STRUCTURED_OUTPUT_INVALID',
            `${isLocalCodeGeneration ? 'The selected local coding model' : 'Gemini'} returned an invalid structured file for ${file.path}.`,
            { retryable: !isLocalCodeGeneration }
          )
        }
        existing.set(file.path, normalizeBuilderFile({
          path: file.path,
          content: stripHarnessInjectedReferences(file.path, record.content),
          role: file.role,
          state: 'generated',
        }))
      }
      return {
        files: [...existing.values()],
        addedPaths: missing.map((file) => file.path),
        provider,
        model,
      }
    }
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
          maxTokens: BUILDER_FILE_GENERATION_MAX_TOKENS,
          signal,
          label: 'project files',
          provider,
          model,
          retries: 0,
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
            content: stripHarnessInjectedReferences(manifestFile.path, record.content),
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
    async plan({ brief, provider, model, signal }) {
      const response = await requestJson({ prompt: buildBuilderPlanPrompt(brief), maxTokens: 1400, signal, label: 'project plan', provider, model })
      const plan = normalizeBuilderPlan(response.value)
      if (!plan.pages.length || !plan.summary) {
        throw new BuilderGenerationError('INVALID_PLAN', 'The AI plan was incomplete. Please retry generation.')
      }
      return { plan, provider: response.result.provider, model: response.result.model }
    },

    async continueMissingFiles({ brief, plan, manifest, files = [], provider, model, signal, onActivity, repairInstructions = '' }) {
      return generateFiles({ brief, plan, manifest, files, provider, model, signal, onActivity, repairInstructions })
    },

    async generate({ brief, plan, provider, model, ownerId, signal, onActivity }) {
      const activity = []
      const publish = (stage, message, details, result) => {
        const entry = event(stage, message, details, result)
        activity.push(entry)
        onActivity?.(entry)
      }
      try {
        publish('understanding', 'Understanding your request')
        let generationProvider = provider || plan?.provider || null
        let generationModel = model || plan?.model || null
        let approvedPlan
        if (plan) {
          approvedPlan = normalizeBuilderPlan(plan)
        } else {
          const planned = await this.plan({ brief, provider: generationProvider, model: generationModel, signal })
          approvedPlan = planned.plan
          generationProvider = planned.provider
          generationModel = planned.model
        }
        if (!approvedPlan.pages.length || !approvedPlan.summary) {
          throw new BuilderGenerationError('INVALID_PLAN', 'The AI plan was incomplete. Please retry generation.')
        }
        publish('planning', 'Project plan ready')
        const manifestResponse = canUseLandingPageManifest(approvedPlan)
          ? { value: createLandingPageManifest(), result: { provider: generationProvider, model: generationModel } }
          : await requestJson({
            prompt: buildBuilderManifestPrompt({ brief, plan: approvedPlan }), maxTokens: 1300, signal, label: 'file manifest',
            provider: generationProvider,
            model: generationModel,
            onRetry: () => publish('retrying', 'Retrying the safe project structure'),
          })
        const manifestCheck = validateBuilderManifest(manifestResponse.value, GENERATION_MANIFEST_OPTIONS)
        if (!manifestCheck.valid) throw new BuilderGenerationError('INVALID_MANIFEST', manifestCheck.issues[0].message, { retryable: true })
        const resolvedProvider = manifestResponse.result.provider || generationProvider
        const resolvedModel = manifestResponse.result.model || generationModel
        publish('manifest', canUseLandingPageManifest(approvedPlan) ? 'Prepared a reliable three-file landing-page structure' : `Planning ${manifestResponse.value.files.length} files`, null, manifestResponse.result)
        const continued = await this.continueMissingFiles({
          brief,
          plan: approvedPlan,
          manifest: manifestResponse.value,
          files: [],
          provider: resolvedProvider,
          model: resolvedModel,
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
            provider: resolvedProvider,
            model: resolvedModel,
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
          provider: continued.provider || resolvedProvider,
          model: continued.model || resolvedModel,
          validation: project.validation,
          changedPaths: validation.files.map((file) => file.path),
          now,
        })
        publish('building-preview', 'Building the isolated preview', null, { provider: continued.provider || resolvedProvider, model: continued.model || resolvedModel })
        project.generationHistory = activity
        return project
      } catch (error) {
        throw toGenerationError(error)
      }
    },

    async applyEdit({ project, request: changeRequest, selectedPath, signal, onActivity }) {
      try {
        onActivity?.(event('editing', 'Preparing a scoped change'))
        const currentVersion = (project.versions || []).find((version) => version.id === project.currentVersionId)
        const response = await requestJson({
          prompt: buildBuilderPatchPrompt({ request: changeRequest, project, selectedPath }),
          maxTokens: 6000,
          signal,
          label: 'project edit',
          provider: currentVersion?.provider || undefined,
          model: currentVersion?.model || undefined,
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
