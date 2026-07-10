import { useState } from 'react'
const C = { surf:'#0f0f1a', border:'rgba(255,255,255,.07)', borderFocus:'rgba(99,102,241,.5)', accent:'#6366f1', accentM:'rgba(99,102,241,.12)', t1:'#eeeef8', t2:'#8888b0', t3:'#44445a', green:'#10b981' }
export default function AudioReplaceUI({ voiceProvider, voiceGender, onDub, dubStatus }) {
  const [prov, setProv] = useState(voiceProvider || 'elevenlabs')
  const [gen,  setGen]  = useState(voiceGender   || 'male')
  return (
    <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
      <p style={{ margin:'0 0 12px', fontSize:13, fontWeight:600, color:C.t1 }}>AI Voice Dub</p>
      <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
        {['elevenlabs','browser'].map(p => (
          <button key={p} onClick={()=>setProv(p)}
            style={{ padding:'6px 14px', borderRadius:999, border:`1px solid ${prov===p?C.accent:C.border}`, background:prov===p?C.accentM:'transparent', color:prov===p?C.accent:C.t2, cursor:'pointer', fontSize:12, fontFamily:'inherit', textTransform:'capitalize', transition:'all .15s' }}>
            {p === 'elevenlabs' ? '⚡ ElevenLabs' : '🌐 Browser Neural'}
          </button>
        ))}
        {['male','female'].map(g => (
          <button key={g} onClick={()=>setGen(g)}
            style={{ padding:'6px 14px', borderRadius:999, border:`1px solid ${gen===g?C.accent:C.border}`, background:gen===g?C.accentM:'transparent', color:gen===g?C.accent:C.t2, cursor:'pointer', fontSize:12, fontFamily:'inherit', textTransform:'capitalize', transition:'all .15s' }}>
            {g === 'male' ? '♂ Male' : '♀ Female'}
          </button>
        ))}
      </div>
      <button onClick={()=>onDub(prov, gen)}
        disabled={dubStatus === 'dubbing'}
        style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, border:`1px solid ${C.borderFocus}`, background:C.accentM, color:C.accent, cursor: dubStatus==='dubbing'?'not-allowed':'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit', opacity: dubStatus==='dubbing'?0.6:1, transition:'all .15s' }}>
        {dubStatus === 'dubbing' ? '⏳ Synthesizing…' : '🔊 Replace Audio with AI Voice'}
      </button>
      {dubStatus === 'done' && <p style={{ margin:'8px 0 0', fontSize:11, color:C.green }}>✓ Audio replaced successfully</p>}
    </div>
  )
}
