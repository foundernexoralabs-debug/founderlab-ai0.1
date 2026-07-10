const C = { surf:'#0f0f1a', border:'rgba(255,255,255,.07)', borderFocus:'rgba(99,102,241,.5)', accent:'#6366f1', accentM:'rgba(99,102,241,.12)', t1:'#eeeef8', t2:'#8888b0', t3:'#44445a' }

function Sel({ label, value, options, onChange }) {
  return (
    <div>
      <label style={{ display:'block', fontSize:11, color:C.t3, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em' }}>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{ width:'100%', background:'rgba(255,255,255,.03)', border:`1px solid ${C.border}`, borderRadius:7, color:C.t1, fontSize:13, padding:'7px 10px', fontFamily:'inherit', outline:'none', cursor:'pointer' }}>
        {options.map(o => <option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}
      </select>
    </div>
  )
}

function Chk({ label, checked, onChange }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:C.t2, cursor:'pointer', userSelect:'none' }}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ accentColor:C.accent, width:14, height:14 }} />
      {label}
    </label>
  )
}

export default function ExportProSettings({ settings, onChange }) {
  const upd = (k,v) => onChange({ ...settings, [k]: v })
  return (
    <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
      <p style={{ margin:'0 0 14px', fontSize:13, fontWeight:600, color:C.t1 }}>Export Settings</p>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
        <Sel label="Resolution" value={settings.resolution} options={['1080p','1440p','4K']} onChange={v=>upd('resolution',v)} />
        <Sel label="FPS" value={String(settings.fps)} options={['30','60']} onChange={v=>upd('fps',Number(v))} />
        <Sel label="Codec" value={settings.codec} options={[{v:'h264',l:'H.264'},{v:'h265',l:'H.265 10-bit'}]} onChange={v=>upd('codec',v)} />
        <Sel label="Bitrate" value={settings.bitrateControl} options={['CBR','VBR']} onChange={v=>upd('bitrateControl',v)} />
      </div>
      <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
        <Chk label="Burn captions" checked={settings.includeCaptions} onChange={v=>upd('includeCaptions',v)} />
        <Chk label="AI Voice Dub" checked={settings.includeAudioDub} onChange={v=>upd('includeAudioDub',v)} />
      </div>
    </div>
  )
}
