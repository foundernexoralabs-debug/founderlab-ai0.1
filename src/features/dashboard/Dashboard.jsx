import { useEffect, useState } from 'react'
import { C } from '@/app/theme'
import { Card, Spinner } from '@/components/ui/Primitives'
import { timeg } from '@/lib/appUtils'
import { loadWorkspaceData as load, workspaceStore as sb } from '@/services/workspaceStore'

export function Dashboard({ user, profile, setPage }) {
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
