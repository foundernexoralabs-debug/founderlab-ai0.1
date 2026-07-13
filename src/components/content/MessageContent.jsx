import { C } from '@/app/theme'

export function renderMsg(content) {
  if (!content) return null
  // Split on fenced code blocks first
  const parts = content.split(/(```[\w]*\n[\s\S]*?```)/g)
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const m = part.match(/```(\w*)\n?([\s\S]*?)```/)
      if (m) return (
        <div key={i} style={{ background:'#050508', border:`1px solid ${C.border}`, borderRadius:8, margin:'8px 0', overflow:'hidden' }}>
          {m[1] && <div style={{ background:C.surfHigh, padding:'4px 12px', fontSize:10, color:C.accent, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', borderBottom:`1px solid ${C.border}` }}>{m[1]}</div>}
          <div style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:12.5, whiteSpace:'pre-wrap', overflowX:'auto', lineHeight:1.6, color:'#e2e8f0' }}>{m[2].replace(/^\n/,'')}</div>
        </div>
      )
    }
    // Inline rendering: process line by line
    const lines = part.split('\n')
    const nodes = []
    let listItems = []
    const flushList = () => {
      if (!listItems.length) return
      nodes.push(<ul key={`ul-${nodes.length}`} style={{ margin:'6px 0', paddingLeft:20, lineHeight:1.7 }}>{listItems.map((li,j)=><li key={j} style={{ color:C.t1, fontSize:14 }}>{inlineRender(li)}</li>)}</ul>)
      listItems = []
    }
    lines.forEach((line, li) => {
      // Blank line
      if (!line.trim()) { flushList(); nodes.push(<br key={`br-${nodes.length}`} />); return }
      // Headings
      const h3 = line.match(/^###\s+(.+)/)
      const h2 = line.match(/^##\s+(.+)/)
      const h1 = line.match(/^#\s+(.+)/)
      if (h1) { flushList(); nodes.push(<p key={nodes.length} style={{ margin:'10px 0 4px', fontWeight:700, fontSize:17, color:C.t1 }}>{inlineRender(h1[1])}</p>); return }
      if (h2) { flushList(); nodes.push(<p key={nodes.length} style={{ margin:'10px 0 4px', fontWeight:700, fontSize:15, color:C.t1 }}>{inlineRender(h2[1])}</p>); return }
      if (h3) { flushList(); nodes.push(<p key={nodes.length} style={{ margin:'8px 0 2px', fontWeight:600, fontSize:14, color:C.t1 }}>{inlineRender(h3[1])}</p>); return }
      // Bullet list
      const bullet = line.match(/^[-*•]\s+(.+)/)
      if (bullet) { listItems.push(bullet[1]); return }
      // Numbered list
      const num = line.match(/^\d+\.\s+(.+)/)
      if (num) { listItems.push(num[1]); return }
      // Normal line
      flushList()
      nodes.push(<p key={nodes.length} style={{ margin:'2px 0', lineHeight:1.65, whiteSpace:'pre-wrap', fontSize:14, color:C.t1 }}>{inlineRender(line)}</p>)
    })
    flushList()
    return <div key={i}>{nodes}</div>
  })
}
// Render inline markdown: **bold**, *italic*, `code`, links
function inlineRender(text) {
  const tokens = []
  const rx = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((https?:\/\/[^\)]+)\))/g
  let last = 0, m
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index))
    if (m[2]) tokens.push(<strong key={m.index}>{m[2]}</strong>)
    else if (m[3]) tokens.push(<em key={m.index}>{m[3]}</em>)
    else if (m[4]) tokens.push(<code key={m.index} style={{ background:C.surfHigh, color:C.accent, borderRadius:4, padding:'1px 5px', fontSize:'0.9em', fontFamily:'monospace' }}>{m[4]}</code>)
    else if (m[5]) tokens.push(<a key={m.index} href={m[6]} target="_blank" rel="noopener noreferrer" style={{ color:C.accent, textDecoration:'underline' }}>{m[5]}</a>)
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push(text.slice(last))
  return tokens.length ? tokens : text
}
