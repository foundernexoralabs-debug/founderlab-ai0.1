// ============================================================
// FOUNDERLAB AI — src/App.jsx  |  Phase 2 Complete
// Single file · Inline styles only · No external libraries
// Colors, data patterns, and auth match master specification
// ============================================================
import React, { useState, useEffect, useRef } from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (this.state.err) return (
      <div style={{ minHeight:'100vh', background:'#09090f', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
        <div style={{ background:'#0f0f1a', border:'1px solid rgba(255,255,255,.07)', borderRadius:12, padding:32, maxWidth:480, width:'100%', textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:16 }}>⚠️</div>
          <h2 style={{ color:'#eeeef8', margin:'0 0 8px', fontSize:18 }}>Something went wrong</h2>
          <p style={{ color:'#8888b0', fontSize:13, margin:'0 0 20px' }}>{this.state.err?.message || 'Unexpected error'}</p>
          <button onClick={()=>window.location.reload()} style={{ background:'#6366f1', color:'#fff', border:'none', borderRadius:8, padding:'10px 24px', fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>Reload App</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

// ── ENV ──────────────────────────────────────────────────────
const SB_URL  = import.meta.env.VITE_SUPABASE_URL  || ''
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const CONFIGURED = Boolean(SB_URL && SB_ANON)
const LS_KEY = 'fl_session'

// ── SUPABASE CLIENT (raw fetch — no SDK) ─────────────────────
const sb = {
  session: null,
  _rem: true,

  async boot() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return false
      const saved = JSON.parse(raw)
      if (!saved?.refresh_token) return false
      const d = await this._ar('/auth/v1/token?grant_type=refresh_token', { refresh_token: saved.refresh_token })
      this._save(d, true)
      return true
    } catch { localStorage.removeItem(LS_KEY); return false }
  },

  _save(d, rem = this._rem) {
    this.session = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      user_id: d.user?.id,
      email: d.user?.email,
    }
    if (rem) localStorage.setItem(LS_KEY, JSON.stringify(this.session))
  },

  async _ar(path, body, token) {
    const h = { 'Content-Type': 'application/json', apikey: SB_ANON }
    if (token) h.Authorization = `Bearer ${token}`
    const res = await fetch(`${SB_URL}${path}`, { method: 'POST', headers: h, body: JSON.stringify(body) })
    const d = await res.json()
    if (!res.ok) throw new Error(d.msg || d.error_description || d.message || 'Auth error')
    return d
  },

  async signUp(email, password)         { return this._ar('/auth/v1/signup', { email, password }) },
  async resetPassword(email)            { return this._ar('/auth/v1/recover', { email }) },
  async resendVerification(email)       { return this._ar('/auth/v1/resend', { type: 'signup', email }) },
  async signIn(email, password, rem = true) {
    this._rem = rem
    const d = await this._ar('/auth/v1/token?grant_type=password', { email, password })
    this._save(d, rem)
    return d
  },
  async signOut() {
    try { await this._ar('/auth/v1/logout', {}, this.session?.access_token) } catch {}
    this.session = null
    localStorage.removeItem(LS_KEY)
  },
  async updatePassword(pw) {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${this.session.access_token}` },
      body: JSON.stringify({ password: pw }),
    })
    if (!res.ok) throw new Error('Update failed')
  },

  _h() { return { 'Content-Type': 'application/json', apikey: SB_ANON, Authorization: `Bearer ${this.session?.access_token}` } },

  async _get(path) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: this._h() })
      return res.ok ? await res.json() : null
    } catch { return null }
  },
  async _patch(path, body) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...this._h(), Prefer: 'return=minimal' }, body: JSON.stringify(body) })
      return res.ok
    } catch { return false }
  },
  async _post(path, body, prefer = 'return=minimal') {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method: 'POST', headers: { ...this._h(), Prefer: prefer }, body: JSON.stringify(body) })
      return res.ok
    } catch { return false }
  },

  async getProfile()       { const d = await this._get(`profiles?id=eq.${this.session.user_id}&select=*`); return Array.isArray(d) ? d[0] || null : null },
  async updateProfile(obj) { return this._post('profiles', { id: this.session.user_id, ...obj }, 'resolution=merge-duplicates,return=minimal') },
  async getData(key)       { const d = await this._get(`user_data?user_id=eq.${this.session.user_id}&key=eq.${encodeURIComponent(key)}&select=value`); return Array.isArray(d) && d.length ? d[0].value : null },
  async setData(key, val)  { return this._post('user_data', { user_id: this.session.user_id, key, value: val }, 'resolution=merge-duplicates,return=minimal') },
  async exportAll()        { return this._get(`user_data?user_id=eq.${this.session.user_id}&select=key,value`) || [] },
  async logEvent(ev, pg)   { try { await this._post('usage_events', { user_id: this.session.user_id, event: ev, page: pg }) } catch {} },
  async getEventCounts()   {
    const d = await this._get(`usage_events?user_id=eq.${this.session.user_id}&select=event`)
    if (!Array.isArray(d)) return {}
    return d.reduce((a, e) => { a[e.event] = (a[e.event] || 0) + 1; return a }, {})
  },
  async submitFeedback(type, description) { return this._post('fl_feedback', { user_id: this.session?.user_id, email: this.session?.email, type, description }) },
  async getFeedback()      { return this._get(`fl_feedback?user_id=eq.${this.session.user_id}&select=*&order=created_at.desc`) || [] },
  async resolveFeedback(id){ return this._patch(`fl_feedback?id=eq.${id}`, { status: 'resolved' }) },
}

// ── SAVE / LOAD (Supabase KV store + localStorage fallback) ──
const save = async (key, value) => {
  if (sb.session?.user_id) { try { await sb.setData(key, value) } catch {} return }
  localStorage.setItem(key, JSON.stringify(value))
}
const load = async (key, def = null) => {
  if (sb.session?.user_id) { try { const r = await sb.getData(key); return r !== null ? r : def } catch { return def } }
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : def } catch { return def }
}
async function migrateLocalToCloud() {
  for (const key of ['fl_convos', 'fl_notes', 'fl_tasks']) {
    try {
      const raw = localStorage.getItem(key); if (!raw) continue
      const local = JSON.parse(raw)
      if (!local || (Array.isArray(local) && !local.length)) continue
      const cloud = await sb.getData(key)
      if (!cloud || (Array.isArray(cloud) && !cloud.length)) { await sb.setData(key, local); localStorage.removeItem(key) }
    } catch {}
  }
}

// ── AI HELPER ────────────────────────────────────────────────
// ── AI PROVIDER MANAGER ──────────────────────────────────────
// All keys live server-side (process.env). Frontend stores only
// provider selection and non-secret config in localStorage.

const LS_PROVIDER  = 'fl_ai_provider'
const LS_MODELS    = 'fl_ai_models'    // { anthropic, groq, gemini } model per provider
const LS_OLLAMA_URL   = 'fl_ollama_url'
const LS_OLLAMA_MODEL = 'fl_ollama_model'

// Catalogue — defines every supported provider and its available models
const PROVIDERS = {
  anthropic: {
    id: 'anthropic', name: 'Anthropic Claude', icon: '✦',
    sub: 'Best quality · Cloud API',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (recommended)' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)' },
    ],
    default: 'claude-sonnet-4-20250514',
    keyEnv: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://console.anthropic.com',
  },
  groq: {
    id: 'groq', name: 'Groq', icon: '⚡',
    sub: 'Ultra-fast inference · Free tier',
    models: [
      { id: 'llama-3.2-70b-versatile', label: 'Llama 3.2 70B (recommended)' },
      { id: 'llama-3.2-3b-instruct', label: 'Llama 3.2 3B (fastest)' },
      { id: 'mistral-7b-instruct-v0.3', label: 'Mistral 7B Instruct' },
      { id: 'gemma2-9b-it', label: 'Gemma 2 9B' },
    ],
    default: 'llama-3.2-70b-versatile',
    keyEnv: 'GROQ_API_KEY',
    docsUrl: 'https://console.groq.com',
  },
  gemini: {
    id: 'gemini', name: 'Google Gemini', icon: '✶',
    sub: 'Google AI · Generous free tier',
    models: [
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (recommended · free)' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro' },
    ],
    default: 'gemini-1.5-flash',
    keyEnv: 'GEMINI_API_KEY',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  ollama: {
    id: 'ollama', name: 'Local Ollama', icon: '🦙',
    sub: '100% private · Free forever · Your machine',
    models: [],   // populated at runtime by probing localhost
    default: '',
    keyEnv: null,
    docsUrl: 'https://ollama.com',
  },
}

// Storage helpers
function getAIProvider()        { try { return localStorage.getItem(LS_PROVIDER) || 'anthropic' } catch { return 'anthropic' } }
function setAIProviderLS(id)    { try { localStorage.setItem(LS_PROVIDER, id) } catch {} }
function getProviderModel(id)   { try { const m = JSON.parse(localStorage.getItem(LS_MODELS)||'{}'); return m[id] || PROVIDERS[id]?.default || '' } catch { return PROVIDERS[id]?.default || '' } }
function setProviderModel(id,m) { try { const all = JSON.parse(localStorage.getItem(LS_MODELS)||'{}'); all[id]=m; localStorage.setItem(LS_MODELS, JSON.stringify(all)) } catch {} }
function getOllamaURL()         { try { return localStorage.getItem(LS_OLLAMA_URL)   || 'http://localhost:11434' } catch { return 'http://localhost:11434' } }
function getOllamaModel()       { try { return localStorage.getItem(LS_OLLAMA_MODEL) || '' } catch { return '' } }

// Electron desktop bridge detection
const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronBridge?.isElectron

// ── Ollama helpers (browser-direct or Electron IPC — no API key) ──

async function ollamaProbe(base) {
  const url = (base || getOllamaURL()).replace(/\/$/, '')
  if (IS_ELECTRON) {
    try { return await window.electronBridge.ollama.probe(url) } catch { return { running: false, corsOk: true, models: [] } }
  }
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      const d  = await r.json()
      const models = (d.models || []).map(m => m.name).filter(Boolean)
      return { models, corsOk: true, running: true }
    }
    return { models: [], corsOk: true, running: false }
  } catch {
    try { await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(3000) }); return { models: [], corsOk: false, running: true } }
    catch { return { models: [], corsOk: false, running: false } }
  }
}

async function ollamaChat(messages, system, max) {
  const base  = getOllamaURL().replace(/\/$/, '')
  const model = getOllamaModel() || getProviderModel('ollama') || 'llama3.2'
  const msgs  = system ? [{ role: 'system', content: system }, ...messages] : messages
  if (IS_ELECTRON) {
    const r = await window.electronBridge.ollama.chat({ url: base, model, messages: msgs, max })
    if (!r.ok) throw new Error(`Ollama: ${r.data?.error || 'unknown error'}`)
    return r.data?.message?.content || ''
  }
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, stream: false, options: { num_predict: max } }),
    signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) { const e = await r.text().catch(() => r.statusText); throw new Error(`Ollama ${r.status}: ${e}`) }
  const d = await r.json()
  return d.message?.content || ''
}

// ── ai() — THE single function all features call ──────────────
// Routes to Ollama (browser-direct) or cloud providers (via /api/ai server).
// Switching provider requires no changes in any feature component.
async function ai(messages, system = '', max = 1200) {
  const provider = getAIProvider()
  try {
    if (provider === 'ollama') {
      return (await ollamaChat(messages, system, max)) || 'No response.'
    }
    // Cloud providers: key stays on server, never in browser bundle
    const model = getProviderModel(provider)
    const r = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, max_tokens: max, ...(system && { system }), messages }),
    })
    const d = await r.json()
    if (d.error) return `⚠ ${PROVIDERS[provider]?.name || 'AI'} error: ${d.error}`
    return d.content?.[0]?.text || d.content?.map(c => c.text || '').join('') || 'No response.'
  } catch (e) {
    if (provider === 'ollama') {
      if (e.name === 'TimeoutError') return '⚠ Ollama timed out — is it still running?'
      if (e.message?.match(/fetch|Failed|NetworkError|cors/i))
        return '⚠ Cannot reach Ollama. Open Settings → AI Provider and complete the CORS setup.'
      return '⚠ Ollama: ' + e.message
    }
    return `⚠ ${PROVIDERS[provider]?.name || 'AI'} error: ${e.message}`
  }
}


// ── UTILITIES ────────────────────────────────────────────────
function uid()  { try { return crypto.randomUUID() } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2) } }
function ts()   { return new Date().toISOString() }
function timeg(){ const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening' }
function fmtDate(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) } catch { return '' } }
function copyText(t) { navigator.clipboard.writeText(t).then(() => toast('Copied!', 'success')).catch(() => {}) }

// ── THEME (exact master spec colors) ─────────────────────────
const C = {
  bg:          '#09090f',
  surf:        '#0f0f1a',
  surfHigh:    '#15152a',
  border:      'rgba(255,255,255,.07)',
  borderHov:   'rgba(255,255,255,.12)',
  borderFocus: 'rgba(99,102,241,.5)',
  accent:      '#6366f1',
  accentM:     'rgba(99,102,241,.12)',
  green:       '#10b981',
  greenM:      'rgba(16,185,129,.12)',
  yellow:      '#f59e0b',
  yellowM:     'rgba(245,158,11,.12)',
  red:         '#ef4444',
  redM:        'rgba(239,68,68,.12)',
  t1:          '#eeeef8',
  t2:          '#8888b0',
  t3:          '#44445a',
  sidebar:     196,
  sidebarSm:   52,
}

// ── TOAST ────────────────────────────────────────────────────
let _toast = null
function toast(msg, type = 'info') { _toast?.(msg, type) }
function ToastContainer() {
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    _toast = (msg, type) => {
      const id = uid()
      setToasts(p => [...p, { id, msg, type }])
      setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3200)
    }
    return () => { _toast = null }
  }, [])
  if (!toasts.length) return null
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, display:'flex', flexDirection:'column', gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: t.type==='error'?'#1a0a0a':t.type==='success'?'#0a1a12':C.surfHigh, color:C.t1, border:`1px solid ${t.type==='error'?C.red:t.type==='success'?C.green:C.border}`, borderRadius:10, padding:'10px 16px', fontSize:14, boxShadow:'0 8px 32px #0009', maxWidth:340, animation:'flSlide .2s ease', lineHeight:1.4 }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── BUTTON ───────────────────────────────────────────────────
function Button({ children, onClick, variant='primary', size='md', disabled, full, icon, style:ex }) {
  const [hov, setHov] = useState(false)
  const sz = { sm:{fontSize:12,padding:'5px 10px'}, md:{fontSize:14,padding:'7px 14px'}, lg:{fontSize:14,padding:'12px 20px'} }[size]
  const va = {
    primary:   { background:hov?'#4f46e5':C.accent, color:'#fff', border:'none' },
    secondary: { background:'transparent', color:C.t1, border:`1px solid ${hov?C.borderHov:C.border}` },
    ghost:     { background:hov?C.surfHigh:'transparent', color:C.t2, border:'none' },
    danger:    { background:hov?'#dc2626':C.red, color:'#fff', border:'none' },
    success:   { background:hov?'#059669':C.green, color:'#fff', border:'none' },
  }[variant||'primary']
  return (
    <button onClick={disabled?undefined:onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, borderRadius:8, cursor:disabled?'not-allowed':'pointer', fontWeight:500, fontFamily:'inherit', transition:'all .15s', width:full?'100%':undefined, opacity:disabled?.4:1, outline:'none', ...sz, ...va, ...ex }}>
      {icon && <span style={{fontSize:14}}>{icon}</span>}
      {children}
    </button>
  )
}

// ── INPUT ────────────────────────────────────────────────────
function Input({ value, onChange, placeholder, rows, type='text', onKeyDown, autoFocus, readOnly, style:ex }) {
  const [foc, setFoc] = useState(false)
  const base = { width:'100%', background:C.surf, border:`1px solid ${foc?C.borderFocus:C.border}`, borderRadius:8, color:C.t1, fontSize:14, fontFamily:'inherit', padding:'9px 12px', outline:'none', boxShadow:foc?`0 0 0 3px ${C.accentM}`:'none', transition:'all .15s', resize:rows?'vertical':undefined, boxSizing:'border-box', ...ex }
  const sp = { value, onChange, placeholder, onKeyDown, autoFocus, readOnly, style:base, onFocus:()=>setFoc(true), onBlur:()=>setFoc(false) }
  return rows ? <textarea rows={rows} {...sp} /> : <input type={type} {...sp} />
}

// ── CARD ─────────────────────────────────────────────────────
function Card({ children, style, onClick, hover }) {
  const [hov, setHov] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={()=>hover&&setHov(true)} onMouseLeave={()=>hover&&setHov(false)}
      style={{ background:C.surf, border:`1px solid ${hov?C.borderHov:C.border}`, borderRadius:10, padding:16, cursor:onClick?'pointer':undefined, transition:'all .15s', boxShadow:hov?'0 4px 24px #0007':'none', ...style }}>
      {children}
    </div>
  )
}

// ── BADGE ────────────────────────────────────────────────────
function Badge({ children, color='accent' }) {
  const m = { accent:[C.accentM,C.accent], green:[C.greenM,C.green], yellow:[C.yellowM,C.yellow], red:[C.redM,C.red], gray:[C.surfHigh,C.t2] }[color]||[C.accentM,C.accent]
  return <span style={{ background:m[0], color:m[1], fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, display:'inline-flex', alignItems:'center' }}>{children}</span>
}

// ── SPINNER ──────────────────────────────────────────────────
function Spinner({ size=20, color=C.accent }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation:'flSpin .8s linear infinite', flexShrink:0 }}><circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="31.4" strokeLinecap="round"/></svg>
}

// ── EMPTY STATE ──────────────────────────────────────────────
function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{ textAlign:'center', padding:60, color:C.t2 }}>
      <div style={{ fontSize:44, marginBottom:16 }}>{icon}</div>
      <div style={{ fontSize:17, fontWeight:600, color:C.t1, marginBottom:8 }}>{title}</div>
      <div style={{ fontSize:14, maxWidth:300, margin:'0 auto 20px', lineHeight:1.6 }}>{description}</div>
      {action}
    </div>
  )
}

// ── TIP ──────────────────────────────────────────────────────
function Tip({ children }) {
  return <div style={{ background:C.accentM, border:`1px solid rgba(99,102,241,.2)`, borderRadius:8, padding:'10px 14px', fontSize:13, color:C.t2, display:'flex', gap:8, alignItems:'flex-start', lineHeight:1.5 }}><span style={{flexShrink:0}}>💡</span><span>{children}</span></div>
}

// ── GLOBAL STYLES ────────────────────────────────────────────
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

// ── SETUP SCREEN ─────────────────────────────────────────────
function SetupScreen() {
  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <Card style={{ maxWidth:520, width:'100%', padding:40, borderRadius:16 }}>
        <div style={{ width:48, height:48, background:C.accent, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, color:'#fff', marginBottom:20 }}>✦</div>
        <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:700, color:C.t1 }}>Setup Required</h2>
        <p style={{ margin:'0 0 24px', color:C.t2, fontSize:14, lineHeight:1.6 }}>Create a <code style={{ background:C.surfHigh, padding:'1px 6px', borderRadius:4, color:C.accent }}>.env.local</code> file in your project root:</p>
        <div style={{ background:'#05050a', border:`1px solid ${C.border}`, borderRadius:8, padding:16, fontFamily:'monospace', fontSize:13, lineHeight:2, marginBottom:24 }}>
          <div style={{ color:C.green }}>VITE_SUPABASE_URL=https://xxxx.supabase.co</div>
          <div style={{ color:C.green }}>VITE_SUPABASE_ANON_KEY=eyJ...</div>
          <div style={{ color:C.t3 }}>ANTHROPIC_API_KEY=sk-ant-...</div>
        </div>
        <Tip>Get Supabase keys: supabase.com → Project → Settings → API. ANTHROPIC_API_KEY is server-side only — no VITE_ prefix.</Tip>
      </Card>
    </div>
  )
}

// ── AUTH SCREEN ───────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [tab, setTab]     = useState('signin')
  const [email, setEmail] = useState('')
  const [pass, setPass]   = useState('')
  const [pass2, setPass2] = useState('')
  const [rem, setRem]     = useState(true)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]     = useState(null)

  function sw(t) { setTab(t); setMsg(null); setPass(''); setPass2('') }

  async function submit() {
    setMsg(null)
    if (!email.trim()) return setMsg({ e:true, t:'Email required.' })
    if (tab === 'reset') {
      setLoading(true)
      try { await sb.resetPassword(email.trim()); setMsg({ t:'Reset email sent! Check your inbox.' }) }
      catch (e) { setMsg({ e:true, t:e.message }) } finally { setLoading(false) }
      return
    }
    if (tab === 'verify') {
      setLoading(true)
      try { await sb.resendVerification(email.trim()); setMsg({ t:'Verification email resent!' }) }
      catch (e) { setMsg({ e:true, t:e.message }) } finally { setLoading(false) }
      return
    }
    if (!pass) return setMsg({ e:true, t:'Password required.' })
    if (tab === 'signup') {
      if (pass.length < 6) return setMsg({ e:true, t:'Password must be 6+ characters.' })
      if (pass !== pass2) return setMsg({ e:true, t:'Passwords do not match.' })
      setLoading(true)
      try { await sb.signUp(email.trim(), pass); setMsg({ t:'Account created! Check your email to verify, then sign in.' }); sw('signin') }
      catch (e) { setMsg({ e:true, t:e.message }) } finally { setLoading(false) }
      return
    }
    setLoading(true)
    try { await sb.signIn(email.trim(), pass, rem); onAuth() }
    catch (e) { setMsg({ e:true, t:e.message }) } finally { setLoading(false) }
  }

  const TABS = [{ id:'signin',l:'Sign In' },{ id:'signup',l:'Sign Up' },{ id:'reset',l:'Reset' },{ id:'verify',l:'Verify' }]
  const lbl = (s) => <label style={{ display:'block', fontSize:12, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>{s}</label>

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ maxWidth:420, width:'100%' }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ width:56, height:56, background:C.accent, borderRadius:14, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:26, color:'#fff', marginBottom:14 }}>✦</div>
          <h1 style={{ margin:0, fontSize:24, fontWeight:700, color:C.t1 }}>FounderLab AI</h1>
          <p style={{ margin:'6px 0 0', color:C.t2, fontSize:14 }}>Your AI-powered founder workspace</p>
        </div>
        <Card style={{ padding:32, borderRadius:16 }}>
          <div style={{ display:'flex', gap:3, marginBottom:24, background:C.bg, borderRadius:10, padding:4 }}>
            {TABS.map(t => <button key={t.id} onClick={()=>sw(t.id)} style={{ flex:1, padding:'7px 4px', borderRadius:7, border:'none', background:tab===t.id?C.surfHigh:'transparent', color:tab===t.id?C.t1:C.t3, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', transition:'all .15s' }}>{t.l}</button>)}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div>{lbl('Email')}<Input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" type="email" onKeyDown={e=>e.key==='Enter'&&submit()} autoFocus /></div>
            {(tab==='signin'||tab==='signup') && <div>{lbl('Password')}<Input value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" type="password" onKeyDown={e=>e.key==='Enter'&&submit()} /></div>}
            {tab==='signup' && <div>{lbl('Confirm Password')}<Input value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="••••••••" type="password" onKeyDown={e=>e.key==='Enter'&&submit()} /></div>}
            {tab==='signin' && (
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:C.t2 }}>
                <input type="checkbox" checked={rem} onChange={e=>setRem(e.target.checked)} style={{ accentColor:C.accent }} /> Remember me
              </label>
            )}
            {msg && <div style={{ padding:'10px 13px', borderRadius:8, fontSize:13, background:msg.e?C.redM:C.greenM, color:msg.e?C.red:C.green, border:`1px solid ${msg.e?C.red:C.green}40`, lineHeight:1.5 }}>{msg.t}</div>}
            <Button onClick={submit} disabled={loading} full size="lg" style={{ marginTop:4 }}>
              {loading && <Spinner size={14} color="#fff" />}
              {tab==='signin'?'Sign In':tab==='signup'?'Create Account':tab==='reset'?'Send Reset Email':'Resend Verification'}
            </Button>
          </div>
          {tab==='signin' && <p style={{ textAlign:'center', marginTop:16, fontSize:13, color:C.t2 }}>No account? <span onClick={()=>sw('signup')} style={{ color:C.accent, cursor:'pointer', fontWeight:500 }}>Sign up free</span></p>}
        </Card>
      </div>
    </div>
  )
}

// ── ONBOARDING MODAL ─────────────────────────────────────────
function OnboardingModal({ onDone }) {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('')
  const [goal, setGoal] = useState('')

  const roles = ['Founder','Creator','Freelancer','Developer','Student']
  const goals = ['Grow my business','Save time with AI','Create more content','Build in public','Learn faster']

  async function finish() {
    try { await sb.updateProfile({ onboarded:true, role, goal }) } catch {}
    onDone()
  }

  const sel = (val, active, onSel) => (
    <button onClick={()=>onSel(val)} style={{ padding:'12px 16px', borderRadius:8, border:`1px solid ${active===val?C.accent:C.border}`, background:active===val?C.accentM:'transparent', color:active===val?C.accent:C.t1, cursor:'pointer', fontSize:14, fontFamily:'inherit', fontWeight:500, textAlign:'left', transition:'all .15s', width:'100%' }}>{val}</button>
  )

  const steps = [
    <div key={0} style={{ textAlign:'center' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🚀</div>
      <h2 style={{ margin:'0 0 12px', fontSize:22, fontWeight:700, color:C.t1 }}>Welcome to FounderLab AI</h2>
      <p style={{ color:C.t2, fontSize:15, lineHeight:1.6, marginBottom:24 }}>Your all-in-one AI workspace. Chat, Notes, Tasks, YouTube AI, Code AI, and a Website Builder — all in one place, synced to the cloud.</p>
      <Button onClick={()=>setStep(1)} full size="lg">Get Started →</Button>
    </div>,
    <div key={1}>
      <div style={{ textAlign:'center', marginBottom:20 }}><h2 style={{ margin:'0 0 6px', fontSize:20, fontWeight:700, color:C.t1 }}>What best describes you?</h2><p style={{ color:C.t2, fontSize:14, margin:0 }}>Helps us personalise your experience</p></div>
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>{roles.map(r=>sel(r, role, setRole))}</div>
      <div style={{ display:'flex', gap:8 }}><Button onClick={()=>setStep(0)} variant="secondary" full>Back</Button><Button onClick={()=>role&&setStep(2)} disabled={!role} full>Next →</Button></div>
    </div>,
    <div key={2}>
      <div style={{ textAlign:'center', marginBottom:20 }}><h2 style={{ margin:'0 0 6px', fontSize:20, fontWeight:700, color:C.t1 }}>Your main goal?</h2><p style={{ color:C.t2, fontSize:14, margin:0 }}>We'll tailor suggestions to you</p></div>
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:20 }}>{goals.map(g=>sel(g, goal, setGoal))}</div>
      <div style={{ display:'flex', gap:8 }}><Button onClick={()=>setStep(1)} variant="secondary" full>Back</Button><Button onClick={()=>goal&&finish()} disabled={!goal} full>Enter FounderLab ✦</Button></div>
    </div>,
  ]

  return (
    <div style={{ position:'fixed', inset:0, background:'#000c', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <Card style={{ width:'100%', maxWidth:460, padding:36, borderRadius:16 }}>
        <div style={{ display:'flex', gap:4, marginBottom:28 }}>
          {[0,1,2].map(i=><div key={i} style={{ flex:1, height:3, borderRadius:99, background:i<=step?C.accent:C.border, transition:'background .3s' }} />)}
        </div>
        {steps[step]}
      </Card>
    </div>
  )
}

// ── DASHBOARD ────────────────────────────────────────────────
function Dashboard({ user, profile, setPage }) {
  const [counts, setCounts]   = useState({})
  const [banner, setBanner]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      setLoading(true)
      sb.logEvent('visit', 'dashboard')
      try {
        const [ec, notes, tasks] = await Promise.all([
          sb.getEventCounts().catch(()=>({})),
          load('fl_notes', []),
          load('fl_tasks', []),
        ])
        setCounts(ec)
        const sorted = Array.isArray(notes) ? [...notes].sort((a,b) => b.updated_at > a.updated_at ? 1 : -1) : []
        const pending = Array.isArray(tasks) ? tasks.filter(t=>t.status!=='done').length : 0
        if (sorted[0] || pending > 0) setBanner({ note:sorted[0]||null, pending })
      } catch {} finally { setLoading(false) }
    }
    init()
  }, [])

  const stats = [
    { icon:'💬', label:'AI Chats', k:'chat', color:C.accent },
    { icon:'📝', label:'Notes',    k:'note', color:C.green },
    { icon:'✅', label:'Tasks',    k:'task', color:C.yellow },
    { icon:'▶',  label:'YouTube',  k:'youtube', color:'#f43f5e' },
    { icon:'⌨',  label:'Code',     k:'code', color:'#3b82f6' },
    { icon:'⬡',  label:'Builder',  k:'builder', color:'#a78bfa' },
  ]
  const maxC = Math.max(...stats.map(s=>counts[s.k]||0), 1)

  const quick = [
    { icon:'💬', label:'AI Chat',    page:'chat' },
    { icon:'📝', label:'New Note',   page:'notes' },
    { icon:'✅', label:'Add Task',   page:'tasks' },
    { icon:'▶',  label:'YouTube AI', page:'youtube' },
    { icon:'⌨',  label:'Code AI',    page:'code' },
    { icon:'⬡',  label:'Build Site', page:'builder' },
  ]

  return (
    <div style={{ height:'100%', overflowY:'auto', padding:'32px 32px 48px' }}>
      <div style={{ marginBottom:32 }}>
        <h1 style={{ margin:'0 0 6px', fontSize:26, fontWeight:700, color:C.t1 }}>Good {timeg()} 👋</h1>
        <p style={{ margin:0, color:C.t2, fontSize:15 }}>{profile?.full_name || user?.email}</p>
      </div>

      {banner && (
        <Card style={{ padding:20, marginBottom:24, background:C.surfHigh, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:4 }}>Continue where you left off</div>
            <div style={{ fontSize:14, color:C.t1 }}>
              {banner.note && <span>📝 <span style={{ fontWeight:500 }}>{banner.note.title||'Untitled note'}</span></span>}
              {banner.note && banner.pending>0 && <span style={{ color:C.t3, margin:'0 8px' }}>·</span>}
              {banner.pending>0 && <span>✅ <span style={{ fontWeight:500 }}>{banner.pending} task{banner.pending!==1?'s':''} pending</span></span>}
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {banner.note && <Button onClick={()=>setPage('notes')} variant="secondary" size="sm">Open Notes</Button>}
            {banner.pending>0 && <Button onClick={()=>setPage('tasks')} variant="secondary" size="sm">Open Tasks</Button>}
          </div>
        </Card>
      )}

      <div style={{ marginBottom:32 }}>
        <div style={{ fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:14 }}>Quick Actions</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:12 }}>
          {quick.map(a => (
            <Card key={a.label} hover onClick={()=>setPage(a.page)} style={{ padding:'16px 14px', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
              <span style={{ fontSize:20 }}>{a.icon}</span>
              <span style={{ fontSize:13, fontWeight:500, color:C.t1 }}>{a.label}</span>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize:11, fontWeight:600, color:C.t3, textTransform:'uppercase', letterSpacing:'.05em', marginBottom:14 }}>Feature Usage</div>
        <Card style={{ padding:'20px 24px' }}>
          {loading ? <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner /></div> : (
            <div style={{ display:'flex', alignItems:'flex-end', gap:16, height:120 }}>
              {stats.map(s => {
                const n = counts[s.k]||0
                const h = Math.max(n/maxC*80, n>0?8:2)
                return (
                  <div key={s.k} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, flex:1, minWidth:0 }}>
                    <span style={{ fontSize:11, color:C.t2, fontWeight:600, height:16 }}>{n||''}</span>
                    <div style={{ width:'100%', height:h, background:s.color, borderRadius:'4px 4px 0 0', opacity:n>0?1:0.15, transition:'height .4s ease' }} />
                    <span style={{ fontSize:10, color:C.t3, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', width:'100%' }}>{s.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── AI CHAT ──────────────────────────────────────────────────
const CHAT_SYS = 'You are FounderLab AI — a smart, concise assistant for founders, creators, and builders. Be practical and direct. Use code blocks for code. Format responses clearly.'
const STARTERS = [
  'Help me brainstorm a content strategy for my startup',
  'Review my business idea and give me brutally honest feedback',
  'Write a cold email to potential investors or clients',
  'Break down my biggest goal into actionable daily tasks',
]

function renderMsg(content) {
  const parts = content.split(/(```[\w]*\n[\s\S]*?```)/g)
  return parts.map((p, i) => {
    if (p.startsWith('```')) {
      const m = p.match(/```(\w*)\n?([\s\S]*?)```/)
      if (m) return (
        <div key={i} style={{ background:'#050508', border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', fontFamily:'monospace', fontSize:12, whiteSpace:'pre-wrap', margin:'6px 0', overflowX:'auto' }}>
          {m[1] && <div style={{ color:C.accent, fontSize:10, marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>{m[1]}</div>}
          {m[2]}
        </div>
      )
    }
    return <span key={i} style={{ whiteSpace:'pre-wrap', lineHeight:1.6 }}>{p}</span>
  })
}

function ChatPage({ user }) {
  const [convos, setConvos]       = useState([])
  const [activeId, setActiveId]   = useState(null)
  const [input, setInput]         = useState('')
  const [sending, setSending]     = useState(false)
  const [loadingData, setLD]      = useState(true)
  const [renaming, setRenaming]   = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const msgEnd = useRef(null)
  const saveTimer = useRef(null)
  const active = convos.find(c=>c.id===activeId)
  const messages = active?.messages||[]

  useEffect(() => {
    async function init() {
      setLD(true); sb.logEvent('chat','chat')
      const d = await load('fl_convos', [])
      setConvos(Array.isArray(d)?d:[])
      setLD(false)
    }
    init()
  }, [])

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior:'smooth' }) }, [messages.length, sending])

  function persist(updated) {
    setConvos(updated)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save('fl_convos', updated), 600)
  }

  function newConvo() {
    const c = { id:uid(), title:'New Chat', messages:[], created_at:ts(), updated_at:ts() }
    persist([c, ...convos]); setActiveId(c.id)
  }

  async function send(text) {
    const t = (text||input).trim()
    if (!t||sending) return
    setInput('')
    let cid = activeId
    let cvs = convos
    if (!cid) {
      const c = { id:uid(), title:t.slice(0,40), messages:[], created_at:ts(), updated_at:ts() }
      cvs = [c, ...convos]; cid = c.id; setActiveId(cid)
    }
    const userMsg = { id:uid(), role:'user', content:t, ts:ts() }
    cvs = cvs.map(c => c.id===cid ? { ...c, messages:[...c.messages, userMsg], updated_at:ts(), title:c.messages.length===0?t.slice(0,40):c.title } : c)
    cvs = [cvs.find(c=>c.id===cid), ...cvs.filter(c=>c.id!==cid)]
    persist(cvs); setSending(true)
    const history = (cvs.find(c=>c.id===cid)?.messages||[]).map(m=>({ role:m.role, content:m.content }))
    const reply = await ai(history, CHAT_SYS, 2000)
    const aiMsg = { id:uid(), role:'assistant', content:reply, ts:ts() }
    const final = cvs.map(c => c.id===cid ? { ...c, messages:[...c.messages, aiMsg], updated_at:ts() } : c)
    persist(final); setSending(false)
  }

  function del(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this chat?')) return
    persist(convos.filter(c=>c.id!==id))
    if (activeId===id) { setActiveId(null) }
    toast('Chat deleted', 'success')
  }

  function startRename(c, e) { e.stopPropagation(); setRenaming(c.id); setRenameVal(c.title) }
  function commitRename(id) {
    if (!renameVal.trim()) { setRenaming(null); return }
    persist(convos.map(c=>c.id===id?{...c,title:renameVal}:c)); setRenaming(null)
  }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
      <div style={{ width:240, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', flexShrink:0 }}>
        <div style={{ padding:12, borderBottom:`1px solid ${C.border}` }}>
          <Button onClick={newConvo} full size="sm" icon="+">New Chat</Button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:8 }}>
          {loadingData ? <div style={{ display:'flex', justifyContent:'center', padding:20 }}><Spinner /></div> :
           convos.length===0 ? <div style={{ textAlign:'center', padding:'24px 12px', color:C.t3, fontSize:13 }}>No chats yet</div> :
           convos.map(c => (
            <div key={c.id} onClick={()=>setActiveId(c.id)}
              style={{ padding:'8px 10px', borderRadius:8, cursor:'pointer', marginBottom:2, background:activeId===c.id?C.accentM:'transparent', border:`1px solid ${activeId===c.id?C.borderFocus:'transparent'}`, display:'flex', alignItems:'center', gap:4, transition:'all .15s' }}>
              {renaming===c.id
                ? <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)} onBlur={()=>commitRename(c.id)} onKeyDown={e=>{ if(e.key==='Enter')commitRename(c.id); if(e.key==='Escape')setRenaming(null) }} onClick={e=>e.stopPropagation()} style={{ flex:1, background:C.bg, border:`1px solid ${C.accent}`, borderRadius:5, padding:'2px 6px', color:C.t1, fontSize:13, outline:'none', fontFamily:'inherit' }} />
                : <span style={{ flex:1, fontSize:13, color:activeId===c.id?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.title||'Untitled'}</span>
              }
              <button onClick={e=>startRename(c,e)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:11, padding:2, fontFamily:'inherit' }} title="Rename">✎</button>
              <button onClick={e=>del(c.id,e)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:16, padding:'0 2px', lineHeight:1 }} title="Delete">×</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {!activeId ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:32 }}>
            <div style={{ textAlign:'center', marginBottom:32 }}>
              <div style={{ fontSize:40, marginBottom:12, color:C.accent }}>✦</div>
              <h2 style={{ margin:'0 0 8px', fontSize:20, fontWeight:700, color:C.t1 }}>FounderLab AI</h2>
              <p style={{ margin:0, color:C.t2, fontSize:14 }}>Start a conversation or pick a prompt below</p>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, maxWidth:560, width:'100%' }}>
              {STARTERS.map(s => (
                <button key={s} onClick={()=>{ newConvo(); setTimeout(()=>send(s),80) }}
                  style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 14px', color:C.t2, fontSize:13, cursor:'pointer', textAlign:'left', lineHeight:1.5, fontFamily:'inherit', transition:'all .15s' }}
                  onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.borderHov; e.currentTarget.style.color=C.t1 }}
                  onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t2 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div style={{ flex:1, overflowY:'auto', padding:'24px 28px' }}>
              {messages.length===0 && <div style={{ textAlign:'center', color:C.t3, padding:40, fontSize:14 }}>Send a message to start</div>}
              {messages.map((m,i) => (
                <div key={m.id||i} style={{ display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start', marginBottom:18 }}>
                  {m.role==='assistant' && <div style={{ width:28, height:28, background:C.accent, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', flexShrink:0, marginRight:10, marginTop:2 }}>✦</div>}
                  <div style={{ maxWidth:'76%' }}>
                    <div style={{ background:m.role==='user'?C.accent:C.surf, color:C.t1, borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px', padding:'10px 14px', border:m.role==='assistant'?`1px solid ${C.border}`:'none', fontSize:14 }}>
                      {renderMsg(m.content)}
                    </div>
                    {m.role==='assistant' && <button onClick={()=>copyText(m.content)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:11, padding:'4px 0', marginTop:2, fontFamily:'inherit' }}>📋 Copy</button>}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
                  <div style={{ width:28, height:28, background:C.accent, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff' }}>✦</div>
                  <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:'16px 16px 16px 4px', padding:'12px 16px', display:'flex', gap:5, alignItems:'center' }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:'50%', background:C.t2, animation:`flPulse 1.4s ease-in-out ${i*.2}s infinite` }} />)}
                  </div>
                </div>
              )}
              <div ref={msgEnd} />
            </div>
            <div style={{ padding:'12px 28px 20px', borderTop:`1px solid ${C.border}` }}>
              <div style={{ display:'flex', gap:8 }}>
                <Input value={input} onChange={e=>setInput(e.target.value)} placeholder="Message FounderLab AI…" onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()} }} style={{ flex:1 }} />
                <Button onClick={()=>send()} disabled={sending||!input.trim()} style={{ flexShrink:0, fontSize:18, padding:'7px 14px' }}>↑</Button>
              </div>
              <p style={{ margin:'6px 0 0', fontSize:11, color:C.t3, textAlign:'center' }}>Enter to send · Shift+Enter for new line</p>
            </div>
          </>
        )}
      </div>
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
  const filtered = notes.filter(n=>!search||(n.title+' '+n.content).toLowerCase().includes(search.toLowerCase()))

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
    const r = await ai([{ role:'user', content:`Improve and enhance this note. Make it clearer, better structured, and more useful while preserving all original information:\n\n${title?'Title: '+title+'\n\n':''}${content}` }],'',2000)
    setContent(r); updateNote(title,r,tags); setEnh(false)
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

  function persist(u) { setTasks(u); save('fl_tasks',u) }

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
    if(!aiIn.trim())return
    setAiLoad(true)
    const r=await ai([{role:'user',content:`Break this goal into 5-8 specific actionable tasks. Return ONLY a JSON array of strings, no markdown, no explanation. Goal: ${aiIn}`}],'',1200)
    try {
      const arr=JSON.parse(r.match(/\[[\s\S]*\]/)?.[0]||'[]')
      if(arr.length){ persist([...arr.map(title=>({id:uid(),title:String(title),status:'todo',priority:'medium',description:'',due_date:'',created_at:ts(),updated_at:ts()})),...tasks]); setAiIn(''); toast(`Added ${arr.length} tasks!`,'success') }
      else toast('No tasks in response','error')
    } catch { toast('Could not parse AI response','error') }
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
                      return (
                        <div key={task.id} style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 12px', marginBottom:8 }}>
                          <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:8 }}>
                            <input type="checkbox" checked={task.status==='done'} onChange={()=>toggle(task.id)} style={{ accentColor:C.accent, marginTop:2, flexShrink:0 }} />
                            <span style={{ fontSize:13, color:C.t1, lineHeight:1.4, textDecoration:task.status==='done'?'line-through':'none', flex:1 }}>{task.title}</span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 }}>
                            <Badge color={task.priority==='high'?'red':task.priority==='medium'?'yellow':'green'}>{pl}</Badge>
                            <div style={{ display:'flex', gap:3, alignItems:'center' }}>
                              {task.due_date && <span style={{ fontSize:10, color:C.t3 }}>{fmtDate(task.due_date)}</span>}
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
  { id:'titles',  label:'Titles',   icon:'🏷', fn:(t,tr)=>`Generate 10 SEO-optimized YouTube video titles. Make them click-worthy, specific, and varied (numbers, questions, how-tos, etc).\n\n${t?'Topic: '+t+'\n\n':''}${tr?'Transcript:\n'+tr.slice(0,3000):''}` },
  { id:'captions',label:'Captions', icon:'📝', fn:(t,tr)=>`Write 3 platform-optimized captions for this video:\n1. YouTube description (500 chars + 10 relevant hashtags)\n2. Instagram/TikTok (150 chars + 10 hashtags)\n3. LinkedIn post (200 chars + 10 hashtags)\n\n${t?'Topic: '+t+'\n\n':''}${tr?'Transcript:\n'+tr.slice(0,3000):''}` },
  { id:'shorts',  label:'Shorts',   icon:'▶',  fn:(t,tr)=>`Identify 5 viral YouTube Shorts ideas. For each: hook (first 3 sec), duration (15-60s), why it would go viral, 3-step outline.\n\n${t?'Topic: '+t+'\n\n':''}${tr?'Transcript:\n'+tr.slice(0,3000):''}` },
  { id:'strategy',label:'Strategy', icon:'📅', fn:(t,tr)=>`Create a 7-day YouTube content calendar. Include daily video ideas, thumbnail concepts, community post ideas, and channel growth tips.\n\n${t?'Topic/Channel: '+t+'\n\n':''}${tr?'Reference content:\n'+tr.slice(0,3000):''}` },
]

function YouTubeAIPage({ user }) {
  const [title, setTitle]   = useState('')
  const [trans, setTrans]   = useState('')
  const [active, setActive] = useState('titles')
  const [outputs, setOut]   = useState({})
  const [loading, setL]     = useState(false)

  async function generate() {
    if (!title.trim()&&!trans.trim()) return toast('Add a topic or paste a transcript first','error')
    sb.logEvent('youtube','youtube'); setL(true)
    const type=YT.find(t=>t.id===active)
    const r=await ai([{role:'user',content:type.fn(title,trans)}],'You are a YouTube growth expert who helps creators build viral channels.',2000)
    setOut(p=>({...p,[active]:r})); setL(false)
  }

  const wc=trans.trim().split(/\s+/).filter(Boolean).length

  return (
    <div style={{ height:'100%', overflowY:'auto', padding:'32px 32px 48px', maxWidth:900 }}>
      <h2 style={{ margin:'0 0 24px', fontSize:22, fontWeight:700, color:C.t1 }}>YouTube AI</h2>
      <Card style={{ padding:24, marginBottom:20 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Video Title or Topic <span style={{ color:C.t3, fontWeight:400, textTransform:'none' }}>(optional)</span></label>
            <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. How I built a $10k/mo SaaS in 60 days" onKeyDown={e=>e.key==='Enter'&&generate()} />
          </div>
          <div>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Paste YouTube Transcript <span style={{ color:C.t3, fontWeight:400 }}>({wc} words)</span></label>
            <Input value={trans} onChange={e=>setTrans(e.target.value)} placeholder="Paste your video transcript here for better AI results…" rows={7} />
          </div>
          <Tip>Get any YouTube transcript free: open a video → click "…" below the video → Show transcript. Copy and paste it here for best results.</Tip>
        </div>
      </Card>
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {YT.map(t=>(
          <button key={t.id} onClick={()=>setActive(t.id)} style={{ padding:'8px 16px', borderRadius:8, border:`1px solid ${active===t.id?C.accent:C.border}`, background:active===t.id?C.accentM:'transparent', color:active===t.id?C.accent:C.t2, cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit', display:'flex', alignItems:'center', gap:6, transition:'all .15s' }}>
            {t.icon} {t.label}
          </button>
        ))}
        <Button onClick={generate} disabled={loading||(!title.trim()&&!trans.trim())} style={{ marginLeft:'auto' }}>
          {loading?<Spinner size={14} color="#fff"/>:'✨'} Generate
        </Button>
      </div>
      <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 18px', borderBottom:`1px solid ${C.border}` }}>
          <span style={{ fontSize:14, fontWeight:500, color:C.t1 }}>{YT.find(t=>t.id===active)?.icon} {YT.find(t=>t.id===active)?.label} Output</span>
          {outputs[active] && <Button onClick={()=>copyText(outputs[active])} variant="secondary" size="sm">📋 Copy</Button>}
        </div>
        <div style={{ padding:20, minHeight:200 }}>
          {loading ? <div style={{ display:'flex', alignItems:'center', gap:10, color:C.t2, fontSize:14 }}><Spinner />Generating…</div>
           : outputs[active] ? <pre style={{ margin:0, fontFamily:'inherit', fontSize:14, color:C.t1, whiteSpace:'pre-wrap', lineHeight:1.7 }}>{outputs[active]}</pre>
           : <div style={{ textAlign:'center', color:C.t3, padding:'30px 0', fontSize:14 }}>Generate output will appear here</div>}
        </div>
      </Card>
    </div>
  )
}

// ── CODE AI ──────────────────────────────────────────────────
const LANGS=['JavaScript','TypeScript','Python','React','HTML/CSS','Rust','Go','Swift','SQL','Bash']

function CodeAIPage({ user }) {
  const [lang,setLang]   = useState('JavaScript')
  const [desc,setDesc]   = useState('')
  const [code,setCode]   = useState('')
  const [out,setOut]     = useState('')
  const [loading,setL]   = useState(false)
  const [act,setAct]     = useState(null)
  const SYS = `You are an expert ${lang} developer. Write clean, production-ready code.`

  async function run(action, prompt) {
    setAct(action); setL(true); sb.logEvent('code','code')
    setOut(await ai([{role:'user',content:prompt}],SYS,2000)); setL(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ padding:'16px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <h2 style={{ margin:'0 0 12px', fontSize:20, fontWeight:700, color:C.t1 }}>Code AI</h2>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {LANGS.map(l=><button key={l} onClick={()=>setLang(l)} style={{ padding:'5px 12px', borderRadius:999, border:`1px solid ${lang===l?C.accent:C.border}`, background:lang===l?C.accentM:'transparent', color:lang===l?C.accent:C.t2, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', transition:'all .15s' }}>{l}</button>)}
        </div>
      </div>
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        <div style={{ width:'44%', borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:16, borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Describe what to build</label>
            <Input rows={3} value={desc} onChange={e=>setDesc(e.target.value)} placeholder={`Describe the ${lang} code to generate…`} style={{ marginBottom:8, fontSize:13 }} />
            <Button onClick={()=>desc.trim()&&run('gen',`Write clean, well-commented ${lang} code that: ${desc}`)} disabled={loading||!desc.trim()} full size="sm">
              {loading&&act==='gen'?<Spinner size={13} color="#fff"/>:'✨'} Generate {lang}
            </Button>
          </div>
          <div style={{ flex:1, padding:16, display:'flex', flexDirection:'column' }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t3, marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Paste existing code</label>
            <textarea value={code} onChange={e=>setCode(e.target.value)} placeholder="Paste your code here…" style={{ flex:1, background:'#050508', border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontFamily:'monospace', fontSize:12, padding:12, outline:'none', resize:'none', lineHeight:1.6 }} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginTop:8 }}>
              {[['exp','📖 Explain',`Explain this ${lang} code clearly. What it does, how it works, key patterns:`],
                ['dbg','🐛 Debug',`Debug this ${lang} code. Find all bugs, explain each, provide fixed version:`],
                ['imp','⬆ Improve',`Improve this ${lang} code for readability, performance, best practices:`],
                ['tst','🧪 Tests',`Write comprehensive unit tests for this ${lang} code. Cover edge cases:`]].map(([a,l,p])=>(
                <Button key={a} onClick={()=>code.trim()?run(a,p+'\n\n'+code):toast('Paste code first','error')} disabled={loading} variant="secondary" size="sm">
                  {loading&&act===a?<Spinner size={12} color={C.accent}/>:null}{l}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <span style={{ fontSize:13, color:C.t2 }}>Output</span>
            {out && <Button onClick={()=>copyText(out)} variant="secondary" size="sm">📋 Copy</Button>}
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:16 }}>
            {loading?<div style={{ display:'flex', alignItems:'center', gap:10, color:C.t2, fontSize:14 }}><Spinner />Generating…</div>
             :out?<pre style={{ margin:0, fontFamily:'monospace', fontSize:13, color:C.t1, whiteSpace:'pre-wrap', lineHeight:1.6 }}>{out}</pre>
             :<div style={{ textAlign:'center', color:C.t3, padding:'50px 0', fontSize:14 }}>Output appears here</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── WEBSITE BUILDER ───────────────────────────────────────────
const BSTYLES=['Dark Modern','Clean Minimal','Bold Startup','Luxury Premium']
const BGUIDES={
  'Dark Modern':'dark background #0a0a0f, accent color #6366f1 (indigo), white text, modern clean layout with subtle glass-morphism',
  'Clean Minimal':'pure white background, black text, generous whitespace, minimal sans-serif typography, very clean',
  'Bold Startup':'vibrant gradient background purple-to-pink, bold large white typography, energetic design with high contrast',
  'Luxury Premium':'deep black background, gold #d4af37 accents, elegant serif fonts, premium sophisticated layout',
}

function BuilderPage({ user }) {
  const [desc,setDesc]   = useState('')
  const [style,setStyle] = useState('Dark Modern')
  const [html,setHtml]   = useState('')
  const [loading,setL]   = useState(false)
  const [view,setView]   = useState('preview')

  async function build() {
    if(!desc.trim()) return toast('Describe your product first','error')
    sb.logEvent('builder','builder'); setL(true)
    const r=await ai([{role:'user',content:`Create a complete, beautiful, responsive single-page HTML landing page for: ${desc}\n\nStyle guide: ${BGUIDES[style]}\n\nRequirements:\n- All CSS in <style> tags\n- Hero section with compelling headline and CTA button\n- 3-4 feature/benefit cards\n- Stats or social proof section\n- Final CTA section\n- Clean footer\n- Mobile responsive with media queries\n- No external dependencies\n\nReturn ONLY valid HTML starting with <!DOCTYPE html> and nothing else.`}],'You are an expert web designer who creates stunning, conversion-optimized landing pages.',4000)
    const m=r.match(/(<!DOCTYPE html>[\s\S]*<\/html>)/i)
    setHtml(m?m[1]:r); setView('preview'); setL(false)
  }

  function dl() {
    const a=Object.assign(document.createElement('a'),{ href:URL.createObjectURL(new Blob([html],{type:'text/html'})), download:'landing-page.html' })
    a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ padding:'20px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <h2 style={{ margin:'0 0 16px', fontSize:22, fontWeight:700, color:C.t1 }}>Website Builder</h2>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <Input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Describe your product or business…" style={{ flex:1, minWidth:200 }} onKeyDown={e=>e.key==='Enter'&&build()} />
          <select value={style} onChange={e=>setStyle(e.target.value)} style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:14, padding:'9px 12px', fontFamily:'inherit', cursor:'pointer' }}>
            {BSTYLES.map(s=><option key={s}>{s}</option>)}
          </select>
          <Button onClick={build} disabled={loading}>{loading?<Spinner size={14} color="#fff"/>:'⬡'} Build Site</Button>
        </div>
        {loading && <p style={{ margin:'10px 0 0', fontSize:13, color:C.t2 }}>⚡ Building your landing page… (~20 seconds)</p>}
      </div>
      {html ? (
        <>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 24px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
            <div style={{ display:'flex', gap:3, background:C.bg, borderRadius:8, padding:3 }}>
              {['preview','code'].map(v=><button key={v} onClick={()=>setView(v)} style={{ padding:'5px 14px', borderRadius:6, border:'none', background:view===v?C.surf:'transparent', color:view===v?C.t1:C.t3, cursor:'pointer', fontSize:13, fontFamily:'inherit', transition:'all .15s' }}>{v==='preview'?'👁 Preview':'< > Code'}</button>)}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <Button onClick={()=>copyText(html)} variant="secondary" size="sm">📋 Copy HTML</Button>
              <Button onClick={dl} size="sm">⬇ Download</Button>
            </div>
          </div>
          <div style={{ flex:1, overflow:'hidden' }}>
            {view==='preview' ? <iframe srcDoc={html} style={{ width:'100%', height:'100%', border:'none' }} title="Preview" sandbox="allow-scripts" />
             : <pre style={{ margin:0, padding:20, fontFamily:'monospace', fontSize:12, color:C.t1, whiteSpace:'pre-wrap', overflowY:'auto', height:'100%', background:'#050508', boxSizing:'border-box' }}>{html}</pre>}
          </div>
        </>
      ) : !loading ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <EmptyState icon="⬡" title="Describe your product above" description="AI generates a complete, downloadable landing page — hero, features, CTA, footer — ready to deploy." />
        </div>
      ) : <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}><Spinner size={36} /></div>}
    </div>
  )
}

// ── SETTINGS ─────────────────────────────────────────────────
function SettingsPage({ user, profile, onProfileUpdate, onSignOut }) {
  const [tab, setTab]       = useState('profile')
  const [name, setName]     = useState(profile?.full_name||'')

  // ── AI provider state ──────────────────────────────────────
  const [aiProv, setAIProv] = useState(getAIProvider)
  // Per-provider model selections (initialised from localStorage)
  const [modelMap, setModelMap] = useState(() => {
    const stored = {}
    Object.keys(PROVIDERS).forEach(id => { stored[id] = getProviderModel(id) })
    return stored
  })
  // Ollama-specific
  const [ollamaUrl, setOllamaUrl]           = useState(getOllamaURL)
  const [ollamaModel, setOllamaModel]       = useState(getOllamaModel)
  const [ollamaModels, setOllamaModels]     = useState([])
  const [ollamaDetecting, setOllamaDetecting] = useState(false)
  const [ollamaDetectErr, setOllamaDetectErr] = useState('')
  // Shared test state
  const [testStatus, setTestStatus]   = useState('') // '' | 'testing' | '✅ …' | '❌ …'

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
  const tabs = [{id:'profile',l:'Profile'},{id:'ai',l:'AI Provider'},{id:'feedback',l:'Feedback'},{id:'data',l:'Data & Export'}]

  // ── AI Settings handlers ────────────────────────────────────
  function saveAISettings() {
    try {
      setAIProviderLS(aiProv)
      Object.entries(modelMap).forEach(([id, m]) => setProviderModel(id, m))
      try { localStorage.setItem(LS_OLLAMA_URL, ollamaUrl) } catch {}
      try { localStorage.setItem(LS_OLLAMA_MODEL, ollamaModel) } catch {}
      toast('AI settings saved', 'success')
    } catch { toast('Failed to save settings', 'error') }
  }

  async function detectOllamaModels() {
    setOllamaDetecting(true); setOllamaDetectErr(''); setOllamaModels([])
    const { models, corsOk, running } = await ollamaProbe(ollamaUrl)
    if (!running)           setOllamaDetectErr('❌ Ollama not reachable. Is it running on this machine?')
    else if (!corsOk)       setOllamaDetectErr('⚠ Ollama is running but CORS is blocked. Start it with OLLAMA_ORIGINS=* ollama serve')
    else if (!models.length) setOllamaDetectErr('✅ Connected — no models found. Run: ollama pull llama3.2')
    else {
      setOllamaModels(models)
      if (!ollamaModel || !models.includes(ollamaModel)) setOllamaModel(models[0])
      setOllamaDetectErr('')
    }
    setOllamaDetecting(false)
  }

  async function testConnection() {
    setTestStatus('testing')
    try {
      if (aiProv === 'ollama') {
        const { corsOk, running } = await ollamaProbe(ollamaUrl)
        if (!running) { setTestStatus('❌ Ollama not running'); return }
        if (!corsOk)  { setTestStatus('⚠ CORS blocked — start with OLLAMA_ORIGINS=* ollama serve'); return }
        const reply = await ollamaChat([{role:'user',content:'Say only: CONNECTED'}], '', 10)
        setTestStatus(`✅ Connected — ${ollamaModel||'model'} replied: "${reply.trim().slice(0,60)}"`)
      } else {
        const reply = await ai([{role:'user',content:'Say only: CONNECTED'}], '', 20)
        if (reply.startsWith('⚠')) setTestStatus('❌ ' + reply.replace('⚠ ',''))
        else setTestStatus(`✅ Connected — ${PROVIDERS[aiProv]?.name} replied: "${reply.trim().slice(0,60)}"`)
      }
    } catch (e) { setTestStatus('❌ ' + e.message) }
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
        <div style={{ maxWidth:540 }}>
          <p style={{ margin:'0 0 20px', fontSize:13, color:C.t2, lineHeight:1.6 }}>
            Choose your AI provider. Your selection applies to <strong style={{color:C.t1}}>every feature</strong> — Chat, Notes, Tasks, YouTube AI, Code AI, and Website Builder. API keys are stored securely on the server, never in your browser.
          </p>

          {/* ── Provider cards ── */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
            {Object.values(PROVIDERS).map(p => {
              const active = aiProv === p.id
              return (
                <button key={p.id} onClick={() => { setAIProv(p.id); setAIProviderLS(p.id); setTestStatus('') }}
                  style={{ padding:'14px 12px', borderRadius:12, border:`2px solid ${active?C.accent:C.border}`, background:active?C.accentM:C.surf, cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'flex-start', gap:4, transition:'all .15s', textAlign:'left' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, width:'100%' }}>
                    <span style={{ fontSize:20 }}>{p.icon}</span>
                    {active && <span style={{ marginLeft:'auto', fontSize:10, background:C.accent, color:'#fff', borderRadius:99, padding:'2px 8px', fontWeight:600 }}>Active</span>}
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color:active?C.accent:C.t1 }}>{p.name}</span>
                  <span style={{ fontSize:11, color:C.t3 }}>{p.sub}</span>
                </button>
              )
            })}
          </div>

          {/* ── Per-provider config panel ── */}
          <Card style={{ padding:18, marginBottom:16 }}>
            {aiProv !== 'ollama' && (() => {
              const p = PROVIDERS[aiProv]
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  <div style={{ padding:12, background:C.bg, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.t2, lineHeight:1.7 }}>
                    Calls go <strong style={{color:C.t1}}>browser → Vercel server → {p.name}</strong>. Your API key is read from the server environment — never sent to the browser.
                    {' '}<a href={p.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color:C.accent }}>Get API key →</a>
                  </div>
                  <div>
                    <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Model</label>
                    <select
                      value={modelMap[aiProv] || p.default}
                      onChange={e => setModelMap(m => ({...m, [aiProv]: e.target.value}))}
                      style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'9px 12px', fontFamily:'inherit', outline:'none', cursor:'pointer' }}>
                      {p.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div style={{ padding:10, background:C.bg, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.t3 }}>
                    Server key variable: <code style={{color:C.accent}}>{p.keyEnv}</code> — add this to your <code style={{color:C.t2}}>.env.local</code> and to Vercel environment variables.
                  </div>
                </div>
              )
            })()}

            {aiProv === 'ollama' && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ padding:12, background:C.bg, borderRadius:8, border:`1px solid ${C.border}`, fontSize:12, color:C.t2, lineHeight:1.7 }}>
                  Calls go <strong style={{color:C.t1}}>directly from your browser to localhost:11434</strong>. No API key needed. In the desktop app, calls go through Node.js with zero CORS issues.
                </div>

                {/* Status feedback */}
                {ollamaDetectErr && (
                  <div style={{ padding:'10px 14px', background:ollamaDetectErr.startsWith('✅')?'rgba(16,185,129,.08)':ollamaDetectErr.startsWith('⚠')?'rgba(245,158,11,.08)':'rgba(239,68,68,.08)', borderRadius:8, border:`1px solid ${ollamaDetectErr.startsWith('✅')?'rgba(16,185,129,.3)':ollamaDetectErr.startsWith('⚠')?'rgba(245,158,11,.3)':'rgba(239,68,68,.3)'}` }}>
                    <p style={{ margin:0, fontSize:12, color:ollamaDetectErr.startsWith('✅')?C.green:ollamaDetectErr.startsWith('⚠')?C.yellow:C.red }}>{ollamaDetectErr}</p>
                    {!ollamaDetectErr.startsWith('✅') && !IS_ELECTRON && (
                      <details style={{ marginTop:6 }}>
                        <summary style={{ fontSize:11, color:C.t3, cursor:'pointer' }}>▸ Fix: enable CORS on Ollama</summary>
                        <div style={{ marginTop:6, display:'flex', gap:6 }}>
                          <code style={{ flex:1, background:C.bg, borderRadius:6, padding:'5px 8px', fontSize:11, color:C.green, fontFamily:'monospace', border:`1px solid ${C.border}` }}>OLLAMA_ORIGINS=* ollama serve</code>
                          <button onClick={()=>copyText('OLLAMA_ORIGINS=* ollama serve')} style={{ background:'none', border:`1px solid ${C.border}`, borderRadius:6, color:C.t3, cursor:'pointer', padding:'4px 8px', fontSize:11, fontFamily:'inherit' }}>Copy</button>
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* URL */}
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Ollama URL</label>
                  <div style={{ display:'flex', gap:8 }}>
                    <input value={ollamaUrl} onChange={e=>{setOllamaUrl(e.target.value); setOllamaModels([]); setOllamaDetectErr('')}}
                      placeholder="http://localhost:11434"
                      style={{ flex:1, background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'9px 12px', fontFamily:'inherit', outline:'none' }} />
                    <Button onClick={detectOllamaModels} disabled={ollamaDetecting} variant="secondary" size="sm">
                      {ollamaDetecting ? <Spinner size={12} color={C.accent}/> : ollamaModels.length ? '↻ Refresh' : 'Detect models'}
                    </Button>
                  </div>
                </div>

                {/* Model */}
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:600, color:C.t2, marginBottom:5, textTransform:'uppercase', letterSpacing:'.05em' }}>Model</label>
                  {ollamaModels.length > 0 ? (
                    <>
                      <select value={ollamaModel} onChange={e=>setOllamaModel(e.target.value)}
                        style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'9px 12px', fontFamily:'inherit', outline:'none', cursor:'pointer' }}>
                        {ollamaModels.map(m=><option key={m} value={m}>{m}</option>)}
                      </select>
                      <p style={{ margin:'5px 0 0', fontSize:11, color:C.green }}>✓ {ollamaModels.length} model{ollamaModels.length!==1?'s':''} detected</p>
                    </>
                  ) : (
                    <input value={ollamaModel} onChange={e=>setOllamaModel(e.target.value)}
                      placeholder="e.g. llama3.2 — or click Detect models"
                      style={{ width:'100%', background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'9px 12px', fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} />
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* ── Test Connection ── */}
          <Card style={{ padding:16, marginBottom:16 }}>
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <Button onClick={testConnection} disabled={testStatus==='testing'} variant="secondary" size="sm">
                {testStatus==='testing' ? <><Spinner size={12} color={C.accent}/> Testing…</> : '⚡ Test Connection'}
              </Button>
              {testStatus && testStatus !== 'testing' && (
                <span style={{ fontSize:12, lineHeight:1.4, flex:1, color:testStatus.startsWith('✅')?C.green:testStatus.startsWith('⚠')?C.yellow:C.red }}>{testStatus}</span>
              )}
            </div>
          </Card>

          <Button onClick={saveAISettings} full>Save &amp; Apply</Button>
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
                {[['All notes & tasks','You','Export or delete anytime'],['AI conversations','You','Export or delete anytime'],['Usage analytics','FounderLab','Anonymous, aggregate only'],['AI processing','Anthropic','Per Anthropic privacy policy']].map(([a,b,c])=>(
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
function FeedbackModal({ onClose }) {
  const [type, setType]   = useState('feedback')
  const [text, setText]   = useState('')
  const [loading, setL]   = useState(false)
  const ph = { bug:'Describe what happened and how to reproduce it…', feature:'What feature would you like to see?', feedback:'Share your thoughts about FounderLab AI…' }

  async function submit() {
    if (!text.trim()) return toast('Please write something first','error')
    setL(true)
    const ok=await sb.submitFeedback(type,text.trim())
    if (ok) { toast('Feedback submitted — thank you!','success'); onClose() }
    else { toast('Submit failed. Try again.','error') }
    setL(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000c', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <Card style={{ width:'100%', maxWidth:440, padding:28, borderRadius:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h3 style={{ margin:0, color:C.t1, fontSize:16 }}>Send Feedback</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.t2, cursor:'pointer', fontSize:22, lineHeight:1, padding:4, fontFamily:'inherit' }}>×</button>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          {[['bug','🐛 Bug'],['feature','✨ Feature'],['feedback','💬 Feedback']].map(([id,l])=>(
            <button key={id} onClick={()=>setType(id)} style={{ flex:1, padding:'7px 0', borderRadius:8, border:`1px solid ${type===id?C.accent:C.border}`, background:type===id?C.accentM:'transparent', color:type===id?C.accent:C.t2, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', transition:'all .15s' }}>{l}</button>
          ))}
        </div>
        <Input rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder={ph[type]} />
        <div style={{ marginTop:16, display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading?<Spinner size={13} color="#fff"/>:null} Submit</Button>
        </div>
      </Card>
    </div>
  )
}

// ── NAVIGATION ────────────────────────────────────────────────
const NAV=[
  {id:'dashboard',label:'Dashboard', icon:'⊞'},
  {id:'chat',     label:'AI Chat',   icon:'💬'},
  {id:'notes',    label:'Notes',     icon:'📝'},
  {id:'tasks',    label:'Tasks',     icon:'✅'},
  {id:'youtube',  label:'YouTube AI',icon:'▶'},
  {id:'code',     label:'Code AI',   icon:'⌨'},
  {id:'builder',  label:'Builder',   icon:'⬡'},
]
const MNAV=[
  {id:'dashboard',label:'Home', icon:'⊞'},
  {id:'chat',     label:'Chat', icon:'💬'},
  {id:'notes',    label:'Notes',icon:'📝'},
  {id:'tasks',    label:'Tasks',icon:'✅'},
  {id:'settings', label:'More', icon:'⚙'},
]

function NavBtn({ id, label, icon, page, setPage, collapsed }) {
  const act=page===id
  const [hov, setHov]=useState(false)
  return (
    <div onClick={()=>setPage(id)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} title={collapsed?label:undefined}
      style={{ display:'flex', alignItems:'center', gap:10, padding:collapsed?'9px 0':'9px 12px', justifyContent:collapsed?'center':'flex-start', borderRadius:8, cursor:'pointer', marginBottom:2, background:act?C.accentM:'transparent', color:act?C.accent:hov?C.t1:C.t2, border:`1px solid ${act?C.borderFocus:hov?C.border:'transparent'}`, transition:'all .15s' }}>
      <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
      {!collapsed && <span style={{ fontSize:13, fontWeight:act?500:400, whiteSpace:'nowrap' }}>{label}</span>}
    </div>
  )
}

function Sidebar({ page, setPage, user, profile, collapsed, setCollapsed, onFeedback }) {
  return (
    <div style={{ width:collapsed?C.sidebarSm:C.sidebar, height:'100vh', background:C.surf, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', transition:'width .2s ease', flexShrink:0, overflow:'hidden', position:'sticky', top:0 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:collapsed?'center':'space-between', padding:collapsed?'16px 0':'16px 12px', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, overflow:'hidden' }}>
          <div style={{ width:28, height:28, background:C.accent, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#fff', flexShrink:0, fontWeight:700 }}>✦</div>
          {!collapsed && <span style={{ fontSize:14, fontWeight:700, color:C.t1, whiteSpace:'nowrap' }}>FounderLab</span>}
        </div>
        <button onClick={()=>setCollapsed(!collapsed)} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:14, padding:4, lineHeight:1, flexShrink:0 }}>{collapsed?'›':'‹'}</button>
      </div>
      <div style={{ flex:1, padding:collapsed?'12px 6px':'12px 8px', overflowY:'auto' }}>
        {NAV.map(n=><NavBtn key={n.id} {...n} page={page} setPage={setPage} collapsed={collapsed} />)}
      </div>
      <div style={{ padding:collapsed?'12px 6px':'12px 8px', borderTop:`1px solid ${C.border}` }}>
        <NavBtn id="settings" label="Settings" icon="⚙" page={page} setPage={setPage} collapsed={collapsed} />
        <div onClick={onFeedback} title={collapsed?'Feedback':undefined}
          style={{ display:'flex', alignItems:'center', gap:10, padding:collapsed?'9px 0':'9px 12px', justifyContent:collapsed?'center':'flex-start', borderRadius:8, cursor:'pointer', color:C.t2, marginBottom:4, transition:'all .15s' }}>
          <span style={{ fontSize:16 }}>💬</span>
          {!collapsed && <span style={{ fontSize:13 }}>Feedback</span>}
        </div>
        {!collapsed&&(profile?.full_name||user?.email)&&<div style={{ fontSize:11, color:C.t3, padding:'6px 12px 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{profile?.full_name||user?.email}</div>}
      </div>
    </div>
  )
}

function MobileTopBar({ onFeedback }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', background:C.surf, borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, zIndex:100 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:28, height:28, background:C.accent, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#fff', fontWeight:700 }}>✦</div>
        <span style={{ fontSize:15, fontWeight:700, color:C.t1 }}>FounderLab AI</span>
      </div>
      <button onClick={onFeedback} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, padding:4, color:C.t2 }}>💬</button>
    </div>
  )
}

function MobileBottomNav({ page, setPage }) {
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, background:C.surf, borderTop:`1px solid ${C.border}`, display:'flex', paddingBottom:'env(safe-area-inset-bottom)', zIndex:100 }}>
      {MNAV.map(n=>{
        const act=page===n.id
        return (
          <button key={n.id} onClick={()=>setPage(n.id)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'8px 0', background:'none', border:'none', cursor:'pointer', color:act?C.accent:C.t3, gap:3, fontFamily:'inherit' }}>
            <span style={{ fontSize:20 }}>{n.icon}</span>
            <span style={{ fontSize:10, fontWeight:act?600:400 }}>{n.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── APP ROOT ──────────────────────────────────────────────────
function AppInner() {
  const [state, setState]     = useState('booting') // booting|setup|auth|onboarding|app
  const [page, setPage]       = useState('dashboard')
  const [profile, setProfile] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [showFb, setShowFb]   = useState(false)
  const [mobile, setMobile]   = useState(typeof window!=='undefined'&&window.innerWidth<768)

  useEffect(() => {
    async function boot() {
      if (!CONFIGURED) { setState('setup'); return }
      const ok=await sb.boot()
      if (ok) {
        try {
          const p=await sb.getProfile()
          setProfile(p)
          await migrateLocalToCloud()
          setState(p?.onboarded?'app':'onboarding')
        } catch { setState('app') }
      } else { setState('auth') }
    }
    boot()
    const onResize=()=>setMobile(window.innerWidth<768)
    window.addEventListener('resize',onResize)
    return ()=>window.removeEventListener('resize',onResize)
  }, [])

  async function afterAuth() {
    try {
      const p=await sb.getProfile()
      setProfile(p)
      await migrateLocalToCloud()
      setState(p?.onboarded?'app':'onboarding')
    } catch { setState('app') }
  }

  async function afterOnboarding() {
    try {
      const p=await sb.getProfile()
      setProfile(p)
    } catch {}
    setState('app')
  }

  async function signOut() {
    await sb.signOut()
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
      case 'builder':   return <BuilderPage user={user} />
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
          {mobile ? (
            <div style={{ minHeight:'100vh', background:C.bg }}>
              <MobileTopBar onFeedback={()=>setShowFb(true)} />
              <div style={{ paddingBottom:80 }}>{renderPage()}</div>
              <MobileBottomNav page={page} setPage={setPage} />
            </div>
          ) : (
            <div style={{ display:'flex', height:'100vh', background:C.bg, overflow:'hidden' }}>
              <Sidebar page={page} setPage={setPage} user={user} profile={profile} collapsed={collapsed} setCollapsed={setCollapsed} onFeedback={()=>setShowFb(true)} />
              <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
                {renderPage()}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>
}
