import { useState } from 'react'
const C = { surf:'#0f0f1a', border:'rgba(255,255,255,.07)', borderFocus:'rgba(99,102,241,.5)', accent:'#6366f1', accentM:'rgba(99,102,241,.12)', t1:'#eeeef8', t2:'#8888b0', t3:'#44445a', green:'#10b981' }
export default function ThumbnailGenerator({ onGenerate, thumbnailUrl, generating }) {
  const [title, setTitle] = useState('')
  return (
    <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
      <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>AI Thumbnail</p>
      <div style={{ display:'flex', gap:8, marginBottom:thumbnailUrl?12:0 }}>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Thumbnail title text…"
          style={{ flex:1, background:'rgba(255,255,255,.03)', border:`1px solid ${C.border}`, borderRadius:8, color:C.t1, fontSize:13, padding:'8px 12px', fontFamily:'inherit', outline:'none' }} />
        <button onClick={()=>onGenerate(title)} disabled={generating}
          style={{ padding:'8px 14px', borderRadius:8, border:`1px solid ${C.borderFocus}`, background:C.accentM, color:C.accent, cursor:generating?'not-allowed':'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit', opacity:generating?0.6:1, whiteSpace:'nowrap', transition:'all .15s' }}>
          {generating ? '⏳' : '🖼 Generate'}
        </button>
      </div>
      {thumbnailUrl && (
        <div style={{ marginTop:12 }}>
          <img src={thumbnailUrl} alt="Generated thumbnail" style={{ width:'100%', borderRadius:8, border:`1px solid ${C.border}` }} />
          <a href={thumbnailUrl} download="thumbnail.jpg"
            style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:8, fontSize:11, color:C.accent, textDecoration:'none' }}>
            ⬇ Download Thumbnail
          </a>
        </div>
      )}
    </div>
  )
}
