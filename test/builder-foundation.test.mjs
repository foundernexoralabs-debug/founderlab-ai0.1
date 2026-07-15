import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BUILDER_FILE_GENERATION_MAX_TOKENS, createBuilderGenerationService, BuilderGenerationError } from '../src/features/builder/builderGeneration.js'
import { buildBuilderFileTree, createBuilderFile, renameBuilderFile } from '../src/features/builder/builderFileOperations.js'
import { createBuilderProject, normalizeBuilderProject } from '../src/features/builder/builderProjectSchema.js'
import { createBuilderProjectRepository } from '../src/features/builder/builderProjectRepository.js'
import { BUILDER_PROMPT_LIMITS, buildBuilderFilesPrompt, buildBuilderPatchPrompt, buildBuilderPlanPrompt, normalizeBuilderPlan } from '../src/features/builder/builderPrompts.js'
import { buildBuilderPreviewDocument, BUILDER_PREVIEW_CSP, BUILDER_PREVIEW_SANDBOX, getLastWorkingPreviewFiles, inlineLocalSvgReferences } from '../src/features/builder/builderPreview.js'
import { BUILDER_MAX_GENERATION_FILE_COUNT, validateBuilderFiles, validateBuilderManifest } from '../src/features/builder/builderValidation.js'
import { appendBuilderVersion, getPreviousBuilderVersion, restoreBuilderVersion } from '../src/features/builder/builderVersions.js'
import { routeAIRequest } from '../src/ai/providerRouter.js'

const NOW = '2026-07-15T12:00:00.000Z'
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const validFiles = [
  { path: 'index.html', content: '<main><h1>FounderLab</h1><a href="pages/about.html">About</a></main>' },
  { path: 'styles.css', content: 'body { margin: 0; }' },
  { path: 'app.js', content: 'document.body.dataset.ready = "true"' },
  { path: 'pages/about.html', content: '<main><h1>About</h1></main>' },
]

test('Builder project schema supplies safe defaults and migrates a legacy Builder record without touching unrelated project types', () => {
  const project = createBuilderProject({ ownerId: 'user-1', prompt: 'Build a founder site', now: NOW })
  assert.equal(project.schemaVersion, 2)
  assert.equal(project.ownerId, 'user-1')
  assert.equal(project.entryFile, 'index.html')
  assert.deepEqual(project.files, [])

  const migrated = normalizeBuilderProject({ id: 'legacy-1', type: 'builder', desc: 'Old project', files: validFiles }, { ownerId: 'user-1', now: NOW })
  assert.equal(migrated.migrated, true)
  assert.equal(migrated.project.status, 'legacy')
  assert.equal(migrated.project.files.length, validFiles.length)
  assert.equal(normalizeBuilderProject({ id: 'code-1', type: 'code', files: [] }, { ownerId: 'user-1', now: NOW }).project, null)
})

test('the active Builder route uses the extracted workspace and does not expose old deployment controls', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'src/App.jsx'), 'utf8')
  const workspaceSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/builder/BuilderWorkspace.jsx'), 'utf8')
  assert.match(appSource, /import \{ BuilderWorkspace \} from '@\/features\/builder\/BuilderWorkspace'/)
  assert.match(appSource, /case 'builder':\s+return <BuilderWorkspace user=\{user\} \/>/)
  assert.doesNotMatch(workspaceSource, /Push to GitHub|Deploy to Vercel|githubToken|localStorage/)
})

test('Builder validation rejects path traversal, duplicate paths, oversized unsafe runtime features, and missing entry files', () => {
  const traversal = validateBuilderFiles([{ path: '../secrets.html', content: '<main>no</main>' }])
  assert.equal(traversal.valid, false)
  assert.equal(traversal.issues.some((item) => item.code === 'INVALID_PATH'), true)

  const duplicate = validateBuilderFiles([{ path: 'index.html', content: '<main>one</main>' }, { path: 'index.html', content: '<main>two</main>' }])
  assert.equal(duplicate.issues.some((item) => item.code === 'DUPLICATE_PATH'), true)

  const unsafe = validateBuilderFiles([{ path: 'index.html', content: '<script>window.parent.document.body</script>' }])
  assert.equal(unsafe.issues.some((item) => item.code === 'PARENT_ACCESS'), true)
  assert.equal(unsafe.issues.some((item) => item.code === 'EMBEDDED_DOCUMENT') || unsafe.issues.some((item) => item.code === 'PARENT_ACCESS'), true)
  assert.equal(validateBuilderFiles([{ path: 'index.html', content: '<main>Built for parent company teams</main>' }]).valid, true)
  assert.equal(validateBuilderFiles([{ path: 'index.html', content: '<script>document.body.dataset.x = "1"</script>' }]).issues.some((item) => item.code === 'INLINE_RUNTIME_TAG'), true)
  assert.equal(validateBuilderFiles([{ path: 'index.html', content: '<main><a href="pages/missing.html">Missing</a></main>' }]).issues.some((item) => item.code === 'MISSING_LOCAL_REFERENCE'), true)

  const manifest = validateBuilderManifest({ files: [{ path: 'styles.css' }] })
  assert.equal(manifest.valid, false)
  assert.equal(manifest.issues.some((item) => item.code === 'ENTRY_FILE_REQUIRED'), true)

  const tooManyFiles = validateBuilderManifest({
    files: [
      { path: 'index.html' },
      { path: 'styles.css' },
      { path: 'app.js' },
      { path: 'pages/about.html' },
      { path: 'pages/pricing.html' },
      { path: 'pages/contact.html' },
    ],
  }, { maxFiles: BUILDER_MAX_GENERATION_FILE_COUNT })
  assert.equal(tooManyFiles.valid, false)
  assert.equal(tooManyFiles.issues.some((item) => item.code === 'TOO_MANY_FILES'), true)
})

test('scoped Builder edits include only the selected file content so valid large projects stay within request bounds', () => {
  const prompt = buildBuilderPatchPrompt({
    request: 'Improve the heading',
    selectedPath: 'index.html',
    project: { files: [{ path: 'index.html', content: '<main>Selected</main>' }, { path: 'styles.css', content: 'x'.repeat(64000) }] },
  })
  assert.match(prompt, /Selected/)
  assert.doesNotMatch(prompt, /x{100}/)
  assert.ok(prompt.length < 10000)
})

test('Builder prompts set a concrete premium landing-page quality bar without expanding the supported runtime', () => {
  const planPrompt = buildBuilderPlanPrompt('Create a simple AI-powered meeting notes website')
  const filesPrompt = buildBuilderFilesPrompt({
    brief: 'Create a simple AI-powered meeting notes website',
    plan: { name: 'Minutes', summary: 'AI meeting notes', pages: [{ path: 'index.html' }], brand: {} },
    manifest: { entryFile: 'index.html', files: [{ path: 'index.html' }, { path: 'styles.css' }, { path: 'app.js' }] },
  })
  assert.match(planPrompt, /outcome-led hero/i)
  assert.match(planPrompt, /trust\/reliability/i)
  assert.match(filesPrompt, /complete, visually ordered page/i)
  assert.match(filesPrompt, /Avoid lorem ipsum/i)
  assert.match(filesPrompt, /never use package imports, web fonts, CDNs, external images/i)
  assert.match(filesPrompt, /Build a composition, not a vertical stack/i)
  assert.match(filesPrompt, /note summary, decisions, and action items/i)
})

test('Builder compacts long brief and plan context before a file-generation request', () => {
  const oversized = 'A founder request. '.repeat(4000)
  const plan = normalizeBuilderPlan({
    name: 'N'.repeat(400),
    summary: 'S'.repeat(4000),
    pages: Array.from({ length: 12 }, (_, index) => ({ path: `pages/page-${index}.html`, title: 'T'.repeat(800), purpose: 'P'.repeat(1000) })),
    sections: Array.from({ length: 20 }, () => 'Section '.repeat(200)),
    brand: { visualDirection: 'D'.repeat(1000), colors: Array.from({ length: 16 }, () => '#123456') },
  })
  const prompt = buildBuilderFilesPrompt({
    brief: oversized,
    plan,
    manifest: { entryFile: 'index.html', files: [{ path: 'index.html', role: 'entry' }, { path: 'styles.css', role: 'style' }, { path: 'app.js', role: 'script' }] },
  })
  assert.ok(oversized.length > BUILDER_PROMPT_LIMITS.briefCharacters)
  assert.ok(prompt.length < 40000)
  assert.match(prompt, /FounderLab compacted long context/)
  assert.equal(plan.pages.length, BUILDER_PROMPT_LIMITS.pages)
  assert.ok(plan.summary.length <= BUILDER_PROMPT_LIMITS.summaryCharacters)
})

test('Builder preview uses an opaque minimal sandbox and CSP without external network or generated parent access', () => {
  const preview = buildBuilderPreviewDocument(validFiles)
  assert.equal(preview.ok, true)
  assert.equal(BUILDER_PREVIEW_SANDBOX, 'allow-scripts')
  assert.match(BUILDER_PREVIEW_CSP, /default-src 'none'/)
  assert.match(BUILDER_PREVIEW_CSP, /connect-src 'none'/)
  assert.match(preview.srcDoc, /Content-Security-Policy/)
  assert.match(preview.srcDoc, /window\.addEventListener\('load'/)
  assert.doesNotMatch(preview.srcDoc, /https?:\/\//)
  assert.doesNotMatch(preview.srcDoc, /eval\s*\(/)

  const escapedTitle = buildBuilderPreviewDocument([{ path: 'index.html', content: '<title>One & Two</title><main>Safe</main>' }])
  assert.match(escapedTitle.srcDoc, /<title>One &amp; Two<\/title>/)

  const rejected = buildBuilderPreviewDocument([{ path: 'index.html', content: '<img src="https://example.test/a.png">' }])
  assert.equal(rejected.ok, false)
  assert.equal(rejected.validation.issues.some((item) => item.code === 'EXTERNAL_NETWORK'), true)

  const readableUrl = validateBuilderFiles([{ path: 'index.html', content: '<main><p>See https://example.test in your documentation.</p><svg xmlns="http://www.w3.org/2000/svg"></svg></main>' }])
  assert.equal(readableUrl.valid, true)
  const rejectedNavigation = validateBuilderFiles([{ path: 'index.html', content: '<main><a href="https://example.test">External</a></main>' }])
  assert.equal(rejectedNavigation.valid, false)
  assert.equal(rejectedNavigation.issues.some((item) => item.code === 'EXTERNAL_NETWORK'), true)

  const svgFiles = [
    { path: 'index.html', content: '<main><img src="assets/mark.svg" alt="Mark"></main>' },
    { path: 'assets/mark.svg', content: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' },
  ]
  const svgPreview = buildBuilderPreviewDocument(svgFiles)
  assert.equal(svgPreview.ok, true)
  assert.match(svgPreview.srcDoc, /data:image\/svg\+xml/)
  assert.doesNotMatch(svgPreview.srcDoc, /src="assets\/mark\.svg"/)
  assert.match(inlineLocalSvgReferences('a{background:url(assets/mark.svg)}', svgFiles), /data:image\/svg\+xml/)
})

test('Builder retains a last known good preview without treating a failed current version as ready', () => {
  const project = {
    preview: { status: 'error', lastSuccessfulVersionId: 'version-good' },
    versions: [
      { id: 'version-good', files: validFiles },
      { id: 'version-bad', files: [{ path: 'index.html', content: '<iframe src="nope"></iframe>' }] },
    ],
  }
  assert.deepEqual(getLastWorkingPreviewFiles(project), validFiles)
  assert.equal(getLastWorkingPreviewFiles({ preview: { lastSuccessfulVersionId: 'missing' }, versions: [] }), null)
})

test('Builder workspace makes the rendered website primary while keeping code available on demand', () => {
  const workspaceSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/builder/BuilderWorkspace.jsx'), 'utf8')
  assert.match(workspaceSource, /Website preview/)
  assert.match(workspaceSource, /View code/)
  assert.match(workspaceSource, /gridTemplateColumns: showCode \?/)
  assert.match(workspaceSource, /Showing your last working preview/)
  assert.match(workspaceSource, /aria-label="Website preview canvas"/)
  assert.match(workspaceSource, /Scroll inside preview/)
  assert.match(workspaceSource, /height: '100vh'/)
  assert.match(workspaceSource, /overflow: 'hidden'/)
  assert.doesNotMatch(workspaceSource, /function ProjectList/)
})

test('Builder versions are immutable, bounded by a current pointer, and restore into a recoverable new version', () => {
  const base = { ...createBuilderProject({ ownerId: 'user-1', now: NOW }), files: validFiles, versions: [] }
  const first = appendBuilderVersion(base, { files: validFiles, origin: 'generation', summary: 'Initial', changedPaths: ['index.html'], now: NOW })
  const changed = validFiles.map((file) => file.path === 'index.html' ? { ...file, content: '<main>Changed</main>' } : file)
  const second = appendBuilderVersion(first, { files: changed, origin: 'manual-edit', summary: 'Changed headline', changedPaths: ['index.html'], now: '2026-07-15T13:00:00.000Z' })
  assert.equal(first.files[0].content.includes('Changed'), false)
  assert.equal(second.versions.length, 2)
  const restored = restoreBuilderVersion(second, first.currentVersionId, { now: '2026-07-15T14:00:00.000Z' })
  assert.equal(restored.restored, true)
  assert.equal(restored.project.files[0].content.includes('FounderLab'), true)
  assert.equal(restored.project.versions.at(-1).origin, 'restore')
  assert.equal(getPreviousBuilderVersion(second).id, first.currentVersionId)
})

test('Builder file operations keep paths safe, preserve local references, and expose a navigable folder tree', () => {
  const created = createBuilderFile('pages/contact.html', { now: NOW })
  assert.equal(created.ok, true)
  assert.equal(created.file.path, 'pages/contact.html')
  assert.equal(createBuilderFile('../secrets.html').ok, false)

  const files = [
    { path: 'index.html', content: '<main><a href="pages/about.html">About</a></main>' },
    { path: 'pages/about.html', content: '<main>About</main>' },
    { path: 'assets/data.json', content: '{}' },
  ]
  const renamed = renameBuilderFile(files, 'pages/about.html', 'pages/team.html', { now: NOW })
  assert.equal(renamed.ok, true)
  assert.equal(renamed.files.some((file) => file.path === 'pages/team.html'), true)
  assert.match(renamed.files.find((file) => file.path === 'index.html').content, /pages\/team\.html/)
  assert.equal(renameBuilderFile(files, 'index.html', 'pages/home.html').code, 'ENTRY_FILE_RENAME_BLOCKED')
  const tree = buildBuilderFileTree(renamed.files)
  assert.deepEqual(tree.children.map((node) => node.name), ['assets', 'pages', 'index.html'])
})

test('Builder repository preserves Code AI records and reports an honest remote persistence result', async () => {
  let saved = null
  const repository = createBuilderProjectRepository({
    load: async () => [{ id: 'code-1', type: 'code', name: 'Keep Code AI' }],
    save: async (_key, value) => { saved = value; return { localSaved: true, cloudSaved: false, remoteAttempted: true } },
    now: () => NOW,
  })
  const project = { ...createBuilderProject({ ownerId: 'user-1', prompt: 'Build', now: NOW }), files: validFiles }
  const result = await repository.save(project, 'user-1')
  assert.equal(result.saved, false)
  assert.equal(result.locallyRecovered, true)
  assert.equal(saved.some((record) => record.type === 'code'), true)
  assert.equal(saved.some((record) => record.type === 'builder-project'), true)
})

test('Builder repository duplicates a valid project as a new recoverable project version', async () => {
  const writes = []
  const source = appendBuilderVersion({ ...createBuilderProject({ ownerId: 'user-1', now: NOW }), files: validFiles, validation: { valid: true, issues: [], checkedAt: NOW } }, { files: validFiles, origin: 'generation', summary: 'Initial', validation: { valid: true, issues: [], checkedAt: NOW }, now: NOW })
  const repository = createBuilderProjectRepository({
    load: async () => [],
    save: async (_key, value) => { writes.push(value); return { localSaved: true, cloudSaved: true, remoteAttempted: true } },
    now: () => NOW,
  })
  const result = await repository.duplicate(source, 'user-1')
  assert.equal(result.saved, true)
  assert.notEqual(result.project.id, source.id)
  assert.equal(result.project.files.length, validFiles.length)
  assert.equal(result.project.versions.length, 1)
  assert.equal(writes[0][0].name, `${source.name} copy`)
})

test('Malformed persisted Builder files remain recoverable but cannot be treated as a ready preview project', async () => {
  const corrupted = { ...createBuilderProject({ ownerId: 'user-1', now: NOW }), id: 'corrupted-builder', status: 'ready', files: [{ path: '../unsafe.html', content: '<main>Unsafe</main>' }] }
  const repository = createBuilderProjectRepository({ load: async () => [corrupted], now: () => NOW })
  const [project] = await repository.list('user-1')
  assert.equal(project.status, 'error')
  assert.equal(project.preview.status, 'error')
  assert.equal(project.recovery.errorCode, 'PERSISTED_PROJECT_INVALID')
  assert.equal(project.validation.issues.some((item) => item.code === 'INVALID_PATH'), true)
})

test('Builder generation uses a bounded structured batch, creates structured files, and rejects prose/fenced output', async () => {
  const responses = [
    { ok: true, provider: 'groq', model: 'model', text: JSON.stringify({ name: 'Founders', summary: 'A site for founders.', projectType: 'website', pages: [{ path: 'index.html', title: 'Home', purpose: 'Home' }], sections: ['Hero'], components: [], features: [], brand: { visualDirection: 'Calm', colors: ['#111827'] } }) },
    { ok: true, provider: 'groq', model: 'model', text: JSON.stringify({ entryFile: 'index.html', files: [{ path: 'index.html', role: 'entry', purpose: 'Home' }, { path: 'styles.css', role: 'style', purpose: 'Styles' }, { path: 'app.js', role: 'script', purpose: 'Interaction' }] }) },
    { ok: true, provider: 'groq', model: 'model', text: JSON.stringify({ files: [
      { path: 'index.html', content: '<main><h1>Founders</h1></main>' },
      { path: 'styles.css', content: 'body { margin: 0; }' },
      { path: 'app.js', content: 'document.body.dataset.ready = "true"' },
    ] }) },
  ]
  const requests = []
  const service = createBuilderGenerationService({ request: async (input) => {
    requests.push(input)
    return responses.shift()
  } })
  const project = await service.generate({ brief: 'Build a founder site', ownerId: 'user-1' })
  assert.equal(project.status, 'ready')
  assert.equal(project.validation.valid, true)
  assert.equal(project.versions[0].provider, 'groq')
  assert.equal(project.files.length, 3)
  assert.equal(project.preview.status, 'building')
  assert.equal(project.preview.lastSuccessfulVersionId, null)
  assert.equal(requests.length, 3)
  assert.deepEqual(requests.at(-1).responseFormat, { type: 'json_object' })
  assert.equal(requests.at(-1).maxTokens, BUILDER_FILE_GENERATION_MAX_TOKENS)

  const bad = createBuilderGenerationService({ request: async () => ({ ok: true, text: '```json\n{}\n```' }) })
  await assert.rejects(() => bad.plan({ brief: 'Bad format' }), (error) => error instanceof BuilderGenerationError && error.code === 'GENERATION_FORMAT_ERROR')
})

test('Builder retries transient planning failures once but never repeats an oversized provider request', async () => {
  const successfulPlan = { ok: true, provider: 'groq', model: 'model', text: JSON.stringify({ name: 'Notes', summary: 'A meeting-notes landing page.', pages: [{ path: 'index.html', title: 'Home', purpose: 'Landing page' }] }) }
  let transientCalls = 0
  const retrying = createBuilderGenerationService({ request: async () => {
    transientCalls += 1
    return transientCalls === 1
      ? { ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Temporary upstream failure.', retryable: true } }
      : successfulPlan
  } })
  const planned = await retrying.plan({ brief: 'Build a meeting notes website' })
  assert.equal(transientCalls, 2)
  assert.equal(planned.plan.pages[0].path, 'index.html')

  let oversizedCalls = 0
  const oversized = createBuilderGenerationService({ request: async () => {
    oversizedCalls += 1
    return { ok: false, error: { code: 'PROVIDER_REQUEST_TOO_LARGE', message: 'Request too large.', retryable: false } }
  } })
  await assert.rejects(
    () => oversized.plan({ brief: 'Build a website' }),
    (error) => error instanceof BuilderGenerationError && error.code === 'PROVIDER_REQUEST_TOO_LARGE'
  )
  assert.equal(oversizedCalls, 1)
})

test('A normalized provider failure is preserved safely by Builder generation', async () => {
  const service = createBuilderGenerationService({ request: async () => ({ ok: false, error: { code: 'PROVIDER_RATE_LIMITED', message: 'Groq has reached its provider request limit. Wait briefly, then try again.', retryable: true } }) })
  await assert.rejects(() => service.plan({ brief: 'Build a site' }), (error) => error instanceof BuilderGenerationError && error.code === 'PROVIDER_RATE_LIMITED' && error.message.includes('provider request limit'))
})

test('Builder continuation generates missing files in one bounded request and does not retry a provider rate limit', async () => {
  const manifest = { entryFile: 'index.html', files: [{ path: 'index.html', role: 'entry' }, { path: 'styles.css', role: 'style' }] }
  const replies = [
    { ok: true, provider: 'groq', model: 'model', text: '{"files":[{"path":"index.html","content":"<main>Recovered</main>"},{"path":"styles.css","content":"body { margin: 0; }"}]}' },
  ]
  let calls = 0
  const service = createBuilderGenerationService({ request: async () => { calls += 1; return replies.shift() } })
  const continued = await service.continueMissingFiles({ brief: 'Build', plan: { summary: 'Build', pages: [] }, manifest, files: [] })
  assert.deepEqual(continued.addedPaths, ['index.html', 'styles.css'])
  assert.equal(continued.files.length, 2)
  assert.equal(calls, 1)

  let limitedCalls = 0
  const limited = createBuilderGenerationService({ request: async () => {
    limitedCalls += 1
    return { ok: false, error: { code: 'PROVIDER_RATE_LIMITED', message: 'Groq has reached its provider request limit.', retryable: true } }
  } })
  await assert.rejects(
    () => limited.continueMissingFiles({ brief: 'Build', plan: { summary: 'Build', pages: [] }, manifest, files: [] }),
    (error) => error instanceof BuilderGenerationError && error.code === 'PROVIDER_RATE_LIMITED'
  )
  assert.equal(limitedCalls, 1)
})

test('Builder cancellation remains a normalized request outcome', async () => {
  const aborted = await routeAIRequest({ provider: 'groq', model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'Build' }] }, {
    fetchImpl: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error },
  })
  assert.equal(aborted.ok, false)
  assert.equal(aborted.error.code, 'REQUEST_CANCELLED')
  assert.equal(aborted.error.status, 499)
})
