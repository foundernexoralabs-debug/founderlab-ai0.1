// ============================================================
// FOUNDERLAB AI — Application shell
// Feature views, services, hooks, and UI primitives are composed here.
// ============================================================
import React, { useState, useEffect, useRef } from 'react'
import VoiceSpeedSelector from '@/components/settings/VoiceSpeedSelector'
import { zipSupported, createZip, readZip, downloadBlob } from '@/lib/zip'
import { detectLanguage, detectFromDescription } from '@/lib/langDetect'
import { parseFiles, isPreviewable, buildPreviewDoc } from '@/lib/codeFiles'
import { downloadProjectZip, pushToGithub as pushToGithubShared, openVercelDeploy } from '@/lib/deploy'
import { classifyEdit, extractSection, replaceSection, KNOWN_SECTIONS } from '@/lib/htmlSections'
import { REQUIRED_PAGES, REQUIRED_COMPONENTS, CONFIG_FILES, classifyProjectEdit } from '@/lib/nextProjectSpec'
import { buildProjectPreview, isPreviewableProject } from '@/lib/previewBundle'
import { GENERATED_PREVIEW_REFERRER_POLICY, GENERATED_PREVIEW_SANDBOX } from '@/lib/previewSecurity'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { C } from '@/app/theme'
import { ToastContainer, toast } from '@/app/toast'
import { renderMsg } from '@/components/content/MessageContent'
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@/components/ui/Primitives'
import { Sidebar } from '@/features/navigation/Navigation'
import { AuthScreen, OnboardingModal, SetupScreen } from '@/features/auth/AuthScreens'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { BuilderWorkspace } from '@/features/builder/BuilderWorkspace'
import { FeedbackModal } from '@/features/feedback/FeedbackModal'
import { OllamaProviderPanel } from '@/features/settings/OllamaProviderPanel'
import { fileToBase64, ACCEPTED_IMAGE_TYPES } from '@/lib/files'
import { copyText, flConsumeHandoff, flNavigate, fmtDate, ts, uid } from '@/lib/appUtils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTextToSpeech } from '@/hooks/useTextToSpeech'
import { getVoiceConfig, persistVoiceConfig } from '@/services/voicePreferences'
import { clearGithubToken, getGithubToken, setGithubToken } from '@/services/githubTokenSession'
import { authenticatedFetch } from '@/services/authenticatedFetch'
import { getProvider } from '@/ai/providerRegistry'
import { getProviderConfigurationState } from '@/ai/providerAvailability'
import {
  getProviderConnectionState,
  getProviderConnectionStatuses,
  setProviderConnectionStatus,
  subscribeProviderConnectionStatuses,
} from '@/ai/providerConnectionState'
import {
  ai,
  getAIProvider,
  getProviderAvailability,
  getProviderModel,
  PROVIDERS,
  createProviderConnectionTestRequest,
  requestAIResult,
  refreshProviderAvailability,
  setAIProvider as setAIProviderLS,
  setProviderModel,
} from '@/services/aiProviderService'
import {
  isWorkspaceConfigured as CONFIGURED,
  loadWorkspaceData as load,
  migrateLocalWorkspaceToCloud as migrateLocalToCloud,
  saveWorkspaceData as save,
  workspaceStore as sb,
} from '@/services/workspaceStore'

function GlobalStyles() {
  useEffect(() => {
    const el = document.createElement('style')
    el.id = 'fl-gs'
    el.textContent = `*,*::before,*::after{box-sizing:border-box}body{margin:0;background:${C.bg};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;color:${C.t1}}@keyframes flSpin{to{transform:rotate(360deg)}}@keyframes flSlide{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes flPulse{0%,60%,100%{opacity:.3;transform:scale(.8)}30%{opacity:1;transform:scale(1)}}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.surfHigh};border-radius:2px}input:-webkit-autofill,input:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 1000px ${C.surf} inset!important;-webkit-text-fill-color:${C.t1}!important}select option{background:${C.surf};color:${C.t1}}`
    document.head.appendChild(el)
    return () => { try { document.head.removeChild(el) } catch {} }
  }, [])
  return null
}

// ── AI CHAT ──────────────────────────────────────────────────
const CHAT_SYS = `You are FounderLab AI — a sharp, practical assistant built for founders, developers, and creators.

Response style — keep this front of mind:
- **Be concise.** Default to short, direct answers. Match your length to the question — a quick question gets a quick answer, not an essay.
- Skip filler ("Great question!", "I'd be happy to help", "As an AI…"). Answer immediately.
- Structure only when it aids scanning: short paragraphs, or a bulleted list when there are ≥3 items, or a fenced code block for code. Don't force headings and bullets into short answers.
- Give complete, actionable answers within that concise frame — depth over length.
- Use **bold** for key terms, \`code\` for inline technical terms.
- Include specific numbers, examples, and real details rather than generic advice.
- Only give a long response when the question genuinely needs one (multi-step guide, detailed comparison, complex explanation the user asked for).
- Never say "I can't help with that" unless it involves genuinely harmful content.`
const STARTERS = [
  'Help me brainstorm a content strategy for my startup',
  'Review my business idea and give me brutally honest feedback',
  'Write a cold email to potential investors or clients',
  'Break down my biggest goal into actionable daily tasks',
]

function ChatPage({ user }) {
  const [convos, setConvos]         = useState([])
  const [activeId, setActiveId]     = useState(null)
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [loadingData, setLD]        = useState(true)
  const [renaming, setRenaming]     = useState(null)
  const [renameVal, setRenameVal]   = useState('')
  const [pendingImage, setPendingImage] = useState(null)
  const [search, setSearch]         = useState('')
  const [hoverId, setHoverId]       = useState(null)
  const [reactions, setReactions]   = useState({})   // msgId -> 'up' | 'down'
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [voiceCfg, setVoiceCfg]     = useState(getVoiceConfig())
  const [showTTSMenu, setShowTTSMenu] = useState(null) // msgId currently showing voice/speed picker
  const [errorMsg, setErrorMsg]     = useState(null)   // last real error, shown as recoverable banner

  const msgEnd     = useRef(null)
  const saveTimer  = useRef(null)
  const fileRef    = useRef(null)
  const abortRef   = useRef(null)
  const textRef    = useRef(null)

  const { listening, transcript, setTranscript, start: startReco, stop: stopReco } = useSpeechRecognition()
  const { speaking, speak, stop: stopTTS, elAvailable } = useTextToSpeech(voiceCfg)
  const [activeTTS, setActiveTTS] = useState(null)

  const active   = convos.find(c => c.id === activeId)
  const messages = active?.messages || []

  useEffect(() => {
    async function init() {
      setLD(true); sb.logEvent('chat', 'chat')
      const d = await load('fl_convos', [])
      const list = Array.isArray(d) ? d : []
      setConvos(list)
      const h = flConsumeHandoff('chat')
      if (h?.message) {
        const c = { id: uid(), title: h.message.slice(0,40), pinned:false, messages: [], created_at: ts(), updated_at: ts() }
        const updated = [c, ...list]
        setConvos(updated); save('fl_convos', updated)
        setActiveId(c.id)
        setInput(h.message)
        toast('Loaded from Code AI — review and press Enter to send', 'success')
      }
      setLD(false)
    }
    init()
  }, [])

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, sending])
  useEffect(() => { if (transcript) setInput(transcript) }, [transcript])

  // Persist voice config on change
  useEffect(() => { persistVoiceConfig(voiceCfg) }, [voiceCfg])

  // Auto-grow textarea
  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto'
      textRef.current.style.height = Math.min(200, textRef.current.scrollHeight) + 'px'
    }
  }, [input])

  function persist(updated) {
    setConvos(updated)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save('fl_convos', updated), 600)
  }

  function newConvo() {
    const c = { id: uid(), title: 'New Chat', pinned: false, messages: [], created_at: ts(), updated_at: ts() }
    persist([c, ...convos]); setActiveId(c.id); setErrorMsg(null)
  }

  function togglePin(id, e) {
    e.stopPropagation()
    persist(convos.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c))
  }

  async function handleImagePick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB', 'error'); return }
    const base64 = await fileToBase64(file)
    setPendingImage({ base64, name: file.name })
    e.target.value = ''
  }

  function stopGenerating() {
    abortRef.current = true
    setSending(false)
  }

  async function send(textOverride) {
    const t = (textOverride || input).trim()
    if ((!t && !pendingImage) || sending) return
    setInput(''); setTranscript(''); stopReco(); setErrorMsg(null)

    let cid = activeId
    let cvs = convos
    if (!cid) {
      const c = { id: uid(), title: t?.slice(0, 40) || 'Image', pinned: false, messages: [], created_at: ts(), updated_at: ts() }
      cvs = [c, ...convos]; cid = c.id; setActiveId(cid)
    }

    const userMsg = {
      id: uid(), role: 'user',
      content: t || (pendingImage ? `[Image: ${pendingImage.name}]` : ''),
      image: pendingImage?.base64 || null,
      ts: ts(),
    }
    setPendingImage(null)

    cvs = cvs.map(c => c.id === cid
      ? { ...c, messages: [...c.messages, userMsg], updated_at: ts(), title: c.messages.length === 0 && t ? t.slice(0, 40) : c.title }
      : c)
    cvs = [cvs.find(c => c.id === cid), ...cvs.filter(c => c.id !== cid)]
    persist(cvs); setSending(true)
    abortRef.current = false

    const provider = getAIProvider()
    const supportsImageInput = getProvider(provider)?.capabilities.imageInput === true
    const history = (cvs.find(c => c.id === cid)?.messages || []).map(m => ({
      role: m.role,
      content: m.content,
      ...(m.image && supportsImageInput ? { image: m.image } : {}),
      ...(m.image && !supportsImageInput ? { content: (m.content || '') + '\n[User attached an image — describe what you would expect in response]' } : {}),
    }))

    let reply
    try {
      reply = await ai(history, CHAT_SYS, 2000, { localOllamaAllowed: true })
      if (abortRef.current) { setSending(false); return }
      if (typeof reply === 'string' && reply.startsWith('⚠')) {
        setErrorMsg(reply.replace(/^⚠\s*/, ''))
        setSending(false); return
      }
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong. Try again.')
      setSending(false); return
    }
    const aiMsg = { id: uid(), role: 'assistant', content: reply, ts: ts() }
    const final = cvs.map(c => c.id === cid ? { ...c, messages: [...c.messages, aiMsg], updated_at: ts() } : c)
    persist(final); setSending(false)
  }

  async function regenerate(msgId) {
    if (!active || sending) return
    const idx = active.messages.findIndex(m => m.id === msgId)
    if (idx < 1) return
    const upToUser = active.messages.slice(0, idx)
    const trimmed = convos.map(c => c.id === activeId ? { ...c, messages: upToUser, updated_at: ts() } : c)
    persist(trimmed); setSending(true); abortRef.current = false; setErrorMsg(null)
    const provider = getAIProvider()
    const supportsImageInput = getProvider(provider)?.capabilities.imageInput === true
    const history = upToUser.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.image && supportsImageInput ? { image: m.image } : {}),
      ...(m.image && !supportsImageInput ? { content: (m.content || '') + '\n[User attached an image — describe what you would expect in response]' } : {}),
    }))
    let reply
    try {
      reply = await ai(history, CHAT_SYS, 2000, { localOllamaAllowed: true })
      if (abortRef.current) { setSending(false); return }
      if (typeof reply === 'string' && reply.startsWith('⚠')) {
        setErrorMsg(reply.replace(/^⚠\s*/, ''))
        setSending(false); return
      }
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong. Try again.')
      setSending(false); return
    }
    const aiMsg = { id: uid(), role: 'assistant', content: reply, ts: ts() }
    persist(trimmed.map(c => c.id === activeId ? { ...c, messages: [...c.messages, aiMsg], updated_at: ts() } : c))
    setSending(false)
  }

  async function saveToNotes(msg) {
    const notes = await load('fl_notes', [])
    const n = { id: uid(), title: (msg.content.slice(0,50) || 'Chat note'), content: msg.content, tags: ['from-chat'], created_at: ts(), updated_at: ts() }
    await save('fl_notes', [n, ...(Array.isArray(notes)?notes:[])])
    toast('Saved to Notes', 'success')
  }

  async function createTaskFromMsg(msg) {
    const tasks = await load('fl_tasks', [])
    const task = { id: uid(), title: msg.content.slice(0,80), status:'todo', priority:'medium', description: msg.content, due_date:'', created_at: ts(), updated_at: ts() }
    await save('fl_tasks', [task, ...(Array.isArray(tasks)?tasks:[])])
    toast('Task created', 'success')
  }

  async function handleMic() {
    if (listening) { stopReco(); return }
    // useSpeechRecognition.start() already runs getMicrophoneStream() internally
    // with the improved error-name mapping from src/lib/microphone.ts, so any
    // permission/hardware issue surfaces as a clear toast — no duplicate probe needed.
    startReco((finalText) => { setInput(finalText) })
  }

  function handleTTS(msg) {
    if (activeTTS === msg.id) { stopTTS(); setActiveTTS(null); setShowTTSMenu(null); return }
    setActiveTTS(msg.id)
    speak(msg.content)
    const check = setInterval(() => {
      if (!window.speechSynthesis?.speaking && !window.speechSynthesis?.pending) {
        setActiveTTS(null); clearInterval(check)
      }
    }, 400)
  }

  function reactToMsg(msgId, r) {
    setReactions(prev => ({ ...prev, [msgId]: prev[msgId] === r ? null : r }))
  }

  function del(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this chat?')) return
    persist(convos.filter(c => c.id !== id))
    if (activeId === id) setActiveId(null)
    toast('Chat deleted', 'success')
  }

  function delMsg(msgId) {
    if (!active) return
    persist(convos.map(c => c.id === activeId ? { ...c, messages: c.messages.filter(m => m.id !== msgId) } : c))
  }

  function startRename(c, e) { e.stopPropagation(); setRenaming(c.id); setRenameVal(c.title) }
  function commitRename(id) {
    if (!renameVal.trim()) { setRenaming(null); return }
    persist(convos.map(c => c.id === id ? { ...c, title: renameVal } : c)); setRenaming(null)
  }

  const filteredConvos = convos
    .filter(c => !search || (c.title||'').toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => (b.pinned?1:0) - (a.pinned?1:0) || new Date(b.updated_at) - new Date(a.updated_at))

  // ── Message action button (hover-revealed, uniform styling) ──
  function ActionBtn({ label, icon, onClick, active, danger }) {
    return (
      <button onClick={onClick} title={label} aria-label={label}
        style={{
          background: active ? C.accentM : 'transparent',
          border: `1px solid ${active ? C.borderFocus : 'transparent'}`,
          color: active ? C.accent : (danger ? C.t3 : C.t2),
          cursor: 'pointer',
          fontSize: 13,
          padding: '5px 8px',
          borderRadius: 6,
          fontFamily: 'inherit',
          transition: 'all .12s',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = C.surfHigh; e.currentTarget.style.color = C.t1 } }}
        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = danger ? C.t3 : C.t2 } }}>
        {icon}
      </button>
    )
  }

  // ── Waveform bars for the live-listening mic state ──
  const WaveformBars = () => (
    <div style={{ display:'flex', alignItems:'center', gap:2, height:14 }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{
          width:2, background:C.red, borderRadius:1,
          animation:`flWave 0.9s ease-in-out ${i*0.1}s infinite`,
        }} />
      ))}
    </div>
  )

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:C.bg }}>
      {/* ═══ Sidebar (collapsible) ═══ */}
      <div style={{
        width: sidebarOpen ? 260 : 0,
        borderRight: sidebarOpen ? `1px solid ${C.border}` : 'none',
        display:'flex', flexDirection:'column', flexShrink:0,
        overflow:'hidden',
        transition: 'width .22s ease',
        background: C.surf,
      }}>
        <div style={{ padding:14, borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:8 }}>
          <button onClick={newConvo}
            style={{
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              padding:'10px 12px', borderRadius:10,
              background: `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
              border:'none', color:'#fff', cursor:'pointer',
              fontSize:13, fontWeight:600, fontFamily:'inherit',
              boxShadow:'0 4px 14px rgba(99,102,241,.25)',
              transition:'transform .15s, box-shadow .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(99,102,241,.35)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(99,102,241,.25)' }}>
            <span style={{ fontSize:16 }}>+</span> New Chat
          </button>
          {convos.length > 4 && (
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search chats…"
              style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, color:C.t1, fontSize:12, padding:'8px 12px', fontFamily:'inherit', outline:'none', transition:'border-color .15s' }}
              onFocus={e => e.currentTarget.style.borderColor = C.borderFocus}
              onBlur={e => e.currentTarget.style.borderColor = C.border} />
          )}
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:8 }}>
          {loadingData
            ? <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner /></div>
            : filteredConvos.length === 0
              ? <div style={{ textAlign:'center', padding:'24px 12px', color:C.t3, fontSize:13 }}>{search?'No matches':'No chats yet'}</div>
              : filteredConvos.map(c => (
                <div key={c.id} onClick={() => { setActiveId(c.id); setErrorMsg(null) }}
                  style={{
                    padding:'9px 10px', borderRadius:10, cursor:'pointer', marginBottom:3,
                    background: activeId===c.id ? C.accentM : 'transparent',
                    border: `1px solid ${activeId===c.id?C.borderFocus:'transparent'}`,
                    display:'flex', alignItems:'center', gap:5,
                    transition:'all .12s',
                  }}
                  onMouseEnter={e => { if (activeId !== c.id) e.currentTarget.style.background = C.surfHigh }}
                  onMouseLeave={e => { if (activeId !== c.id) e.currentTarget.style.background = 'transparent' }}>
                  {c.pinned && <span style={{ fontSize:10, color:C.accent, flexShrink:0 }}>📌</span>}
                  {renaming === c.id
                    ? <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                        onBlur={() => commitRename(c.id)}
                        onKeyDown={e => { if (e.key==='Enter') commitRename(c.id); if (e.key==='Escape') setRenaming(null) }}
                        onClick={e => e.stopPropagation()}
                        style={{ flex:1, background:C.bg, border:`1px solid ${C.accent}`, borderRadius:6, padding:'3px 7px', color:C.t1, fontSize:13, outline:'none', fontFamily:'inherit' }} />
                    : <span style={{ flex:1, fontSize:13, color:activeId===c.id?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.title||'Untitled'}</span>
                  }
                  <button onClick={e => togglePin(c.id, e)} style={{ background:'none', border:'none', color:c.pinned?C.accent:C.t3, cursor:'pointer', fontSize:11, padding:2, fontFamily:'inherit' }} title={c.pinned?'Unpin':'Pin'}>📌</button>
                  <button onClick={e => startRename(c, e)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:11, padding:2, fontFamily:'inherit' }} title="Rename">✎</button>
                  <button onClick={e => del(c.id, e)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:16, padding:'0 2px', lineHeight:1 }} title="Delete">×</button>
                </div>
              ))
          }
        </div>
      </div>

      {/* ═══ Main: immersive chat surface ═══ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
        {/* Slim top bar */}
        <div style={{
          display:'flex', alignItems:'center', gap:10,
          padding:'12px 20px',
          borderBottom:`1px solid ${C.border}`,
          background: `${C.bg}dd`,
          backdropFilter:'blur(12px)',
          WebkitBackdropFilter:'blur(12px)',
          flexShrink:0,
          zIndex:2,
        }}>
          <button onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Hide chats' : 'Show chats'}
            style={{ background:'none', border:'none', color:C.t2, cursor:'pointer', fontSize:18, padding:4, fontFamily:'inherit' }}>
            ☰
          </button>
          <span style={{ fontSize:14, fontWeight:600, color:C.t1, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {active?.title || 'FounderLab AI'}
          </span>
          {elAvailable === true && (
            <span title="Premium voice available (ElevenLabs)"
              style={{ fontSize:10, color:C.green, background:'rgba(16,185,129,.1)', border:`1px solid rgba(16,185,129,.25)`, borderRadius:99, padding:'2px 8px', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
              ● Premium Voice
            </span>
          )}
        </div>

        {!activeId ? (
          /* ═══ Empty landing ═══ */
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:32, overflow:'auto' }}>
            <div style={{ textAlign:'center', marginBottom:36 }}>
              <div style={{
                width:56, height:56, margin:'0 auto 20px',
                background:`linear-gradient(135deg, ${C.accent}, #a855f7)`,
                borderRadius:'50%',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:24, color:'#fff',
                boxShadow:'0 8px 32px rgba(99,102,241,.35)',
                animation:'flFadeIn .5s ease',
              }}>✦</div>
              <h1 style={{
                margin:'0 0 8px', fontSize:28, fontWeight:700, letterSpacing:'-.02em',
                background: `linear-gradient(135deg, ${C.t1}, ${C.t2})`,
                WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
              }}>How can I help today?</h1>
              <p style={{ margin:0, color:C.t3, fontSize:14 }}>Ask anything. I'll keep it short and useful.</p>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:10, maxWidth:600, width:'100%' }}>
              {STARTERS.map((s, i) => (
                <button key={s} onClick={() => { newConvo(); setTimeout(() => send(s), 80) }}
                  style={{
                    background: `${C.surf}b3`,
                    backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)',
                    border:`1px solid ${C.border}`, borderRadius:14,
                    padding:'14px 16px', color:C.t2, fontSize:13,
                    cursor:'pointer', textAlign:'left', lineHeight:1.5,
                    fontFamily:'inherit',
                    transition:'all .18s',
                    animation:`flFadeIn .4s ease ${i * 0.05}s both`,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = C.borderFocus
                    e.currentTarget.style.background = C.surfHigh
                    e.currentTarget.style.color = C.t1
                    e.currentTarget.style.transform = 'translateY(-1px)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = C.border
                    e.currentTarget.style.background = `${C.surf}b3`
                    e.currentTarget.style.color = C.t2
                    e.currentTarget.style.transform = 'none'
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* ═══ Messages (immersive, centred 800px reading column) ═══ */}
            <div style={{ flex:1, overflowY:'auto', padding:'32px 24px 24px' }}>
              <div style={{ maxWidth:800, margin:'0 auto', display:'flex', flexDirection:'column', gap:20 }}>
                {messages.length === 0 && <div style={{ textAlign:'center', color:C.t3, padding:40, fontSize:14 }}>Send a message to start</div>}
                {messages.map((m, i) => (
                  <div key={m.id||i}
                    onMouseEnter={()=>setHoverId(m.id)} onMouseLeave={()=>setHoverId(h=>h===m.id?null:h)}
                    style={{ display:'flex', gap:14, alignItems:'flex-start', animation:'flFadeIn .3s ease' }}>
                    {/* Avatar */}
                    <div style={{
                      width:32, height:32, flexShrink:0,
                      borderRadius:'50%',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize: m.role==='user' ? 13 : 12,
                      fontWeight: m.role==='user' ? 600 : 400,
                      color:'#fff',
                      background: m.role === 'user'
                        ? `linear-gradient(135deg, #64748b, #475569)`
                        : `linear-gradient(135deg, ${C.accent}, #a855f7)`,
                      boxShadow: m.role === 'assistant' ? '0 2px 10px rgba(99,102,241,.35)' : 'none',
                    }}>
                      {m.role === 'user' ? (user?.email?.[0]?.toUpperCase() || 'U') : '✦'}
                    </div>

                    {/* Message column */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:600, color:C.t3, marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>
                        {m.role === 'user' ? 'You' : 'FounderLab'}
                      </div>
                      {m.image && (
                        <img src={m.image} alt="attachment"
                          style={{ maxWidth:280, maxHeight:200, borderRadius:12, marginBottom:8, display:'block', objectFit:'cover', border:`1px solid ${C.border}` }} />
                      )}
                      <div style={{ fontSize:15, lineHeight:1.65, color:C.t1 }}>
                        {m.role === 'assistant'
                          ? renderMsg(m.content)
                          : <div style={{ whiteSpace:'pre-wrap' }}>{m.content}</div>}
                      </div>

                      {/* Hover-revealed action row */}
                      <div style={{
                        display:'flex', alignItems:'center', gap:2, marginTop:8, flexWrap:'wrap',
                        opacity: (hoverId === m.id || activeTTS === m.id || showTTSMenu === m.id || reactions[m.id]) ? 1 : 0,
                        transition:'opacity .15s',
                      }}>
                        <ActionBtn label="Copy" icon="📋" onClick={() => { copyText(m.content); toast('Copied','success') }} />
                        {m.role === 'assistant' && (
                          <ActionBtn
                            label={activeTTS===m.id ? 'Stop' : 'Read aloud'}
                            icon={activeTTS===m.id ? '⏹' : '🔊'}
                            onClick={() => handleTTS(m)}
                            active={activeTTS===m.id}
                          />
                        )}
                        {m.role === 'assistant' && (
                          <ActionBtn label="Voice settings" icon="⚙" onClick={() => setShowTTSMenu(v => v === m.id ? null : m.id)} active={showTTSMenu === m.id} />
                        )}
                        {m.role === 'assistant' && !sending && (
                          <ActionBtn label="Regenerate" icon="↻" onClick={() => regenerate(m.id)} />
                        )}
                        {m.role === 'assistant' && (
                          <ActionBtn label="Good response" icon="👍" onClick={() => reactToMsg(m.id, 'up')} active={reactions[m.id]==='up'} />
                        )}
                        {m.role === 'assistant' && (
                          <ActionBtn label="Poor response" icon="👎" onClick={() => reactToMsg(m.id, 'down')} active={reactions[m.id]==='down'} />
                        )}
                        {m.role === 'assistant' && (
                          <ActionBtn label="Save to Notes" icon="📝" onClick={() => saveToNotes(m)} />
                        )}
                        {m.role === 'assistant' && (
                          <ActionBtn label="Create task" icon="✅" onClick={() => createTaskFromMsg(m)} />
                        )}
                        <ActionBtn label="Delete" icon="🗑" onClick={() => delMsg(m.id)} danger />
                        {m.ts && <span style={{ fontSize:10, color:C.t3, marginLeft:6 }}>
                          {new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
                        </span>}
                      </div>

                      {/* Voice/speed picker (glass card) */}
                      {showTTSMenu === m.id && (
                        <div style={{
                          marginTop:8, padding:'12px 14px',
                          background: `${C.surf}e6`,
                          backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
                          borderRadius:12, border:`1px solid ${C.border}`,
                          display:'flex', flexDirection:'column', gap:10, maxWidth:520,
                        }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:11, color:C.t3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>Voice</span>
                            {[
                              { id:'elevenlabs', label:'⚡ ElevenLabs', avail: elAvailable !== false },
                              { id:'browser',    label:'🌐 Browser',    avail: true },
                            ].map(p => (
                              <button key={p.id}
                                disabled={!p.avail}
                                onClick={() => setVoiceCfg(v => ({ ...v, provider: p.id }))}
                                style={{
                                  padding:'4px 10px', borderRadius:99,
                                  border:`1px solid ${voiceCfg.provider === p.id ? C.accent : C.border}`,
                                  background: voiceCfg.provider === p.id ? C.accentM : 'transparent',
                                  color: voiceCfg.provider === p.id ? C.accent : (p.avail ? C.t2 : C.t3),
                                  cursor: p.avail ? 'pointer' : 'not-allowed',
                                  opacity: p.avail ? 1 : 0.5,
                                  fontSize:11, fontFamily:'inherit',
                                }}>
                                {p.label}
                              </button>
                            ))}
                            {['male','female'].map(g => (
                              <button key={g} onClick={() => setVoiceCfg(v => ({ ...v, gender: g }))}
                                style={{
                                  padding:'4px 10px', borderRadius:99,
                                  border:`1px solid ${voiceCfg.gender === g ? C.accent : C.border}`,
                                  background: voiceCfg.gender === g ? C.accentM : 'transparent',
                                  color: voiceCfg.gender === g ? C.accent : C.t2,
                                  cursor:'pointer', fontSize:11, fontFamily:'inherit', textTransform:'capitalize',
                                }}>
                                {g === 'male' ? '♂' : '♀'} {g}
                              </button>
                            ))}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:11, color:C.t3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>Speed</span>
                            <input type="range" min={-50} max={50} value={voiceCfg.speed}
                              onChange={e => setVoiceCfg(v => ({ ...v, speed: parseInt(e.target.value, 10) }))}
                              style={{ flex:1, minWidth:120, accentColor:C.accent, cursor:'pointer' }} />
                            <span style={{ fontSize:11, color:C.t2, minWidth:50, textAlign:'right' }}>
                              {voiceCfg.speed === 0 ? 'Normal' : `${voiceCfg.speed > 0 ? '+' : ''}${voiceCfg.speed}%`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {sending && (
                  <div style={{ display:'flex', gap:14, alignItems:'flex-start', animation:'flFadeIn .3s' }}>
                    <div style={{
                      width:32, height:32, flexShrink:0, borderRadius:'50%',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:12, color:'#fff',
                      background:`linear-gradient(135deg, ${C.accent}, #a855f7)`,
                      boxShadow:'0 2px 10px rgba(99,102,241,.35)',
                    }}>✦</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, fontWeight:600, color:C.t3, marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>FounderLab</div>
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <div style={{ display:'flex', gap:5 }}>
                          {[0,1,2].map(i => (
                            <div key={i} style={{
                              width:7, height:7, borderRadius:'50%',
                              background:C.accent,
                              opacity:0.4,
                              animation:`flTyping 1.3s ease-in-out ${i*0.15}s infinite`,
                            }} />
                          ))}
                        </div>
                        <button onClick={stopGenerating}
                          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, color:C.t2, cursor:'pointer', fontSize:11, padding:'4px 10px', fontFamily:'inherit', display:'flex', alignItems:'center', gap:4 }}>
                          ■ Stop
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recoverable error banner */}
                {errorMsg && (
                  <div style={{
                    display:'flex', gap:12, alignItems:'flex-start',
                    padding:'12px 14px',
                    background:'rgba(239,68,68,.08)',
                    border:`1px solid rgba(239,68,68,.25)`,
                    borderRadius:12,
                    animation:'flFadeIn .25s',
                  }}>
                    <span style={{ fontSize:16 }}>⚠</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, color:C.t1, marginBottom:6 }}>{errorMsg}</div>
                      <div style={{ display:'flex', gap:6 }}>
                        {messages.filter(m => m.role === 'user').slice(-1).map(userM => (
                          <button key={userM.id} onClick={() => { setErrorMsg(null); send(userM.content) }}
                            style={{ background:C.accentM, border:`1px solid ${C.borderFocus}`, borderRadius:6, color:C.accent, cursor:'pointer', fontSize:12, padding:'4px 10px', fontFamily:'inherit' }}>
                            ↻ Retry
                          </button>
                        ))}
                        <button onClick={() => setErrorMsg(null)}
                          style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.t2, cursor:'pointer', fontSize:12, padding:'4px 10px', fontFamily:'inherit' }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={msgEnd} />
              </div>
            </div>

            {/* ═══ Composer (glassmorphism, centred) ═══ */}
            <div style={{ padding:'0 24px 24px', flexShrink:0 }}>
              <div style={{ maxWidth:800, margin:'0 auto' }}>
                {pendingImage && (
                  <div style={{
                    display:'flex', alignItems:'center', gap:10, marginBottom:10,
                    padding:'8px 12px',
                    background:C.surf, borderRadius:10,
                    border:`1px solid ${C.border}`,
                  }}>
                    <img src={pendingImage.base64} alt="" style={{ width:36, height:36, borderRadius:6, objectFit:'cover' }} />
                    <span style={{ fontSize:12, color:C.t2, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pendingImage.name}</span>
                    <button onClick={() => setPendingImage(null)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:18 }}>×</button>
                  </div>
                )}

                <div
                  onDragOver={e=>e.preventDefault()}
                  onDrop={async e=>{ e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f&&f.type.startsWith('image/')){ if(f.size>5*1024*1024){toast('Image must be under 5MB','error');return} setPendingImage({base64:await fileToBase64(f),name:f.name}) } }}
                  style={{
                    display:'flex', alignItems:'flex-end', gap:8,
                    padding:'10px 12px',
                    background: `${C.surf}cc`,
                    backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
                    border:`1px solid ${listening ? C.red : C.border}`,
                    borderRadius:20,
                    boxShadow:'0 8px 32px rgba(0,0,0,.35)',
                    transition:'border-color .18s',
                  }}>
                  <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES} style={{ display:'none' }} onChange={handleImagePick} />

                  {/* Attach */}
                  <button onClick={() => fileRef.current?.click()} title="Attach image (or drag & drop, or paste)"
                    style={{
                      background: pendingImage ? C.accentM : 'transparent',
                      border: `1px solid ${pendingImage ? C.borderFocus : 'transparent'}`,
                      borderRadius:12, color: pendingImage ? C.accent : C.t2,
                      cursor:'pointer', fontSize:18, padding:'8px 10px',
                      flexShrink:0, transition:'all .15s',
                    }}
                    onMouseEnter={e => { if (!pendingImage) { e.currentTarget.style.background = C.surfHigh; e.currentTarget.style.color = C.t1 } }}
                    onMouseLeave={e => { if (!pendingImage) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.t2 } }}>
                    📎
                  </button>

                  {/* Textarea */}
                  <textarea
                    ref={textRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onPaste={async e => {
                      const item = Array.from(e.clipboardData?.items||[]).find(i=>i.type.startsWith('image/'))
                      if (item) { const f=item.getAsFile(); if(f){ e.preventDefault(); setPendingImage({base64:await fileToBase64(f),name:'pasted-image.png'}) } }
                    }}
                    placeholder={listening ? 'Listening… speak now' : 'Message FounderLab AI…'}
                    rows={1}
                    onKeyDown={e => {
                      if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() }
                      if (e.key==='Escape' && sending) { stopGenerating() }
                    }}
                    style={{
                      flex:1, background:'transparent', border:'none',
                      color:C.t1, fontSize:15, padding:'10px 4px',
                      fontFamily:'inherit', outline:'none', resize:'none',
                      lineHeight:1.55, minHeight:24, maxHeight:200, overflowY:'auto',
                    }}
                  />

                  {/* Mic — sleek, larger, highlighted when active */}
                  <button onClick={handleMic} title={listening ? 'Stop recording' : 'Voice input'} aria-label="Voice input"
                    style={{
                      background: listening
                        ? 'rgba(239,68,68,.15)'
                        : 'transparent',
                      border: `1px solid ${listening ? C.red : 'transparent'}`,
                      borderRadius:14,
                      color: listening ? C.red : C.t2,
                      cursor:'pointer', fontSize:18,
                      padding:'8px 12px',
                      flexShrink:0,
                      transition:'all .15s',
                      display:'flex', alignItems:'center', gap:6,
                    }}
                    onMouseEnter={e => { if (!listening) { e.currentTarget.style.background = C.surfHigh; e.currentTarget.style.color = C.t1 } }}
                    onMouseLeave={e => { if (!listening) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.t2 } }}>
                    {listening ? <><WaveformBars /></> : '🎤'}
                  </button>

                  {/* Send / Stop */}
                  {sending
                    ? <button onClick={stopGenerating} title="Stop generating" aria-label="Stop"
                        style={{
                          background: C.red, border:'none', borderRadius:14,
                          color:'#fff', cursor:'pointer', fontSize:14,
                          padding:'8px 14px', flexShrink:0,
                          boxShadow:'0 2px 10px rgba(239,68,68,.35)',
                        }}>■</button>
                    : <button onClick={() => send()} disabled={!input.trim() && !pendingImage} title="Send" aria-label="Send"
                        style={{
                          background: (!input.trim() && !pendingImage) ? C.surfHigh : `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
                          border:'none', borderRadius:14,
                          color:'#fff', cursor: (!input.trim() && !pendingImage) ? 'not-allowed' : 'pointer',
                          fontSize:18, padding:'8px 14px', flexShrink:0,
                          opacity:(!input.trim()&&!pendingImage)?0.5:1,
                          transition:'all .15s',
                          boxShadow: (!input.trim() && !pendingImage) ? 'none' : '0 4px 14px rgba(99,102,241,.35)',
                        }}
                        onMouseEnter={e => { if (input.trim() || pendingImage) e.currentTarget.style.transform = 'translateY(-1px)' }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}>↑</button>
                  }
                </div>

                <p style={{ margin:'8px 0 0', fontSize:11, color:C.t3, textAlign:'center' }}>
                  Enter to send · Shift+Enter for a new line · 🎤 voice · 📎 image · Esc to stop
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Animations */}
      <style>{`
        @keyframes flFadeIn { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes flTyping {
          0%, 60%, 100% { transform: scale(1); opacity: .4 }
          30% { transform: scale(1.2); opacity: 1 }
        }
        @keyframes flWave {
          0%, 100% { height: 4px }
          50% { height: 14px }
        }
      `}</style>
    </div>
  )
}

// ── NOTES ─────────────────────────────────────────────────────
function NotesPage({ user }) {
  const [notes, setNotes]       = useState([])
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch]     = useState('')
  const [title, setTitle]       = useState('')
  const [content, setContent]   = useState('')
  const [tags, setTags]         = useState([])
  const [tagIn, setTagIn]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [loading, setLoading]   = useState(true)
  const [enhancing, setEnh]     = useState(false)

  const saveTimer = useRef(null)
  const filtered = notes
    .filter(n => !search || (n.title+' '+n.content).toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at))

  useEffect(() => {
    async function init() {
      setLoading(true); sb.logEvent('note','notes')
      const d = await load('fl_notes', [])
      setNotes(Array.isArray(d)?d:[]); setLoading(false)
    }
    init()
  }, [])

  function persist(updated) {
    setNotes(updated)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async()=>{ setSaving(true); await save('fl_notes',updated); setSaving(false) }, 700)
  }

  function selectNote(n) { setActiveId(n.id); setTitle(n.title||''); setContent(n.content||''); setTags(n.tags||[]) }

  function newNote() {
    const n = { id:uid(), title:'Untitled Note', content:'', tags:[], created_at:ts(), updated_at:ts() }
    persist([n,...notes]); selectNote(n)
  }

  function updateNote(t, c, tgs) {
    const upd = notes.map(n=>n.id===activeId?{...n,title:t,content:c,tags:tgs,updated_at:ts()}:n)
    persist(upd)
  }

  function delNote() {
    if (!activeId||!confirm('Delete this note?')) return
    persist(notes.filter(n=>n.id!==activeId))
    setActiveId(null); setTitle(''); setContent(''); setTags([])
    toast('Note deleted','success')
  }

  async function enhance() {
    if (!content.trim()) return toast('Add some content first','error')
    setEnh(true)
    const r = await ai([{ role:'user', content:`You are a professional editor. Improve this note:

${title ? `Title: ${title}\n\n` : ''}${content}

Requirements:
- Preserve ALL original information and facts — never remove anything important
- Fix grammar, spelling, and clarity
- Improve structure with clear headers (## Heading) where helpful
- Use **bold** for key points and \`code\` for technical terms
- Add bullet points for lists of items
- Make it more actionable and useful
- Keep the same voice and intent

Return only the improved note content, no preamble.` }], '', 2000)
    if (r && !r.startsWith('⚠')) { setContent(r); updateNote(title, r, tags); toast('Note enhanced ✨', 'success') }
    else toast(r || 'Enhancement failed', 'error')
    setEnh(false)
  }

  function addTag() {
    const t = tagIn.trim()
    if (!t||tags.includes(t)) { setTagIn(''); return }
    const next = [...tags,t]; setTags(next); setTagIn(''); updateNote(title,content,next)
  }

  const wc = content.trim().split(/\s+/).filter(Boolean).length

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
      <div style={{ width:260, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', flexShrink:0 }}>
        <div style={{ padding:12, borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:8 }}>
          <Button onClick={newNote} full size="sm" icon="+">New Note</Button>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes…" style={{ fontSize:13 }} />
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:8 }}>
          {loading ? <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner /></div> :
           filtered.length===0 ? <div style={{ textAlign:'center', padding:24, color:C.t3, fontSize:13 }}>{search?'No results':'No notes yet'}</div> :
           filtered.map(n=>(
            <div key={n.id} onClick={()=>selectNote(n)}
              style={{ padding:'10px 12px', borderRadius:8, cursor:'pointer', marginBottom:3, background:activeId===n.id?C.accentM:'transparent', border:`1px solid ${activeId===n.id?C.borderFocus:'transparent'}`, transition:'all .15s' }}>
              <div style={{ fontSize:13, fontWeight:500, color:activeId===n.id?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>{n.title||'Untitled'}</div>
              <div style={{ fontSize:11, color:C.t3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{(n.content||'').slice(0,55)||'Empty note'}</div>
              <div style={{ fontSize:10, color:C.t3, marginTop:3 }}>{fmtDate(n.updated_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {!activeId ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <EmptyState icon="📝" title="Select or create a note" description="Notes auto-save 700ms after each keystroke and sync to the cloud." action={<Button onClick={newNote} icon="+">New Note</Button>} />
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 20px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <input value={title} onChange={e=>{ setTitle(e.target.value); updateNote(e.target.value,content,tags) }} style={{ flex:1, background:'transparent', border:'none', color:C.t1, fontSize:18, fontWeight:700, outline:'none', fontFamily:'inherit' }} placeholder="Note title…" />
            <span style={{ fontSize:11, color:C.t3, whiteSpace:'nowrap' }}>{saving?'✦ Saving…':'✓ Saved'}</span>
            <Button onClick={enhance} disabled={enhancing} variant="secondary" size="sm">{enhancing?<Spinner size={12} color={C.accent}/>:'✨'} AI Enhance</Button>
            <Button onClick={delNote} variant="ghost" size="sm" style={{ color:C.red }}>🗑</Button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 20px', borderBottom:`1px solid ${C.border}`, flexWrap:'wrap', minHeight:38, flexShrink:0 }}>
            {tags.map(t=>(
              <span key={t} style={{ background:C.accentM, color:C.accent, fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:999, display:'flex', alignItems:'center', gap:4 }}>
                {t}<span onClick={()=>{ const n=tags.filter(x=>x!==t); setTags(n); updateNote(title,content,n) }} style={{ cursor:'pointer', opacity:.7, lineHeight:1 }}>×</span>
              </span>
            ))}
            <input value={tagIn} onChange={e=>setTagIn(e.target.value)} onKeyDown={e=>(e.key==='Enter'||e.key===',')&&(e.preventDefault(),addTag())} placeholder="+ tag" style={{ background:'transparent', border:'none', color:C.t2, fontSize:12, outline:'none', fontFamily:'inherit', width:64 }} />
          </div>
          <textarea value={content} onChange={e=>{ setContent(e.target.value); updateNote(title,e.target.value,tags) }} placeholder="Start writing…" style={{ flex:1, background:'transparent', border:'none', color:C.t1, fontSize:15, lineHeight:1.75, padding:'20px', outline:'none', resize:'none', fontFamily:'inherit' }} />
          <div style={{ padding:'8px 20px', borderTop:`1px solid ${C.border}`, display:'flex', gap:16, flexShrink:0 }}>
            <span style={{ fontSize:11, color:C.t3 }}>{wc} words</span>
            <span style={{ fontSize:11, color:C.t3 }}>{content.length} chars</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── TASKS / KANBAN ────────────────────────────────────────────
const COLS = [{ id:'todo',label:'To Do' },{ id:'in_progress',label:'In Progress' },{ id:'done',label:'Done' }]
const PRI  = { high:[C.red,C.redM,'High'], medium:[C.yellow,C.yellowM,'Medium'], low:[C.green,C.greenM,'Low'] }
const CIDX = { todo:0, in_progress:1, done:2 }

function TaskModal({ task, onSave, onClose }) {
  const [t,setT]   = useState(task?.title||'')
  const [d,setD]   = useState(task?.description||'')
  const [s,setS]   = useState(task?.status||'todo')
  const [p,setP]   = useState(task?.priority||'medium')
  const [dd,setDd] = useState(task?.due_date||'')
  const lbl = x => <label style={{ display:'block', fontSize:12, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>{x}</label>

  function submit() {
    if (!t.trim()) return toast('Title required','error')
    onSave({ ...(task||{}), id:task?.id||uid(), title:t.trim(), description:d, status:s, priority:p, due_date:dd, created_at:task?.created_at||ts(), updated_at:ts() })
  }
  const selSt = { width:'100%', background:C.surf, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:14, padding:'9px 12px', fontFamily:'inherit', cursor:'pointer' }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000c', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <Card style={{ width:'100%', maxWidth:460, padding:28, borderRadius:16 }}>
        <h3 style={{ margin:'0 0 20px', color:C.t1, fontSize:16 }}>{task?'Edit Task':'Add Task'}</h3>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>{lbl('Title')}<Input value={t} onChange={e=>setT(e.target.value)} placeholder="Task title…" autoFocus /></div>
          <div>{lbl('Description (optional)')}<Input value={d} onChange={e=>setD(e.target.value)} placeholder="Optional notes…" rows={2} /></div>
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ flex:1 }}>{lbl('Status')}<select value={s} onChange={e=>setS(e.target.value)} style={selSt}>{COLS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div style={{ flex:1 }}>{lbl('Priority')}<select value={p} onChange={e=>setP(e.target.value)} style={selSt}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
          </div>
          <div>{lbl('Due Date')}<input type="date" value={dd} onChange={e=>setDd(e.target.value)} style={{ ...selSt, outline:'none' }} /></div>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:20, justifyContent:'flex-end' }}>
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button onClick={submit}>Save Task</Button>
        </div>
      </Card>
    </div>
  )
}

function TasksPage({ user }) {
  const [tasks, setTasks]   = useState([])
  const [view, setView]     = useState('board')
  const [loading, setL]     = useState(true)
  const [modal, setModal]   = useState(null)
  const [aiIn, setAiIn]     = useState('')
  const [aiLoad, setAiLoad] = useState(false)

  useEffect(() => {
    async function init() { setL(true); sb.logEvent('task','tasks'); const d=await load('fl_tasks',[]); setTasks(Array.isArray(d)?d:[]); setL(false) }
    init()
  }, [])

  const saveTimer = useRef(null)
  function persist(u) {
    setTasks(u)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save('fl_tasks', u), 400)
  }

  function saveTask(task) {
    const ex = tasks.find(t=>t.id===task.id)
    persist(ex ? tasks.map(t=>t.id===task.id?task:t) : [task,...tasks])
    setModal(null)
    toast(ex?'Task updated':'Task added','success')
  }
  function delTask(id) { if(!confirm('Delete task?'))return; persist(tasks.filter(t=>t.id!==id)); toast('Deleted') }
  function move(id,dir) {
    const t=tasks.find(t=>t.id===id); if(!t)return
    const ni=CIDX[t.status]+dir; if(ni<0||ni>2)return
    const ns=COLS[ni].id
    persist(tasks.map(x=>x.id===id?{...x,status:ns}:x))
    if(ns==='done') toast('✅ Task marked done!','success')
  }
  function toggle(id) {
    const t=tasks.find(t=>t.id===id); if(!t)return
    const ns=t.status==='done'?'todo':'done'
    persist(tasks.map(x=>x.id===id?{...x,status:ns}:x))
    if(ns==='done') toast('✅ Task marked done!','success')
  }

  async function aiBreak() {
    if (!aiIn.trim()) return
    setAiLoad(true)
    const r = await ai([{ role:'user', content:`Break this goal into 5-8 specific, actionable tasks. Each task should be concrete and completable in one sitting.

Goal: ${aiIn}

Return ONLY a valid JSON array of strings. No markdown fences, no explanation, no preamble. Example format:
["Research competitors in the market", "Write landing page copy", "Set up Stripe payments"]` }], '', 1200)
    try {
      const match = r.match(/\[[\s\S]*\]/)
      const arr = JSON.parse(match?.[0] || '[]')
      if (arr.length) {
        persist([...arr.map(title => ({ id:uid(), title:String(title).trim(), status:'todo', priority:'medium', description:'', due_date:'', created_at:ts(), updated_at:ts() })), ...tasks])
        setAiIn(''); toast(`✅ Added ${arr.length} tasks!`, 'success')
      } else toast('No tasks found in response — try rephrasing', 'error')
    } catch { toast('Could not parse AI response — try again', 'error') }
    setAiLoad(false)
  }

  const done=tasks.filter(t=>t.status==='done').length
  const pct=tasks.length?Math.round(done/tasks.length*100):0

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {modal && <TaskModal task={modal==='new'?null:modal} onSave={saveTask} onClose={()=>setModal(null)} />}
      <div style={{ padding:'20px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <h2 style={{ margin:0, fontSize:22, fontWeight:700, color:C.t1 }}>Tasks</h2>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ display:'flex', background:C.bg, borderRadius:8, padding:3, gap:2 }}>
              {['board','list'].map(v=><button key={v} onClick={()=>setView(v)} style={{ padding:'5px 12px', borderRadius:6, border:'none', background:view===v?C.surf:'transparent', color:view===v?C.t1:C.t3, cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight:500, transition:'all .15s' }}>{v==='board'?'⊞ Board':'≡ List'}</button>)}
            </div>
            <Button onClick={()=>setModal('new')} size="sm" icon="+">Add Task</Button>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
          <div style={{ flex:1, height:5, background:C.surfHigh, borderRadius:3, overflow:'hidden' }}><div style={{ width:`${pct}%`, height:'100%', background:C.accent, borderRadius:3, transition:'width .4s' }} /></div>
          <span style={{ fontSize:12, color:C.t2, whiteSpace:'nowrap' }}>{done}/{tasks.length} · {pct}%</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Input value={aiIn} onChange={e=>setAiIn(e.target.value)} placeholder="✨ Describe a goal → AI breaks it into tasks…" style={{ flex:1, fontSize:13 }} onKeyDown={e=>e.key==='Enter'&&aiBreak()} />
          <Button onClick={aiBreak} disabled={aiLoad||!aiIn.trim()} size="sm">{aiLoad?<Spinner size={13} color="#fff"/>:'✨ Generate'}</Button>
        </div>
      </div>

      <div style={{ flex:1, overflow:view==='board'?'hidden':'auto', padding:'20px 24px' }}>
        {loading ? <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Spinner /></div>
         : tasks.length===0 ? <EmptyState icon="✅" title="No tasks yet" description="Add a task or use AI to break down a big goal." action={<Button onClick={()=>setModal('new')} icon="+">Add Task</Button>} />
         : view==='board' ? (
          <div style={{ display:'flex', gap:16, height:'100%', overflow:'hidden' }}>
            {COLS.map(col => {
              const ct = tasks.filter(t=>t.status===col.id)
              return (
                <div key={col.id} style={{ flex:1, minWidth:220, background:C.surfHigh, borderRadius:10, border:`1px solid ${C.border}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                  <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:C.t1 }}>{col.label}</span>
                      <Badge color="gray">{ct.length}</Badge>
                    </div>
                    <button onClick={()=>setModal('new')} style={{ background:'none', border:'none', color:C.t2, cursor:'pointer', fontSize:20, lineHeight:1, padding:'0 2px', fontFamily:'inherit' }}>+</button>
                  </div>
                  <div style={{ flex:1, overflowY:'auto', padding:8 }}>
                    {ct.map(task => {
                      const [pc,,pl]=PRI[task.priority]||PRI.medium
                      const overdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()
                      return (
                        <div key={task.id} style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 12px', marginBottom:8 }}>
                          <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:8 }}>
                            <input type="checkbox" checked={task.status==='done'} onChange={()=>toggle(task.id)} style={{ accentColor:C.accent, marginTop:2, flexShrink:0 }} />
                            <span style={{ fontSize:13, color:C.t1, lineHeight:1.4, textDecoration:task.status==='done'?'line-through':'none', flex:1 }}>{task.title}</span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
                            <Badge color={task.priority==='high'?'red':task.priority==='medium'?'yellow':'green'}>{pl}</Badge>
                            <div style={{ display:'flex', gap:3, alignItems:'center' }}>
                              {task.due_date && <span style={{ fontSize:10, color:overdue?C.red:C.t3, fontWeight:overdue?600:400 }}>{overdue?'⚠ ':''}{fmtDate(task.due_date)}</span>}
                              {CIDX[task.status]>0 && <button onClick={()=>move(task.id,-1)} title="Move left" style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:4, color:C.t2, cursor:'pointer', fontSize:11, padding:'1px 5px', lineHeight:1, fontFamily:'inherit' }}>←</button>}
                              {CIDX[task.status]<2 && <button onClick={()=>move(task.id,1)} title="Move right" style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:4, color:C.t2, cursor:'pointer', fontSize:11, padding:'1px 5px', lineHeight:1, fontFamily:'inherit' }}>→</button>}
                              <button onClick={()=>setModal(task)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:12, padding:2, fontFamily:'inherit' }}>✎</button>
                              <button onClick={()=>delTask(task.id)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:16, padding:'0 2px', lineHeight:1 }}>×</button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
         ) : (
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Task','Status','Priority','Due Date',''].map(h=><th key={h} style={{ textAlign:'left', padding:'8px 12px', fontSize:11, color:C.t3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em', borderBottom:`1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {tasks.map(task=>(
                <tr key={task.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:'11px 12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <input type="checkbox" checked={task.status==='done'} onChange={()=>toggle(task.id)} style={{ accentColor:C.accent, flexShrink:0 }} />
                      <span style={{ fontSize:14, color:C.t1, textDecoration:task.status==='done'?'line-through':'none' }}>{task.title}</span>
                    </div>
                  </td>
                  <td style={{ padding:'11px 12px' }}><span style={{ fontSize:12, color:C.t2 }}>{COLS.find(c=>c.id===task.status)?.label}</span></td>
                  <td style={{ padding:'11px 12px' }}><Badge color={task.priority==='high'?'red':task.priority==='medium'?'yellow':'green'}>{PRI[task.priority]?.[2]}</Badge></td>
                  <td style={{ padding:'11px 12px', fontSize:12, color:C.t3 }}>{task.due_date?fmtDate(task.due_date):'—'}</td>
                  <td style={{ padding:'11px 12px' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={()=>setModal(task)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:13, padding:2 }}>✎</button>
                      <button onClick={()=>delTask(task.id)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:17, lineHeight:1, padding:'0 2px' }}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
         )}
      </div>
    </div>
  )
}

// ── YOUTUBE AI ────────────────────────────────────────────────
const YT = [
  { id:'summary',  label:'Summary',  icon:'📋', fn:(t,tr)=>`Create a comprehensive, structured summary of this YouTube video.

${t?`Video: ${t}\n`:''}${tr?`Transcript:\n${tr.slice(0,4000)}`:''}

Structure your response as:
## 🎯 Core Message (2-3 sentences)

## 📌 Key Takeaways
- (5-8 specific, actionable takeaways — not generic)

## 🕐 Key Moments (if transcript has timestamps or clear sections)
- Intro / hook
- Main points
- Conclusion

## 💡 Action Items
- (3-5 things the viewer should do after watching)

Be specific and extract real information from the content. Never give generic summaries.` },
  { id:'titles',  label:'Titles',   icon:'🏷', fn:(t,tr)=>`Generate 10 high-converting YouTube video titles.

${t?`Topic: ${t}\n`:''}${tr?`Transcript:\n${tr.slice(0,3000)}`:''}

Requirements:
- Mix styles: numbers ("7 Ways to..."), questions ("Why does...?"), how-tos, power words
- Each title under 70 characters (YouTube truncates at ~60)
- SEO-optimized with searchable keywords
- Emotionally compelling — triggers curiosity or urgency
- No clickbait that fails to deliver

Number each title 1-10. Include a ✅ next to your top pick.` },
  { id:'captions', label:'Captions', icon:'📝', fn:(t,tr)=>`Write 3 platform-specific captions for this video.

${t?`Topic: ${t}\n`:''}${tr?`Transcript:\n${tr.slice(0,3000)}`:''}

## 📺 YouTube Description (500-600 chars)
Full description with hook, what viewers learn, and 10 relevant hashtags.

## 📱 Instagram / TikTok (150 chars max)
Short punchy caption + 10 trending hashtags.

## 💼 LinkedIn (250 chars)
Professional framing + 5 industry hashtags.` },
  { id:'shorts',  label:'Shorts',   icon:'▶',  fn:(t,tr)=>`Identify 5 YouTube Shorts ideas from this content.

${t?`Topic: ${t}\n`:''}${tr?`Transcript:\n${tr.slice(0,3000)}`:''}

For each Short:
**Hook** (exact first line, under 3 seconds)
**Duration**: X seconds
**Content outline**: 3-4 steps
**Why it'll perform**: specific reason (trend, emotion, shareability)
**Thumbnail idea**: describe the visual

Make each one specific to the actual content, not generic.` },
  { id:'strategy',label:'Strategy', icon:'📅', fn:(t,tr)=>`Create a 7-day YouTube content calendar based on this.

${t?`Channel/Topic: ${t}\n`:''}${tr?`Reference content:\n${tr.slice(0,3000)}`:''}

For each day include:
- **Video idea** (with working title)
- **Target keyword** (searchable phrase, low competition)
- **Thumbnail concept** (describe the visual)
- **Best upload time** for the niche
- **Community post** to complement the video

End with 3 channel growth tips specific to this niche.` },
  { id:'viral', label:'Viral Short', icon:'🔥', fn:(t,tr)=>`You are an expert viral content strategist. Analyze this content and deliver a complete Viral Short production package.

${t?`Topic/URL: ${t}\n`:''}${tr?`Transcript:\n${tr.slice(0,4000)}`:''}

## 🎯 Viral Score: [X]/100
**Verdict**: [one sentence on virality potential]
**Key factors**: [3 bullet points why it will/won't perform]

## 🔥 Top 3 Clip Opportunities
${tr?'Use exact timestamps if available in transcript.':'Suggest ideal moments based on content structure.'}

**Clip 1 — The Hook**
- Segment: [describe the moment / timestamp if available]
- Duration: [X] seconds
- Why it works: [specific reason]
- Opening line (exact words): "[quote or suggestion]"

**Clip 2 — The Value Drop**
- Segment: [describe / timestamp]
- Duration: [X] seconds  
- Why it works: [specific reason]

**Clip 3 — The CTA/Surprise**
- Segment: [describe / timestamp]
- Duration: [X] seconds
- Why it works: [specific reason]

## 📱 60-Second Short Script
[Write the complete word-for-word script optimized for vertical video. Include stage directions in (parentheses).]

**HOOK (0-3s)**: [exact opening]
**SETUP (3-10s)**: [context]
**VALUE (10-50s)**: [core content]
**CTA (50-60s)**: [call to action]

## 🏷️ 5 Title Options
1. 
2. 
3. 
4. 
5. ✅ [mark your top pick]

## #️⃣ 20 Hashtags
[Mix of trending, niche, and broad hashtags]

## 🖼️ Thumbnail Brief
**Text overlay**: [exact words, max 4]
**Visual**: [describe background, colors, face expression if person]
**Color scheme**: [specific hex or color names]
**Hook element**: [what makes it impossible to scroll past]

## 📈 3 Ways to Boost Viral Potential
1. 
2. 
3. ` },
]

function YouTubeAIPage({ user }) {
  // ── Input state ─────────────────────────────────────────────
  const [url,      setUrl]      = useState('')
  const [title,    setTitle]    = useState('')
  const [trans,    setTrans]    = useState('')
  const [active,   setActive]   = useState('summary')
  const [outputs,  setOut]      = useState({})
  const [loading,  setL]        = useState(false)

  // ── Video info state ─────────────────────────────────────────
  const [videoInfo, setVideoInfo]   = useState(null)
  const [infoLoad,  setInfoLoad]    = useState(false)
  const [autoTransMsg, setATMsg]    = useState('')

  // ── Viral clip studio state ──────────────────────────────────
  const [analysis,      setAnalysis]     = useState(null)
  const [karaokeStyle,  setKaraokeStyle] = useState('highlight')
  const [aspectRatio,   setAspectRatio]  = useState('9:16')
  const [exportSettings,setExportSettings] = useState({ resolution:'1080p', fps:30, codec:'h264', bitrateControl:'CBR', includeCaptions:true, includeAudioDub:false })
  const [dubStatus,     setDubStatus]    = useState(null)
  const [dubScript,     setDubScript]    = useState('')

  const videoId = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/)?.[1]
  const wc      = trans.trim().split(/\s+/).filter(Boolean).length

  // ── Auto-fetch video info when URL changes ───────────────────
  useEffect(() => {
    if (!videoId) { setVideoInfo(null); return }
    let cancelled = false
    setInfoLoad(true)
    authenticatedFetch('/api/youtube/info', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url }) })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setVideoInfo(d); if (!title && d.title) setTitle(d.title) } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setInfoLoad(false) })
    return () => { cancelled = true }
  }, [videoId])

  // ── Auto-fetch transcript ────────────────────────────────────
  async function fetchAutoTranscript() {
    if (!videoId) return
    setATMsg('Fetching captions…')
    const r = await authenticatedFetch('/api/youtube/transcript', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ videoId }) })
    const d = await r.json()
    if (d.transcript) { setTrans(d.transcript); setATMsg('✅ Captions loaded automatically') }
    else setATMsg(d.message || '⚠ No captions found — paste transcript manually')
  }

  // ── AI text generation (Summary / Titles / Captions / Shorts / Strategy) ─
  async function generate() {
    if (!title.trim() && !trans.trim() && !url.trim()) return toast('Add a YouTube URL, title, or paste a transcript', 'error')
    sb.logEvent('youtube', 'youtube')
    if (active === 'clips') { return runViralAnalysis() }
    const type = YT.find(t => t.id === active)
    if (!type) return
    setL(true)
    const topicStr = url ? `YouTube URL: ${url}\nTitle: ${title}` : title
    const r = await ai(
      [{ role:'user', content: type.fn(topicStr, trans) }],
      'You are a world-class YouTube growth strategist with a proven track record of 50M+ views. Give specific, complete, actionable output every time. Never give generic advice. Always finish your response.',
      3000
    )
    setOut(p => ({ ...p, [active]: r }))
    setL(false)
  }

  // ── Full Viral Clip Analysis ─────────────────────────────────
  async function runViralAnalysis() {
    if (!trans.trim() && !url.trim()) return toast('Add a YouTube URL or paste a transcript first', 'error')
    const provider = getAIProvider()
    if (!provider) return toast('Choose a configured cloud AI provider before running Viral Clip Analysis.', 'error')
    if (provider === 'ollama') return toast('Viral Clip Analysis runs securely on the server. Choose a configured cloud provider; Local Ollama remains available for browser-executable AI features.', 'error')
    let text = trans
    if (!text && videoId) {
      setL(true)
      const r = await authenticatedFetch('/api/youtube/transcript', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ videoId }) })
      const d = await r.json()
      text = d.transcript || ''
      if (text) setTrans(text)
    }
    setL(true)
    const r = await authenticatedFetch('/api/youtube/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: text, duration: videoInfo?.duration || 0, url, provider, model:getProviderModel(provider) }),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.ok && d?.error) { toast('Analysis failed: ' + (d?.error?.message || 'Please try again.'), 'error'); setL(false); return }
    setAnalysis(d)
    setOut(p => ({ ...p, clips: `Viral Score: ${d.viralityScore}/100\n\n${d.reason}\n\nBest Hook: "${d.hook}"\n\nShort Script:\n${d.shortScript || 'See clip ranges below.'}` }))
    setL(false)
  }

  async function handleDub(gender) {
    if (!analysis?.shortScript && !trans.trim()) return toast('Run analysis first to get a script', 'error')
    setDubStatus('loading')
    const r = await authenticatedFetch('/api/youtube/ai-dub', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ transcript: analysis?.shortScript || trans.slice(0,1000), gender }) })
    if (!r.ok || !r.headers.get('Content-Type')?.includes('audio')) {
      const d = await r.json().catch(() => null)
      toast(d?.error?.message || 'AI voice could not be generated. Please try again.', 'error')
      setDubStatus(null)
      return
    }
    const blob = await r.blob()
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download:'ai_dub.mp3' })
    a.click(); URL.revokeObjectURL(a.href)
    setDubStatus('done')
  }

  // ── Clip config summary for export ──────────────────────────
  function buildFFmpegCommand(range) {
    if (!videoId || !range) return null
    return `# 1. Download clip from YouTube:\nyt-dlp -f "bestvideo[height<=1920]+bestaudio" --merge-output-format mp4 -o "source.mp4" "https://youtube.com/watch?v=${videoId}"\n\n# 2. Trim to viral segment:\nffmpeg -i source.mp4 -ss ${range.start} -to ${range.end} -c copy clip.mp4\n\n# 3. Reframe for ${aspectRatio}:\nffmpeg -i clip.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -c:a copy reframed.mp4\n\n# 4. Export at ${exportSettings.resolution} ${exportSettings.fps}fps:\nffmpeg -i reframed.mp4 -vf "scale=1920:1080,fps=${exportSettings.fps}" -c:v ${exportSettings.codec==='h265'?'libx265':'libx264'} -preset medium -b:v 8M output_pro.mp4`
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{ height:'100%', overflowY:'auto', padding:'28px 28px 56px', maxWidth:940 }}>

      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <h2 style={{ margin:'0 0 4px', fontSize:22, fontWeight:700, background:'linear-gradient(135deg,#6366f1,#a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
          YouTube AI Studio
        </h2>
        <p style={{ margin:0, fontSize:13, color:C.t2 }}>Analyse videos, generate viral content, and export production-ready Shorts — all in one place.</p>
      </div>

      {/* Input panel */}
      <Card style={{ padding:22, marginBottom:18 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* URL */}
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.06em' }}>YouTube URL</label>
            <Input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=... or youtu.be/..." />
          </div>

          {/* Video info bar */}
          {(infoLoad || videoInfo) && (
            <div style={{ display:'flex', gap:12, alignItems:'center', padding:'10px 14px', background:C.bg, borderRadius:10, border:`1px solid ${C.border}` }}>
              {videoInfo?.thumbnail && <img src={videoInfo.thumbnail} alt="" style={{ width:64, height:36, borderRadius:6, objectFit:'cover', flexShrink:0 }} />}
              <div style={{ flex:1, minWidth:0 }}>
                {infoLoad ? <span style={{ fontSize:12, color:C.t3 }}>Loading video info…</span> : <>
                  <p style={{ margin:'0 0 2px', fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{videoInfo?.title}</p>
                  <p style={{ margin:0, fontSize:11, color:C.t3 }}>{videoInfo?.author}{videoInfo?.duration ? ` · ${Math.floor(videoInfo.duration/60)}:${String(videoInfo.duration%60).padStart(2,'0')}` : ''}{videoInfo?.viewCount ? ` · ${(videoInfo.viewCount/1000).toFixed(0)}K views` : ''}</p>
                </>}
              </div>
              {videoId && !infoLoad && (
                <button onClick={fetchAutoTranscript} style={{ background:C.accentM, border:`1px solid ${C.borderFocus}`, borderRadius:8, color:C.accent, cursor:'pointer', fontSize:12, padding:'5px 12px', fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0 }}>
                  🔤 Auto-fetch captions
                </button>
              )}
            </div>
          )}

          {autoTransMsg && <p style={{ margin:0, fontSize:12, color:autoTransMsg.startsWith('✅')?C.green:C.t3 }}>{autoTransMsg}</p>}

          {/* Video embed */}
          {videoId && (
            <div style={{ borderRadius:10, overflow:'hidden', border:`1px solid ${C.border}`, background:'#000', position:'relative', paddingTop:'56.25%' }}>
              <iframe src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', border:'none' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="YouTube preview" />
            </div>
          )}

          {/* Title */}
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.06em' }}>Title / Topic <span style={{ fontWeight:400, textTransform:'none' }}>(auto-filled from URL)</span></label>
            <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. How I built a $10k/mo SaaS in 60 days" onKeyDown={e=>e.key==='Enter'&&generate()} />
          </div>

          {/* Transcript */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <label style={{ fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.06em' }}>Transcript <span style={{ fontWeight:400, textTransform:'none', color:C.t3 }}>({wc} words)</span></label>
              {videoId && <button onClick={fetchAutoTranscript} style={{ background:'none', border:'none', color:C.accent, cursor:'pointer', fontSize:11, fontFamily:'inherit', padding:0 }}>↓ Auto-fetch captions</button>}
            </div>
            <Input value={trans} onChange={e=>setTrans(e.target.value)} placeholder="Paste transcript here for better results — or click Auto-fetch above…" rows={4} />
            <p style={{ margin:'5px 0 0', fontSize:11, color:C.t3 }}>Tip: YouTube → click ⋯ under the video → Show transcript → Copy all</p>
          </div>
        </div>
      </Card>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {YT.map(t => (
          <button key={t.id} onClick={()=>setActive(t.id)}
            style={{ padding:'8px 15px', borderRadius:8, border:`2px solid ${active===t.id ? (t.id==='clips'?C.red:C.accent) : C.border}`, background:active===t.id ? (t.id==='clips'?'rgba(239,68,68,.1)':C.accentM) : 'transparent', color:active===t.id ? (t.id==='clips'?C.red:C.accent) : C.t2, cursor:'pointer', fontSize:13, fontWeight:active===t.id?600:400, fontFamily:'inherit', display:'flex', alignItems:'center', gap:5, transition:'all .15s' }}>
            {t.icon} {t.label}
          </button>
        ))}
        <Button onClick={generate} disabled={loading} style={{ marginLeft:'auto' }}>
          {loading ? <Spinner size={14} color="#fff"/> : (active==='clips'?'🎯':'✨')} {active==='clips'?'Analyse for Viral Clips':'Generate'}
        </Button>
      </div>

      {/* Output panel */}
      <Card style={{ padding:0, overflow:'hidden', marginBottom: analysis && active==='clips' ? 18 : 0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 18px', borderBottom:`1px solid ${C.border}` }}>
          <span style={{ fontSize:14, fontWeight:600, color:C.t1 }}>{YT.find(t=>t.id===active)?.icon} {YT.find(t=>t.id===active)?.label}</span>
          {outputs[active] && <Button onClick={()=>copyText(outputs[active])} variant="secondary" size="sm">📋 Copy</Button>}
        </div>
        <div style={{ padding:20, minHeight:180 }}>
          {loading
            ? <div style={{ display:'flex', alignItems:'center', gap:10, color:C.t2, fontSize:14 }}><Spinner /> {active==='clips'?'Analysing transcript for viral moments…':'Generating…'}</div>
            : outputs[active]
              ? <div style={{ fontSize:14, color:C.t1, lineHeight:1.75 }}>{renderMsg(outputs[active])}</div>
              : <div style={{ textAlign:'center', color:C.t3, padding:'28px 0', fontSize:14 }}>
                  {active==='clips' ? '🎯 Paste a transcript or URL above, then click Analyse for Viral Clips' : 'Output appears here — add content above and click Generate'}
                </div>
          }
        </div>
      </Card>

      {/* ── VIRAL CLIP STUDIO PANELS (shown after analysis) ────── */}
      {analysis && active==='clips' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* Virality score */}
          <Card style={{ padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ position:'relative', width:72, height:72, flexShrink:0 }}>
                <svg width={72} height={72} style={{ transform:'rotate(-90deg)' }}>
                  <circle cx={36} cy={36} r={30} fill="none" stroke={C.border} strokeWidth={6}/>
                  <circle cx={36} cy={36} r={30} fill="none"
                    stroke={analysis.viralityScore>=80?C.green:analysis.viralityScore>=60?C.yellow:C.red}
                    strokeWidth={6} strokeLinecap="round"
                    strokeDasharray={`${2*Math.PI*30}`}
                    strokeDashoffset={`${2*Math.PI*30*(1-analysis.viralityScore/100)}`}
                    style={{ transition:'stroke-dashoffset .6s ease' }}/>
                </svg>
                <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700, color:analysis.viralityScore>=80?C.green:analysis.viralityScore>=60?C.yellow:C.red }}>{analysis.viralityScore}</span>
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:'0 0 4px', fontSize:15, fontWeight:700, color:C.t1 }}>Viral Score: {analysis.viralityScore}/100</p>
                <p style={{ margin:'0 0 6px', fontSize:13, color:C.t2 }}>{analysis.reason}</p>
                {analysis.hashtags?.length>0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {analysis.hashtags.map((h,i) => <span key={i} style={{ fontSize:11, color:C.accent, background:C.accentM, borderRadius:99, padding:'2px 9px', border:`1px solid ${C.borderFocus}` }}>{h}</span>)}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Clip ranges */}
          {analysis.clipRanges?.length>0 && (
            <Card style={{ padding:18 }}>
              <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>📍 Best Clip Moments</p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {analysis.clipRanges.map((r,i) => {
                  const cmd = buildFFmpegCommand(r)
                  return (
                    <div key={i} style={{ padding:'12px 14px', background:C.bg, borderRadius:10, border:`1px solid ${C.border}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:C.t1 }}>{r.label}</span>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:12, color:C.t3 }}>{Math.floor(r.start/60)}:{String(r.start%60).padStart(2,'0')} – {Math.floor(r.end/60)}:{String(r.end%60).padStart(2,'0')} ({r.end-r.start}s)</span>
                          <span style={{ fontSize:11, fontWeight:600, color:r.score>=80?C.green:r.score>=60?C.yellow:C.red }}>{r.score}/100</span>
                        </div>
                      </div>
                      {cmd && (
                        <details style={{ marginTop:6 }}>
                          <summary style={{ fontSize:11, color:C.accent, cursor:'pointer', userSelect:'none' }}>📋 Export commands (run locally)</summary>
                          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:6, marginBottom:4 }}>
                            <button onClick={()=>copyText(cmd)} style={{ background:C.accentM, border:`1px solid ${C.borderFocus}`, borderRadius:6, color:C.accent, cursor:'pointer', fontSize:11, padding:'3px 10px', fontFamily:'inherit' }}>Copy all</button>
                          </div>
                          <pre style={{ margin:0, background:'#050508', borderRadius:8, padding:'10px 12px', fontSize:11, color:C.green, overflowX:'auto', whiteSpace:'pre-wrap', lineHeight:1.6, border:`1px solid ${C.border}` }}>{cmd}</pre>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Karaoke captions preview */}
          {(() => {
            const words = analysis.shortScript
              ? analysis.shortScript.split(' ').map((w,i,arr) => ({ word:w, start:i*(analysis.clipRanges?.[0]?.end||60)/arr.length, end:(i+1)*(analysis.clipRanges?.[0]?.end||60)/arr.length }))
              : []
            return (
              <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
                <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>🎬 Karaoke Caption Style</p>
                <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
                  {['highlight','pop','bounce','fade'].map(s => (
                    <button key={s} onClick={()=>setKaraokeStyle(s)}
                      style={{ padding:'5px 14px', borderRadius:99, border:`1px solid ${karaokeStyle===s?C.accent:C.border}`, background:karaokeStyle===s?C.accentM:'transparent', color:karaokeStyle===s?C.accent:C.t2, cursor:'pointer', fontSize:12, fontFamily:'inherit', textTransform:'capitalize', transition:'all .15s' }}>
                      {s}
                    </button>
                  ))}
                </div>
                <div style={{ background:'#000', borderRadius:8, padding:'14px 18px', minHeight:48, display:'flex', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                  {analysis.shortScript
                    ? analysis.shortScript.slice(0,80).split(' ').map((w,i) => (
                        <span key={i} style={{ display:'inline-block', padding:'2px 6px', borderRadius:5, fontSize:14, fontWeight:500, background:karaokeStyle==='highlight'?C.accent:'rgba(255,255,255,.08)', color:'#fff', transform:karaokeStyle==='pop'?'scale(1.1)':'scale(1)', transition:'all .15s' }}>{w}</span>
                      ))
                    : <span style={{ color:C.t3, fontSize:12 }}>Run analysis above to preview captions</span>
                  }
                </div>
              </div>
            )
          })()}

          {/* Smart reframe */}
          <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
            <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>📱 Smart Reframe</p>
            <div style={{ display:'flex', gap:8 }}>
              {[{id:'9:16',label:'9:16',desc:'Shorts · TikTok · Reels',icon:'▮'},{id:'1:1',label:'1:1',desc:'Instagram',icon:'◼'},{id:'16:9',label:'16:9',desc:'YouTube',icon:'▬'}].map(r => (
                <button key={r.id} onClick={()=>setAspectRatio(r.id)}
                  style={{ flex:1, padding:'12px 8px', borderRadius:10, border:`2px solid ${aspectRatio===r.id?C.accent:C.border}`, background:aspectRatio===r.id?C.accentM:'transparent', cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'center', gap:3, transition:'all .15s' }}>
                  <span style={{ fontSize:18, color:aspectRatio===r.id?C.accent:C.t2 }}>{r.icon}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:aspectRatio===r.id?C.accent:C.t1 }}>{r.label}</span>
                  <span style={{ fontSize:10, color:C.t3, textAlign:'center' }}>{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* AI voice dub */}
          <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
            <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>🔊 AI Voice Dub</p>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={()=>handleDub('male')} disabled={dubStatus==='loading'}
                style={{ padding:'8px 16px', borderRadius:10, border:`1px solid ${C.borderFocus}`, background:C.accentM, color:C.accent, cursor:dubStatus==='loading'?'not-allowed':'pointer', fontSize:13, fontFamily:'inherit', opacity:dubStatus==='loading'?0.6:1, transition:'all .15s' }}>
                {dubStatus==='loading'?'⏳ Generating…':'♂ Male Voice (Brian)'}
              </button>
              <button onClick={()=>handleDub('female')} disabled={dubStatus==='loading'}
                style={{ padding:'8px 16px', borderRadius:10, border:`1px solid ${C.borderFocus}`, background:C.accentM, color:C.accent, cursor:dubStatus==='loading'?'not-allowed':'pointer', fontSize:13, fontFamily:'inherit', opacity:dubStatus==='loading'?0.6:1, transition:'all .15s' }}>
                ♀ Female Voice
              </button>
              {dubStatus==='done' && <span style={{ fontSize:12, color:C.green, alignSelf:'center' }}>✅ Downloaded</span>}
            </div>
            <p style={{ margin:'8px 0 0', fontSize:11, color:C.t3 }}>Premium voices require ELEVENLABS_API_KEY to be configured on the server.</p>
          </div>

          {/* Export settings */}
          <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
            <p style={{ margin:'0 0 14px', fontSize:13, fontWeight:600, color:C.t1 }}>⚙️ Export Configuration</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              {[['Resolution','resolution',['1080p','1440p','4K']],['FPS','fps',['30','60']],['Codec','codec',[{v:'h264',l:'H.264'},{v:'h265',l:'H.265'}]],['Bitrate','bitrateControl',['CBR','VBR']]].map(([label,key,opts]) => (
                <div key={key}>
                  <label style={{ display:'block', fontSize:11, color:C.t3, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>{label}</label>
                  <select value={exportSettings[key]} onChange={e=>setExportSettings(s=>({...s,[key]:key==='fps'?Number(e.target.value):e.target.value}))}
                    style={{ width:'100%', background:'rgba(255,255,255,.03)', border:`1px solid ${C.border}`, borderRadius:7, color:C.t1, fontSize:13, padding:'7px 10px', fontFamily:'inherit', outline:'none', cursor:'pointer' }}>
                    {opts.map(o => typeof o==='string' ? <option key={o}>{o}</option> : <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:16 }}>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:C.t2, cursor:'pointer' }}>
                <input type="checkbox" checked={exportSettings.includeCaptions} onChange={e=>setExportSettings(s=>({...s,includeCaptions:e.target.checked}))} style={{ accentColor:C.accent }} /> Burn captions
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:C.t2, cursor:'pointer' }}>
                <input type="checkbox" checked={exportSettings.includeAudioDub} onChange={e=>setExportSettings(s=>({...s,includeAudioDub:e.target.checked}))} style={{ accentColor:C.accent }} /> AI Voice Dub
              </label>
            </div>
          </div>

          {/* Export summary card */}
          <div style={{ background:'rgba(99,102,241,.06)', border:`1px solid ${C.borderFocus}`, borderRadius:12, padding:18 }}>
            <p style={{ margin:'0 0 8px', fontSize:13, fontWeight:700, color:C.accent }}>🚀 Your Clip is Configured</p>
            <p style={{ margin:'0 0 12px', fontSize:12, color:C.t2, lineHeight:1.6 }}>
              Format: <strong style={{color:C.t1}}>{aspectRatio}</strong> · Captions: <strong style={{color:C.t1}}>{karaokeStyle}</strong> · Export: <strong style={{color:C.t1}}>{exportSettings.resolution} {exportSettings.fps}fps {exportSettings.codec.toUpperCase()}</strong>
            </p>
            <p style={{ margin:'0 0 10px', fontSize:12, color:C.t3 }}>
              Copy the FFmpeg commands above to export locally in seconds — or open in CapCut / DaVinci Resolve with these timestamps.
            </p>
            {analysis.clipRanges?.[0] && videoId && (
              <a href={`https://www.youtube.com/watch?v=${videoId}&t=${analysis.clipRanges[0].start}s`} target="_blank" rel="noopener noreferrer"
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, background:C.accent, color:'#fff', textDecoration:'none', fontSize:13, fontWeight:600, transition:'all .15s' }}>
                ▶ Open at best moment on YouTube
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CODE AI ──────────────────────────────────────────────────
const LANGS=['JavaScript','TypeScript','Python','React','HTML/CSS','Rust','Go','Swift','SQL','Bash']
const EXT_BY_LANG2 = { JavaScript:'js', TypeScript:'ts', Python:'py', React:'jsx', 'HTML/CSS':'html', Rust:'rs', Go:'go', Swift:'swift', SQL:'sql', Bash:'sh' }
const IMPROVE_FOCUSES = ['Performance','Security','Accessibility','Mobile','SEO','Readability','Best Practices']
const WS_TABS = [
  { id:'code',    label:'Code',    icon:'{ }' },
  { id:'preview', label:'Preview', icon:'▶' },
  { id:'explain', label:'Explain', icon:'💡' },
  { id:'files',   label:'Files',   icon:'📁' },
  { id:'tests',   label:'Tests',   icon:'🧪' },
  { id:'terminal',label:'Terminal',icon:'>_' },
]

function CodeAIPage({ user }) {
  // ── Core state (kept from the original implementation) ──────
  const [desc, setDesc]     = useState('')
  const [code, setCode]     = useState('')
  const [loading, setL]     = useState(false)
  const [act, setAct]       = useState(null)

  useEffect(() => {
    const h = flConsumeHandoff('code')
    if (h?.code) { setCode(h.code); toast('Loaded from Builder', 'success') }
    if (h?.desc) setDesc(h.desc)
  }, [])

  // ── Language auto-detection (new) ────────────────────────────
  const [manualLang, setManualLang] = useState(null)     // user override, null = auto
  const [advancedOpen, setAdvOpen]  = useState(false)
  const detected = detectFromDescription(desc) || detectLanguage(code)
  const lang = manualLang || detected || 'JavaScript'

  // ── Workspace output state ───────────────────────────────────
  const [tab, setTab]         = useState('code')
  const [rawOut, setRawOut]   = useState('')      // last raw AI response (generate/improve)
  const [explainOut, setExplainOut] = useState('')
  const [reviewIssues, setReviewIssues] = useState(null) // parsed [{severity,title,why,fix,fixedCode}]
  const [reviewRaw, setReviewRaw] = useState('')
  const [testsOut, setTestsOut]   = useState('')
  const [terminalOut, setTerminalOut] = useState('')
  const [improveFocus, setImproveFocus] = useState(new Set())

  // ── Imported codebase (GitHub / uploaded project) ────────────
  const [codebase, setCodebase]   = useState(null) // { files:[{path,content}], source, label }
  const [ghInput, setGhInput]     = useState('')
  const [importing, setImporting] = useState(false)
  const zipInputRef = useRef(null)

  // ── GitHub push / deploy ──────────────────────────────────────
  const [ghPat, setGhPat]         = useState(getGithubToken)
  const [ghRepoName, setGhRepoName] = useState('')
  const [ghRepoUrl, setGhRepoUrl] = useState('')
  const [pushing, setPushing]     = useState(false)
  const [showGhForm, setShowGhForm] = useState(false)

  const files = parseFiles(rawOut || code, 'main', EXT_BY_LANG2[lang] || 'txt')
  const previewable = isPreviewable(files)

  const SYS = `You are a senior ${lang} software engineer. Always:
- Write clean, production-ready code with clear comments
- Follow current best practices and idiomatic patterns for ${lang}
- Include error handling where appropriate
- Prefix multi-file responses with a filename comment (e.g. "// file: src/App.jsx") before each fenced block
- Keep prose explanation OUTSIDE the code fences so it can be shown separately`

  function saveGhPat(value) { setGithubToken(value); setGhPat(value) }

  // ── Generate / Explain / Improve ─────────────────────────────
  async function run(action, prompt, opts = {}) {
    setAct(action); setL(true); sb.logEvent('code','code')
    const r = await ai([{ role:'user', content: prompt }], SYS, 2400)
    if (opts.into === 'rawOut') { setRawOut(r); setTab('code') }
    if (opts.into === 'explainOut') { setExplainOut(r); setTab('explain') }
    if (opts.into === 'testsOut') { setTestsOut(r); setTab('tests') }
    if (opts.into === 'terminalOut') { setTerminalOut(r); setTab('terminal') }
    setL(false)
    return r
  }

  function generate() {
    if (!desc.trim()) return toast('Describe what to build first', 'error')
    run('gen', `Write clean, well-commented ${lang} code that: ${desc}`, { into:'rawOut' })
  }

  function explain() {
    const src = code.trim() || rawOut
    if (!src) return toast('Paste or generate code first', 'error')
    run('exp', `Explain this ${lang} code clearly — what it does, how it works, and the key patterns used:\n\n${src}`, { into:'explainOut' })
  }

  async function debugReview() {
    const src = code.trim() || rawOut
    if (!src) return toast('Paste or generate code first', 'error')
    setAct('dbg'); setL(true); sb.logEvent('code','code')
    const prompt = `Perform a professional code review of this ${lang} code. Categorise every issue found by severity.

${src}

Return ONLY valid JSON, no markdown fences, no prose outside the JSON, in exactly this shape:
{"issues":[{"severity":"critical|warning|suggestion","title":"short title","why":"why this happens / why it matters","fix":"how to fix it, in plain English","fixedCode":"a short corrected code snippet, or null if not applicable"}]}

If the code has no issues, return {"issues":[]}.`
    const r = await ai([{ role:'user', content: prompt }], SYS, 2400)
    try {
      const jsonMatch = r.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : r)
      setReviewIssues(Array.isArray(parsed.issues) ? parsed.issues : [])
      setReviewRaw('')
    } catch {
      setReviewIssues(null)
      setReviewRaw(r)
    }
    setTab('explain'); setL(false)
  }

  function improve() {
    const src = code.trim() || rawOut
    if (!src) return toast('Paste or generate code first', 'error')
    const focuses = [...improveFocus]
    const focusLine = focuses.length ? `Specifically optimise for: ${focuses.join(', ')}.` : 'Improve overall readability, performance, and best practices.'
    run('imp', `Improve this ${lang} code. ${focusLine} Explain what you changed and why (outside the code fence), then give the improved code:\n\n${src}`, { into:'rawOut' })
  }

  async function generateTests() {
    const src = code.trim() || rawOut
    if (!src) return toast('Paste or generate code first', 'error')
    setAct('tst'); setL(true); sb.logEvent('code','code')
    const prompt = `Write comprehensive tests for this ${lang} code: unit tests, integration tests, and edge cases.

${src}

After the test code, add a section titled "AI-Estimated Coverage" listing:
- Scenarios covered
- Scenarios NOT covered / recommended additional tests
This is an AI estimate, not a real coverage tool — label it as such.`
    const r = await ai([{ role:'user', content: prompt }], SYS, 2400)
    setTestsOut(r); setTab('tests'); setL(false)
  }

  async function generateTerminal() {
    setAct('term'); setL(true)
    const prompt = `For this ${lang} project, list the exact terminal commands to: 1) install dependencies, 2) run it locally, 3) run tests, 4) build for production, 5) deploy. Use realistic tooling for ${lang}. Format as labelled shell code blocks, no extra prose.`
    const r = await ai([{ role:'user', content: prompt }], SYS, 800)
    setTerminalOut(r); setTab('terminal'); setL(false)
  }

  // ── GitHub import ─────────────────────────────────────────────
  async function importGithub() {
    const m = ghInput.trim().match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/)
    if (!m) return toast('Enter a repo as owner/repo or a GitHub URL', 'error')
    const [, owner, repo] = m
    setImporting(true)
    try {
      const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
      if (!metaRes.ok) throw new Error(metaRes.status === 404 ? 'Repository not found (must be public)' : `GitHub error ${metaRes.status}`)
      const meta = await metaRes.json()
      const branch = meta.default_branch || 'main'
      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`)
      if (!treeRes.ok) throw new Error('Could not read repository file tree')
      const tree = await treeRes.json()
      const candidates = (tree.tree || [])
        .filter(t => t.type === 'blob' && t.size < 40000)
        .filter(t => !/node_modules|\.git\/|dist\/|build\/|\.lock$|\.png$|\.jpg$|\.jpeg$|\.gif$|\.svg$|\.ico$|\.woff|\.ttf/i.test(t.path))
        .sort((a,b) => {
          const score = p => /readme/i.test(p) ? 0 : /package\.json|requirements\.txt|cargo\.toml|go\.mod/i.test(p) ? 1 : /^src\//i.test(p) ? 2 : 3
          return score(a.path) - score(b.path)
        })
        .slice(0, 18)

      const filesList = []
      for (const t of candidates) {
        try {
          const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${t.path}`)
          if (r.ok) filesList.push({ path: t.path, content: await r.text() })
        } catch {}
      }
      if (!filesList.length) throw new Error('No readable source files found')
      setCodebase({ files: filesList, source: 'github', label: `${owner}/${repo}` })
      toast(`Imported ${filesList.length} files from ${owner}/${repo}`, 'success')
      await analyzeCodebase(filesList, `${owner}/${repo}`)
    } catch (e) {
      toast(e.message, 'error')
    }
    setImporting(false)
  }

  async function handleZipUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!zipSupported) return toast('ZIP import needs a modern browser (Chrome, Edge, or Safari 16.4+)', 'error')
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const entries = await readZip(buf)
      const textFiles = entries
        .filter(f => !/\.(png|jpe?g|gif|svg|ico|woff2?|ttf|eot|zip|jar|exe|dll|so)$/i.test(f.path))
        .filter(f => !/node_modules|\.git\//i.test(f.path))
        .slice(0, 30)
        .map(f => ({ path: f.path, content: new TextDecoder().decode(f.content) }))
      if (!textFiles.length) throw new Error('No readable source files found in the ZIP')
      setCodebase({ files: textFiles, source: 'upload', label: file.name })
      toast(`Imported ${textFiles.length} files from ${file.name}`, 'success')
      await analyzeCodebase(textFiles, file.name)
    } catch (e) {
      toast('Import failed: ' + e.message, 'error')
    }
    setImporting(false)
  }

  async function analyzeCodebase(filesList, label) {
    setL(true); setAct('analyze')
    const bundle = filesList.map(f => `--- ${f.path} ---\n${f.content.slice(0, 2000)}`).join('\n\n').slice(0, 14000)
    const prompt = `You imported the codebase "${label}". Analyse it and explain:
1. What this project is and its architecture (frameworks, structure, key modules)
2. Any bugs or issues you can see
3. Concrete suggestions for improvement
4. How to continue developing it

Files:
${bundle}`
    const r = await ai([{ role:'user', content: prompt }], 'You are a senior software engineer reviewing an unfamiliar codebase for the first time.', 3000)
    setExplainOut(r); setTab('explain'); setL(false)
  }

  // ── One-click actions ──────────────────────────────────────────
  async function downloadZip() {
    const list = codebase?.files?.length ? codebase.files : files
    try {
      const r = await downloadProjectZip(list, codebase?.label || 'founderlab-code')
      toast(r.fallback ? 'Downloaded files individually (ZIP not supported in this browser)' : 'ZIP downloaded', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  async function pushToGithub() {
    const list = codebase?.files?.length ? codebase.files : files
    if (!list.length) return toast('Nothing to push yet', 'error')
    if (!ghPat || !ghRepoName.trim()) { setShowGhForm(true); return }
    setPushing(true)
    try {
      const { repoUrl } = await pushToGithubShared({ files: list, repoName: ghRepoName, token: ghPat })
      setGhRepoUrl(repoUrl)
      setShowGhForm(false)
      toast('Pushed to GitHub', 'success')
    } catch (e) {
      toast(e.message, 'error')
    }
    setPushing(false)
  }

  function deployToVercel() {
    try { openVercelDeploy(ghRepoUrl) } catch (e) { toast(e.message, 'error') }
  }

  async function saveAsProject() {
    const list = codebase?.files?.length ? codebase.files : files
    if (!list.length) return toast('Nothing to save yet', 'error')
    const projects = await load('fl_projects', [])
    const project = { id: uid(), name: codebase?.label || desc.slice(0,40) || 'Untitled project', language: lang, files: list, created_at: ts(), updated_at: ts() }
    await save('fl_projects', [project, ...(Array.isArray(projects)?projects:[])])
    toast('Saved as Project', 'success')
  }

  function continueInBuilder() {
    const previewDoc = buildPreviewDoc(files)
    flNavigate('builder', { desc: desc || `Continue building this ${lang} project`, html: previewDoc || undefined })
    toast('Opening in Builder…', 'success')
  }

  function continueInChat() {
    const src = code.trim() || rawOut
    flNavigate('chat', { message: `Here's ${lang} code I was working on in Code AI:\n\n${src.slice(0,3000)}\n\nHelp me continue from here.` })
    toast('Opening in AI Chat…', 'success')
  }

  const hasOutput = !!(rawOut || explainOut || testsOut || terminalOut || reviewIssues || reviewRaw)
  const SEV_COLOR = { critical: C.red, warning: C.yellow, suggestion: C.accent }
  const SEV_LABEL = { critical: 'Critical', warning: 'Warning', suggestion: 'Suggestion' }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding:'16px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:C.t1 }}>Code AI</h2>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Badge color={detected ? 'green' : 'accent'}>
              {manualLang ? `Language: ${manualLang}` : detected ? `Detected: ${detected}` : `Default: ${lang}`}
            </Badge>
            <button onClick={() => setAdvOpen(v => !v)}
              style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, color:C.t2, cursor:'pointer', fontSize:12, padding:'5px 10px', fontFamily:'inherit' }}>
              ⚙ Advanced
            </button>
          </div>
        </div>
        {advancedOpen && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:12 }}>
            <button onClick={() => setManualLang(null)}
              style={{ padding:'5px 12px', borderRadius:999, border:`1px solid ${!manualLang?C.accent:C.border}`, background:!manualLang?C.accentM:'transparent', color:!manualLang?C.accent:C.t2, cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
              Auto
            </button>
            {LANGS.map(l => (
              <button key={l} onClick={() => setManualLang(l)}
                style={{ padding:'5px 12px', borderRadius:999, border:`1px solid ${manualLang===l?C.accent:C.border}`, background:manualLang===l?C.accentM:'transparent', color:manualLang===l?C.accent:C.t2, cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* ── Left: input pane ── */}
        <div style={{ width:'42%', borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', overflowY:'auto' }}>
          <div style={{ padding:16, borderBottom:`1px solid ${C.border}` }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Describe what to build</label>
            <Input rows={3} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Describe the code to generate — language is detected automatically…" style={{ marginBottom:8, fontSize:13 }} />
            <Button onClick={generate} disabled={loading||!desc.trim()} full size="sm">
              {loading&&act==='gen'?<Spinner size={13} color="#fff"/>:'✨'} Generate {lang}
            </Button>
          </div>

          <div style={{ padding:16, borderBottom:`1px solid ${C.border}` }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Paste existing code</label>
            <textarea value={code} onChange={e=>setCode(e.target.value)} placeholder="Paste your code here…"
              style={{ width:'100%', height:140, background:'#050508', border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontFamily:'monospace', fontSize:12, padding:12, outline:'none', resize:'vertical', lineHeight:1.6, boxSizing:'border-box' }} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:8 }}>
              <Button onClick={explain} disabled={loading} variant="secondary" size="sm">{loading&&act==='exp'?<Spinner size={12} color={C.accent}/>:'📖'} Explain</Button>
              <Button onClick={debugReview} disabled={loading} variant="secondary" size="sm">{loading&&act==='dbg'?<Spinner size={12} color={C.accent}/>:'🐛'} Code Review</Button>
              <Button onClick={improve} disabled={loading} variant="secondary" size="sm">{loading&&act==='imp'?<Spinner size={12} color={C.accent}/>:'⬆'} Improve</Button>
              <Button onClick={generateTests} disabled={loading} variant="secondary" size="sm">{loading&&act==='tst'?<Spinner size={12} color={C.accent}/>:'🧪'} Tests</Button>
            </div>
            <div style={{ marginTop:10 }}>
              <p style={{ margin:'0 0 6px', fontSize:11, color:C.t3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>Improve focus (optional)</p>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {IMPROVE_FOCUSES.map(f => {
                  const on = improveFocus.has(f)
                  return (
                    <button key={f} onClick={() => setImproveFocus(s => { const n=new Set(s); n.has(f)?n.delete(f):n.add(f); return n })}
                      style={{ padding:'4px 10px', borderRadius:999, border:`1px solid ${on?C.accent:C.border}`, background:on?C.accentM:'transparent', color:on?C.accent:C.t2, cursor:'pointer', fontSize:11, fontFamily:'inherit', transition:'all .15s' }}>
                      {f}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Import codebase ── */}
          <div style={{ padding:16 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Import a project</label>
            <div style={{ display:'flex', gap:6, marginBottom:8 }}>
              <Input value={ghInput} onChange={e=>setGhInput(e.target.value)} placeholder="owner/repo or GitHub URL" style={{ flex:1, fontSize:13 }} onKeyDown={e=>e.key==='Enter'&&importGithub()} />
              <Button onClick={importGithub} disabled={importing||!ghInput.trim()} variant="secondary" size="sm">
                {importing?<Spinner size={12} color={C.accent}/>:'🔗'} Import
              </Button>
            </div>
            <input ref={zipInputRef} type="file" accept=".zip" style={{ display:'none' }} onChange={handleZipUpload} />
            <Button onClick={() => zipInputRef.current?.click()} disabled={importing} variant="secondary" size="sm" full>
              ⬆ Upload project (.zip)
            </Button>
            {codebase && (
              <div style={{ marginTop:8, padding:'8px 10px', background:C.surf, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.t2 }}>
                📁 {codebase.label} — {codebase.files.length} files loaded
              </div>
            )}
          </div>
        </div>

        {/* ── Right: workspace ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {/* Tab bar */}
          <div style={{ display:'flex', alignItems:'center', borderBottom:`1px solid ${C.border}`, flexShrink:0, padding:'0 8px', overflowX:'auto' }}>
            {WS_TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding:'11px 14px', background:'none', border:'none', borderBottom:`2px solid ${tab===t.id?C.accent:'transparent'}`, color:tab===t.id?C.t1:C.t3, cursor:'pointer', fontSize:13, fontWeight:tab===t.id?600:400, fontFamily:'inherit', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap', transition:'all .15s' }}>
                <span style={{ fontSize:11 }}>{t.icon}</span> {t.label}
              </button>
            ))}
            <div style={{ marginLeft:'auto', display:'flex', gap:6, padding:'6px 0' }}>
              {(rawOut || code) && <Button onClick={()=>copyText(rawOut||code)} variant="secondary" size="sm">📋 Copy</Button>}
            </div>
          </div>

          {/* Tab content */}
          <div style={{ flex:1, overflowY:'auto', padding:16 }}>
            {loading ? (
              <div style={{ display:'flex', alignItems:'center', gap:10, color:C.t2, fontSize:14 }}><Spinner />Working…</div>
            ) : (
              <>
                {tab === 'code' && (
                  files.length ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      {files.map((f,i) => (
                        <div key={i} style={{ border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 12px', background:C.surfHigh, fontSize:11, color:C.t2, fontFamily:'monospace' }}>
                            <span>{f.path}</span>
                            <button onClick={()=>copyText(f.content)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>📋</button>
                          </div>
                          <pre style={{ margin:0, padding:12, fontFamily:'monospace', fontSize:12.5, color:C.t1, whiteSpace:'pre-wrap', lineHeight:1.6, overflowX:'auto' }}>{f.content}</pre>
                        </div>
                      ))}
                    </div>
                  ) : <EmptyState icon="{ }" title="No code yet" description="Generate or paste code on the left to see it here." />
                )}

                {tab === 'preview' && (
                  previewable ? (
                    <iframe title="Live preview" srcDoc={buildPreviewDoc(files)} sandbox={GENERATED_PREVIEW_SANDBOX} referrerPolicy={GENERATED_PREVIEW_REFERRER_POLICY}
                      style={{ width:'100%', height:'100%', minHeight:400, border:`1px solid ${C.border}`, borderRadius:8, background:'#fff' }} />
                  ) : <EmptyState icon="▶" title="No preview available" description="Live preview works for HTML/CSS/JS output. Generate a website or frontend component to preview it here." />
                )}

                {tab === 'explain' && (
                  <>
                    {explainOut && <div style={{ fontSize:14, color:C.t1, lineHeight:1.75, marginBottom: reviewIssues||reviewRaw ? 24 : 0 }}>{renderMsg(explainOut)}</div>}
                    {reviewIssues && (
                      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                        <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.t1 }}>Code Review — {reviewIssues.length} issue{reviewIssues.length!==1?'s':''} found</p>
                        {reviewIssues.length === 0 && <p style={{ margin:0, fontSize:13, color:C.green }}>✅ No issues found.</p>}
                        {reviewIssues.map((iss,i) => (
                          <div key={i} style={{ border:`1px solid ${C.border}`, borderRadius:10, padding:14, borderLeft:`3px solid ${SEV_COLOR[iss.severity]||C.t3}` }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                              <Badge color={iss.severity==='critical'?'red':iss.severity==='warning'?'yellow':'accent'}>{SEV_LABEL[iss.severity]||iss.severity}</Badge>
                              <span style={{ fontSize:13, fontWeight:600, color:C.t1 }}>{iss.title}</span>
                            </div>
                            {iss.why && <p style={{ margin:'0 0 6px', fontSize:13, color:C.t2 }}>{iss.why}</p>}
                            {iss.fix && <p style={{ margin:'0 0 6px', fontSize:13, color:C.t2 }}><strong style={{color:C.t1}}>Fix:</strong> {iss.fix}</p>}
                            {iss.fixedCode && (
                              <div style={{ marginTop:8 }}>
                                <pre style={{ margin:0, background:'#050508', border:`1px solid ${C.border}`, borderRadius:6, padding:10, fontFamily:'monospace', fontSize:12, color:C.green, whiteSpace:'pre-wrap', overflowX:'auto' }}>{iss.fixedCode}</pre>
                                <button onClick={()=>{ setRawOut(iss.fixedCode); setTab('code'); toast('Applied to Code tab','success') }}
                                  style={{ marginTop:6, background:C.accentM, border:`1px solid ${C.borderFocus}`, borderRadius:6, color:C.accent, cursor:'pointer', fontSize:11, padding:'4px 10px', fontFamily:'inherit' }}>
                                  Apply fix →
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {reviewRaw && <div style={{ fontSize:14, color:C.t1, lineHeight:1.75 }}>{renderMsg(reviewRaw)}</div>}
                    {!explainOut && !reviewIssues && !reviewRaw && <EmptyState icon="💡" title="No explanation yet" description="Click Explain or Code Review on the left to analyse your code." />}
                  </>
                )}

                {tab === 'files' && (
                  files.length ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                      {files.map((f,i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:C.surf, borderRadius:8, border:`1px solid ${C.border}` }}>
                          <span style={{ fontSize:14 }}>📄</span>
                          <span style={{ flex:1, fontSize:13, color:C.t1, fontFamily:'monospace' }}>{f.path}</span>
                          <span style={{ fontSize:11, color:C.t3 }}>{f.content.length.toLocaleString()} chars</span>
                        </div>
                      ))}
                    </div>
                  ) : <EmptyState icon="📁" title="No files yet" description="Generated or imported files will be listed here." />
                )}

                {tab === 'tests' && (
                  testsOut ? <div style={{ fontSize:14, color:C.t1, lineHeight:1.75 }}>{renderMsg(testsOut)}</div>
                    : <EmptyState icon="🧪" title="No tests yet" description="Click Tests on the left to generate unit, integration, and edge-case tests with a coverage estimate." />
                )}

                {tab === 'terminal' && (
                  <div>
                    {terminalOut ? (
                      <div style={{ fontSize:13, color:C.t1, lineHeight:1.7 }}>{renderMsg(terminalOut)}</div>
                    ) : (
                      <EmptyState icon=">_" title="No commands yet" description="Generate suggested install / run / build / deploy commands for this project." action={
                        <Button onClick={generateTerminal} disabled={loading} size="sm">{loading&&act==='term'?<Spinner size={12} color="#fff"/>:'>_'} Suggest commands</Button>
                      } />
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── One-click actions ── */}
          {(hasOutput || codebase) && (
            <div style={{ borderTop:`1px solid ${C.border}`, padding:'10px 16px', flexShrink:0 }}>
              {showGhForm && (
                <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                  <Input value={ghRepoName} onChange={e=>setGhRepoName(e.target.value)} placeholder="new-repo-name" style={{ flex:1, minWidth:140, fontSize:12 }} />
                  <input type="password" value={ghPat} onChange={e=>saveGhPat(e.target.value)} placeholder="GitHub token (this session only)"
                    autoComplete="off"
                    style={{ flex:1, minWidth:160, background:C.surf, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:12, padding:'8px 10px', fontFamily:'inherit', outline:'none' }} />
                  <Button onClick={pushToGithub} disabled={pushing} size="sm">{pushing?<Spinner size={12} color="#fff"/>:'🚀'} Push</Button>
                </div>
              )}
              {ghRepoUrl && (
                <p style={{ margin:'0 0 8px', fontSize:12, color:C.green }}>
                  ✅ Pushed — <a href={ghRepoUrl} target="_blank" rel="noopener noreferrer" style={{ color:C.accent }}>{ghRepoUrl}</a>
                </p>
              )}
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                <Button onClick={downloadZip} variant="secondary" size="sm">⬇ Download ZIP</Button>
                <Button onClick={pushToGithub} disabled={pushing} variant="secondary" size="sm">{pushing?<Spinner size={12} color={C.accent}/>:'🐙'} Push to GitHub</Button>
                <Button onClick={deployToVercel} variant="secondary" size="sm">▲ Deploy to Vercel</Button>
                <Button onClick={continueInBuilder} variant="secondary" size="sm">⬡ Continue in Builder</Button>
                <Button onClick={continueInChat} variant="secondary" size="sm">💬 Continue in AI Chat</Button>
                <Button onClick={saveAsProject} variant="secondary" size="sm">💾 Save as Project</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── WEBSITE BUILDER ───────────────────────────────────────────
const BSTYLES=['Dark Modern','Clean Minimal','Bold Startup','Luxury Premium']
const BGUIDES={
  'Dark Modern':'dark background #09090f, indigo/purple gradient accents (#6366f1 → #a855f7), white text, glassmorphism cards with backdrop-blur, subtle glow effects',
  'Clean Minimal':'white background, black text, generous whitespace, minimal sans-serif typography, soft shadows instead of borders, restrained accent color',
  'Bold Startup':'vibrant purple-to-pink gradient background, bold large white typography, energetic high-contrast layout, playful micro-interactions',
  'Luxury Premium':'deep black background, gold (#d4af37) accents, elegant serif display type paired with clean sans body text, generous negative space',
}

const FILE_CONVENTIONS = `STRICT FILE CONVENTIONS (required — the code must compile with a simple in-browser transform, so follow these exactly):
- Every file has EXACTLY ONE export: "export default function ComponentName(props) { ... }" — always a named function declaration, never an arrow const, never additional named exports.
- Use TypeScript prop types/interfaces freely.
- Import shared components as: import ComponentName from '@/components/ComponentName'
- For navigation use: import Link from 'next/link'  — and  import { useRouter, usePathname } from 'next/navigation'
- NEVER use next/image or any external image URL. Build all visuals with Tailwind gradients, CSS shapes, or inline SVG icons only.
- Add 'use client' at the top of any file using useState/useEffect/onClick/form handlers.
- Style EXCLUSIVELY with raw Tailwind CSS utility classes written directly in every className — backdrop-blur-xl, bg-white/5, border border-white/10, rounded-2xl, gradient backgrounds, generous padding, transition-all duration-300, hover:scale-[1.02], hover:shadow-xl hover:shadow-indigo-500/20 — on every interactive element. NEVER define custom classes via @layer/@apply in globals.css and reference them by name (e.g. never className="glass-panel") — always write the full utility class list inline on every element, every time, even if repetitive. globals.css should only contain the three @tailwind directives, a font import if needed, and plain standard CSS (@keyframes, global resets) — nothing that requires a build step to resolve.
- Every visible button must have a real onClick — navigation buttons use <Link>, action buttons use real React state (toggle, form submit with validation, modal open/close). No dead buttons.
- Never use lorem ipsum or generic placeholder copy — write real, specific, compelling copy for this exact product.
- Every <Link href> must point to one of: / /features /pricing /about /contact /dashboard /login /signup — never a broken or fake link.
- Prefix each file with a comment line exactly like: // file: components/Navbar.tsx
- Return each file as its own separate fenced code block.`

async function callGenAI(prompt, maxTokens = 4000) {
  return ai([{ role:'user', content: prompt }], 'You are a senior product designer and frontend engineer at a top design studio, building premium, modern, production-quality Next.js 14 App Router + TypeScript + Tailwind CSS SaaS websites. Every pixel is intentional. Nothing looks like a template.', maxTokens)
}

// Runs one generation call, verifies every expected file path came back,
// and retries (with a reinforcing reminder) if any are missing — up to
// `retries` times. Throws immediately with the real provider error message
// if the AI call itself failed (never silently swallowed into "incomplete").
async function genBatch(prompt, expectedPaths, maxTokens = 4000, retries = 1) {
  let lastFiles = []
  for (let attempt = 0; attempt <= retries; attempt++) {
    const p = attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: Your previous response was missing these required files — you MUST include ALL of them this time, each as its own complete fenced code block: ${expectedPaths.filter(ep => !lastFiles.some(f => f.path === ep)).join(', ')}`
    const r = await callGenAI(p, maxTokens)
    if (typeof r === 'string' && r.startsWith('⚠')) {
      // Real provider/connection error — surface it immediately, don't retry blindly
      throw new Error(r.replace(/^⚠\s*/, ''))
    }
    const parsed = parseFiles(r, 'gen', 'tsx').filter(f => f.path !== 'gen.tsx')
    lastFiles = parsed
    const missing = expectedPaths.filter(ep => !parsed.some(f => f.path === ep))
    if (missing.length === 0) return { files: parsed, missing: [] }
  }
  const missing = expectedPaths.filter(ep => !lastFiles.some(f => f.path === ep))
  return { files: lastFiles, missing }
}

// ── Persistent project storage (shared fl_projects key with Code AI) ─────
async function loadAllProjects() {
  const p = await load('fl_projects', [])
  return Array.isArray(p) ? p : []
}
async function persistProject(project) {
  const all = await loadAllProjects()
  const idx = all.findIndex(p => p.id === project.id)
  const updated = idx === -1 ? [project, ...all] : all.map(p => p.id === project.id ? project : p)
  await save('fl_projects', updated)
  return updated
}

function BuilderPage({ user }) {
  // ── Describe & plan ───────────────────────────────────────────
  const [desc,setDesc]       = useState('')
  const [style,setStyle]     = useState('Dark Modern')
  const [overview,setOverview] = useState(null)
  const [missingAnswers,setMissingAnswers] = useState({})
  const [stage,setStage]     = useState(null)      // null | 'planning' | 'generating' | 'editing'
  const [stageDetail,setStageDetail] = useState('')

  // ── Project (persistent memory) ─────────────────────────────────
  const [projects,setProjects]   = useState([])
  const [projectId,setProjectId] = useState(null)
  const saveTimer = useRef(null)

  // ── Output / versions ───────────────────────────────────────────
  const [files,setFiles]       = useState([])       // real separate project files (components + pages + globals.css + layout.tsx)
  const [versions,setVersions] = useState([])        // [{id,label,files,ts}]
  const [activeIdx,setActiveIdx] = useState(-1)
  const [view,setView]         = useState('preview')
  const [activeFile,setActiveFile] = useState(null)  // path, for code view
  const [editIn,setEditIn]     = useState('')

  // ── Export / GitHub ──────────────────────────────────────────────
  const [ghPat,setGhPat]         = useState(getGithubToken)
  const [ghRepoName,setGhRepoName] = useState('')
  const [ghRepoUrl,setGhRepoUrl] = useState('')
  const [showGhForm,setShowGhForm] = useState(false)
  const [pushing,setPushing]     = useState(false)

  const loading = stage !== null
  const previewHtml = files.length && isPreviewableProject(files) ? buildProjectPreview(files) : null

  useEffect(() => {
    async function init() {
      const all = await loadAllProjects()
      setProjects(all.filter(p => p.type === 'builder'))
      const h = flConsumeHandoff('builder')
      if (h?.desc) setDesc(h.desc)
    }
    init()
  }, [])

  function saveGhPat(value) { setGithubToken(value); setGhPat(value) }

  function persistNow(overrides = {}) {
    const project = {
      id: projectId || uid(), type: 'builder',
      name: overview?.projectType || desc.slice(0,40) || 'Untitled project',
      desc, style, overview, files, versions, activeIdx,
      created_at: ts(), updated_at: ts(),
      ...overrides,
    }
    if (!projectId) setProjectId(project.id)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await persistProject(project)
      const all = await loadAllProjects()
      setProjects(all.filter(p => p.type === 'builder'))
    }, 500)
  }

  function loadProject(p) {
    setProjectId(p.id); setDesc(p.desc||''); setStyle(p.style||'Dark Modern')
    setOverview(p.overview||null); setFiles(p.files||[]); setVersions(p.versions||[])
    setActiveIdx(typeof p.activeIdx === 'number' ? p.activeIdx : ((p.versions?.length||0)-1))
    setView('preview'); setGhRepoUrl(''); toast(`Loaded "${p.name}"`, 'success')
  }

  function newProject() {
    setProjectId(null); setDesc(''); setOverview(null); setFiles([])
    setVersions([]); setActiveIdx(-1); setGhRepoUrl('')
  }

  // ── Step 1: Plan ────────────────────────────────────────────────
  async function planOverview() {
    if (!desc.trim()) return toast('Describe your idea first', 'error')
    setStage('planning'); setStageDetail('Analysing your idea…')
    const prompt = `A founder wants to build: "${desc}"

Analyse this idea and produce a complete project plan for a modern multi-page SaaS website with pages: Home, Features, Pricing, About, Contact, Dashboard, Login, Signup. Infer everything you reasonably can — only flag something as missing if it's truly essential and can't be inferred.

Return ONLY valid JSON, no markdown fences, no prose, in exactly this shape:
{
  "projectType": "short label",
  "audience": "who this is for",
  "goals": ["primary goal", "secondary goal"],
  "features": ["feature 1", "feature 2", "..."],
  "techStack": "Next.js 14 App Router, TypeScript, Tailwind CSS",
  "designSystem": "1-2 sentence description of the visual style and mood",
  "dashboardContent": "what the Dashboard page should realistically show for this product",
  "missingInfo": [],
  "progressEstimate": 0
}`
    const r = await ai([{ role:'user', content: prompt }], 'You are a senior product architect who plans software projects with zero wasted questions.', 1600)
    try {
      const m = r.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(m ? m[0] : r)
      setOverview(parsed)
      setMissingAnswers(parsed.missingInfo?.length ? Object.fromEntries(parsed.missingInfo.map(k => [k,''])) : {})
    } catch {
      setOverview({ raw:r, projectType:'Project', features:[], missingInfo:[], progressEstimate:0 })
    }
    setStage(null)
  }

  function confirmMissingInfo() {
    const extra = Object.entries(missingAnswers).filter(([,v])=>v.trim()).map(([k,v])=>`${k}: ${v}`).join('. ')
    if (extra) setDesc(d => `${d}\n\n${extra}`)
    setOverview(o => ({ ...o, missingInfo: [] }))
    setMissingAnswers({})
  }

  // ── Step 2: Generate — real, separate Next.js files (never one HTML file) ──
  async function generate() {
    if (!desc.trim()) return toast('Describe your product first', 'error')
    sb.logEvent('builder','builder'); setStage('generating')
    const ov = overview
    const designLine = ov?.designSystem ? `Design direction: ${ov.designSystem}.` : ''
    const featuresLine = ov?.features?.length ? `Core features to reflect in the copy/UI: ${ov.features.join(', ')}.` : ''

    try {
      // Phase 1 — design system + shared components + root layout
      setStageDetail('Designing the shared component system…')
      const phase1Expected = ['app/globals.css','app/layout.tsx','components/Navbar.tsx','components/Footer.tsx','components/Button.tsx','components/GlassCard.tsx','components/Skeleton.tsx']
      const phase1Prompt = `Build the shared design system for this project.

Product: ${desc}
Style: ${style} — ${BGUIDES[style]}
${designLine} ${featuresLine}

${FILE_CONVENTIONS}

Generate EXACTLY these files:
- app/globals.css — "@tailwind base; @tailwind components; @tailwind utilities;" plus, using only plain standard CSS (no @apply, no @layer with custom class names — components must use raw Tailwind utility classes inline instead), a couple of @keyframes animations (e.g. fade-in-up) and any global font-face/reset rules needed.
- app/layout.tsx — the root layout: imports Navbar and Footer, wraps {children} between them, exports "metadata" (title + description) for SEO. Must have 'use client' NOT set (layout stays a server component) — do not add interactivity here.
- components/Navbar.tsx — sticky glassmorphism navbar: logo derived from the product name, links to Home/Features/Pricing/About/Contact, Login + Signup buttons on the right, a working mobile hamburger menu (real useState toggle).
- components/Footer.tsx — modern footer: logo, tagline, link columns, inline-SVG social icons, copyright.
- components/Button.tsx — reusable button with a "variant" prop ('primary'|'secondary'|'ghost'), gradient background on primary, hover/active micro-interactions.
- components/GlassCard.tsx — reusable glassmorphism card wrapper (backdrop-blur, translucent border, rounded-2xl, hover lift).
- components/Skeleton.tsx — reusable loading skeleton using className="fl-skeleton" (shimmer animation already provided globally), accepting a "className" prop for sizing.`

      const phase1 = await genBatch(phase1Prompt, phase1Expected, 4500, 1)
      let allFiles = phase1.files
      const componentContext = allFiles.filter(f => f.path.startsWith('components/')).map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')

      // Phase 2 — pages, generated in small batches so no single response gets
      // truncated (a full page of real Tailwind + form logic easily runs
      // 600-1000+ tokens; asking for all 8 at once was the root cause of
      // "Generation incomplete" — the response was silently cut off mid-file).
      const pageBatches = [
        [REQUIRED_PAGES[0], REQUIRED_PAGES[1]], // Home, Features
        [REQUIRED_PAGES[2], REQUIRED_PAGES[3]], // Pricing, About
        [REQUIRED_PAGES[4], REQUIRED_PAGES[5]], // Contact, Dashboard
        [REQUIRED_PAGES[6], REQUIRED_PAGES[7]], // Login, Signup
      ]
      const allMissing = []

      for (const batch of pageBatches) {
        setStageDetail(`Building ${batch.map(p=>p.name).join(' & ')}…`)
        const specialLines = batch.map(p => {
          if (p.name==='Login' || p.name==='Signup') return `- ${p.file}: 'use client', real controlled form inputs, real client-side validation (empty fields, email format, password length), simulate the submit with a realistic ~600ms delay via setTimeout representing a future real API call, then show a clear success or validation-error message.`
          if (p.name==='Dashboard') return `- ${p.file}: 'use client', shows a <Skeleton /> loading state for ~500ms (useEffect + setTimeout) before revealing realistic product-specific content (not generic placeholders).`
          if (p.name==='Contact') return `- ${p.file}: 'use client', a real controlled contact form with validation and a success state on submit.`
          return null
        }).filter(Boolean).join('\n')

        const batchPrompt = `These shared components already exist — use them exactly as defined, matching their real prop names:

${componentContext}

Now build these ${batch.length} page(s) for: ${desc}
Style: ${style} — ${BGUIDES[style]}
${designLine} ${featuresLine}
${ov?.dashboardContent ? `Dashboard should realistically show: ${ov.dashboardContent}.` : ''}

${FILE_CONVENTIONS}

Do NOT import or render Navbar/Footer inside page files — the root layout already wraps every page with them. Just build each page's content.

Generate EXACTLY these files:
${batch.map(p => `- ${p.file} (route ${p.route}) — the "${p.name}" page`).join('\n')}
${specialLines ? '\nSpecial requirements:\n' + specialLines : ''}`

        const result = await genBatch(batchPrompt, batch.map(p=>p.file), 3500, 1)
        allFiles = [...allFiles, ...result.files]
        allMissing.push(...result.missing)
      }

      if (allMissing.length > 0) {
        toast(`Generation incomplete — could not generate: ${allMissing.join(', ')}. Try again, or try a shorter description.`, 'error')
        setStage(null)
        return
      }

      const snap = { id: uid(), label: 'Generated', files: allFiles, ts: ts() }
      setFiles(allFiles); setVersions([snap]); setActiveIdx(0); setView('preview'); setActiveFile('app/page.tsx'); setStage(null)
      persistNow({ files: allFiles, versions: [snap], activeIdx: 0 })
    } catch (e) {
      // A real provider/connection error (e.g. invalid API key, unsupported
      // model, network failure) — show it verbatim instead of a generic message.
      toast(e.message || 'Generation failed', 'error')
      setStage(null)
    }
  }

  // ── Step 3: Smart, targeted editing — never regenerates the whole project ──
  async function applyEdit() {
    const instruction = editIn.trim()
    if (!instruction) return
    if (!files.length) return toast('Generate a project first', 'error')
    setStage('editing')
    const classification = classifyProjectEdit(instruction, files)
    setStageDetail(classification.type === 'design-system'
      ? 'Updating the design system…'
      : `Updating ${classification.paths[0]}…`)

    let updatedFiles = files
    if (classification.paths.length === 1) {
      const path = classification.paths[0]
      const current = files.find(f => f.path === path)
      const prompt = `Here is the file "${path}" from a Next.js project:

${current ? current.content : '(file does not exist yet — create it)'}

Instruction: ${instruction}

${FILE_CONVENTIONS}

Return ONLY the full replacement content for this ONE file, prefixed with "// file: ${path}", as a single fenced code block. No explanation.`
      const r = await callGenAI(prompt)
      const parsed = parseFiles(r, 'edit', 'tsx')
      const newContent = parsed[0]?.content
      if (newContent) {
        updatedFiles = files.some(f => f.path === path)
          ? files.map(f => f.path === path ? { ...f, content: newContent } : f)
          : [...files, { path, content: newContent }]
      }
    } else {
      // design-system: regenerate the small set of shared files together in one call
      const currentBundle = classification.paths.map(p => {
        const f = files.find(x => x.path === p)
        return f ? `--- ${p} ---\n${f.content}` : ''
      }).filter(Boolean).join('\n\n')
      const prompt = `Here are the shared design-system files from a Next.js project:

${currentBundle}

Instruction (apply this site-wide aesthetic change): ${instruction}

${FILE_CONVENTIONS}

Return the full replacement content for EACH file above, each prefixed with its own "// file: path" comment and its own fenced code block. Keep functionality identical — only change the visual design.`
      const r = await callGenAI(prompt)
      const parsed = parseFiles(r, 'edit', 'tsx')
      if (parsed.length) {
        updatedFiles = files.map(f => {
          const match = parsed.find(p => p.path === f.path)
          return match ? { ...f, content: match.content } : f
        })
      }
    }

    const snap = { id: uid(), label: instruction.slice(0,50), files: updatedFiles, ts: ts() }
    const newVersions = [...versions, snap]
    setFiles(updatedFiles); setVersions(newVersions); setActiveIdx(newVersions.length-1); setEditIn(''); setStage(null)
    persistNow({ files: updatedFiles, versions: newVersions, activeIdx: newVersions.length-1 })
    toast('Applied — only the affected file' + (classification.paths.length>1?'s were':' was') + ' changed', 'success')
  }

  // ── Version history ───────────────────────────────────────────
  function goToVersion(i) {
    if (i < 0 || i >= versions.length) return
    setActiveIdx(i); setFiles(versions[i].files)
    persistNow({ files: versions[i].files, activeIdx: i })
  }
  function undo() { goToVersion(activeIdx - 1) }
  function redo() { goToVersion(activeIdx + 1) }
  function duplicateVersion(i) {
    const snap = { id: uid(), label: `${versions[i].label} (copy)`, files: versions[i].files, ts: ts() }
    const newVersions = [...versions, snap]
    setVersions(newVersions); setActiveIdx(newVersions.length-1); setFiles(snap.files)
    persistNow({ versions: newVersions, activeIdx: newVersions.length-1, files: snap.files })
  }

  // ── Export ──────────────────────────────────────────────────────
  function exportFiles() {
    const readme = `# ${overview?.projectType || desc.slice(0,60) || 'FounderLab Project'}

${desc}

## Pages
${REQUIRED_PAGES.map(p=>`- ${p.name} — \`${p.route}\``).join('\n')}

## Features
${(overview?.features||[]).map(f=>`- ${f}`).join('\n') || '- See source'}

## Tech stack
Next.js 14 (App Router) · TypeScript · Tailwind CSS

## Run locally
\`\`\`
npm install
npm run dev
\`\`\`
Then open http://localhost:3000

## Deploy
Push to GitHub and import at vercel.com/new — zero configuration needed.

---
Generated with FounderLab AI Builder.
`
    return [...CONFIG_FILES(), { path:'README.md', content: readme }, ...files]
  }

  async function dl() {
    try {
      const r = await downloadProjectZip(exportFiles(), overview?.projectType || 'founderlab-app')
      toast(r.fallback ? 'Downloaded files individually' : 'ZIP downloaded', 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  async function pushGithub() {
    if (!files.length) return toast('Generate a project first', 'error')
    if (!ghPat || !ghRepoName.trim()) { setShowGhForm(true); return }
    setPushing(true)
    try {
      const { repoUrl } = await pushToGithubShared({ files: exportFiles(), repoName: ghRepoName, token: ghPat })
      setGhRepoUrl(repoUrl); setShowGhForm(false)
      toast('Pushed to GitHub', 'success')
    } catch (e) { toast(e.message, 'error') }
    setPushing(false)
  }

  function deployVercel() {
    try { openVercelDeploy(ghRepoUrl) } catch (e) { toast(e.message, 'error') }
  }

  // ── Cross-module integration ────────────────────────────────────
  function continueInChat() {
    const summary = overview ? `Project: ${overview.projectType}\nAudience: ${overview.audience}\nFeatures: ${(overview.features||[]).join(', ')}\nPages: ${REQUIRED_PAGES.map(p=>p.name).join(', ')}` : desc
    flNavigate('chat', { message: `I'm building this with FounderLab Builder (a real Next.js + TypeScript + Tailwind project):\n\n${summary}\n\nLet's keep working on it — what should we improve next?` })
    toast('Opening in AI Chat…', 'success')
  }

  async function saveOverviewToNotes() {
    if (!overview) return toast('Plan the project first', 'error')
    const notes = await load('fl_notes', [])
    const content = `# ${overview.projectType}\n\n**Audience:** ${overview.audience}\n\n**Goals:** ${(overview.goals||[]).join(', ')}\n\n**Features:**\n${(overview.features||[]).map(f=>`- ${f}`).join('\n')}\n\n**Tech stack:** ${overview.techStack}\n\n**Design:** ${overview.designSystem}`
    const n = { id: uid(), title: overview.projectType || 'Project overview', content, tags: ['builder','project-plan'], created_at: ts(), updated_at: ts() }
    await save('fl_notes', [n, ...(Array.isArray(notes)?notes:[])])
    toast('Overview saved to Notes', 'success')
  }

  async function createTasksFromPlan() {
    if (!overview?.features?.length) return toast('Plan the project first', 'error')
    const tasks = await load('fl_tasks', [])
    const newTasks = overview.features.map(f => ({ id: uid(), title: f, status:'todo', priority:'medium', description:`From ${overview.projectType} plan`, due_date:'', created_at: ts(), updated_at: ts() }))
    await save('fl_tasks', [...newTasks, ...(Array.isArray(tasks)?tasks:[])])
    toast(`Created ${newTasks.length} tasks`, 'success')
  }

  function debugInCodeAI() {
    if (!files.length) return toast('Generate a project first', 'error')
    const bundle = files.map(f => `// file: ${f.path}\n${f.content}`).join('\n\n')
    flNavigate('code', { code: bundle.slice(0,6000), desc: `Debug and improve this ${overview?.projectType || 'website'} (Next.js project)` })
    toast('Opening in Code AI…', 'success')
  }

  const stageLabel = stage ? (stageDetail || { planning:'🧠 Planning…', generating:'⚡ Generating your project…', editing:'✨ Applying your edit…' }[stage]) : null

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding:'16px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:12 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:C.t1 }}>AI Product Studio</h2>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={newProject} style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:8, color:C.t2, cursor:'pointer', fontSize:12, padding:'5px 10px', fontFamily:'inherit' }}>+ New</button>
            {projects.slice(0,5).map(p => (
              <button key={p.id} onClick={()=>loadProject(p)}
                style={{ padding:'5px 12px', borderRadius:999, border:`1px solid ${projectId===p.id?C.accent:C.border}`, background:projectId===p.id?C.accentM:'transparent', color:projectId===p.id?C.accent:C.t2, cursor:'pointer', fontSize:12, fontFamily:'inherit', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <Input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Describe your product or business idea…" style={{ flex:1, minWidth:220 }} onKeyDown={e=>e.key==='Enter'&&(overview?generate():planOverview())} />
          <select value={style} onChange={e=>setStyle(e.target.value)} style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:14, padding:'9px 12px', fontFamily:'inherit', cursor:'pointer' }}>
            {BSTYLES.map(s=><option key={s}>{s}</option>)}
          </select>
          <Button onClick={planOverview} disabled={loading} variant="secondary">{stage==='planning'?<Spinner size={14} color={C.accent}/>:'🧠'} Plan</Button>
          <Button onClick={generate} disabled={loading}>{stage==='generating'?<Spinner size={14} color="#fff"/>:'⬡'} Generate</Button>
        </div>
        {stageLabel && <p style={{ margin:'10px 0 0', fontSize:13, color:C.accent }}>{stageLabel}</p>}
      </div>

      {/* ── Project Overview ── */}
      {overview && !overview.raw && (
        <div style={{ padding:'14px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0, maxHeight:220, overflowY:'auto' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700, color:C.t1 }}>📋 {overview.projectType}</span>
            {typeof overview.progressEstimate === 'number' && (
              <div style={{ flex:1, maxWidth:200, height:6, background:C.surf, borderRadius:99, overflow:'hidden' }}>
                <div style={{ width:`${overview.progressEstimate}%`, height:'100%', background:C.accent, transition:'width .3s' }} />
              </div>
            )}
            <span style={{ fontSize:11, color:C.t3 }}>{overview.progressEstimate||0}% planned</span>
          </div>
          {overview.missingInfo?.length > 0 ? (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <p style={{ margin:0, fontSize:12, color:C.yellow }}>A few details would help — everything else was inferred automatically:</p>
              {overview.missingInfo.map(k => (
                <Input key={k} value={missingAnswers[k]||''} onChange={e=>setMissingAnswers(m=>({...m,[k]:e.target.value}))} placeholder={k} style={{ fontSize:13 }} />
              ))}
              <Button onClick={confirmMissingInfo} size="sm" style={{ alignSelf:'flex-start' }}>Continue →</Button>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10, fontSize:12, color:C.t2 }}>
              <div><strong style={{color:C.t1}}>Features</strong><br/>{(overview.features||[]).join(', ')||'—'}</div>
              <div><strong style={{color:C.t1}}>Tech stack</strong><br/>{overview.techStack||'Next.js · TypeScript · Tailwind'}</div>
              <div><strong style={{color:C.t1}}>Design</strong><br/>{overview.designSystem||'—'}</div>
              <div><strong style={{color:C.t1}}>Pages</strong><br/>{REQUIRED_PAGES.map(p=>p.name).join(', ')}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Main: rail + dominant preview ── */}
      {files.length ? (
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
          {/* Left rail */}
          <div style={{ width:260, borderRight:`1px solid ${C.border}`, overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:16, flexShrink:0 }}>
            <div>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.05em' }}>Version History</p>
              <div style={{ display:'flex', gap:6, marginBottom:8 }}>
                <Button onClick={undo} disabled={activeIdx<=0} variant="secondary" size="sm">↶ Undo</Button>
                <Button onClick={redo} disabled={activeIdx>=versions.length-1} variant="secondary" size="sm">↷ Redo</Button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {versions.slice().reverse().map((v, ri) => {
                  const i = versions.length - 1 - ri
                  return (
                    <div key={v.id} onClick={()=>goToVersion(i)}
                      style={{ padding:'7px 9px', borderRadius:7, cursor:'pointer', background:activeIdx===i?C.accentM:'transparent', border:`1px solid ${activeIdx===i?C.borderFocus:'transparent'}`, fontSize:12 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                        <span style={{ color:activeIdx===i?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.label}</span>
                        <button onClick={e=>{e.stopPropagation();duplicateVersion(i)}} title="Duplicate" style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:11, fontFamily:'inherit', flexShrink:0 }}>⎘</button>
                      </div>
                      <span style={{ fontSize:10, color:C.t3 }}>{new Date(v.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.05em' }}>Export</p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <Button onClick={dl} variant="secondary" size="sm" full>⬇ Download ZIP</Button>
                {showGhForm && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, padding:8, background:C.surf, borderRadius:8, border:`1px solid ${C.border}` }}>
                    <Input value={ghRepoName} onChange={e=>setGhRepoName(e.target.value)} placeholder="repo-name" style={{ fontSize:12 }} />
                    <input type="password" value={ghPat} onChange={e=>saveGhPat(e.target.value)} placeholder="GitHub token (this session only)"
                      autoComplete="off"
                      style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:12, padding:'8px 10px', fontFamily:'inherit', outline:'none' }} />
                    <Button onClick={pushGithub} disabled={pushing} size="sm">{pushing?<Spinner size={12} color="#fff"/>:'🚀'} Push</Button>
                  </div>
                )}
                <Button onClick={pushGithub} disabled={pushing} variant="secondary" size="sm" full>{pushing?<Spinner size={12} color={C.accent}/>:'🐙'} Push to GitHub</Button>
                {ghRepoUrl && <a href={ghRepoUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:C.accent }}>Open repository →</a>}
                <Button onClick={deployVercel} variant="secondary" size="sm" full>▲ Deploy to Vercel</Button>
              </div>
            </div>

            <div>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.05em' }}>Continue working</p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <Button onClick={continueInChat} variant="secondary" size="sm" full>💬 Continue in AI Chat</Button>
                <Button onClick={debugInCodeAI} variant="secondary" size="sm" full>🐛 Debug in Code AI</Button>
                <Button onClick={saveOverviewToNotes} variant="secondary" size="sm" full>📝 Save plan to Notes</Button>
                <Button onClick={createTasksFromPlan} variant="secondary" size="sm" full>✅ Create tasks from plan</Button>
              </div>
            </div>
          </div>

          {/* Dominant preview */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 20px', borderBottom:`1px solid ${C.border}`, flexShrink:0, gap:10, flexWrap:'wrap' }}>
              <div style={{ display:'flex', gap:3, background:C.bg, borderRadius:8, padding:3 }}>
                {['preview','code'].map(v=><button key={v} onClick={()=>setView(v)} style={{ padding:'5px 14px', borderRadius:6, border:'none', background:view===v?C.surf:'transparent', color:view===v?C.t1:C.t3, cursor:'pointer', fontSize:13, fontFamily:'inherit', transition:'all .15s' }}>{v==='preview'?'👁 Preview':'< > Code'}</button>)}
              </div>
              {view==='code' && (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', flex:1, justifyContent:'flex-end' }}>
                  {files.map(f => (
                    <button key={f.path} onClick={()=>setActiveFile(f.path)}
                      style={{ padding:'3px 9px', borderRadius:6, border:`1px solid ${activeFile===f.path?C.accent:C.border}`, background:activeFile===f.path?C.accentM:'transparent', color:activeFile===f.path?C.accent:C.t3, cursor:'pointer', fontSize:11, fontFamily:'monospace' }}>
                      {f.path.split('/').pop()}
                    </button>
                  ))}
                </div>
              )}
              <span style={{ fontSize:12, color:C.t3 }}>{versions[activeIdx]?.label}</span>
            </div>
            <div style={{ flex:1, overflow:'hidden', position:'relative' }}>
              {stage==='editing' && (
                <div style={{ position:'absolute', inset:0, background:'rgba(9,9,15,.55)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:5 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 20px' }}>
                    <Spinner size={16} /><span style={{ fontSize:13, color:C.t1 }}>{stageDetail || 'Applying your edit…'}</span>
                  </div>
                </div>
              )}
              {view==='preview'
                ? (previewHtml
                    ? <iframe srcDoc={previewHtml} style={{ width:'100%', height:'100%', border:'none' }} title="Live preview" sandbox={GENERATED_PREVIEW_SANDBOX} referrerPolicy={GENERATED_PREVIEW_REFERRER_POLICY} />
                    : <EmptyState icon="⬡" title="Preview not ready" description="Generate the project to see a fully-navigable live preview." />)
                : <pre style={{ margin:0, padding:20, fontFamily:'monospace', fontSize:12, color:C.t1, whiteSpace:'pre-wrap', overflowY:'auto', height:'100%', background:'#050508', boxSizing:'border-box' }}>{files.find(f=>f.path===activeFile)?.content || files[0]?.content || ''}</pre>}
            </div>
            {/* Smart edit bar */}
            <div style={{ padding:'10px 20px', borderTop:`1px solid ${C.border}`, flexShrink:0, display:'flex', gap:8 }}>
              <Input value={editIn} onChange={e=>setEditIn(e.target.value)} placeholder='Tell AI what to change — "add pricing tiers", "more premium", "improve mobile navbar"…' style={{ flex:1, fontSize:13 }} onKeyDown={e=>e.key==='Enter'&&applyEdit()} />
              <Button onClick={applyEdit} disabled={loading||!editIn.trim()} size="sm">✨ Apply</Button>
            </div>
          </div>
        </div>
      ) : !loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <EmptyState icon="⬡" title="Describe your product above" description="AI plans the architecture, then generates a real, separate-file Next.js + TypeScript + Tailwind project — 8 fully navigable pages, glassmorphism design, and instant live preview." />
        </div>
      ) : <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}><Spinner size={36} /></div>}
    </div>
  )
}

function providerStatusBadgeColor(state) {
  if (state === 'connected' || state === 'models_available' || state === 'ready' || state === 'local') return 'green'
  if (state === 'testing' || state === 'detecting') return 'accent'
  if (state === 'failed' || state === 'not_configured' || state === 'unavailable') return 'red'
  return 'yellow'
}

function ProviderChoiceCard({ provider, active, connection, onSelect }) {
  const isLocal = provider.capabilities.local
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      style={{
        minHeight: 126,
        padding: '14px 15px',
        borderRadius: 12,
        border: `1px solid ${active ? C.accent : C.border}`,
        boxShadow: active ? `0 0 0 3px ${C.accentM}` : 'none',
        background: active ? C.accentM : C.bg,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        textAlign: 'left',
        transition: 'border-color .15s, box-shadow .15s, background .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%' }}>
        <span aria-hidden="true" style={{ fontSize: 21, lineHeight: 1 }}>{provider.icon}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.t1 }}>{provider.name}</span>
          <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: C.t3, lineHeight: 1.4 }}>{provider.sub}</span>
        </span>
        {active && <Badge color="accent">Active</Badge>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge color={isLocal ? 'green' : 'gray'}>{isLocal ? 'Local' : 'Cloud'}</Badge>
        <Badge color={providerStatusBadgeColor(connection.state)}>{connection.label}</Badge>
      </div>
    </button>
  )
}

// ── SETTINGS ─────────────────────────────────────────────────
function SettingsPage({ user, profile, onProfileUpdate, onSignOut }) {
  const [tab, setTab]       = useState('profile')
  const [name, setName]     = useState(profile?.full_name||'')

  // ── AI provider state ──────────────────────────────────────
  const [aiProv, setAIProv] = useState(getAIProvider)
  const [providerAvailability, setProviderAvailability] = useState(getProviderAvailability)
  // Per-provider model selections (initialised from localStorage)
  const [modelMap, setModelMap] = useState(() => {
    const stored = {}
    Object.keys(PROVIDERS).forEach(id => { stored[id] = getProviderModel(id) })
    return stored
  })
  // Shared test state
  const [testStatus, setTestStatus]   = useState(null) // { provider, state, message } | null
  const [providerConnectionStatuses, setProviderConnectionStatuses] = useState(getProviderConnectionStatuses)

  const [np, setNp]         = useState('')
  const [cp, setCp]         = useState('')
  const [saving, setSaving] = useState(false)
  const [pwd, setPwd]       = useState(false)
  const [feedbacks, setFB]  = useState([])
  const [fbFilter, setFbF]  = useState('all')
  const [fbLoad, setFbL]    = useState(true)
  const [summary, setSummary]= useState('')
  const [sumLoad, setSumL]  = useState(false)
  const [exporting, setExp] = useState(false)
  const lbl = x => <label style={{ display:'block', fontSize:12, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>{x}</label>

  useEffect(() => { setName(profile?.full_name||'') }, [profile])
  useEffect(() => {
    async function init() { setFbL(true); setFB(await sb.getFeedback()||[]); setFbL(false) }
    init()
  }, [])
  useEffect(() => subscribeProviderConnectionStatuses(setProviderConnectionStatuses), [])
  useEffect(() => {
    let mounted = true
    refreshProviderAvailability().then(({ provider, providers }) => {
      if (!mounted) return
      setProviderAvailability(providers)
      setAIProv(provider)
    })
    return () => { mounted = false }
  }, [])

  async function savePro() {
    setSaving(true)
    await sb.updateProfile({full_name:name})
    onProfileUpdate?.({...profile,full_name:name})
    toast('Profile saved','success'); setSaving(false)
  }

  async function changePw() {
    if (!np||np!==cp) return toast('Passwords do not match','error')
    if (np.length<6) return toast('Password must be 6+ characters','error')
    setPwd(true)
    try { await sb.updatePassword(np); toast('Password changed','success'); setNp(''); setCp('') }
    catch (e) { toast(e.message,'error') } finally { setPwd(false) }
  }

  async function resolve(id) {
    await sb.resolveFeedback(id)
    setFB(f=>f.map(x=>x.id===id?{...x,status:'resolved'}:x))
    toast('Marked resolved','success')
  }

  async function aiSum() {
    if (!feedbacks.length) return
    setSumL(true)
    const r=await ai([{role:'user',content:`Summarize this user feedback for a developer. Highlight top patterns and priority features:\n\n${feedbacks.map(f=>`[${f.type}] ${f.description}`).join('\n')}`}])
    setSummary(r); setSumL(false)
  }

  async function expData() {
    setExp(true)
    try {
      const [all,fb]=await Promise.all([sb.exportAll(),sb.getFeedback()])
      const blob=new Blob([JSON.stringify({exported_at:ts(),user:{id:user.id,email:user.email},data:all,feedback:fb},null,2)],{type:'application/json'})
      const a=Object.assign(document.createElement('a'),{ href:URL.createObjectURL(blob), download:`founderlab-export-${Date.now()}.json` })
      a.click(); URL.revokeObjectURL(a.href)
      toast('Data exported!','success')
    } catch (e) { toast('Export error: '+e.message,'error') } finally { setExp(false) }
  }

  const fbF = feedbacks.filter(f=>fbFilter==='all'||f.type===fbFilter)
  const tabs = [{id:'profile',l:'Profile'},{id:'ai',l:'AI Provider'},{id:'integrations',l:'Integrations'},{id:'feedback',l:'Feedback'},{id:'data',l:'Data & Export'}]
  const [ghPatSettings, setGhPatSettings] = useState(getGithubToken)
  const [ghUserSettings, setGhUserSettings] = useState(null)
  const [ghChecking, setGhChecking] = useState(false)
  const [ghInputVal, setGhInputVal] = useState('')

  useEffect(() => {
    if (ghPatSettings) checkGithubConnection(ghPatSettings)
  }, [])

  async function checkGithubConnection(pat) {
    setGhChecking(true)
    try {
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${pat}` } })
      if (r.ok) setGhUserSettings(await r.json())
      else { setGhUserSettings(null); toast('GitHub token is invalid or expired', 'error') }
    } catch { setGhUserSettings(null) }
    setGhChecking(false)
  }

  function connectGithub() {
    if (!ghInputVal.trim()) return toast('Paste a GitHub token first', 'error')
    setGithubToken(ghInputVal)
    setGhPatSettings(ghInputVal.trim())
    checkGithubConnection(ghInputVal.trim())
    setGhInputVal('')
  }

  function disconnectGithub() {
    clearGithubToken()
    setGhPatSettings(''); setGhUserSettings(null)
    toast('GitHub disconnected', 'success')
  }


  // ── AI Settings handlers ────────────────────────────────────
  function saveAISettings() {
    try {
      setAIProviderLS(aiProv)
      Object.entries(modelMap).filter(([id]) => id !== 'ollama').forEach(([id, m]) => setProviderModel(id, m))
      toast('AI settings saved', 'success')
    } catch { toast('Failed to save settings', 'error') }
  }

  async function testConnection() {
    if (!aiProv) {
      setTestStatus({ provider:null, state:'not_configured', message:'No AI provider is configured. Add one optional provider key or use Local Ollama.' })
      return
    }
    const refreshed = await refreshProviderAvailability()
    setProviderAvailability(refreshed.providers)
    if (aiProv !== 'ollama' && getProviderConfigurationState(aiProv, refreshed.providers) === 'not_configured') {
      setProviderConnectionStatus(aiProv, 'not_configured')
      setTestStatus({ provider:aiProv, state:'not_configured', message:`${PROVIDERS[aiProv]?.name || 'This provider'} is not configured on the server.` })
      return
    }

    setTestStatus({ provider:aiProv, state:'testing', message:'' })
    try {
      const result = await requestAIResult(createProviderConnectionTestRequest({
        provider: aiProv,
        model: modelMap[aiProv] || PROVIDERS[aiProv]?.default,
      }))
      if (!result.ok) {
        setTestStatus({
          provider: aiProv,
          state: result.error.code === 'MISSING_CONFIGURATION' ? 'not_configured' : 'failed',
          message: result.error.message,
        })
        return
      }
      setTestStatus({ provider:aiProv, state:'connected', message:`${PROVIDERS[aiProv]?.name} replied: "${result.text.trim().slice(0,60)}"` })
    } catch { setTestStatus({ provider:aiProv, state:'failed', message:'The provider could not be tested. Check its configuration and try again.' }) }
  }

  function connectionFor(provider) {
    const configuration = getProviderConfigurationState(provider.id, providerAvailability)
    const lastKnownState = providerConnectionStatuses[provider.id] || ''
    const isTesting = testStatus?.provider === provider.id && testStatus.state === 'testing'
    const fallbackTestState = testStatus?.provider === provider.id && !lastKnownState ? testStatus.state : ''
    return getProviderConnectionState(configuration, isTesting ? 'testing' : lastKnownState || fallbackTestState)
  }

  function selectProvider(providerId) {
    setAIProv(providerId)
    setAIProviderLS(providerId)
    setTestStatus(null)
  }

  return (
    <div style={{ height:'100%', overflowY:'auto', padding:'32px 32px 48px', maxWidth:680 }}>
      <h2 style={{ margin:'0 0 24px', fontSize:22, fontWeight:700, color:C.t1 }}>Settings</h2>
      <div style={{ display:'flex', gap:3, marginBottom:28, background:C.surf, borderRadius:10, padding:4, width:'fit-content' }}>
        {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'7px 18px', borderRadius:7, border:'none', background:tab===t.id?C.accent:'transparent', color:tab===t.id?'#fff':C.t2, cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit', transition:'all .15s' }}>{t.l}</button>)}
      </div>

      {tab==='profile' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          <Card style={{ padding:24 }}>
            <h3 style={{ margin:'0 0 16px', fontSize:15, color:C.t1 }}>Account Info</h3>
            <div style={{ marginBottom:14 }}>{lbl('Email')}<Input value={user?.email||''} onChange={()=>{}} readOnly /></div>
            <div style={{ marginBottom:16 }}>{lbl('Full Name')}<Input value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" /></div>
            <Button onClick={savePro} disabled={saving}>{saving?<Spinner size={13} color="#fff"/>:null} Save Profile</Button>
          </Card>
          <Card style={{ padding:24 }}>
            <h3 style={{ margin:'0 0 16px', fontSize:15, color:C.t1 }}>Change Password</h3>
            <div style={{ marginBottom:14 }}>{lbl('New Password')}<Input value={np} onChange={e=>setNp(e.target.value)} type="password" placeholder="Min. 6 characters" /></div>
            <div style={{ marginBottom:16 }}>{lbl('Confirm Password')}<Input value={cp} onChange={e=>setCp(e.target.value)} type="password" placeholder="Repeat new password" /></div>
            <Button onClick={changePw} disabled={pwd}>{pwd?<Spinner size={13} color="#fff"/>:null} Change Password</Button>
          </Card>
          <Card style={{ padding:24 }}>
            <h3 style={{ margin:'0 0 8px', fontSize:15, color:C.t1 }}>Sign Out</h3>
            <p style={{ margin:'0 0 16px', color:C.t2, fontSize:14 }}>You'll need to sign in again after signing out.</p>
            <Button onClick={onSignOut} variant="danger">Sign Out</Button>
          </Card>
        </div>
      )}

      {tab==='ai' && (
        <div style={{ maxWidth:680, display:'flex', flexDirection:'column', gap:16 }}>
          <div>
            <span style={{ color:C.accent, fontSize:11, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase' }}>AI providers</span>
            <h3 style={{ margin:'6px 0 5px', fontSize:19, color:C.t1 }}>Choose how FounderLab thinks</h3>
            <p style={{ margin:0, fontSize:13, color:C.t2, lineHeight:1.6 }}>Use a protected cloud provider, or keep Chat private with a local Ollama model on this Mac. Your choice is remembered for this device.</p>
          </div>

          <Card style={{ padding:18 }}>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, marginBottom:12 }}>
              <div><h4 style={{ margin:0, fontSize:14, color:C.t1 }}>Cloud providers</h4><p style={{ margin:'3px 0 0', fontSize:12, color:C.t3 }}>Fast, server-protected AI for Chat and supported workspace tools.</p></div>
              <Badge color="gray">Cloud</Badge>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(155px, 1fr))', gap:10 }}>
              {Object.values(PROVIDERS).filter(p => !p.capabilities.local).map(p => <ProviderChoiceCard key={p.id} provider={p} active={aiProv===p.id} connection={connectionFor(p)} onSelect={() => selectProvider(p.id)} />)}
            </div>
          </Card>

          <Card style={{ padding:18 }}>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, marginBottom:12 }}>
              <div><h4 style={{ margin:0, fontSize:14, color:C.t1 }}>Local AI</h4><p style={{ margin:'3px 0 0', fontSize:12, color:C.t3 }}>Use an installed Ollama model directly from this Mac.</p></div>
              <Badge color="green">Private</Badge>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 1fr)', gap:10 }}>
              {Object.values(PROVIDERS).filter(p => p.capabilities.local).map(p => <ProviderChoiceCard key={p.id} provider={p} active={aiProv===p.id} connection={connectionFor(p)} onSelect={() => selectProvider(p.id)} />)}
            </div>
          </Card>

          <Card style={{ padding:18 }}>
            {!aiProv && <div style={{ padding:'12px 13px', background:C.bg, borderRadius:9, border:`1px solid ${C.border}`, fontSize:12, color:C.t2, lineHeight:1.65 }}>Choose a provider to continue. FounderLab authentication and workspace features remain available even when no cloud AI provider is configured.</div>}

            {aiProv && aiProv !== 'ollama' && (() => {
              const p = PROVIDERS[aiProv]
              const connection = connectionFor(p)
              const isConfigured = getProviderConfigurationState(p.id, providerAvailability) !== 'not_configured'
              return <div style={{ display:'flex', flexDirection:'column', gap:15 }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <span aria-hidden="true" style={{ fontSize:21, lineHeight:1 }}>{p.icon}</span>
                  <div style={{ flex:1 }}><div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}><strong style={{ color:C.t1, fontSize:15 }}>{p.name}</strong><Badge color="gray">Cloud</Badge><Badge color={providerStatusBadgeColor(connection.state)}>{connection.label}</Badge></div><p style={{ margin:'4px 0 0', color:C.t2, fontSize:12, lineHeight:1.5 }}>{isConfigured ? 'Credentials stay on the protected FounderLab server and are never sent to your browser.' : 'This provider is not configured for this deployment yet. You can still choose another provider or Local Ollama.'}</p></div>
                </div>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t2, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Model</label>
                  <select value={modelMap[aiProv] || p.default} onChange={e => setModelMap(m => ({...m, [aiProv]: e.target.value}))} style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'9px 12px', fontFamily:'inherit', outline:'none', cursor:'pointer' }}>
                    {p.models.filter(m => !m.internalOnly).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <Button onClick={testConnection} disabled={testStatus?.state==='testing'} variant="secondary" size="sm">{testStatus?.state==='testing' ? <><Spinner size={12} color={C.accent}/> Testing…</> : 'Test connection'}</Button>
                  {testStatus && testStatus.provider===aiProv && testStatus.state !== 'testing' && <span role="status" style={{ fontSize:12, lineHeight:1.4, flex:1, color:testStatus.state==='connected'?C.green:testStatus.state==='not_configured'?C.yellow:C.red }}>{testStatus.state==='connected' ? 'Connected' : testStatus.state==='not_configured' ? 'Not configured' : 'Failed'} — {testStatus.message}</span>}
                </div>
                <details><summary style={{ color:C.t2, cursor:'pointer', fontSize:12, fontWeight:600 }}>Provider setup and privacy</summary><p style={{ margin:'8px 0 0', color:C.t3, fontSize:12, lineHeight:1.6 }}>This deployment reads cloud credentials on its server and sends requests through its protected provider route. <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color:C.accent }}>Open {p.name} setup →</a></p></details>
              </div>
            })()}

            {aiProv === 'ollama' && <OllamaProviderPanel providerAvailability={providerAvailability} />}
          </Card>

          <Button onClick={saveAISettings} full disabled={!aiProv}>Save provider preference</Button>
        </div>
      )}

      {tab==='integrations' && (
        <div style={{ maxWidth:600, display:'flex', flexDirection:'column', gap:14 }}>
          <p style={{ margin:'0 0 4px', fontSize:13, color:C.t2, lineHeight:1.6 }}>
            Connect the services Builder and Code AI use to push code and deploy. Connections are saved in this browser and reused automatically — you won't be asked again.
          </p>

          {/* GitHub */}
          <Card style={{ padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:20 }}>🐙</span>
                <div>
                  <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.t1 }}>GitHub</p>
                  <p style={{ margin:0, fontSize:12, color:C.t3 }}>Push generated code and websites to a repository</p>
                </div>
              </div>
              {ghChecking ? <Spinner size={16} />
                : ghUserSettings ? <Badge color="green">● Connected as {ghUserSettings.login}</Badge>
                : <Badge color="gray">○ Not connected</Badge>}
            </div>
            {ghUserSettings ? (
              <Button onClick={disconnectGithub} variant="secondary" size="sm">Disconnect</Button>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <input type="password" value={ghInputVal} onChange={e=>setGhInputVal(e.target.value)}
                  placeholder="Personal access token (this session only)"
                  autoComplete="off"
                  style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'9px 12px', fontFamily:'inherit', outline:'none' }} />
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <Button onClick={connectGithub} size="sm">Connect</Button>
                  <a href="https://github.com/settings/tokens/new?scopes=repo&description=FounderLab%20AI" target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:C.accent }}>Create a token →</a>
                </div>
                <p style={{ margin:0, color:C.t3, fontSize:11, lineHeight:1.5 }}>The token is kept in memory for this browser session only and is never saved to local storage.</p>
              </div>
            )}
          </Card>

          {/* Vercel */}
          <Card style={{ padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:20 }}>▲</span>
                <div>
                  <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.t1 }}>Vercel</p>
                  <p style={{ margin:0, fontSize:12, color:C.t3 }}>Deploy is one click — opens Vercel's own import flow, you log in there directly. No token needed.</p>
                </div>
              </div>
              <Badge color="green">● Ready</Badge>
            </div>
          </Card>

          {/* Supabase */}
          <Card style={{ padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:20 }}>⚡</span>
                <div>
                  <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.t1 }}>Supabase</p>
                  <p style={{ margin:0, fontSize:12, color:C.t3 }}>Powers your account, notes, tasks and chat history</p>
                </div>
              </div>
              <Badge color="green">● Connected</Badge>
            </div>
          </Card>

          {/* Composio */}
          <Card style={{ padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:20 }}>🔌</span>
                <div>
                  <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.t1 }}>Composio</p>
                  <p style={{ margin:0, fontSize:12, color:C.t3 }}>500+ app integrations — not yet configured for this workspace</p>
                </div>
              </div>
              <Badge color="gray">○ Not connected</Badge>
            </div>
          </Card>
        </div>
      )}

      {tab==='feedback' && (
        <div>
          <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
            {['all','bug','feature','feedback'].map(f=><button key={f} onClick={()=>setFbF(f)} style={{ padding:'5px 14px', borderRadius:999, border:`1px solid ${fbFilter===f?C.accent:C.border}`, background:fbFilter===f?C.accentM:'transparent', color:fbFilter===f?C.accent:C.t2, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', textTransform:'capitalize', transition:'all .15s' }}>{f}</button>)}
            <Button onClick={aiSum} disabled={sumLoad||!feedbacks.length} variant="secondary" size="sm" style={{ marginLeft:'auto' }}>{sumLoad?<Spinner size={12} color={C.accent}/>:'✨'} AI Summary</Button>
          </div>
          {summary && <Card style={{ padding:16, marginBottom:16, background:C.accentM, border:`1px solid ${C.borderFocus}` }}><p style={{ margin:0, fontSize:13, color:C.t1, lineHeight:1.6 }}>{summary}</p></Card>}
          {fbLoad ? <div style={{ display:'flex', justifyContent:'center', padding:32 }}><Spinner /></div>
           : fbF.length===0 ? <EmptyState icon="💬" title="No feedback yet" description='Use the "💬 Feedback" button in the sidebar to submit feedback.' />
           : fbF.map(f=>(
            <Card key={f.id} style={{ padding:16, marginBottom:10, opacity:f.status==='resolved'?.5:1 }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <Badge color={f.type==='bug'?'red':f.type==='feature'?'accent':'gray'}>{f.type}</Badge>
                    <span style={{ fontSize:11, color:C.t3 }}>{fmtDate(f.created_at)}</span>
                    {f.status==='resolved' && <Badge color="green">Resolved</Badge>}
                  </div>
                  <p style={{ margin:0, fontSize:14, color:C.t1, lineHeight:1.5 }}>{f.description}</p>
                </div>
                {f.status!=='resolved' && <Button onClick={()=>resolve(f.id)} variant="secondary" size="sm">Resolve</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab==='data' && (
        <div>
          <Card style={{ padding:24, marginBottom:16 }}>
            <h3 style={{ margin:'0 0 16px', fontSize:15, color:C.t1 }}>Data Ownership</h3>
            <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
              <tbody>
                {[['All notes & tasks','You','Export or delete anytime'],['AI conversations','You','Export or delete anytime'],['Usage analytics','FounderLab','Anonymous, aggregate only'],['AI processing','Selected provider','Per selected provider privacy policy']].map(([a,b,c])=>(
                  <tr key={a} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:'10px 0', color:C.t1 }}>{a}</td>
                    <td style={{ padding:'10px 12px', color:C.t2 }}>{b}</td>
                    <td style={{ padding:'10px 0', color:C.t3, textAlign:'right' }}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card style={{ padding:24 }}>
            <h3 style={{ margin:'0 0 8px', fontSize:15, color:C.t1 }}>Export All Data</h3>
            <p style={{ margin:'0 0 16px', color:C.t2, fontSize:14, lineHeight:1.6 }}>Download all your notes, tasks, chats, and feedback as a single JSON file. Your data is always yours.</p>
            <Button onClick={expData} disabled={exporting}>{exporting?<Spinner size={13} color="#fff"/>:'⬇'} Export All Data (JSON)</Button>
          </Card>
        </div>
      )}
    </div>
  )
}

// ── FEEDBACK MODAL ────────────────────────────────────────────
// ── APP ROOT ──────────────────────────────────────────────────
function hasCompletedOnboarding(profile) {
  return profile?.onboarded === true
}

function AppInner() {
  const [state, setState]     = useState('booting') // booting|setup|auth|onboarding|app
  const [page, setPage]       = useState('dashboard')
  const [profile, setProfile] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [showFb, setShowFb]   = useState(false)

  useEffect(() => {
    async function boot() {
      if (!CONFIGURED) { setState('setup'); return }
      const ok=await sb.boot()
      if (ok) {
        try { await refreshProviderAvailability() } catch {}
        const p=await sb.getProfile().catch(()=>null)
        setProfile(p)
        await migrateLocalToCloud()
        setState(hasCompletedOnboarding(p)?'app':'onboarding')
      } else { setState('auth') }
    }
    boot()
    // Cross-module handoff bus: any page can call flNavigate(page, payload) to
    // switch tabs and hand data to the destination page (e.g. Code AI → Builder).
    const onNav = (e) => { if (e.detail?.page) setPage(e.detail.page) }
    window.addEventListener('fl:navigate', onNav)
    return ()=>{ window.removeEventListener('fl:navigate', onNav) }
  }, [])

  async function afterAuth() {
    try { await refreshProviderAvailability() } catch {}
    const p=await sb.getProfile().catch(()=>null)
    setProfile(p)
    await migrateLocalToCloud()
    setState(hasCompletedOnboarding(p)?'app':'onboarding')
  }

  function afterOnboarding(completedProfile, completion = {}) {
    setProfile(completedProfile)
    setState('app')
    if (!completion.saved) {
      toast('Onboarding is stored only on this device until a later sync succeeds.', 'error')
    } else if (!completion.metadataSaved) {
      toast('Workspace setup is saved. Your role and goal will sync when the connection returns.', 'error')
    }
  }

  async function signOut() {
    await sb.signOut()
    clearGithubToken()
    setProfile(null); setPage('dashboard'); setState('auth')
  }

  const user=sb.session?{id:sb.session.user_id,email:sb.session.email}:null

  function renderPage() {
    switch (page) {
      case 'chat':      return <ChatPage user={user} />
      case 'notes':     return <NotesPage user={user} />
      case 'tasks':     return <TasksPage user={user} />
      case 'youtube':   return <YouTubeAIPage user={user} />
      case 'code':      return <CodeAIPage user={user} />
      case 'builder':   return <BuilderWorkspace user={user} />
      case 'settings':  return <SettingsPage user={user} profile={profile} onProfileUpdate={setProfile} onSignOut={signOut} />
      default:          return <Dashboard user={user} profile={profile} setPage={setPage} />
    }
  }

  return (
    <>
      <GlobalStyles />
      <ToastContainer />
      {state==='booting'&&<div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center' }}><Spinner size={32} /></div>}
      {state==='setup'&&<SetupScreen />}
      {state==='auth'&&<AuthScreen onAuth={afterAuth} />}
      {state==='onboarding'&&<OnboardingModal onDone={afterOnboarding} />}
      {state==='app'&&(
        <>
          {showFb&&<FeedbackModal onClose={()=>setShowFb(false)} />}
          <div style={{ display:'flex', minHeight:'100vh', background:C.bg, overflow:'hidden' }}>
            <Sidebar page={page} setPage={setPage} user={user} profile={profile} collapsed={collapsed} setCollapsed={setCollapsed} onFeedback={()=>setShowFb(true)} />
            <div style={{ flex:1, minWidth:0, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              {renderPage()}
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
