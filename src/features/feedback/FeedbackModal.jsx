import { useState } from 'react'
import { C } from '@/app/theme'
import { toast } from '@/app/toast'
import { Button, Card, Input, Spinner } from '@/components/ui/Primitives'
import { workspaceStore as sb } from '@/services/workspaceStore'

export function FeedbackModal({ onClose }) {
  const [type, setType]   = useState('feedback')
  const [text, setText]   = useState('')
  const [loading, setL]   = useState(false)
  const ph = { bug:'Describe what happened and how to reproduce it…', feature:'What feature would you like to see?', feedback:'Share your thoughts about FounderLab AI…' }

  async function submit() {
    if (!text.trim()) return toast('Please write something first','error')
    setL(true)
    const ok=await sb.submitFeedback(type,text.trim())
    if (ok) { toast('Feedback submitted — thank you!','success'); onClose() }
    else { toast('Submit failed. Try again.','error') }
    setL(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'#000c', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <Card style={{ width:'100%', maxWidth:440, padding:28, borderRadius:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h3 style={{ margin:0, color:C.t1, fontSize:16 }}>Send Feedback</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.t2, cursor:'pointer', fontSize:22, lineHeight:1, padding:4, fontFamily:'inherit' }}>×</button>
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:16 }}>
          {[['bug','🐛 Bug'],['feature','✨ Feature'],['feedback','💬 Feedback']].map(([id,l])=>(
            <button key={id} onClick={()=>setType(id)} style={{ flex:1, padding:'7px 0', borderRadius:8, border:`1px solid ${type===id?C.accent:C.border}`, background:type===id?C.accentM:'transparent', color:type===id?C.accent:C.t2, cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', transition:'all .15s' }}>{l}</button>
          ))}
        </div>
        <Input rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder={ph[type]} />
        <div style={{ marginTop:16, display:'flex', gap:8, justifyContent:'flex-end' }}>
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button onClick={submit} disabled={loading}>{loading?<Spinner size={13} color="#fff"/>:null} Submit</Button>
        </div>
      </Card>
    </div>
  )
}
