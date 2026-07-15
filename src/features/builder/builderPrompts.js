import { BUILDER_ENTRY_FILE, BUILDER_RUNTIME, BUILDER_TEMPLATE } from './builderProjectSchema.js'

const JSON_RULES = `Return exactly one valid JSON object. Do not use Markdown, code fences, commentary, or keys that were not requested.`

const PREMIUM_WEBSITE_STANDARD = `
Design for a credible, launch-ready modern SaaS website rather than a wireframe or a developer demo. Make decisive, appropriate design choices from the brief; do not ask the user to fill in missing basics.

For a typical landing page, create a clear narrative: a compact navigation, an outcome-led hero with one primary CTA, concise proof or reassurance, a useful feature section, an understandable workflow or product moment, a trust/reliability section when relevant, a final CTA, and a compact footer. Adapt that structure when the brief calls for another type of site.

Use a purposeful design system: a limited palette, high-contrast readable type, a centered responsive content container, deliberate whitespace, consistent cards and buttons, and one restrained visual accent. Prefer real, concise product copy over lorem ipsum, fake dashboards, fake customer logos, inflated metrics, or placeholder-heavy layouts. The result must be comfortable on narrow screens as well as desktop.

The in-app runtime is dependency-free and offline. Use only local HTML, CSS, and JavaScript; never use package imports, web fonts, CDNs, external images, remote URLs, iframes, eval, Function, or network calls.`

export function buildBuilderPlanPrompt(brief) {
  return `${JSON_RULES}

You are the planning stage of FounderLab Builder. Infer sensible defaults and produce a concise, buildable plan for a dependency-free responsive static website. The supported runtime is ${BUILDER_RUNTIME} (${BUILDER_TEMPLATE}).
${PREMIUM_WEBSITE_STANDARD}

User brief:
${brief}

Return this exact shape:
{"name":"short project name","summary":"one concise sentence","projectType":"website|landing-page|dashboard|portfolio|storefront","pages":[{"path":"index.html","title":"Home","purpose":"..."}],"sections":["..."],"components":["..."],"features":["..."],"brand":{"name":"...","tone":"...","visualDirection":"...","colors":["#..."]},"designSystem":{"layout":"...","typography":"...","surfaces":"...","accent":"...","motion":"..."},"technicalStructure":"static HTML, CSS and optional JavaScript"}`
}

export function buildBuilderManifestPrompt({ brief, plan }) {
  return `${JSON_RULES}

You are the manifest stage of FounderLab Builder. Create a small, complete ${BUILDER_RUNTIME} website. Files may only use these paths: ${BUILDER_ENTRY_FILE}, styles.css, app.js, pages/<name>.html, and assets/<name>.json or assets/<name>.svg. Do not request packages, external URLs, imports, CDNs, iframes, eval, Function, or remote assets. index.html is required.
${PREMIUM_WEBSITE_STANDARD}

For a single-page landing page, prefer exactly index.html, styles.css, and app.js. Add a second page or an asset only when it creates a real user-facing benefit. Keep the manifest to five files or fewer so the full project can be generated reliably in one structured response.

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
${PREMIUM_WEBSITE_STANDARD}

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
${PREMIUM_WEBSITE_STANDARD}

Generation quality bar:
- index.html must contain a complete, visually ordered page—not a single hero or a text dump.
- styles.css must define the visual system (custom properties, responsive layout, type scale, accessible focus states, button/card states, and mobile rules) instead of relying on browser defaults.
- app.js is optional in spirit: when it is present, keep it small and use it only for a real progressive enhancement such as a mobile navigation toggle or an in-page interaction. It must not be required for core content or layout.
- Keep copy concrete and concise. Avoid lorem ipsum, invented testimonials or customers, fake metrics, generic repeated cards, and empty placeholder boxes.
- Use semantic landmarks and real button/link labels. Ensure the site remains coherent with JavaScript disabled.

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
${PREMIUM_WEBSITE_STANDARD}

Preserve the existing information hierarchy and visual system unless the request explicitly changes them. Make the smallest complete change that improves the rendered result, retains responsive behavior, and continues to pass the isolated preview checks.

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
