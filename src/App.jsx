// ============================================================
// FOUNDERLAB AI — src/App.jsx
// Single-file React app. Inline styles only. No external deps.
// ============================================================

import React, { useState, useEffect } from 'react'

// ── ENVIRONMENT ──────────────────────────────────────────────────────────────
const SB_URL  = import.meta.env.VITE_SUPABASE_URL  || ''
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const CONFIGURED = Boolean(SB_URL && SB_ANON)

// ── SUPABASE AUTH CLIENT  (raw fetch — no SDK) ───────────────────────────────
const FL_SESSION_KEY = 'fl_session'

function loadSession() {
  try { return JSON.parse(localStorage.getItem(FL_SESSION_KEY)) } catch { return null }
}
function saveSession(s) {
  s ? localStorage.setItem(FL_SESSION_KEY, JSON.stringify(s))
    : localStorage.removeItem(FL_SESSION_KEY)
}

// Module-level state so auth is a singleton
let _session = loadSession()
const _listeners = []

const auth = {
  get session() { return _session },

  subscribe(fn) {
    _listeners.push(fn)
    fn(_session)  // emit current state immediately
    return () => {
      const i = _listeners.indexOf(fn)
      if (i > -1) _listeners.splice(i, 1)
    }
  },

  _emit(s) {
    _session = s
    saveSession(s)
    _listeners.forEach(fn => fn(s))
  },

  async _post(path, body, token) {
    const headers = { 'Content-Type': 'application/json', apikey: SB_ANON }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${SB_URL}/auth/v1${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data.msg || data.error_description || data.message || 'Request failed')
    }
    return data
  },

  async signUp(email, password) {
    const data = await this._post('/signup', { email, password })
    if (data.access_token) this._emit(data)
    return data
  },

  async signIn(email, password) {
    const data = await this._post('/token?grant_type=password', { email, password })
    this._emit(data)
    return data
  },

  async signOut() {
    try { await this._post('/logout', {}, _session?.access_token) } catch {}
    this._emit(null)
  },

  async resetPassword(email) {
    return this._post('/recover', { email })
  },

  async refresh() {
    if (!_session?.refresh_token) { this._emit(null); return null }
    try {
      const data = await this._post('/token?grant_type=refresh_token', {
        refresh_token: _session.refresh_token,
      })
      this._emit(data)
      return data
    } catch {
      this._emit(null)
      return null
    }
  },

  getUser()  { return _session?.user  || null },
  getToken() { return _session?.access_token || null },
}

// ── DATABASE CLIENT  (raw fetch — no SDK) ────────────────────────────────────
async function dbFetch(method, table, body, filter, upsert) {
  const token = auth.getToken()
  const headers = {
    'Content-Type': 'application/json',
    apikey: SB_ANON,
    Prefer: upsert
      ? 'resolution=merge-duplicates,return=representation'
      : 'return=representation',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const url = `${SB_URL}/rest/v1/${table}${filter ? '?' + filter : ''}`
  const res = await fetch(url, {
    method,
    headers,
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 204) return []
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || data.hint || `DB error ${res.status}`)
  return data
}

const db = {
  select: (table, filter = '')        => dbFetch('GET',    table, null, filter, false),
  insert: (table, body)               => dbFetch('POST',   table, body, '',     false),
  upsert: (table, body)               => dbFetch('POST',   table, body, '',     true),
  update: (table, body, filter = '')  => dbFetch('PATCH',  table, body, filter, false),
  remove: (table, filter = '')        => dbFetch('DELETE', table, null, filter, false),
}

// ── AI HELPER ─────────────────────────────────────────────────────────────────
async function ai(messages, system = '', max = 1200) {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max,
        ...(system && { system }),
        messages,
      }),
    })
    const data = await res.json()
    return data.content?.map(c => c.text || '').join('') || 'No response.'
  } catch (e) {
    return '⚠ AI error: ' + e.message
  }
}

// ── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg:          '#0f0f11',
  surface:     '#18181b',
  surfaceHov:  '#1f1f23',
  border:      '#27272a',
  borderHov:   '#3f3f46',
  accent:      '#6366f1',
  accentHov:   '#4f46e5',
  accentLight: '#6366f118',
  text:        '#fafafa',
  textMuted:   '#a1a1aa',
  textDim:     '#71717a',
  green:       '#22c55e',
  greenLight:  '#22c55e18',
  yellow:      '#eab308',
  yellowLight: '#eab30818',
  red:         '#ef4444',
  redLight:    '#ef444418',
  sidebar:     196,
  sidebarSm:   52,
}

// ── TOAST SYSTEM ─────────────────────────────────────────────────────────────
let _toastFn = null

function toast(msg, type = 'default') { _toastFn?.(msg, type) }

function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    _toastFn = (msg, type) => {
      const id = Date.now() + Math.random()
      setToasts(prev => [...prev, { id, msg, type }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200)
    }
    return () => { _toastFn = null }
  }, [])

  if (!toasts.length) return null
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'error' ? '#7f1d1d' : t.type === 'success' ? '#14532d' : C.surface,
          color: C.text,
          border: `1px solid ${t.type === 'error' ? C.red : t.type === 'success' ? C.green : C.border}`,
          borderRadius: 8,
          padding: '10px 16px',
          fontSize: 14,
          boxShadow: '0 4px 20px #0008',
          maxWidth: 340,
          animation: 'flSlideIn 0.2s ease',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ── SHARED COMPONENTS ────────────────────────────────────────────────────────

function Button({ children, onClick, variant = 'primary', size = 'md', disabled, full, icon, style: extra }) {
  const [hov, setHov] = useState(false)

  const sizes = {
    sm: { fontSize: 12, padding: '5px 10px' },
    md: { fontSize: 14, padding: '7px 14px' },
    lg: { fontSize: 14, padding: '12px 20px' },
  }
  const variants = {
    primary:   { background: hov ? C.accentHov : C.accent, color: '#fff', border: 'none' },
    secondary: { background: 'transparent', color: C.text, border: `1px solid ${hov ? C.borderHov : C.border}` },
    ghost:     { background: hov ? C.surfaceHov : 'transparent', color: C.textMuted, border: 'none' },
    danger:    { background: hov ? '#dc2626' : C.red, color: '#fff', border: 'none' },
    success:   { background: hov ? '#16a34a' : C.green, color: '#fff', border: 'none' },
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 500, transition: 'all 0.15s',
        width: full ? '100%' : undefined,
        opacity: disabled ? 0.45 : 1, outline: 'none',
        ...sizes[size], ...variants[variant || 'primary'], ...extra,
      }}
    >
      {icon && <span>{icon}</span>}
      {children}
    </button>
  )
}

function Input({ value, onChange, placeholder, rows, type = 'text', onKeyDown, autoFocus, readOnly, style: extra }) {
  const [focused, setFocused] = useState(false)
  const base = {
    width: '100%', background: C.surface,
    border: `1px solid ${focused ? C.accent : C.border}`,
    borderRadius: 7, color: C.text, fontSize: 14,
    padding: '9px 12px', outline: 'none',
    boxShadow: focused ? `0 0 0 3px ${C.accentLight}` : 'none',
    transition: 'all 0.15s', boxSizing: 'border-box',
    resize: rows ? 'vertical' : undefined,
    ...extra,
  }
  const shared = {
    value, onChange, placeholder, onKeyDown, autoFocus, readOnly,
    style: base,
    onFocus: () => setFocused(true),
    onBlur:  () => setFocused(false),
  }
  return rows ? <textarea rows={rows} {...shared} /> : <input type={type} {...shared} />
}

function Card({ children, style, onClick, hover }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setHov(true)}
      onMouseLeave={() => hover && setHov(false)}
      style={{
        background: C.surface,
        border: `1px solid ${hov ? C.accent + '60' : C.border}`,
        borderRadius: 10, padding: 16,
        boxShadow: hov ? `0 2px 12px #0004` : 'none',
        cursor: onClick ? 'pointer' : undefined,
        transition: 'all 0.15s', ...style,
      }}
    >
      {children}
    </div>
  )
}

function Badge({ children, color = 'accent' }) {
  const map = {
    accent: { bg: C.accentLight, text: C.accent },
    green:  { bg: C.greenLight,  text: C.green },
    yellow: { bg: C.yellowLight, text: C.yellow },
    red:    { bg: C.redLight,    text: C.red },
    gray:   { bg: '#27272a',     text: C.textMuted },
  }
  const { bg, text } = map[color] || map.accent
  return (
    <span style={{ background: bg, color: text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center' }}>
      {children}
    </span>
  )
}

function Spinner({ size = 20, color = C.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'flSpin 0.8s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="31.4" strokeLinecap="round" />
    </svg>
  )
}

function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: C.textMuted }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, maxWidth: 320, margin: '0 auto 20px', lineHeight: 1.6 }}>{description}</div>
      {action}
    </div>
  )
}

function Tip({ children }) {
  return (
    <div style={{ background: C.accentLight, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.textMuted, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0 }}>💡</span>
      <span>{children}</span>
    </div>
  )
}

// ── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen() {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Card style={{ maxWidth: 500, width: '100%', padding: 40 }}>
        <div style={{ width: 48, height: 48, background: C.accent, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', marginBottom: 20 }}>✦</div>
        <h2 style={{ color: C.text, margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>FounderLab AI — Setup Required</h2>
        <p style={{ color: C.textMuted, fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
          Environment variables are missing. Create a <code style={{ color: C.accent, background: C.accentLight, padding: '1px 6px', borderRadius: 4 }}>.env.local</code> file in the project root with:
        </p>
        <div style={{ background: '#0a0a0b', border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 13, lineHeight: 2, marginBottom: 24 }}>
          <div style={{ color: C.green }}>VITE_SUPABASE_URL=https://xxxx.supabase.co</div>
          <div style={{ color: C.green }}>VITE_SUPABASE_ANON_KEY=eyJ...</div>
          <div style={{ color: C.textDim }}>ANTHROPIC_API_KEY=sk-ant-...</div>
        </div>
        <Tip>Get your Supabase keys at supabase.com → your project → Settings → API. The ANTHROPIC_API_KEY is server-side only and does not need the VITE_ prefix.</Tip>
      </Card>
    </div>
  )
}

// ── AUTH SCREEN ───────────────────────────────────────────────────────────────
function AuthScreen() {
  const [tab, setTab]         = useState('signin')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)

  function switchTab(t) { setTab(t); setMsg(null) }

  async function handleSubmit() {
    setMsg(null)
    if (!email.trim()) return setMsg({ type: 'error', text: 'Email is required.' })

    if (tab === 'reset') {
      setLoading(true)
      try {
        await auth.resetPassword(email.trim())
        setMsg({ type: 'success', text: 'Password reset email sent. Check your inbox.' })
      } catch (e) {
        setMsg({ type: 'error', text: e.message })
      } finally { setLoading(false) }
      return
    }

    if (!password) return setMsg({ type: 'error', text: 'Password is required.' })

    if (tab === 'signup') {
      if (password.length < 6) return setMsg({ type: 'error', text: 'Password must be at least 6 characters.' })
      if (password !== confirm) return setMsg({ type: 'error', text: 'Passwords do not match.' })
      setLoading(true)
      try {
        await auth.signUp(email.trim(), password)
        setMsg({ type: 'success', text: 'Account created! Check your email to verify, then sign in.' })
      } catch (e) {
        setMsg({ type: 'error', text: e.message })
      } finally { setLoading(false) }
      return
    }

    // sign in
    setLoading(true)
    try {
      await auth.signIn(email.trim(), password)
      // auth.subscribe listener in App will pick up the new session
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
      setLoading(false)
    }
  }

  function onKey(e) { if (e.key === 'Enter') handleSubmit() }

  const tabs = [
    { id: 'signin', label: 'Sign In' },
    { id: 'signup', label: 'Sign Up' },
    { id: 'reset',  label: 'Reset'   },
  ]

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 400, width: '100%' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, background: C.accent, borderRadius: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: '#fff', marginBottom: 14 }}>✦</div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.text }}>FounderLab AI</h1>
          <p style={{ margin: '6px 0 0', color: C.textMuted, fontSize: 14 }}>Your AI-powered founder workspace</p>
        </div>

        <Card style={{ padding: 32 }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: C.bg, borderRadius: 8, padding: 4 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => switchTab(t.id)} style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none',
                background: tab === t.id ? C.surface : 'transparent',
                color: tab === t.id ? C.text : C.textMuted,
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
                boxShadow: tab === t.id ? '0 1px 4px #0006' : 'none',
                transition: 'all 0.15s',
              }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>Email</label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" onKeyDown={onKey} autoFocus />
            </div>

            {tab !== 'reset' && (
              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>Password</label>
                <Input value={password} onChange={e => setPass(e.target.value)} placeholder="••••••••" type="password" onKeyDown={onKey} />
              </div>
            )}

            {tab === 'signup' && (
              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>Confirm Password</label>
                <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" type="password" onKeyDown={onKey} />
              </div>
            )}

            {msg && (
              <div style={{
                padding: '10px 13px', borderRadius: 7, fontSize: 13, lineHeight: 1.5,
                background: msg.type === 'error' ? C.redLight : C.greenLight,
                color: msg.type === 'error' ? C.red : C.green,
                border: `1px solid ${msg.type === 'error' ? C.red + '50' : C.green + '50'}`,
              }}>
                {msg.text}
              </div>
            )}

            <Button onClick={handleSubmit} disabled={loading} full size="lg" style={{ marginTop: 2 }}>
              {loading && <Spinner size={15} color="#fff" />}
              {tab === 'signin' ? 'Sign In' : tab === 'signup' ? 'Create Account' : 'Send Reset Email'}
            </Button>
          </div>

          {/* Footer hints */}
          {tab === 'signin' && (
            <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: C.textMuted }}>
              No account?{' '}
              <span onClick={() => switchTab('signup')} style={{ color: C.accent, cursor: 'pointer', fontWeight: 500 }}>Sign up free</span>
              {'  ·  '}
              <span onClick={() => switchTab('reset')} style={{ color: C.textDim, cursor: 'pointer' }}>Forgot password?</span>
            </p>
          )}
          {tab === 'signup' && (
            <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: C.textMuted }}>
              Already have an account?{' '}
              <span onClick={() => switchTab('signin')} style={{ color: C.accent, cursor: 'pointer', fontWeight: 500 }}>Sign in</span>
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── PAGE PLACEHOLDERS ────────────────────────────────────────────────────────
function Dashboard({ user }) {
  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: '0 0 6px', color: C.text, fontSize: 22, fontWeight: 700 }}>Dashboard</h2>
        <p style={{ margin: 0, color: C.textMuted, fontSize: 14 }}>Welcome back, {user?.email}. Your workspace is ready.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        {[
          { icon: '💬', label: 'AI Chats',    val: '—' },
          { icon: '📝', label: 'Notes',        val: '—' },
          { icon: '✅', label: 'Tasks',         val: '—' },
          { icon: '⚡', label: 'AI Calls Today', val: '—' },
        ].map(stat => (
          <Card key={stat.label} style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{stat.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{stat.val}</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{stat.label}</div>
          </Card>
        ))}
      </div>
      <EmptyState icon="🚀" title="Phase 2 coming next" description="Dashboard stats, resume banner, recent activity, and AI quick-actions will be live in the next build." />
    </div>
  )
}

function ChatPage() {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>AI Chat</h2>
      <EmptyState icon="💬" title="AI Chat — Phase 2" description="Full conversation history, code blocks, markdown rendering, and web search will be built here." />
    </div>
  )
}

function NotesPage() {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>Notes</h2>
      <EmptyState icon="📝" title="Notes — Phase 2" description="AI-powered notes with auto-save, auto-tagging, and smart search coming next." />
    </div>
  )
}

function TasksPage() {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>Tasks</h2>
      <EmptyState icon="✅" title="Tasks — Phase 2" description="Kanban board + list view with AI-powered task breakdown coming next." />
    </div>
  )
}

function YouTubeAIPage() {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>YouTube AI</h2>
      <EmptyState icon="▶" title="YouTube AI — Phase 2" description="Generate titles, scripts, descriptions, shorts ideas, and full content strategies." />
    </div>
  )
}

function CodeAIPage() {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>Code AI</h2>
      <EmptyState icon="⌨" title="Code AI — Phase 2" description="Generate, explain, debug, and improve code in any language with AI." />
    </div>
  )
}

function BuilderPage() {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>Website Builder</h2>
      <EmptyState icon="⬡" title="Website Builder — Phase 2" description="Describe your product → live preview of a complete, downloadable landing page." />
    </div>
  )
}

function SettingsPage({ user, onSignOut }) {
  return (
    <div style={{ padding: 32 }}>
      <h2 style={{ margin: '0 0 24px', color: C.text, fontSize: 22, fontWeight: 700 }}>Settings</h2>
      <Card style={{ maxWidth: 500, padding: 28 }}>
        <h3 style={{ margin: '0 0 20px', color: C.text, fontSize: 16 }}>Profile</h3>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>Email</label>
          <Input value={user?.email || ''} onChange={() => {}} readOnly />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, color: C.textMuted, marginBottom: 5, fontWeight: 500 }}>Full Name</label>
          <Input value="" onChange={() => {}} placeholder="Coming in Phase 2" readOnly />
        </div>
        <Button onClick={onSignOut} variant="danger">Sign Out</Button>
        <p style={{ marginTop: 20, fontSize: 12, color: C.textDim }}>Full profile editing, password change, data export, and feedback management coming in Phase 2.</p>
      </Card>
    </div>
  )
}

// ── FEEDBACK MODAL ───────────────────────────────────────────────────────────
function FeedbackModal({ onClose }) {
  const [type, setType]   = useState('feedback')
  const [text, setText]   = useState('')
  const [loading, setLoading] = useState(false)

  const types = [
    { id: 'bug',      label: '🐛 Bug' },
    { id: 'feature',  label: '✨ Feature' },
    { id: 'feedback', label: '💬 Feedback' },
  ]
  const placeholders = {
    bug:      'Describe what happened and how to reproduce it...',
    feature:  'What feature would you like to see?',
    feedback: 'Share your thoughts about FounderLab AI...',
  }

  async function submit() {
    if (!text.trim()) return toast('Please write something before submitting.', 'error')
    setLoading(true)
    try {
      const user = auth.getUser()
      await db.insert('fl_feedback', {
        user_id: user?.id,
        type,
        description: text.trim(),
      })
      toast('Feedback submitted — thank you!', 'success')
      onClose()
    } catch (e) {
      toast('Failed to submit: ' + e.message, 'error')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <Card style={{ width: '100%', maxWidth: 440, padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: C.text, fontSize: 17 }}>Send Feedback</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {types.map(t => (
            <button key={t.id} onClick={() => setType(t.id)} style={{
              flex: 1, padding: '7px 0', borderRadius: 7,
              border: `1px solid ${type === t.id ? C.accent : C.border}`,
              background: type === t.id ? C.accentLight : 'transparent',
              color: type === t.id ? C.accent : C.textMuted,
              cursor: 'pointer', fontSize: 12, fontWeight: 500,
              transition: 'all 0.15s',
            }}>
              {t.label}
            </button>
          ))}
        </div>
        <Input rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={placeholders[type]} />
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button onClick={submit} disabled={loading}>
            {loading && <Spinner size={14} color="#fff" />}
            Submit
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ── NAVIGATION ITEMS ─────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',  icon: '⊞' },
  { id: 'chat',      label: 'AI Chat',    icon: '💬' },
  { id: 'notes',     label: 'Notes',      icon: '📝' },
  { id: 'tasks',     label: 'Tasks',      icon: '✅' },
  { id: 'youtube',   label: 'YouTube AI', icon: '▶' },
  { id: 'code',      label: 'Code AI',    icon: '⌨' },
  { id: 'builder',   label: 'Builder',    icon: '⬡' },
]

// ── SIDEBAR (desktop, collapsible) ───────────────────────────────────────────
function SidebarNavItem({ id, label, icon, page, setPage, collapsed }) {
  const active = page === id
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={() => setPage(id)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={collapsed ? label : undefined}
      style={{
        display: 'flex', alignItems: 'center',
        gap: 10, padding: collapsed ? '9px 0' : '9px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 7, cursor: 'pointer', marginBottom: 2,
        background: active ? C.accentLight : hov ? C.surfaceHov : 'transparent',
        color: active ? C.accent : hov ? C.text : C.textMuted,
        border: `1px solid ${active ? C.accent + '40' : 'transparent'}`,
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  )
}

function Sidebar({ page, setPage, user, collapsed, setCollapsed, onFeedback }) {
  const itemProps = { page, setPage, collapsed }

  return (
    <div style={{
      width: collapsed ? C.sidebarSm : C.sidebar,
      height: '100vh', background: C.surface,
      borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.2s ease',
      flexShrink: 0, overflow: 'hidden',
      position: 'sticky', top: 0,
    }}>
      {/* Logo row */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '16px 0' : '16px 12px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <div style={{ width: 28, height: 28, background: C.accent, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff', flexShrink: 0 }}>✦</div>
          {!collapsed && <span style={{ fontSize: 14, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>FounderLab</span>}
        </div>
        <button onClick={() => setCollapsed(!collapsed)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 16, padding: 4, flexShrink: 0, lineHeight: 1 }}>
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Main nav */}
      <div style={{ flex: 1, padding: collapsed ? '12px 6px' : '12px 8px', overflowY: 'auto' }}>
        {NAV_ITEMS.map(item => <SidebarNavItem key={item.id} {...item} {...itemProps} />)}
      </div>

      {/* Bottom: settings, feedback, email */}
      <div style={{ padding: collapsed ? '12px 6px' : '12px 8px', borderTop: `1px solid ${C.border}` }}>
        <SidebarNavItem id="settings" label="Settings" icon="⚙" {...itemProps} />
        <div
          onClick={onFeedback}
          title={collapsed ? 'Feedback' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: collapsed ? '9px 0' : '9px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 7, cursor: 'pointer', color: C.textMuted,
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 16 }}>💬</span>
          {!collapsed && <span style={{ fontSize: 13 }}>Feedback</span>}
        </div>
        {!collapsed && user?.email && (
          <div style={{ fontSize: 11, color: C.textDim, padding: '6px 12px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </div>
        )}
      </div>
    </div>
  )
}

// ── MOBILE NAV ───────────────────────────────────────────────────────────────
const MOBILE_NAV_ITEMS = [
  { id: 'dashboard', label: 'Home',  icon: '⊞' },
  { id: 'chat',      label: 'Chat',  icon: '💬' },
  { id: 'notes',     label: 'Notes', icon: '📝' },
  { id: 'tasks',     label: 'Tasks', icon: '✅' },
  { id: 'settings',  label: 'More',  icon: '⚙'  },
]

function MobileTopBar({ onFeedback }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: C.surface, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, background: C.accent, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff' }}>✦</div>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>FounderLab AI</span>
      </div>
      <button onClick={onFeedback} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, padding: 4, color: C.textMuted }}>💬</button>
    </div>
  )
}

function MobileBottomNav({ page, setPage }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)', zIndex: 100 }}>
      {MOBILE_NAV_ITEMS.map(item => {
        const active = page === item.id
        return (
          <button key={item.id} onClick={() => setPage(item.id)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '8px 0',
            background: 'none', border: 'none', cursor: 'pointer',
            color: active ? C.accent : C.textDim, gap: 3,
          }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── GLOBAL STYLES ────────────────────────────────────────────────────────────
function GlobalStyles() {
  useEffect(() => {
    const el = document.createElement('style')
    el.id = 'fl-global'
    el.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; background: ${C.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
      @keyframes flSpin    { to { transform: rotate(360deg); } }
      @keyframes flSlideIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      ::-webkit-scrollbar       { width: 4px; height: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
        -webkit-box-shadow: 0 0 0px 1000px ${C.surface} inset;
        -webkit-text-fill-color: ${C.text};
        transition: background-color 5000s ease-in-out 0s;
      }
    `
    document.head.appendChild(el)
    return () => document.head.removeChild(el)
  }, [])
  return null
}

// ── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session,     setSession]     = useState(_session)
  const [page,        setPage]        = useState('dashboard')
  const [collapsed,   setCollapsed]   = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [mobile,      setMobile]      = useState(typeof window !== 'undefined' && window.innerWidth < 768)

  // Subscribe to auth state changes
  useEffect(() => {
    const unsub = auth.subscribe(s => setSession(s))
    return unsub
  }, [])

  // Responsive breakpoint
  useEffect(() => {
    function onResize() { setMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function renderPage() {
    const user = auth.getUser()
    switch (page) {
      case 'dashboard': return <Dashboard user={user} />
      case 'chat':      return <ChatPage />
      case 'notes':     return <NotesPage />
      case 'tasks':     return <TasksPage />
      case 'youtube':   return <YouTubeAIPage />
      case 'code':      return <CodeAIPage />
      case 'builder':   return <BuilderPage />
      case 'settings':  return <SettingsPage user={user} onSignOut={() => auth.signOut()} />
      default:          return <Dashboard user={user} />
    }
  }

  return (
    <>
      <GlobalStyles />
      <ToastContainer />

      {/* Setup screen — no env vars */}
      {!CONFIGURED && <SetupScreen />}

      {/* Auth screen — no session */}
      {CONFIGURED && !session && <AuthScreen />}

      {/* Main app */}
      {CONFIGURED && session && (
        <>
          {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

          {mobile ? (
            /* ── MOBILE LAYOUT ── */
            <div style={{ minHeight: '100vh', background: C.bg }}>
              <MobileTopBar onFeedback={() => setShowFeedback(true)} />
              <div style={{ paddingBottom: 80 }}>{renderPage()}</div>
              <MobileBottomNav page={page} setPage={setPage} />
            </div>
          ) : (
            /* ── DESKTOP LAYOUT ── */
            <div style={{ display: 'flex', height: '100vh', background: C.bg, overflow: 'hidden' }}>
              <Sidebar
                page={page} setPage={setPage}
                user={auth.getUser()}
                collapsed={collapsed} setCollapsed={setCollapsed}
                onFeedback={() => setShowFeedback(true)}
              />
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {renderPage()}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
