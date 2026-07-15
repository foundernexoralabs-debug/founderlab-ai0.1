import { BUILDER_ENTRY_FILE, BUILDER_RUNTIME, BUILDER_TEMPLATE } from './builderProjectSchema.js'

const JSON_RULES = `Return exactly one valid JSON object. Do not use Markdown, code fences, commentary, or keys that were not requested.`

export function buildBuilderPlanPrompt(brief) {
  return `${JSON_RULES}

You are the planning stage of FounderLab Builder. Infer sensible defaults and produce a concise, buildable plan for a dependency-free responsive static website. The supported runtime is ${BUILDER_RUNTIME} (${BUILDER_TEMPLATE}).

User brief:
${brief}

Return this exact shape:
{"name":"short project name","summary":"one concise sentence","projectType":"website|landing-page|dashboard|portfolio|storefront","pages":[{"path":"index.html","title":"Home","purpose":"..."}],"sections":["..."],"components":["..."],"features":["..."],"brand":{"name":"...","tone":"...","visualDirection":"...","colors":["#..."]},"technicalStructure":"static HTML, CSS and optional JavaScript"}`
}

export function buildBuilderManifestPrompt({ brief, plan }) {
  return `${JSON_RULES}

You are the manifest stage of FounderLab Builder. Create a small, complete ${BUILDER_RUNTIME} website. Files may only use these paths: ${BUILDER_ENTRY_FILE}, styles.css, app.js, pages/<name>.html, and assets/<name>.json or assets/<name>.svg. Do not request packages, external URLs, imports, CDNs, iframes, eval, Function, or remote assets. index.html is required.

Brief:
${brief}

Approved plan:
${JSON.stringify(plan)}

Return exactly:
{"entryFile":"index.html","files":[{"path":"index.html","role":"entry","purpose":"..."},{"path":"styles.css","role":"style","purpose":"..."},{"path":"app.js","role":"script","purpose":"..."}]}`
}

export function buildBuilderFilePrompt({ brief, plan, file, manifest, repairInstructions = '' }) {
  return `${JSON_RULES}

You are generating one file for a FounderLab Builder project. Produce complete content only for the requested path. The supported project has no dependencies, no imports, no external URLs, no network access, no iframe, no eval, and no Function constructor. Use semantic accessible responsive HTML, polished CSS, and small progressive-enhancement JavaScript where needed. Do not include script or link tags in HTML; styles.css and app.js are injected by the isolated runtime.

Brief: ${brief}
Plan: ${JSON.stringify(plan)}
Manifest: ${JSON.stringify(manifest)}
Requested file: ${JSON.stringify(file)}
${repairInstructions ? `Repair instructions: ${repairInstructions}` : ''}

Return exactly: {"path":${JSON.stringify(file.path)},"content":"complete file contents"}`
}

export function buildBuilderFilesPrompt({ brief, plan, manifest, repairInstructions = '' }) {
  return `${JSON_RULES}

You are generating every file in a small FounderLab Builder project in one cohesive response. Produce complete contents for each manifest file. The supported project has no dependencies, no imports, no external URLs, no network access, no iframe, no eval, and no Function constructor. Use semantic accessible responsive HTML, polished CSS, and small progressive-enhancement JavaScript where needed. Do not include script or link tags in HTML; styles.css and app.js are injected by the isolated runtime.

Keep this project intentionally small: return only the manifest files, and keep total generated source concise enough to fit in one response. Every manifest path must appear once, with complete content.

Brief: ${brief}
Plan: ${JSON.stringify(plan)}
Manifest: ${JSON.stringify(manifest)}
${repairInstructions ? `Repair instructions: ${repairInstructions}` : ''}

Return exactly: {"files":[{"path":"manifest file path","content":"complete file contents"}]}`
}

export function buildBuilderPatchPrompt({ request, project, selectedPath }) {
  const fileList = (project.files || []).map((file) => ({ path: file.path, role: file.role, language: file.language }))
  const selectedFile = (project.files || []).find((file) => file.path === selectedPath) || (project.files || [])[0]
  return `${JSON_RULES}

You are applying a scoped FounderLab Builder edit. Modify only the selected file unless the requested change cannot be validly completed there. Return complete replacement contents for every changed file. This project supports only local static HTML, CSS, and JavaScript: no package imports, external URLs, iframe, eval, Function, or remote resources.

User request: ${request}
Selected file: ${selectedFile?.path || 'Choose the smallest relevant file'}
Available project files: ${JSON.stringify(fileList)}
Selected file contents: ${JSON.stringify({ path: selectedFile?.path || null, content: selectedFile?.content || '' })}

Return exactly: {"summary":"short change summary","changes":[{"path":"existing file path","content":"complete replacement content"}]}`
}

export function parseStrictBuilderJson(text, label = 'generation response') {
  if (typeof text !== 'string' || !text.trim()) throw new BuilderFormatError(`The ${label} was empty.`)
  const source = text.trim()
  if (source.startsWith('```')) throw new BuilderFormatError(`The ${label} was not returned in the required JSON format.`)
  try {
    const parsed = JSON.parse(source)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object')
    return parsed
  } catch {
    throw new BuilderFormatError(`The ${label} was not valid JSON. Please retry generation.`)
  }
}

export class BuilderFormatError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BuilderFormatError'
    this.code = 'GENERATION_FORMAT_ERROR'
  }
}
