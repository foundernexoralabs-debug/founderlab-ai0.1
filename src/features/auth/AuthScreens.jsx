import { useState } from 'react'
import { C } from '@/app/theme'
import { Button, Card, Input, Spinner } from '@/components/ui/Primitives'
import { getSafeAuthErrorMessage, getSetupScreenView } from '@/lib/supabaseConfig'
import { workspaceStore as sb } from '@/services/workspaceStore'

// ── SETUP SCREEN ─────────────────────────────────────────────
export function SetupScreen() {
  const view = getSetupScreenView(import.meta.env)
  const retry = () => globalThis.location?.reload?.()

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <Card style={{ maxWidth:440, width:'100%', padding:40, borderRadius:16, textAlign:'center' }}>
        <div style={{ width:48, height:48, background:C.accent, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, color:'#fff', margin:'0 auto 20px' }}>✦</div>
        <p style={{ margin:'0 0 8px', color:C.accent, fontSize:13, fontWeight:700, letterSpacing:'.04em' }}>FOUNDERLAB</p>
        <h1 style={{ margin:'0 0 10px', fontSize:22, fontWeight:700, color:C.t1 }}>{view.title}</h1>
        <p style={{ margin:'0 0 22px', color:C.t2, fontSize:14, lineHeight:1.6 }}>{view.message}</p>
        <Button onClick={retry} size="sm">Try again</Button>
        <p style={{ margin:'16px 0 0', color:C.t3, fontSize:11 }}>Reference: {view.referenceCode}</p>
        {view.diagnostics.length > 0 && (
          <details style={{ marginTop:20, textAlign:'left', color:C.t3, fontSize:12, lineHeight:1.6 }}>
            <summary style={{ cursor:'pointer', color:C.t2 }}>Development diagnostics</summary>
            <ul style={{ margin:'8px 0 0', paddingLeft:18 }}>
              {view.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
            </ul>
          </details>
        )}
      </Card>
    </div>
  )
}

// ── AUTH SCREEN ───────────────────────────────────────────────
export function AuthScreen({ onAuth }) {
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
      catch (e) { setMsg({ e:true, t:getSafeAuthErrorMessage(e) }) } finally { setLoading(false) }
      return
    }
    if (tab === 'verify') {
      setLoading(true)
      try { await sb.resendVerification(email.trim()); setMsg({ t:'Verification email resent!' }) }
      catch (e) { setMsg({ e:true, t:getSafeAuthErrorMessage(e) }) } finally { setLoading(false) }
      return
    }
    if (!pass) return setMsg({ e:true, t:'Password required.' })
    if (tab === 'signup') {
      if (pass.length < 6) return setMsg({ e:true, t:'Password must be 6+ characters.' })
      if (pass !== pass2) return setMsg({ e:true, t:'Passwords do not match.' })
      setLoading(true)
      try { await sb.signUp(email.trim(), pass); sw('signin'); setMsg({ t:'Account created! Check your email to verify, then sign in.' }) }
      catch (e) { setMsg({ e:true, t:getSafeAuthErrorMessage(e) }) } finally { setLoading(false) }
      return
    }
    setLoading(true)
    try { await sb.signIn(email.trim(), pass, rem); onAuth() }
    catch (e) { setMsg({ e:true, t:getSafeAuthErrorMessage(e) }) } finally { setLoading(false) }
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
export function OnboardingModal({ onDone }) {
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
