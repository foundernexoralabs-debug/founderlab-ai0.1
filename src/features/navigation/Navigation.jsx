import { useState } from 'react'
import { C } from '@/app/theme'

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
export function Sidebar({ page, setPage, user, profile, collapsed, setCollapsed, onFeedback }) {
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

export function MobileTopBar({ onFeedback }) {
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

export function MobileBottomNav({ page, setPage }) {
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
