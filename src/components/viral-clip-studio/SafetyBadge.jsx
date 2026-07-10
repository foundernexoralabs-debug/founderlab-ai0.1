export default function SafetyBadge({ safe }) {
  if (safe === null || safe === undefined) return null
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:999, fontSize:11, fontWeight:700, background: safe ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)', color: safe ? '#10b981' : '#ef4444', border: `1px solid ${safe ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}` }}>
      {safe ? '✅ MONETIZATION SAFE' : '⚠️ MUSIC DETECTED — CHECK'}
    </span>
  )
}
