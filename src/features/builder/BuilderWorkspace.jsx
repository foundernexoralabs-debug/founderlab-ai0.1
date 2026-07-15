import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../app/theme.js'
import { toast } from '../../app/toast.jsx'
import { Badge, Button, EmptyState, Input, Spinner } from '../../components/ui/Primitives.jsx'
import { uid } from '../../lib/ids.js'
import { builderGenerationService, BuilderGenerationError } from './builderGeneration.js'
import { createBuilderProject, BUILDER_ENTRY_FILE } from './builderProjectSchema.js'
import { builderProjectRepository } from './builderProjectRepository.js'
import { buildBuilderPreviewDocument, BUILDER_PREVIEW_SANDBOX, isSafeBuilderPreviewMessage } from './builderPreview.js'
import { validateBuilderFiles } from './builderValidation.js'
import { appendBuilderVersion, restoreBuilderVersion } from './builderVersions.js'

const EXAMPLES = [
  'A polished landing page for a founder-focused accounting service with a calm, trustworthy visual style.',
  'A responsive portfolio for a product designer, with selected work, case studies, and a contact section.',
  'A waitlist website for an AI meeting-notes product aimed at small startup teams.',
]

function safeProjectError(error) {
  const message = error?.message || 'FounderLab could not complete this Builder operation.'
  return { code: error?.code || 'BUILDER_OPERATION_FAILED', message, retryable: error?.retryable !== false, at: new Date().toISOString() }
}

function projectStatus(project) {
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
    preview: { status: validation.valid ? 'ready' : 'error', lastSuccessfulVersionId: null, lastSuccessfulAt: validation.valid ? now : null, lastError: null },
  }, { files: validation.files, origin: 'manual-edit', summary: 'Created blank project', validation: { valid: validation.valid, issues: validation.issues, checkedAt: now }, changedPaths: validation.files.map((file) => file.path), now })
  project.preview.lastSuccessfulVersionId = project.currentVersionId
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
    <textarea id="builder-brief" aria-describedby="builder-brief-help" value={brief} maxLength={100000} onChange={(event) => onBriefChange(event.target.value)} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onPlan()
    }} placeholder="For example: A premium landing page for a fractional CFO service for seed-stage founders…" rows={6} disabled={busy} style={{ width: '100%', marginTop: 8, padding: 16, color: C.t1, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 12, resize: 'vertical', font: 'inherit', lineHeight: 1.55, outline: 'none' }} />
    <p id="builder-brief-help" style={{ color: C.t3, fontSize: 12, margin: '8px 0 14px' }}>Include users, goal, pages, brand, visual direction, or functionality if they matter. FounderLab will infer the rest. Press ⌘/Ctrl + Enter to plan. {brief.length.toLocaleString()}/100,000 characters.</p>
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

function ProjectList({ projects, selectedId, onSelect, onCreate, query, onQuery }) {
  return <aside className="builder-project-list" aria-label="Builder projects" style={{ width: 230, borderRight: `1px solid ${C.border}`, padding: 12, overflow: 'auto', flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><strong style={{ fontSize: 13 }}>Projects</strong><Button size="sm" onClick={onCreate}>New</Button></div>
    <input aria-label="Search Builder projects" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search projects" style={{ margin: '12px 0', width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.t1, padding: '7px 8px', font: 'inherit', fontSize: 12 }} />
    <div style={{ display: 'grid', gap: 5 }}>{projects.map((project) => <button type="button" key={project.id} onClick={() => onSelect(project)} style={{ textAlign: 'left', border: `1px solid ${selectedId === project.id ? C.borderFocus : 'transparent'}`, background: selectedId === project.id ? C.accentM : 'transparent', borderRadius: 8, color: selectedId === project.id ? C.t1 : C.t2, padding: 9, cursor: 'pointer', font: 'inherit' }}><span style={{ display: 'block', fontSize: 12, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{project.name}</span><span style={{ display: 'block', color: C.t3, fontSize: 10, marginTop: 4 }}>{compactDate(project.updatedAt)}</span></button>)}</div>
  </aside>
}

function FileExplorer({ project, activePath, onSelect, onAdd, onDelete, activeOnMobile = false }) {
  return <div className={`builder-file-panel${activeOnMobile ? ' builder-file-active' : ''}`} style={{ width: 210, minWidth: 150, maxWidth: 320, resize: 'horizontal', overflow: 'auto', borderRight: `1px solid ${C.border}`, padding: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}><strong style={{ fontSize: 12 }}>Files</strong><span style={{ display: 'flex', gap: 2 }}><Button size="sm" variant="ghost" onClick={onAdd}>+</Button>{activePath !== BUILDER_ENTRY_FILE && <Button size="sm" variant="ghost" onClick={() => onDelete(activePath)}>−</Button>}</span></div>
    <div style={{ display: 'grid', gap: 3, marginTop: 10 }}>{project.files.map((file) => <button key={file.path} type="button" onClick={() => onSelect(file.path)} style={{ textAlign: 'left', background: file.path === activePath ? C.accentM : 'transparent', border: `1px solid ${file.path === activePath ? C.borderFocus : 'transparent'}`, color: file.path === activePath ? C.t1 : C.t2, borderRadius: 6, padding: '7px 8px', cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 }}>{file.path}</button>)}</div>
  </div>
}

function PreviewPanel({ project, previewPath, onNavigate, onRuntimeError }) {
  const frame = useRef(null)
  const preview = useMemo(() => buildBuilderPreviewDocument(project.files, { entryFile: previewPath }), [project.files, previewPath])
  useEffect(() => {
    const listen = (event) => {
      if (!isSafeBuilderPreviewMessage(event, frame.current?.contentWindow)) return
      if (event.data.type === 'navigate') onNavigate(event.data.detail?.path)
      if (event.data.type === 'runtime-error') onRuntimeError()
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [onNavigate, onRuntimeError])
  if (!preview.ok) return <div style={{ padding: 20 }}><EmptyState icon="⚠" title="Preview needs attention" description={preview.validation.issues[0]?.message || 'Fix the validation issues before previewing this project.'} /></div>
  return <iframe ref={frame} srcDoc={preview.srcDoc} title="Builder live preview" sandbox={BUILDER_PREVIEW_SANDBOX} referrerPolicy="no-referrer" style={{ display: 'block', width: '100%', height: '100%', border: 'none', background: '#fff' }} />
}

function ActivityPanel({ project }) {
  const activity = [...(project.generationHistory || []), ...(project.changeHistory || [])].slice(-8).reverse()
  return <section style={{ borderTop: `1px solid ${C.border}`, padding: 12, maxHeight: 145, overflow: 'auto' }}><strong style={{ fontSize: 11, color: C.t3, letterSpacing: '.07em', textTransform: 'uppercase' }}>Activity</strong>{activity.length ? <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>{activity.map((item) => <div key={item.id || `${item.at}-${item.message}`} style={{ fontSize: 12, color: C.t2 }}><span style={{ color: C.accent, marginRight: 7 }}>{item.stage}</span>{item.message}</div>)}</div> : <p style={{ color: C.t3, fontSize: 12 }}>No project activity yet.</p>}</section>
}

function BuilderWorkspaceView({ project, onProjectChange, onSave, onDelete, onArchive, onDuplicate, busy, onCancel }) {
  const [activePath, setActivePath] = useState(project.settings?.previewPath || BUILDER_ENTRY_FILE)
  const [previewPath, setPreviewPath] = useState(project.settings?.previewPath || BUILDER_ENTRY_FILE)
  const [draft, setDraft] = useState(() => project.files.find((file) => file.path === activePath)?.content || '')
  const [changeRequest, setChangeRequest] = useState('')
  const [editing, setEditing] = useState(false)
  const [mobileTab, setMobileTab] = useState('preview')

  useEffect(() => {
    const file = project.files.find((entry) => entry.path === activePath) || project.files[0]
    if (file && file.path !== activePath) setActivePath(file.path)
    setDraft(file?.content || '')
  }, [project, activePath])

  const activeFile = project.files.find((file) => file.path === activePath) || project.files[0]
  const saveFile = () => {
    if (!activeFile || draft === activeFile.content) return
    const files = project.files.map((file) => file.path === activeFile.path ? { ...file, content: draft.replace(/\r\n?/g, '\n'), state: 'edited', updatedAt: new Date().toISOString() } : file)
    const validation = validateBuilderFiles(files)
    if (!validation.valid) {
      toast(validation.issues[0].message, 'error')
      return
    }
    const now = new Date().toISOString()
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now }, status: 'ready', preview: { ...project.preview, status: 'ready', lastError: null } }, { files: validation.files, origin: 'manual-edit', summary: `Edited ${activeFile.path}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: [activeFile.path], now })
    updated.preview.lastSuccessfulVersionId = updated.currentVersionId
    updated.preview.lastSuccessfulAt = now
    onProjectChange(updated)
    onSave(updated)
  }
  const addFile = () => {
    const path = window.prompt('New file path (pages/name.html or assets/name.json)')
    if (!path) return
    if (!/^(pages\/[a-z0-9][a-z0-9._-]*\.html|assets\/[a-z0-9][a-z0-9._/-]*)$/i.test(path)) {
      toast('Use pages/name.html or assets/name.json (or .svg).', 'error')
      return
    }
    if (project.files.some((file) => file.path === path)) return toast('A file already uses that path.', 'error')
    const now = new Date().toISOString()
    const file = { path, content: path.endsWith('.html') ? '<main>New page</main>' : '{}', role: 'source', state: 'edited', createdAt: now, updatedAt: now }
    const validation = validateBuilderFiles([...project.files, file])
    if (!validation.valid) return toast(validation.issues[0].message, 'error')
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now } }, { files: validation.files, origin: 'manual-edit', summary: `Added ${path}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: [path], now })
    onProjectChange(updated); onSave(updated); setActivePath(path)
  }
  const deleteFile = (path) => {
    if (path === BUILDER_ENTRY_FILE) return toast('index.html is required for every Builder project.', 'error')
    if (!window.confirm(`Delete ${path}? A recoverable version will remain in history.`)) return
    const now = new Date().toISOString()
    const files = project.files.filter((file) => file.path !== path)
    const validation = validateBuilderFiles(files)
    if (!validation.valid) return toast(validation.issues[0].message, 'error')
    const updated = appendBuilderVersion({ ...project, files: validation.files, validation: { valid: true, issues: validation.issues, checkedAt: now } }, { files: validation.files, origin: 'manual-edit', summary: `Deleted ${path}`, validation: { valid: true, issues: validation.issues, checkedAt: now }, changedPaths: [path], now })
    onProjectChange(updated); onSave(updated); setActivePath(BUILDER_ENTRY_FILE)
  }
  const restore = (versionId) => {
    const result = restoreBuilderVersion(project, versionId)
    if (!result.restored) return
    result.project.preview = { ...result.project.preview, status: 'ready', lastSuccessfulVersionId: result.project.currentVersionId, lastSuccessfulAt: new Date().toISOString(), lastError: null }
    onProjectChange(result.project); onSave(result.project)
  }
  const applyChange = async () => {
    if (!changeRequest.trim() || busy) return
    if (changeRequest.length > 60000) return toast('Keep a scoped edit request under 60,000 characters so FounderLab can validate it safely.', 'error')
    setEditing(true)
    try {
      const updated = await builderGenerationService.applyEdit({ project, request: changeRequest.trim(), selectedPath: activePath, onActivity: () => {} })
      onProjectChange(updated)
      await onSave(updated)
      setChangeRequest('')
      toast('Change applied in a new recoverable version.', 'success')
    } catch (error) {
      toast(safeProjectError(error).message, 'error')
    } finally { setEditing(false) }
  }
  const validate = validateBuilderFiles(project.files)
  const status = projectStatus(project)
  const onNavigate = useCallback((path) => {
    if (project.files.some((file) => file.path === path && file.path.endsWith('.html'))) setPreviewPath(path)
  }, [project.files])
  const onRuntimeError = useCallback(() => {
    onProjectChange({ ...project, preview: { ...project.preview, status: 'error', lastError: 'The isolated preview reported a runtime error.' } })
  }, [onProjectChange, project])

  return <div className="builder-workspace" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <style>{`@media (max-width: 760px){.builder-project-list,.builder-file-panel,.builder-history-panel{display:none!important}.builder-file-panel.builder-file-active,.builder-history-panel.builder-history-active{display:block!important;width:100%!important;max-width:none!important;border-left:none!important;border-right:none!important}.builder-mobile-tabs{display:flex!important}.builder-main-grid{grid-template-columns:1fr!important}.builder-main-grid.builder-main-inactive{display:none!important}.builder-editor-panel{display:var(--builder-editor-display,none)}.builder-preview-panel{display:var(--builder-preview-display,none)}}@media (min-width: 761px){.builder-mobile-tabs{display:none!important}}`}</style>
    <header style={{ padding: '13px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <input aria-label="Project name" value={project.name} onChange={(event) => onProjectChange({ ...project, name: event.target.value, updatedAt: new Date().toISOString() })} onBlur={(event) => { const updated = { ...project, name: event.target.value, updatedAt: new Date().toISOString() }; onProjectChange(updated); onSave(updated) }} style={{ background: 'transparent', border: 'none', color: C.t1, fontSize: 17, fontWeight: 700, minWidth: 190, outline: 'none' }} />
      <Badge color={status.color}>{status.label}</Badge>
      <span style={{ color: C.t3, fontSize: 12 }}>{project.validation?.valid ? 'Saved project checks passed' : 'Validation needs attention'}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {(busy || editing) && <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button variant="secondary" size="sm" onClick={onDuplicate}>Duplicate</Button>
        <Button variant="secondary" size="sm" onClick={() => onArchive({ ...project, status: project.status === 'archived' ? 'ready' : 'archived' })}>{project.status === 'archived' ? 'Restore' : 'Archive'}</Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(project)}>Delete</Button>
      </div>
    </header>
    <div className="builder-mobile-tabs" style={{ gap: 6, padding: 8, borderBottom: `1px solid ${C.border}` }}>{['files', 'editor', 'preview', 'history'].map((tab) => <Button key={tab} size="sm" variant={mobileTab === tab ? 'secondary' : 'ghost'} onClick={() => setMobileTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</Button>)}</div>
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <FileExplorer project={project} activePath={activePath} onSelect={setActivePath} onAdd={addFile} onDelete={deleteFile} activeOnMobile={mobileTab === 'files'} />
      <div className={`builder-main-grid${mobileTab === 'files' || mobileTab === 'history' ? ' builder-main-inactive' : ''}`} style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(270px, .9fr) minmax(340px, 1.1fr)', minHeight: 0 }}>
        <section className="builder-editor-panel" style={{ '--builder-editor-display': mobileTab === 'editor' ? 'flex' : 'none', borderRight: `1px solid ${C.border}`, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: C.t2, font: '12px ui-monospace, monospace' }}>{activeFile?.path}</span><Button size="sm" variant="secondary" onClick={saveFile} disabled={!activeFile || draft === activeFile.content}>Save file</Button></div>
          <textarea aria-label={`Edit ${activeFile?.path || 'project file'}`} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} style={{ flex: 1, width: '100%', minHeight: 180, border: 'none', outline: 'none', resize: 'none', padding: 14, background: '#06060b', color: '#e8e8f8', font: '12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace' }} />
          <div style={{ borderTop: `1px solid ${C.border}`, padding: 10 }}><label style={{ display: 'block', color: C.t3, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>REQUEST A SCOPED CHANGE</label><div style={{ display: 'flex', gap: 7 }}><Input value={changeRequest} onChange={(event) => setChangeRequest(event.target.value)} placeholder="Make this heading more direct…" onKeyDown={(event) => event.key === 'Enter' && applyChange()} /><Button size="sm" onClick={applyChange} disabled={busy || editing || !changeRequest.trim()}>{editing ? <Spinner size={13} color="#fff" /> : 'Apply'}</Button></div></div>
        </section>
        <section className="builder-preview-panel" style={{ '--builder-preview-display': mobileTab === 'preview' ? 'flex' : 'none', minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ padding: '9px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}><span style={{ color: C.t2, fontSize: 12 }}>Live preview · {previewPath}</span><select aria-label="Preview page" value={previewPath} onChange={(event) => setPreviewPath(event.target.value)} style={{ color: C.t2, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, font: '12px inherit', padding: 4 }}>{project.files.filter((file) => file.path.endsWith('.html')).map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></div>
          <div style={{ flex: 1, minHeight: 0 }}>{<PreviewPanel project={project} previewPath={previewPath} onNavigate={onNavigate} onRuntimeError={onRuntimeError} />}</div>
        </section>
      </div>
      <aside className={`builder-history-panel${mobileTab === 'history' ? ' builder-history-active' : ''}`} style={{ width: 205, borderLeft: `1px solid ${C.border}`, overflow: 'auto', flexShrink: 0 }}>
        <div style={{ padding: 12, borderBottom: `1px solid ${C.border}` }}><strong style={{ fontSize: 12 }}>Validation</strong><p style={{ color: validate.valid ? C.green : C.red, fontSize: 12, lineHeight: 1.4, marginBottom: 0 }}>{validate.valid ? 'Project structure is valid.' : validate.issues[0]?.message}</p></div>
        <div style={{ padding: 12 }}><strong style={{ fontSize: 12 }}>Version history</strong><div style={{ display: 'grid', gap: 5, marginTop: 10 }}>{[...(project.versions || [])].reverse().map((version) => <button type="button" key={version.id} onClick={() => restore(version.id)} style={{ textAlign: 'left', padding: 8, background: version.id === project.currentVersionId ? C.accentM : 'transparent', border: `1px solid ${version.id === project.currentVersionId ? C.borderFocus : C.border}`, borderRadius: 7, color: C.t2, cursor: 'pointer', font: 'inherit', fontSize: 11 }}><span style={{ display: 'block', color: C.t1 }}>{version.summary}</span><span style={{ display: 'block', color: C.t3, marginTop: 3 }}>{version.origin} · {compactDate(version.createdAt)}</span></button>)}</div></div>
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
  const [search, setSearch] = useState('')
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
    } catch (error) { toast(safeProjectError(error).message, 'error') } finally { inFlight.current = false; setBusy(false); controller.current = null }
  }
  const buildProject = async () => {
    if (!brief.trim() || !plan || inFlight.current) return
    inFlight.current = true; setBusy(true); setActivity([]); controller.current = new AbortController()
    try {
      const project = await builderGenerationService.generate({ brief: brief.trim(), plan, ownerId: user?.id, signal: controller.current.signal, onActivity: (entry) => setActivity((current) => [...current, entry]) })
      const result = await persist(project)
      setActiveProject(result.project || project); setPlan(null); setBrief('')
      toast(result.saved ? 'Your Builder project is ready.' : 'Project built and retained locally; cloud saving needs attention.', result.saved ? 'success' : 'error')
    } catch (error) {
      const failure = safeProjectError(error)
      toast(failure.code === 'CANCELLED' ? 'Generation cancelled. No partial files were saved.' : failure.message, 'error')
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
  const filtered = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()))
  const visibleProject = activeProject && { ...activeProject, generationHistory: [...(activeProject.generationHistory || []), ...activity] }

  if (visibleProject) return <div style={{ height: '100%', minHeight: 0, display: 'flex' }}><ProjectList projects={filtered} selectedId={visibleProject.id} onSelect={setActiveProject} onCreate={createNew} query={search} onQuery={setSearch} /><div style={{ flex: 1, minWidth: 0 }}><BuilderWorkspaceView project={visibleProject} onProjectChange={setActiveProject} onSave={persist} onDelete={remove} onArchive={archive} onDuplicate={duplicate} busy={busy} onCancel={cancel} /></div></div>
  if (plan) return <BuilderPlan plan={plan} onChange={setPlan} onBuild={buildProject} onBack={() => setPlan(null)} onCancel={cancel} busy={busy} activity={activity} />
  return <BuilderStart brief={brief} onBriefChange={setBrief} onPlan={planProject} onBlank={blank} busy={busy} projects={projects} />
}
