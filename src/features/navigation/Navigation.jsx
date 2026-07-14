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
function NavBtn({ id, label, icon, page, setPage, collapsed }) {
  const act=page===id
  const [hov, setHov]=useState(false)
  return (
    <button type="button" onClick={()=>setPage(id)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} title={collapsed?label:undefined} aria-label={label} aria-current={act?'page':undefined}
      style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:collapsed?'9px 0':'9px 12px', justifyContent:collapsed?'center':'flex-start', borderRadius:8, cursor:'pointer', marginBottom:2, background:act?C.accentM:'transparent', color:act?C.accent:hov?C.t1:C.t2, border:`1px solid ${act?C.borderFocus:hov?C.border:'transparent'}`, transition:'all .15s', fontFamily:'inherit', textAlign:'left' }}>
      <span style={{ fontSize:16, flexShrink:0 }}>{icon}</span>
      {!collapsed && <span style={{ fontSize:13, fontWeight:act?500:400, whiteSpace:'nowrap' }}>{label}</span>}
    </button>
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
        <button type="button" onClick={()=>setCollapsed(!collapsed)} aria-label={collapsed?'Expand navigation':'Collapse navigation'} aria-expanded={!collapsed} style={{ background:'none', border:'none', color:C.t3, cursor:'pointer', fontSize:14, padding:4, lineHeight:1, flexShrink:0 }}>{collapsed?'›':'‹'}</button>
      </div>
      <div style={{ flex:1, padding:collapsed?'12px 6px':'12px 8px', overflowY:'auto' }}>
        {NAV.map(n=><NavBtn key={n.id} {...n} page={page} setPage={setPage} collapsed={collapsed} />)}
      </div>
      <div style={{ padding:collapsed?'12px 6px':'12px 8px', borderTop:`1px solid ${C.border}` }}>
        <NavBtn id="settings" label="Settings" icon="⚙" page={page} setPage={setPage} collapsed={collapsed} />
        <button type="button" onClick={onFeedback} title={collapsed?'Feedback':undefined} aria-label="Feedback"
          style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:collapsed?'9px 0':'9px 12px', justifyContent:collapsed?'center':'flex-start', borderRadius:8, cursor:'pointer', color:C.t2, marginBottom:4, transition:'all .15s', background:'none', border:'none', fontFamily:'inherit', textAlign:'left' }}>
          <span style={{ fontSize:16 }}>💬</span>
          {!collapsed && <span style={{ fontSize:13 }}>Feedback</span>}
        </button>
        {!collapsed&&(profile?.full_name||user?.email)&&<div style={{ fontSize:11, color:C.t3, padding:'6px 12px 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{profile?.full_name||user?.email}</div>}
      </div>
    </div>
  )
}
