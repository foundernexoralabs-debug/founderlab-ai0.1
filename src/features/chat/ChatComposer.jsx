import { useEffect, useRef } from 'react'
import { C } from '@/app/theme'
import { ACCEPTED_IMAGE_TYPES, fileToBase64 } from '@/lib/files'

function WaveformBars() {
  return <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 14 }}>{[0, 1, 2, 3, 4].map((index) => <i key={index} style={{ width: 2, background: C.red, borderRadius: 1, animation: `flChatWave .9s ease-in-out ${index * .1}s infinite` }} />)}</span>
}

export function ChatComposer({
  input,
  onInput,
  onSend,
  sending,
  onStop,
  pendingImage,
  onPendingImage,
  listening,
  onMic,
  provider,
  editing,
  onCancelEdit,
  onOpenProviders,
}) {
  const fileRef = useRef(null)
  const textRef = useRef(null)
  const canSend = Boolean(input.trim() || pendingImage) && !sending

  useEffect(() => {
    const textarea = textRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`
  }, [input])

  async function attachFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    if (file.size > 5 * 1024 * 1024) return
    try {
      onPendingImage({ base64: await fileToBase64(file), name: file.name })
    } catch {
      // The parent retains the stable composer state when a browser cannot read an attachment.
    }
  }

  return (
    <div className="fl-chat-composer-wrap">
      <div className="fl-chat-composer-column">
        {editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 10px', background: C.accentM, border: `1px solid ${C.borderFocus}`, borderRadius: 9, color: C.t2, fontSize: 12 }}>
            <span aria-hidden="true">✎</span>
            <span style={{ flex: 1 }}>Editing a message. Sending will replace the reply that followed it.</span>
            <button type="button" onClick={onCancelEdit} style={{ background: 'transparent', border: 'none', color: C.t1, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>Cancel</button>
          </div>
        )}
        {pendingImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '7px 10px', background: C.surf, borderRadius: 10, border: `1px solid ${C.border}` }}>
            <img src={pendingImage.base64} alt="Pending attachment" style={{ width: 34, height: 34, borderRadius: 7, objectFit: 'cover' }} />
            <span style={{ flex: 1, color: C.t2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingImage.name}</span>
            <button type="button" onClick={() => onPendingImage(null)} aria-label="Remove image" style={{ background: 'transparent', border: 'none', color: C.t2, cursor: 'pointer', fontSize: 17 }}>×</button>
          </div>
        )}
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); attachFile(event.dataTransfer.files?.[0]) }}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 11px', background: `${C.surf}e8`, border: `1px solid ${listening ? C.red : C.border}`, borderRadius: 17, boxShadow: '0 12px 34px rgba(0,0,0,.26)', transition: 'border-color .15s' }}>
          <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES} style={{ display: 'none' }} onChange={(event) => { attachFile(event.target.files?.[0]); event.target.value = '' }} />
          <button type="button" onClick={() => fileRef.current?.click()} title="Attach image" aria-label="Attach image" style={{ background: pendingImage ? C.accentM : 'transparent', border: `1px solid ${pendingImage ? C.borderFocus : 'transparent'}`, borderRadius: 10, color: pendingImage ? C.accent : C.t2, cursor: 'pointer', padding: '8px 9px', fontSize: 16, lineHeight: 1 }}>⌁</button>
          <textarea
            ref={textRef}
            value={input}
            onChange={(event) => onInput(event.target.value)}
            onPaste={(event) => {
              const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith('image/'))
              const file = item?.getAsFile?.()
              if (file) { event.preventDefault(); attachFile(file) }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend() }
              if (event.key === 'Escape' && sending) onStop()
            }}
            rows={1}
            placeholder={listening ? 'Listening… speak now' : 'Message FounderLab'}
            aria-label="Message FounderLab"
            style={{ flex: 1, minWidth: 0, minHeight: 24, maxHeight: 200, overflowY: 'auto', resize: 'none', background: 'transparent', border: 'none', color: C.t1, outline: 'none', padding: '9px 3px', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.55 }}
          />
          <button type="button" onClick={onMic} title={listening ? 'Stop voice input' : 'Voice input'} aria-label={listening ? 'Stop voice input' : 'Voice input'} style={{ background: listening ? C.redM : 'transparent', border: `1px solid ${listening ? C.red : 'transparent'}`, borderRadius: 10, color: listening ? C.red : C.t2, cursor: 'pointer', padding: '8px 9px', fontSize: 16, lineHeight: 1 }}>{listening ? <WaveformBars /> : '◉'}</button>
          {sending ? (
            <button type="button" onClick={onStop} title="Stop generating" aria-label="Stop generating" style={{ background: C.red, border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', padding: '9px 12px', fontSize: 12, boxShadow: '0 3px 12px rgba(239,68,68,.25)' }}>■</button>
          ) : (
            <button type="button" onClick={onSend} disabled={!canSend} title="Send message" aria-label="Send message" style={{ background: canSend ? `linear-gradient(135deg, ${C.accent}, #8b5cf6)` : C.surfHigh, border: 'none', borderRadius: 10, color: '#fff', cursor: canSend ? 'pointer' : 'not-allowed', opacity: canSend ? 1 : .5, padding: '8px 12px', fontSize: 17, lineHeight: 1, boxShadow: canSend ? '0 4px 14px rgba(99,102,241,.3)' : 'none' }}>↑</button>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 8, minHeight: 18, flexWrap: 'wrap' }}>
          <button type="button" onClick={onOpenProviders} title="Open AI Providers" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 7px', borderRadius: 99, background: provider.local ? 'rgba(16,185,129,.08)' : C.accentM, border: `1px solid ${provider.local ? 'rgba(16,185,129,.22)' : C.borderFocus}`, color: provider.local ? C.green : C.accent, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit' }}>
            <span>{provider.local ? 'Local' : 'Cloud'}</span>
            <span style={{ opacity: .65 }}>·</span>
            <span>{provider.name}</span>
            <span style={{ opacity: .72, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.model}</span>
          </button>
          <span style={{ color: C.t3, fontSize: 10.5 }}>Enter to send · Shift+Enter for a new line</span>
        </div>
      </div>
    </div>
  )
}
