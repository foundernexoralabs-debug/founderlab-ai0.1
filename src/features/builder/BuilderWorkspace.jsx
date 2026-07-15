import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../app/theme.js'
import { toast } from '../../app/toast.jsx'
import { Badge, Button, EmptyState, Input, Spinner } from '../../components/ui/Primitives.jsx'
import { uid } from '../../lib/ids.js'
import { builderGenerationService } from './builderGeneration.js'
import { buildBuilderFileTree, createBuilderFile, renameBuilderFile } from './builderFileOperations.js'
import { createBuilderProject, BUILDER_ENTRY_FILE } from './builderProjectSchema.js'
import { builderProjectRepository } from './builderProjectRepository.js'
import { buildBuilderPreviewDocument, BUILDER_PREVIEW_SANDBOX, getLastWorkingPreviewFiles, isSafeBuilderPreviewMessage } from './builderPreview.js'
import { BUILDER_PROMPT_LIMITS } from './builderPrompts.js'
import { BUILDER_MAX_FILE_BYTES, validateBuilderFiles } from './builderValidation.js'
import { appendBuilderVersion, getPreviousBuilderVersion, restoreBuilderVersion } from './builderVersions.js'

const EXAMPLES = [
  'A polished landing page for a founder-focused accounting service with a calm, trustworthy visual style.',
  'A responsive portfolio for a product designer, with selected work, case studies, and a contact section.',
  'A waitlist website for an AI meeting-notes product aimed at small startup teams.',
]

const SAFE_BUILDER_ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_REQUIRED: 'Sign in is required before Builder can generate a project.',
  AUTHENTICATION_INVALID: 'Your sign-in session could not be verified. Please sign in again.',
  MISSING_CONFIGURATION: 'The selected AI provider is not configured. Choose another configured provider in Settings.',
  INVALID_MODEL: 'The selected AI model is unavailable. Choose another model in Settings.',
  INVALID_MANIFEST: 'FounderLab could not create a safe project structure. Please retry the build.',
  INVALID_PLAN: 'FounderLab could not complete the project plan. Please review it and retry.',
  GENERATION_FORMAT_ERROR: 'FounderLab received an incomplete structured response. No project was saved.',
  FILE_BATCH_INVALID: 'FounderLab received an invalid project-file response. No project was saved.',
  FILE_BATCH_INCOMPLETE: 'FounderLab received an incomplete project-file response. Please retry the build.',
  VALIDATION_FAILED: 'The generated project did not pass Builder safety checks. No project was saved.',
  PROVIDER_RATE_LIMITED: 'The selected provider has reached its request limit. Wait briefly, then retry.',
  PROVIDER_REQUEST_TOO_LARGE: 'This Builder request was larger than the selected provider can accept. Simplify the brief and retry.',
  RATE_LIMITED: 'FounderLab request protection is temporarily limiting generation. Wait briefly, then retry.',
  RATE_LIMIT_BACKEND_UNAVAILABLE: 'Builder generation is temporarily unavailable while request protection recovers.',
  PROVIDER_UNAVAILABLE: 'The selected AI provider is unavailable right now. Please retry shortly.',
  NETWORK_FAILURE: 'Builder could not reach the selected AI provider. Check your connection and retry.',
  REQUEST_CANCELLED: 'Generation was cancelled.',
  CANCELLED: 'Generation was cancelled.',
})

function safeProjectError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'BUILDER_OPERATION_FAILED'
  return {
    code,
    message: SAFE_BUILDER_ERROR_MESSAGES[code] || 'FounderLab could not complete this Builder operation. No project was changed.',
    retryable: error?.retryable !== false,
    reference: `FL-BLD-${code.replace(/[^A-Z0-9_]/gi, '').slice(0, 36) || 'UNKNOWN'}`,
    at: new Date().toISOString(),
  }
}

function projectStatus(project) {
  if (project?.preview?.status === 'building') return { label: 'Building preview', color: 'accent' }
  if (project?.preview?.status === 'error') return { label: 'Preview needs attention', color: 'red' }
  if (project?.status === 'ready' && project?.validation?.valid) return { label: 'Ready', color: 'green' }
  if (project?.status === 'error') return { label: 'Needs attention', color: 'red' }
  if (project?.status === 'legacy') return { label: 'Legacy project', color: 'yellow' }
  if (project?.status === 'archived') return { label: 'Archived', color: 'gray' }
  return { label: project?.status || 'Draft', color: 'accent' }
}

function compactDate(value) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(time) : '—'
}

function createBlankProject(ownerId) {
  const now = new Date().toISOString()
  let project = createBuilderProject({ ownerId, name: 'Untitled website', prompt: 'Blank Builder project', now })
  const files = [
    { path: 'index.html', role: 'entry', language: 'html', state: 'edited', createdAt: now, updatedAt: now, content: '<main class="site-shell">\n  <section class="hero">\n    <p class="eyebrow">FounderLab Builder</p>\n    <h1>Start building.</h1>\n    <p>Shape this blank canvas into your next idea.</p>\n  </section>\n</main>' },
    { path: 'styles.css', role: 'style', language: 'css', state: 'edited', createdAt: now, updatedAt: now, content: ':root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }\nbody { margin: 0; background: #09090f; color: #f4f4ff; }\n.site-shell { min-height: 100vh; display: grid; place-items: center; padding: 2rem; }\n.hero { max-width: 42rem; }\n.eyebrow { color: #a5b4fc; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }\nh1 { font-size: clamp(3rem, 10vw, 7rem); margin: .25rem 0; }\np { color: #b5b5ce; font-size: 1.1rem; line-height: 1.6; }' },
  ]
  const validation = validateBuilderFiles(files)
  project = appendBuilderVersion({
    ...project,
    files: validation.files,
    status: 'ready',
    validation: { valid: validation.valid, issues: validation.issues, checkedAt: now },
    preview: { status: validation.valid ? 'building' : 'error', lastSuccessfulVersionId: null, lastSuccessfulAt: null, lastError: null },
  }, { files: validation.files, origin: 'manual-edit', summary: 'Created blank project', validation: { valid: validation.valid, issues: validation.issues, checkedAt: now }, changedPaths: validation.files.map((file) => file.path), now })
  return project
}

function BuilderStart({ brief, onBriefChange, onPlan, onBlank, busy, projects }) {
  return <div className="builder-start" style={{ maxWidth: 860, width: '100%', margin: '0 auto', padding: 'clamp(24px, 7vw, 72px) 24px' }}>
    <div style={{ maxWidth: 640 }}>
      <Badge>Builder 2.0</Badge>
      <h1 style={{ fontSize: 'clamp(30px, 5vw, 50px)', lineHeight: 1.06, letterSpacing: '-.04em', margin: '16px 0 12px', color: C.t1 }}>Describe what you want to build.</h1>
      <p style={{ color: C.t2, lineHeight: 1.6, margin: 0, maxWidth: 580 }}>FounderLab turns a clear idea into a versioned, responsive website project—with editable files and an isolated live preview.</p>
    </div>
    <label htmlFor="builder-brief" style={{ display: 'block', marginTop: 28, fontSize: 13, fontWeight: 700, color: C.t1 }}>What should FounderLab create?</label>
    <textarea id="builder-brief" aria-describedby="builder-brief-help" value={brief} maxLength={BUILDER_PROMPT_LIMITS.briefCharacters} onChange={(event) => onBriefChange(event.target.value)} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onPlan()
    }} placeholder="For example: A premium landing page for a fractional CFO service for seed-stage founders…" rows={6} disabled={busy} style={{ width: '100%', marginTop: 8, padding: 16, color: C.t1, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, resize: 'vertical', font: 'inherit', lineHeight: 1.55, outline: 'none' }} />
    <p id="builder-brief-help" style={{ color: C.t3, fontSize: 12, margin: '8px 0 14px' }}>Include users, goal, pages, brand, visual direction, or functionality if they matter. FounderLab will infer the rest. Press ⌘/Ctrl + Enter to plan. {brief.length.toLocaleString()}/{BUILDER_PROMPT_LIMITS.briefCharacters.toLocaleString()} characters.</p>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button onClick={onPlan} disabled={busy || !brief.trim()} size="lg">{busy ? <Spinner size={16} color="#fff" /> : 'Create project plan'}</Button>
      <Button onClick={onBlank} disabled={busy} variant="secondary" size="lg">Start blank</Button>
    </div>
    {busy && <p role="status" style={{ color: C.accent, fontSize: 13, margin: '12px 0 0' }}>FounderLab is understanding your request…</p>}
    <div style={{ marginTop: 34 }}>
      <p style={{ color: C.t3, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Start with an example</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
        {EXAMPLES.map((example) => <button type="button" key={example} onClick={() => onBriefChange(example)} style={{ textAlign: 'left', border: `1px solid ${C.border}`, background: C.surf, color: C.t2, borderRadius: 10, padding: 13, font: 'inherit', fontSize: 13, lineHeight: 1.45, cursor: 'pointer' }}>{example}</button>)}
      </div>
    </div>
    {projects.length > 0 && <div style={{ marginTop: 34 }}>
      <p style={{ color: C.t3, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Recent projects</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{projects.slice(0, 5).map((project) => <span key={project.id} style={{ border: `1px solid ${C.border}`, color: C.t2, borderRadius: 999, padding: '6px 10px', fontSize: 12 }}>{project.name}</span>)}</div>
    </div>}
  </div>
}

function BuilderPlan({ plan, onChange, onBuild, onBack, onCancel, busy, activity }) {
  const update = (key, value) => onChange({ ...plan, [key]: value })
  const updateList = (key, value) => update(key, value.split(',').map((item) => item.trim()).filter(Boolean))
  const updatePages = (value) => {
    const pages = value.split(',').map((item) => item.trim()).filter(Boolean).map((title, index) => ({
      title,
      path: index === 0 ? 'index.html' : `pages/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `page-${index + 1}`}.html`,
      purpose: title,
    }))
    update('pages', pages.length ? pages : plan.pages)
  }
  return <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: 'clamp(24px, 7vw, 72px) 24px' }}>
    <Badge>Project plan</Badge>
    <h1 style={{ fontSize: 34, letterSpacing: '-.035em', margin: '16px 0 8px' }}>{plan.name || 'Your project'}</h1>
    <p style={{ color: C.t2, margin: 0 }}>Review the direction before FounderLab generates the files. You can edit the key decisions without completing a long form.</p>
    <div style={{ display: 'grid', gap: 14, marginTop: 28 }}>
      <section aria-label="Design direction" style={{ background: `linear-gradient(135deg, ${C.accentM}, ${C.surf})`, border: `1px solid ${C.border}`, padding: 18, borderRadius: 12 }}>
        <strong style={{ fontSize: 13 }}>Design direction</strong>
        <p style={{ color: C.t2, fontSize: 13, lineHeight: 1.55, margin: '8px 0 12px' }}>{plan.brand?.visualDirection || plan.designSystem?.layout || 'A clear, considered responsive website.'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{[plan.designSystem?.typography, plan.designSystem?.surfaces, plan.designSystem?.accent, plan.brand?.tone].filter(Boolean).slice(0, 4).map((item) => <span key={item} style={{ color: C.t2, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 999, padding: '4px 8px', fontSize: 11 }}>{item}</span>)}{(plan.brand?.colors || []).slice(0, 4).map((color) => <span key={color} title={color} aria-label={`Brand color ${color}`} style={{ width: 18, height: 18, borderRadius: 99, background: color, border: `1px solid ${C.border}` }} />)}</div>
      </section>
      <div><label style={{ display: 'block', marginBottom: 6, color: C.t2, fontSize: 12, fontWeight: 700 }}>Project name</label><Input value={plan.name || ''} onChange={(event) => update('name', event.target.value)} /></div>
      <div><label style={{ display: 'block', marginBottom: 6, color: C.t2, fontSize: 12, fontWeight: 700 }}>Summary</label><Input rows={3} value={plan.summary || ''} onChange={(event) => update('summary', event.target.value)} /></div>
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, padding: 16, borderRadius: 10, display: 'grid', gap: 12 }}>
        <strong style={{ fontSize: 13 }}>Structure</strong>
        <div><label style={{ display: 'block', marginBottom: 6, color: C.t2, fontSize: 12 }}>Pages (comma-separated)</label><Input value={(plan.pages || []).map((page) => page.title || page.path).join(', ')} onChange={(event) => updatePages(event.target.value)} /></div>
        <div><label style={{ display: 'block', marginBottom: 6, color: C.t2, fontSize: 12 }}>Major sections (comma-separated)</label><Input value={(plan.sections || []).join(', ')} onChange={(event) => updateList('sections', event.target.value)} /></div>
      </div>
      <div style={{ background: C.surf, border: `1px solid ${C.border}`, padding: 16, borderRadius: 10 }}><strong style={{ fontSize: 13 }}>Visual direction</strong><Input value={plan.brand?.visualDirection || ''} onChange={(event) => update('brand', { ...(plan.brand || {}), visualDirection: event.target.value })} placeholder="Clear, considered, and responsive" style={{ marginTop: 9 }} /></div>
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap' }}><Button onClick={onBuild} disabled={busy}>{busy ? <Spinner size={15} color="#fff" /> : 'Approve and build'}</Button><Button onClick={onBack} disabled={busy} variant="secondary">Back to brief</Button>{busy && <Button onClick={onCancel} variant="ghost">Cancel</Button>}</div>
    {busy && <p role="status" style={{ color: C.accent, fontSize: 13, margin: '12px 0 0' }}>{activity.at(-1)?.message || 'Preparing your project…'}</p>}
  </div>
}

function fileIcon(path) {
  if (path.endsWith('.html')) return '◇'
  if (path.endsWith('.css')) return '◒'
  if (path.endsWith('.js')) return '◈'
  if (path.endsWith('.svg')) return '◌'
  if (path.endsWith('.json')) return '◫'
  return '·'
}

function FileExplorer({ project, activePath, dirtyPath, onSelect, onAdd, onDelete, onRename, activeOnMobile = false }) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const tree = useMemo(() => buildBuilderFileTree(project.files), [project.files])
  const matches = (node) => node.type === 'file'
    ? node.path.toLowerCase().includes(query.trim().toLowerCase())
    : !query.trim() || node.children.some(matches)
  const renderNode = (node, depth = 1) => {
    if (!matches(node)) return null
    if (node.type === 'folder') {
      if (!node.path) return node.children.map((child) => renderNode(child, depth))
      const expanded = !collapsed.has(node.path)
      return <div key={node.path} role="treeitem" aria-level={depth} aria-expanded={expanded}>
        <button type="button" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next })} style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: C.t2, borderRadius: 6, padding: '6px 7px', cursor: 'pointer', font: '600 11px ui-monospace, SFMono-Regular, monospace' }}>{expanded ? '⌄' : '›'} <span aria-hidden="true">▱</span> {node.name}</button>
        {expanded && <div style={{ paddingLeft: 10 }}>{node.children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    }
    const selected = node.path === activePath
    return <button key={node.path} type="button" role="treeitem" aria-level={depth} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(node.path)} style={{ width: '100%', textAlign: 'left', background: selected ? C.accentM : 'transparent', border: `1px solid ${selected ? C.borderFocus : 'transparent'}`, color: selected ? C.t1 : C.t2, borderRadius: 6, padding: '7px 8px', cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 }}><span aria-hidden="true">{fileIcon(node.path)}</span> {node.name}{dirtyPath === node.path && <span aria-label="Unsaved changes" style={{ color: C.accent }}> •</span>}</button>
  }
  return <div className={`builder-file-panel${activeOnMobile ? ' builder-file-active' : ''}`} style={{ width: 184, minWidth: 150, maxWidth: 300, resize: 'horizontal', overflow: 'auto', borderRight: `1px solid ${C.border}`, padding: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}><strong style={{ fontSize: 12 }}>Files</strong><span style={{ display: 'flex', gap: 2 }}><Button size="sm" variant="ghost" onClick={onAdd} aria-label="Create file">+</Button><Button size="sm" variant="ghost" onClick={() => onRename(activePath)} disabled={activePath === BUILDER_ENTRY_FILE} aria-label="Rename selected file">↗</Button>{activePath !== BUILDER_ENTRY_FILE && <Button size="sm" variant="ghost" onClick={() => onDelete(activePath)} aria-label="Delete selected file">−</Button>}</span></div>
    <input aria-label="Search project files" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" style={{ margin: '12px 0 8px', width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.t1, padding: '7px 8px', font: 'inherit', fontSize: 12 }} />
    <div role="tree" aria-label="Project files" style={{ display: 'grid', gap: 2 }}>{renderNode(tree)}</div>
  </div>
}

function PreviewPanel({ project, previewPath, onNavigate, onReady, onRuntimeError, renderKey }) {
  const frame = useRef(null)
  const preview = useMemo(() => buildBuilderPreviewDocument(project.files, { entryFile: previewPath }), [project.files, previewPath])
  useEffect(() => {
    const listen = (event) => {
      if (!isSafeBuilderPreviewMessage(event, frame.current?.contentWindow)) return
      if (event.data.type === 'navigate') onNavigate(event.data.detail?.path)
      if (event.data.type === 'ready') onReady()
      if (event.data.type === 'runtime-error') onRuntimeError()
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [onNavigate, onReady, onRuntimeError])
  useEffect(() => {
    if (!preview.ok) onRuntimeError(preview.validation.issues[0]?.message || 'This version could not be rendered safely.')
  }, [onRuntimeError, preview.ok])
  if (!preview.ok) return <div style={{ padding: 20 }}><EmptyState icon="⚠" title="Preview needs attention" description={preview.validation.issues[0]?.message || 'Fix the validation issues before previewing this project.'} /></div>
  return <iframe key={renderKey} ref={frame} srcDoc={preview.srcDoc} title="Builder live preview" sandbox={BUILDER_PREVIEW_SANDBOX} referrerPolicy="no-referrer" style={{ display: 'block', width: '100%', height: '100%', minHeight: 0, border: 'none', background: '#fff' }} />
}

function ActivityPanel({ project }) {
  const activity = [...(project.generationHistory || []), ...(project.changeHistory || [])].slice(-8).reverse()
  return <details style={{ borderTop: `1px solid ${C.border}`, flexShrink: 0 }}><summary style={{ padding: '9px 12px', color: C.t3, cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase' }}>Recent activity{activity.length ? ` · ${activity.length}` : ''}</summary><section style={{ padding: '0 12px 12px', maxHeight: 118, overflow: 'auto' }}>{activity.length ? <div style={{ display: 'grid', gap: 5 }}>{activity.map((item) => <div key={item.id || `${item.at}-${item.message}`} style={{ fontSize: 12, color: C.t2 }}><span style={{ color: C.accent, marginRight: 7 }}>{item.stage}</span>{item.message}</div>)}</div> : <p style={{ color: C.t3, fontSize: 12, margin: 0 }}>No project activity yet.</p>}</section></details>
}

function BuilderWorkspaceView({ project, projects, onSelectProject, onCreateProject, onProjectChange, onSave, onDelete, onArchive, onDuplicate, busy, onCancel }) {
  const [activePath, setActivePath] = useState(project.settings?.previewPath || BUILDER_ENTRY_FILE)
  const [previewPath, setPreviewPath] = useState(project.settings?.previewPath || BUILDER_ENTRY_FILE)
  const [draft, setDraft] = useState(() => project.files.find((file) => file.path === activePath)?.content || '')
  const [changeRequest, setChangeRequest] = useState('')
  const [editing, setEditing] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [mobileTab, setMobileTab] = useState('preview')
  const [previewKey, setPreviewKey] = useState(0)
  const previewHost = useRef(null)

  useEffect(() => {
    const file = project.files.find((entry) => entry.path === activePath) || project.files[0]
    if (file && file.path !== activePath) setActivePath(file.path)
    setDraft(file?.content || '')
  }, [project.files, activePath])

  const activeFile = project.files.find((file) => file.path === activePath) || project.files[0]
  const hasUnsavedChanges = Boolean(activeFile && draft !== activeFile.content)
  const isLargeFile = (activeFile?.content.length || 0) > BUILDER_MAX_FILE_BYTES
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    const warnBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])
  const selectFile = useCallback((path) => {
    if (path === activePath) return
    if (hasUnsavedChanges && !window.confirm('Discard unsaved changes to the current file?')) return
    setActivePath(path)
  }, [activePath, hasUnsavedChanges])
  const saveFile = () => {
    if (!activeFile || !hasUnsavedChanges) return
    if (isLargeFile) return toast('This file exceeds the safe Builder editor size limit and is read-only.', 'error')
    const files = project.files.map((file) => file.path === activeFile.path ? { ...file, content: draft.replace(/\r\n?/g, '\n'), state: 'edited', updatedAt: new Date().toISOString() } : file)
    const validation = validateBuilderFiles(files)
    if (!validation.valid) {
      toast(validation.issues[0].message, 'error')
      return
    }
    const now = new Date().toISOString()
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now }, status: 'ready', preview: { ...project.preview, status: 'building', lastError: null } }, { files: validation.files, origin: 'manual-edit', summary: `Edited ${activeFile.path}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: [activeFile.path], now })
    onProjectChange(updated)
    onSave(updated)
  }
  const addFile = () => {
    const path = window.prompt('New file path (pages/name.html or assets/name.json)')
    if (!path) return
    const created = createBuilderFile(path)
    if (!created.ok) return toast(created.message, 'error')
    if (project.files.some((file) => file.path === created.file.path)) return toast('A file already uses that path.', 'error')
    const now = new Date().toISOString()
    const file = { ...created.file, createdAt: now, updatedAt: now }
    const validation = validateBuilderFiles([...project.files, file])
    if (!validation.valid) return toast(validation.issues[0].message, 'error')
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now }, preview: { ...project.preview, status: 'building', lastError: null } }, { files: validation.files, origin: 'manual-edit', summary: `Added ${file.path}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: [file.path], now })
    onProjectChange(updated); onSave(updated); setActivePath(file.path)
  }
  const renameFile = (path) => {
    const destination = window.prompt('Rename file to', path)
    if (!destination) return
    const now = new Date().toISOString()
    const renamed = renameBuilderFile(project.files, path, destination, { now })
    if (!renamed.ok) return toast(renamed.message, 'error')
    const validation = validateBuilderFiles(renamed.files)
    if (!validation.valid) return toast(validation.issues[0].message, 'error')
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now }, preview: { ...project.preview, status: 'building', lastError: null } }, { files: validation.files, origin: 'manual-edit', summary: `Renamed ${path} to ${destination}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: renamed.changedPaths, now })
    onProjectChange(updated); onSave(updated); setActivePath(destination)
  }
  const deleteFile = (path) => {
    if (path === BUILDER_ENTRY_FILE) return toast('index.html is required for every Builder project.', 'error')
    if (!window.confirm(`Delete ${path}? A recoverable version will remain in history.`)) return
    const now = new Date().toISOString()
    const files = project.files.filter((file) => file.path !== path)
    const validation = validateBuilderFiles(files)
    if (!validation.valid) return toast(validation.issues[0].message, 'error')
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now }, preview: { ...project.preview, status: 'building', lastError: null } }, { files: validation.files, origin: 'manual-edit', summary: `Deleted ${path}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: [path], now })
    onProjectChange(updated); onSave(updated); setActivePath(BUILDER_ENTRY_FILE)
  }
  const restore = (versionId) => {
    const result = restoreBuilderVersion(project, versionId)
    if (!result.restored) return
    result.project.preview = { ...result.project.preview, status: 'building', lastError: null }
    onProjectChange(result.project); onSave(result.project)
  }
  const undoLatest = () => {
    const previous = getPreviousBuilderVersion(project)
    if (!previous) return toast('There is no earlier version to restore.', 'error')
    restore(previous.id)
  }
  const copyActiveFile = async () => {
    if (!activeFile) return
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(activeFile.content)
      toast('File content copied.', 'success')
    } catch {
      toast('Copy is not available in this browser. Select the file content to copy it.', 'error')
    }
  }
  const applyChange = async ({ request = changeRequest, selectedPath = activePath, successMessage = 'Change applied in a new recoverable version.' } = {}) => {
    if (!request.trim() || busy) return
    if (request.length > 60000) return toast('Keep a scoped edit request under 60,000 characters so FounderLab can validate it safely.', 'error')
    setEditing(true)
    try {
      const updated = await builderGenerationService.applyEdit({ project, request: request.trim(), selectedPath, onActivity: () => {} })
      onProjectChange(updated)
      await onSave(updated)
      setChangeRequest('')
      toast(successMessage, 'success')
    } catch (error) {
      const failure = safeProjectError(error)
      toast(`${failure.message} Reference: ${failure.reference}`, 'error')
    } finally { setEditing(false) }
  }
  const validate = validateBuilderFiles(project.files)
  const status = projectStatus(project)
  const onNavigate = useCallback((path) => {
    if (project.files.some((file) => file.path === path && file.path.endsWith('.html'))) setPreviewPath(path)
  }, [project.files])
  const onPreviewReady = useCallback(() => {
    // A previous version can stay visible after a failed edit. Never mark the failed
    // current version ready merely because that fallback iframe loaded correctly.
    if (project.preview?.status === 'error') return
    if (project.preview?.status === 'ready' && project.preview?.lastSuccessfulVersionId === project.currentVersionId) return
    const now = new Date().toISOString()
    const updated = {
      ...project,
      preview: {
        ...project.preview,
        status: 'ready',
        lastSuccessfulVersionId: project.currentVersionId,
        lastSuccessfulAt: now,
        lastError: null,
      },
      generationHistory: [...(project.generationHistory || []), {
        id: `builder-event-${uid()}`,
        at: now,
        stage: 'ready',
        message: 'Isolated preview rendered successfully',
        provider: null,
        model: null,
        details: null,
      }].slice(-30),
    }
    onProjectChange(updated)
    void onSave(updated)
    toast('Isolated preview is ready.', 'success')
  }, [onProjectChange, onSave, project])
  const onRuntimeError = useCallback((message = 'The isolated preview reported a runtime error.') => {
    if (project.preview?.status === 'error') return
    const updated = { ...project, preview: { ...project.preview, status: 'error', lastError: message } }
    onProjectChange(updated)
    void onSave(updated)
  }, [onProjectChange, onSave, project])
  const setPreviewDevice = (device) => {
    const updated = { ...project, settings: { ...project.settings, device } }
    onProjectChange(updated)
    void onSave(updated)
  }
  const expandPreview = () => {
    previewHost.current?.requestFullscreen?.().catch(() => {})
  }
  const previewDevice = project.settings?.device || 'desktop'
  const previewWidth = previewDevice === 'mobile' ? 390 : previewDevice === 'tablet' ? 768 : '100%'
  const selectableProjects = projects.some((item) => item.id === project.id) ? projects : [project, ...projects]
  const lastWorkingFiles = getLastWorkingPreviewFiles(project)
  const showingFallback = project.preview?.status === 'error' && Boolean(lastWorkingFiles)
  const previewProject = showingFallback ? { ...project, files: lastWorkingFiles } : project
  const previewPages = previewProject.files.filter((file) => file.path.endsWith('.html'))
  const displayedPreviewPath = previewPages.some((file) => file.path === previewPath)
    ? previewPath
    : previewProject.entryFile || BUILDER_ENTRY_FILE
  const retryPreview = () => {
    const updated = { ...project, preview: { ...project.preview, status: 'building', lastError: null } }
    onProjectChange(updated)
    void onSave(updated)
    setPreviewKey((value) => value + 1)
  }
  const repairPreview = () => {
    const repairPath = project.files.some((file) => file.path === 'styles.css') ? 'styles.css' : BUILDER_ENTRY_FILE
    void applyChange({
      request: 'Repair the current Builder preview. Keep the existing product message and visual direction, remove only the issue preventing a safe render, and preserve responsive, accessible behavior without external resources.',
      selectedPath: repairPath,
      successMessage: 'Preview repair applied in a new recoverable version.',
    })
  }
  const previewLabel = project.preview?.status === 'building'
    ? 'Building preview'
    : project.preview?.status === 'error'
      ? showingFallback ? 'Showing last working version' : 'Preview needs attention'
      : 'Preview ready'

  return <div className="builder-workspace" style={{ height: '100vh', maxHeight: '100dvh', minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
    <style>{`@media (max-width: 760px){.builder-file-panel,.builder-history-panel{display:none!important}.builder-file-panel.builder-file-active,.builder-history-panel.builder-history-active{display:block!important;width:100%!important;max-width:none!important;border-left:none!important;border-right:none!important}.builder-mobile-tabs{display:flex!important}.builder-main-grid{grid-template-columns:1fr!important}.builder-main-grid.builder-main-inactive{display:none!important}.builder-editor-panel{display:var(--builder-editor-display,none)!important}.builder-preview-panel{display:var(--builder-preview-display,none)!important}.builder-project-switcher{width:100%}}@media (min-width: 761px){.builder-mobile-tabs{display:none!important}}`}</style>
    <header style={{ padding: '13px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div className="builder-project-switcher" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <select aria-label="Open Builder project" value={project.id} onChange={(event) => onSelectProject(selectableProjects.find((item) => item.id === event.target.value) || project)} style={{ maxWidth: 180, color: C.t2, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 7, font: '12px inherit', padding: '6px 8px' }}>{selectableProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <Button size="sm" variant="secondary" onClick={onCreateProject}>New</Button>
      </div>
      <input aria-label="Project name" value={project.name} onChange={(event) => onProjectChange({ ...project, name: event.target.value, updatedAt: new Date().toISOString() })} onBlur={(event) => { const updated = { ...project, name: event.target.value, updatedAt: new Date().toISOString() }; onProjectChange(updated); onSave(updated) }} style={{ background: 'transparent', border: 'none', color: C.t1, fontSize: 17, fontWeight: 700, minWidth: 150, flex: '1 1 180px', outline: 'none' }} />
      <Badge color={status.color}>{status.label}</Badge>
      <span style={{ color: C.t3, fontSize: 12 }}>{project.validation?.valid ? 'Saved project checks passed' : 'Validation needs attention'}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {(busy || editing) && <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button variant={showCode ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowCode((visible) => !visible)} aria-pressed={showCode}>{showCode ? 'Hide code' : 'View code'}</Button>
        <Button variant="secondary" size="sm" onClick={undoLatest} disabled={!getPreviousBuilderVersion(project)}>Undo</Button>
        <Button variant="secondary" size="sm" onClick={onDuplicate}>Duplicate</Button>
        <Button variant="secondary" size="sm" onClick={() => onArchive({ ...project, status: project.status === 'archived' ? 'ready' : 'archived' })}>{project.status === 'archived' ? 'Restore' : 'Archive'}</Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(project)}>Delete</Button>
      </div>
    </header>
    <div className="builder-mobile-tabs" style={{ gap: 6, padding: 8, borderBottom: `1px solid ${C.border}` }}>{['preview', 'files', 'code', 'history'].map((tab) => <Button key={tab} size="sm" variant={mobileTab === tab ? 'secondary' : 'ghost'} onClick={() => setMobileTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</Button>)}</div>
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <FileExplorer project={project} activePath={activePath} dirtyPath={hasUnsavedChanges ? activePath : null} onSelect={selectFile} onAdd={addFile} onDelete={deleteFile} onRename={renameFile} activeOnMobile={mobileTab === 'files'} />
      <div className={`builder-main-grid${mobileTab === 'files' || mobileTab === 'history' ? ' builder-main-inactive' : ''}`} style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: showCode ? 'minmax(360px, 1.65fr) minmax(280px, .8fr)' : 'minmax(0, 1fr)', minHeight: 0 }}>
        <section className="builder-editor-panel" style={{ '--builder-editor-display': mobileTab === 'code' ? 'flex' : 'none', borderLeft: `1px solid ${C.border}`, minWidth: 0, display: showCode ? 'flex' : 'none', flexDirection: 'column', order: 2 }}>
          <div style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: C.t2, font: '12px ui-monospace, monospace' }}>{activeFile?.path}{hasUnsavedChanges && <span aria-label="Unsaved changes" style={{ color: C.accent }}> · unsaved</span>}</span><span style={{ display: 'flex', gap: 5 }}><Button size="sm" variant="ghost" onClick={copyActiveFile}>Copy</Button><Button size="sm" variant="secondary" onClick={saveFile} disabled={!activeFile || !hasUnsavedChanges || isLargeFile}>Save file</Button></span></div>
          {isLargeFile && <p role="status" style={{ margin: 0, padding: '8px 12px', color: C.yellow, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>This file exceeds the safe editor size limit and is read-only.</p>}
          <textarea aria-label={`Edit ${activeFile?.path || 'project file'}`} value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={isLargeFile} spellCheck={false} style={{ flex: 1, width: '100%', minHeight: 180, border: 'none', outline: 'none', resize: 'none', padding: 14, background: '#06060b', color: '#e8e8f8', font: '12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace' }} />
        </section>
        <section ref={previewHost} className="builder-preview-panel" style={{ '--builder-preview-display': mobileTab === 'preview' ? 'flex' : 'none', minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', background: C.bg, order: 1 }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><div><strong style={{ color: C.t1, fontSize: 13 }}>Website preview</strong><span style={{ color: C.t3, fontSize: 12 }}> · {displayedPreviewPath}</span></div><span role="status" style={{ color: project.preview?.status === 'error' ? C.red : project.preview?.status === 'building' ? C.accent : C.green, fontSize: 11 }}>{previewLabel}</span><div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}><span style={{ color: C.t3, fontSize: 11 }}>Scroll inside preview</span><select aria-label="Preview viewport" value={previewDevice} onChange={(event) => setPreviewDevice(event.target.value)} style={{ color: C.t2, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, font: '12px inherit', padding: 4 }}><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select><select aria-label="Preview page" value={displayedPreviewPath} onChange={(event) => setPreviewPath(event.target.value)} style={{ color: C.t2, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, font: '12px inherit', padding: 4 }}>{previewPages.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select><Button size="sm" variant="ghost" onClick={retryPreview} aria-label="Refresh preview">↻</Button><Button size="sm" variant="ghost" onClick={expandPreview} aria-label="Expand preview">⛶</Button></div></div>
          {project.preview?.status === 'error' && <div role="alert" style={{ margin: '10px 12px 0', padding: 11, border: `1px solid ${C.red}55`, borderRadius: 9, background: '#261116', color: C.t2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><strong style={{ color: C.t1, fontSize: 12 }}>{showingFallback ? 'Showing your last working preview' : 'This version needs attention'}</strong><span style={{ display: 'block', fontSize: 12, marginTop: 3 }}>{project.preview?.lastError || 'The current version could not render safely.'}</span></div><span style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="secondary" onClick={retryPreview}>Retry</Button><Button size="sm" onClick={repairPreview} disabled={busy || editing}>{editing ? <Spinner size={13} color="#fff" /> : 'Repair with AI'}</Button></span></div>}
          <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center', background: C.surf }}><Input aria-label="Refine the website" value={changeRequest} onChange={(event) => setChangeRequest(event.target.value)} placeholder="Refine the website: make the hero more confident, add a product workflow…" onKeyDown={(event) => event.key === 'Enter' && applyChange()} /><Button size="sm" onClick={() => applyChange()} disabled={busy || editing || !changeRequest.trim()}>{editing ? <Spinner size={13} color="#fff" /> : 'Refine'}</Button></div>
          <div aria-label="Website preview canvas" style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: previewDevice === 'desktop' ? 10 : 16, display: 'flex', justifyContent: 'center', alignItems: 'stretch', background: '#06060b', boxSizing: 'border-box' }}><div style={{ width: previewWidth, maxWidth: '100%', height: '100%', minHeight: 0, flex: previewDevice === 'desktop' ? '1 1 auto' : '0 1 auto', overflow: 'hidden', background: '#fff', borderRadius: previewDevice === 'desktop' ? 10 : 14, boxShadow: '0 12px 32px rgba(0,0,0,.28)' }}><PreviewPanel project={previewProject} previewPath={displayedPreviewPath} onNavigate={onNavigate} onReady={onPreviewReady} onRuntimeError={onRuntimeError} renderKey={`${showingFallback ? project.preview?.lastSuccessfulVersionId : project.currentVersionId || 'draft'}-${displayedPreviewPath}-${previewKey}`} /></div></div>
        </section>
      </div>
      <aside className={`builder-history-panel${mobileTab === 'history' ? ' builder-history-active' : ''}`} style={{ width: 184, borderLeft: `1px solid ${C.border}`, overflow: 'auto', flexShrink: 0 }}>
        <div style={{ padding: 12, borderBottom: `1px solid ${C.border}` }}><strong style={{ fontSize: 12 }}>Validation</strong><p style={{ color: validate.valid ? C.green : C.red, fontSize: 12, lineHeight: 1.4, marginBottom: 0 }}>{validate.valid ? 'Project structure is valid.' : validate.issues[0]?.message}</p></div>
        <div style={{ padding: 12 }}><strong style={{ fontSize: 12 }}>Version history</strong><div style={{ display: 'grid', gap: 5, marginTop: 10 }}>{[...(project.versions || [])].reverse().map((version) => <button type="button" key={version.id} onClick={() => restore(version.id)} style={{ textAlign: 'left', padding: 8, background: version.id === project.currentVersionId ? C.accentM : 'transparent', border: `1px solid ${version.id === project.currentVersionId ? C.borderFocus : C.border}`, borderRadius: 7, color: C.t2, cursor: 'pointer', font: 'inherit', fontSize: 11 }}><span style={{ display: 'block', color: C.t1 }}>{version.summary}</span><span style={{ display: 'block', color: C.t3, marginTop: 3 }}>{version.origin} · {compactDate(version.createdAt)}</span>{version.changedPaths?.length > 0 && <span style={{ display: 'block', color: C.t3, marginTop: 3, fontFamily: 'ui-monospace, monospace' }}>{version.changedPaths.slice(0, 2).join(', ')}{version.changedPaths.length > 2 ? ` +${version.changedPaths.length - 2}` : ''}</span>}</button>)}</div></div>
      </aside>
    </div>
    <ActivityPanel project={project} />
  </div>
}

export function BuilderWorkspace({ user }) {
  const [projects, setProjects] = useState([])
  const [activeProject, setActiveProject] = useState(null)
  const [brief, setBrief] = useState('')
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [activity, setActivity] = useState([])
  const controller = useRef(null)
  const inFlight = useRef(false)

  const reload = useCallback(async () => {
    try {
      const records = await builderProjectRepository.list(user?.id)
      setProjects(records.filter((project) => project.status !== 'archived'))
    } catch {
      toast('Builder projects could not be loaded. Your other workspace data is unaffected.', 'error')
    }
  }, [user?.id])
  useEffect(() => { reload() }, [reload])
  useEffect(() => () => controller.current?.abort(), [])

  const persist = useCallback(async (project) => {
    const result = await builderProjectRepository.save(project, user?.id)
    if (!result.saved) {
      toast(result.locallyRecovered ? 'Saved on this device. Cloud sync will retry when available.' : 'Project could not be saved. Your current version remains open.', 'error')
    }
    setActiveProject(result.project || project)
    await reload()
    return result
  }, [reload, user?.id])

  const cancel = () => controller.current?.abort()
  const planProject = async () => {
    if (!brief.trim() || inFlight.current) return
    inFlight.current = true; setBusy(true); controller.current = new AbortController()
    try {
      const result = await builderGenerationService.plan({ brief: brief.trim(), signal: controller.current.signal })
      setPlan({ ...result.plan, provider: result.provider, model: result.model })
    } catch (error) { const failure = safeProjectError(error); toast(`${failure.message} Reference: ${failure.reference}`, 'error') } finally { inFlight.current = false; setBusy(false); controller.current = null }
  }
  const buildProject = async () => {
    if (!brief.trim() || !plan || inFlight.current) return
    inFlight.current = true; setBusy(true); setActivity([]); controller.current = new AbortController()
    try {
      const project = await builderGenerationService.generate({ brief: brief.trim(), plan, ownerId: user?.id, signal: controller.current.signal, onActivity: (entry) => setActivity((current) => [...current, entry]) })
      const result = await persist(project)
      setActiveProject(result.project || project); setPlan(null); setBrief('')
      toast(result.saved ? 'Project saved. Building the isolated preview…' : 'Project built and retained locally; cloud saving needs attention.', result.saved ? 'success' : 'error')
    } catch (error) {
      const failure = safeProjectError(error)
      toast(failure.code === 'CANCELLED' ? 'Generation cancelled. No partial files were saved.' : `${failure.message} Reference: ${failure.reference}`, 'error')
    } finally { inFlight.current = false; setBusy(false); controller.current = null }
  }
  const blank = async () => {
    if (busy) return
    const project = createBlankProject(user?.id)
    await persist(project); setActiveProject(project)
  }
  const createNew = () => { setActiveProject(null); setPlan(null); setBrief('') }
  const remove = async (project) => {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return
    const result = await builderProjectRepository.remove(project.id, user?.id)
    if (!result.saved) return toast('Project deletion could not be synced. Please retry.', 'error')
    if (activeProject?.id === project.id) setActiveProject(null)
    await reload(); toast('Project deleted.', 'success')
  }
  const archive = async (project) => { await persist({ ...project, updatedAt: new Date().toISOString() }) }
  const duplicate = async () => {
    const result = await builderProjectRepository.duplicate(activeProject, user?.id)
    setActiveProject(result.project || activeProject)
    await reload()
    toast(result.saved ? 'Project duplicated into a new versioned workspace.' : 'Duplicate is retained locally but could not be saved to your workspace.', result.saved ? 'success' : 'error')
  }
  const visibleProject = activeProject && { ...activeProject, generationHistory: [...(activeProject.generationHistory || []), ...activity] }

  if (visibleProject) return <div style={{ height: '100vh', maxHeight: '100dvh', minHeight: 0 }}><BuilderWorkspaceView project={visibleProject} projects={projects} onSelectProject={setActiveProject} onCreateProject={createNew} onProjectChange={setActiveProject} onSave={persist} onDelete={remove} onArchive={archive} onDuplicate={duplicate} busy={busy} onCancel={cancel} /></div>
  if (plan) return <BuilderPlan plan={plan} onChange={setPlan} onBuild={buildProject} onBack={() => setPlan(null)} onCancel={cancel} busy={busy} activity={activity} />
  return <BuilderStart brief={brief} onBriefChange={setBrief} onPlan={planProject} onBlank={blank} busy={busy} projects={projects} />
}
