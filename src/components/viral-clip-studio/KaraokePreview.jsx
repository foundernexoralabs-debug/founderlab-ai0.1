import { useState, useEffect, useRef } from 'react'

const C = { surf:'#0f0f1a', border:'rgba(255,255,255,.07)', borderFocus:'rgba(99,102,241,.5)', accent:'#6366f1', accentM:'rgba(99,102,241,.12)', t1:'#eeeef8', t2:'#8888b0', t3:'#44445a' }

const STYLES = ['highlight','pop','bounce','fade']

export default function KaraokePreview({ words = [], style, onChangeStyle }) {
  const [playhead, setPlayhead] = useState(0)
  const rafRef = useRef(null)
  const startRef = useRef(null)

  // Simulate playback for preview
  const totalDuration = words.length ? words[words.length-1].end + 0.5 : 0

  useEffect(() => {
    if (!words.length) return
    startRef.current = performance.now()
    const tick = () => {
      const elapsed = (performance.now() - startRef.current) / 1000
      setPlayhead(elapsed % (totalDuration + 1))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [words, totalDuration])

  function wordStyle(w) {
    const active = playhead >= w.start && playhead <= w.end
    const base = { display:'inline-block', padding:'2px 6px', borderRadius:5, margin:'0 2px 4px', fontSize:14, fontWeight:500, transition:'all .15s', cursor:'default' }
    if (style === 'highlight') return { ...base, background: active ? C.accent : 'rgba(255,255,255,.08)', color: active ? '#fff' : C.t2, transform: active ? 'scale(1.05)' : 'scale(1)' }
    if (style === 'pop')       return { ...base, color: active ? '#fff' : C.t2, transform: active ? 'scale(1.25)' : 'scale(1)', fontWeight: active ? 700 : 400 }
    if (style === 'bounce')    return { ...base, color: active ? C.accent : C.t2, transform: active ? 'translateY(-4px)' : 'translateY(0)' }
    if (style === 'fade')      return { ...base, color: active ? '#fff' : 'rgba(136,136,176,.3)', fontWeight: active ? 600 : 400 }
    return base
  }

  return (
    <div style={{ background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.t1 }}>Karaoke Captions</p>
        <div style={{ display:'flex', gap:6 }}>
          {STYLES.map(s => (
            <button key={s} onClick={()=>onChangeStyle(s)}
              style={{ padding:'4px 10px', borderRadius:999, border:`1px solid ${style===s?C.accent:C.border}`, background:style===s?C.accentM:'transparent', color:style===s?C.accent:C.t2, cursor:'pointer', fontSize:11, fontWeight:500, fontFamily:'inherit', textTransform:'capitalize', transition:'all .15s' }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div style={{ background:'#000', borderRadius:8, padding:'12px 16px', minHeight:56, display:'flex', alignItems:'center', flexWrap:'wrap', gap:2 }}>
        {words.length === 0
          ? <span style={{ color:C.t3, fontSize:12 }}>Word timings appear here after analysis</span>
          : words.map((w, i) => <span key={i} style={wordStyle(w)}>{w.word}</span>)
        }
      </div>
    </div>
  )
}
