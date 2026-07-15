# FounderLab Builder 2.0 architecture

## Stage 1 audit

The prior Builder was a large `BuilderPage` inside `src/App.jsx`. It had a
useful product direction—plan first, generate multiple files, edit a scoped
file, and retain snapshots—but it was not a reliable project system.

| Area | Previous implementation | Risk / decision |
| --- | --- | --- |
| Route and UI | `BuilderPage` was selected from `AppInner` and owned prompt, generation, files, versions, preview, export, and persistence state. | Extract all new Builder behaviour into `src/features/builder/`; `App.jsx` only renders the feature. |
| Generation | Several prompts requested fenced Next.js/TypeScript files, parsed by `parseFiles`. | Fence parsing and prose-adjacent filenames are not a contract. Builder 2.0 requests strict JSON and rejects incomplete/truncated responses. |
| Project shape | `{ type: 'builder', desc, style, overview, files, versions, activeIdx }` shared the generic `fl_projects` collection with Code AI records. | A schema-versioned Builder record now validates and migrates independently without changing non-Builder records. |
| Persistence | A debounced `fl_projects` write had no explicit save result, recovery state, owner, or bounded history. | A repository uses authenticated workspace storage as the source of truth, keeps a local recovery copy through that boundary, and returns honest save outcomes. |
| Preview | Generated Next.js files were rewritten into one browser scope and executed through CDN React/Babel/Tailwind. | This is not a Next.js build, makes import assumptions, needs unrestricted external network, and cannot make a valid-build claim. New projects use an explicitly supported static HTML/CSS/JS format. |
| Validation | Required paths were checked per batch; paths, imports, size limits, duplicate files, and preview safety were not validated as one project. | Project, manifest, file, import, preview-safety, and supported-runtime checks run before a version becomes ready. |
| Editing | Heuristics chose a file, then a free-form fenced replacement was applied; the result was versioned even when invalid. | Edits use structured patches, enforce a selected scope, validate before commit, and preserve the last working version on failure. |
| History | Snapshot copies were kept only in current React state and did not record origin, model, validation, or recovery. | Bounded immutable snapshots record origin, provider/model, changed files, validation, and restore metadata. |
| Security | Iframe sandbox was correctly `allow-scripts` without same-origin, but the preview loads remote CDNs and generated scripts have no Builder-specific policy. | The new preview is an opaque-origin `srcDoc` with `allow-scripts`, `no-referrer`, restrictive CSP, no external network, and no parent APIs. |

The old Builder 1.x source remains as an unreachable migration reference while
legacy records exist, but `AppInner` now routes Builder only to
`BuilderWorkspace`; the production build excludes the unused legacy view. No
Builder 2.0 generation, editing, preview, or persistence path calls the old
Next.js preview helpers.

## Supported Builder 2.0 runtime

Builder 2.0 produces a portable, dependency-free website project:

```text
index.html        required entry file
styles.css        optional project stylesheet
app.js            optional project script
pages/*.html      optional additional static pages
assets/*          optional local data assets
```

No package manager, external import, remote script, remote stylesheet,
iframe, `eval`, `Function` constructor, or external network resource is
supported in the in-app runtime. This is an intentional product constraint:
FounderLab only marks a project ready when this supported format validates and
renders in its isolated preview. Future phases can add a real server-side build
worker as a new runtime instead of loosening these guarantees.

## Module boundaries

```text
src/features/builder/
  builderProjectSchema.js       schema, migration, safe defaults
  builderProjectRepository.js   authenticated persistence and recovery cache
  builderValidation.js          paths, imports, runtime/safety validation
  builderFileOperations.js      safe file creation, rename/reference rewrites, tree data
  builderVersions.js            immutable versions, restore, undo
  builderPrompts.js             JSON-only plan/manifest/files/patch prompts and product-quality guidance
  builderGeneration.js          staged provider orchestration and cancellation
  builderPreview.js             CSP-wrapped static preview document
  BuilderWorkspace.jsx          route composition plus focused start, file,
                                editor, preview, activity, and history views
```

Dependencies point inward: components call the workspace controller; the
controller calls generation/repository/version helpers; those helpers depend on
schema and validation. Provider execution stays in `src/services/aiProviderService.js`.
No Builder module imports `App.jsx`.

## Project and recovery model

Every Builder record has `schemaVersion: 2`, an authenticated `ownerId`, a
current file set, a bounded list of immutable versions, generation/change
history, validation output, preview state, settings, brand preferences, and a
recoverable error. The generic `fl_projects` collection remains compatible with
Code AI records: Builder 2.0 selects only records marked `builder-project` and
leaves other records untouched.

`loadWorkspaceData` / `saveWorkspaceData` remain the persistence boundary. They
write a local device copy for recovery and sync the authenticated user's
collection to `user_data`; local storage is not treated as the only source of
truth. Save failures are reflected in project state instead of being reported
as success. Interrupted generation records an honest recoverable status and
retains the last successful version.

## Generation pipeline

1. Normalize the user's brief and request an editable JSON plan.
2. Bound the brief and every plan/manifest field before it is interpolated into a
   later prompt, then request a JSON file manifest. This prevents an unusually
   verbose plan from turning the first file-generation request into an upstream
   request-size failure.
3. Generate the small, bounded manifest (at most five files) in one structured
   provider response through the normalized provider service. This avoids a
   burst of per-file calls exhausting an upstream provider quota.
4. Use a native JSON-object response mode for providers that support it, then
   retain strict local parsing and validation as the final authority.
5. Normalize paths and line endings, reject duplicates, missing local
   references, and unsafe content.
6. Validate files, the entry point, references, and supported preview format.
   A targeted repair is bounded and never replaces a valid version until it
   passes validation.
7. Persist the project in a `building` preview state. The isolated iframe must
   send its narrow ready signal after `load` before Builder records the new
   version as the last successful preview.

### First-generation quality standard

The plan and file prompts share a product-quality contract. For an ordinary
landing-page brief, Builder produces an intentional narrative rather than a
single hero or a collection of generic boxes: navigation, an outcome-led hero,
proof or reassurance, useful features, an understandable product/workflow
moment, an appropriate trust section, final CTA, and footer. The generated CSS
must establish its own responsive type scale, layout, focus states, controls,
and restrained visual system. It must use concise real copy rather than lorem
ipsum, invented customers, fake metrics, or placeholder dashboards.

This is guidance, not a new runtime. Generation remains bounded to five local
static files and retains the same structured JSON and validation gates.

The controller uses a request-scoped `AbortController`, a generation id, and a
single in-flight guard. Cancellation stops outstanding browser requests when
possible and always prevents stale completions from committing state. A
continuation re-requests only missing files as one bounded batch; it never
replaces already validated files. Provider rate-limit results are not retried
inside Builder and are distinct from FounderLab's Upstash protection response.
Provider execution is also bounded server-side (60 seconds by default,
configurable with the server-only `FOUNDERLAB_PROVIDER_TIMEOUT_MS` within a
5–120 second range), so a stalled upstream request becomes a safe, retryable
provider-unavailable outcome rather than leaving the workspace in a false
completed state.

The initial file batch has a deliberately smaller output budget than a general
chat response. It is a concise three-to-five-file static site, not an arbitrary
repository. A transient plan or manifest failure gets one automatic retry;
request-size, authentication, configuration, and rate-limit failures do not.
An upstream HTTP 413 is returned as the specific, non-retryable
`PROVIDER_REQUEST_TOO_LARGE` error rather than being hidden as a generic
provider outage.

## Preview security

New Builder projects use an iframe with `sandbox="allow-scripts"` and
`referrerPolicy="no-referrer"`. Its document contains a restrictive CSP:
`default-src 'none'`, inline script/style only, data/blob images only,
`connect-src 'none'`, and no form/base/frame/object embedding. The iframe has
an opaque origin, so generated code cannot access FounderLab's tokens, storage,
or parent DOM. A narrow message bridge reports only preview lifecycle and safe
error codes; it never accepts commands or data from the preview.

Preview state is intentionally version-aware. If an edited version fails
validation or reports an isolated runtime error, Builder retains the last
version that sent a ready signal in the canvas where available. The user sees a
clear scoped message with retry and deliberate AI-repair actions; a fallback
ready signal can never mark the failed current version as ready. The visual
preview is the default primary workspace surface. Files, versions, and raw code
remain available for advanced editing without competing with the first result.
The desktop canvas has a definite viewport height and hides its outer overflow;
the rendered site owns its own iframe scroll position. This keeps the website
framed stably while making it clear that the Builder shell itself is not the
page being previewed.

## Deferred, intentionally

- Arbitrary Next.js/npm package builds need a server-side build worker and are
  not represented as working in the Builder UI.
- GitHub and Vercel export/deployment are excluded from the Builder 2.0 UI.
- Collaborative editing, billing, marketplace templates, and Supabase project
  provisioning remain outside Phase 2.3.
