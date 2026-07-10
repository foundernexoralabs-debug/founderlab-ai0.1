const C = { surf:'#0f0f1a', border:'rgba(255,255,255,.07)', borderFocus:'rgba(99,102,241,.5)', accent:'#6366f1', accentM:'rgba(99,102,241,.12)', t1:'#eeeef8', t2:'#8888b0', t3:'#44445a' }
const RATIOS = [
  { id:'9:16', label:'9:16', desc:'TikTok · Reels · Shorts', icon:'◻' },
  { id:'1:1',  label:'1:1',  desc:'Instagram Feed',          icon:'⬜' },
  { id:'16:9', label:'16:9', desc:'YouTube · Twitter',       icon:'▬' },
]
export default function ReframePanel({ ratio, onChange }) {
  return (
    <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
      <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>Smart Reframe</p>
      <div style={{ display:'flex', gap:8 }}>
        {RATIOS.map(r => (
          <button key={r.id} onClick={()=>onChange(r.id)}
            style={{ flex:1, padding:'10px 8px', borderRadius:10, border:`2px solid ${ratio===r.id?C.accent:C.border}`, background:ratio===r.id?C.accentM:'transparent', cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'center', gap:3, transition:'all .15s' }}>
            <span style={{ fontSize:20, color:ratio===r.id?C.accent:C.t2 }}>{r.icon}</span>
            <span style={{ fontSize:13, fontWeight:700, color:ratio===r.id?C.accent:C.t1 }}>{r.label}</span>
            <span style={{ fontSize:10, color:C.t3, textAlign:'center' }}>{r.desc}</span>
          </button>
        ))}
      </div>
      <p style={{ margin:'8px 0 0', fontSize:11, color:C.t3 }}>Auto-centres speaker using face detection</p>
    </div>
  )
}
