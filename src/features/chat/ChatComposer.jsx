import { useEffect, useRef, useState } from 'react'
import { C } from '@/app/theme'
import { toast } from '@/app/toast'
import { ACCEPTED_IMAGE_TYPES, fileToBase64 } from '@/lib/files'

function WaveformBars() {
  return <span aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 2, height: 14 }}>{[0, 1, 2, 3, 4].map((index) => <i key={index} style={{ width: 2, background: C.red, borderRadius: 1, animation: `flChatWave .9s ease-in-out ${index * .1}s infinite` }} />)}</span>
}

const HOLD_TO_DICTATE_DELAY_MS = 180

export function ChatComposer({
  input,
  onInput,
  onSend,
  sending,
  onStop,
  pendingImage,
  onPendingImage,
  listening,
  voiceInputState = 'idle',
  onVoiceStart,
  onVoiceFinish,
  providerSwitcher,
  editing,
  onCancelEdit,
}) {
  const fileRef = useRef(null)
  const textRef = useRef(null)
  const actionMenuRef = useRef(null)
  const holdTimerRef = useRef(null)
  const heldToDictateRef = useRef(false)
  const pointerIdRef = useRef(null)
  const pressedWhileRecordingRef = useRef(false)
  const suppressVoiceClickRef = useRef(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const canSend = Boolean(input.trim() || pendingImage) && !sending
  const recording = ['listening', 'resuming'].includes(voiceInputState)
  const voiceError = voiceInputState === 'error'
  const voiceStatus = voiceInputState === 'listening'
    ? 'Live dictation is flowing into your message. Pause or correct yourself; send when ready.'
    : voiceInputState === 'resuming'
      ? 'Keeping your place — take your time, then continue naturally.'
      : voiceInputState === 'error'
        ? 'Voice input stopped. Your draft is still here.'
        : ''

  useEffect(() => {
    const textarea = textRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(200, textarea.scrollHeight)}px`
  }, [input])

  useEffect(() => {
    if (!actionMenuOpen) return undefined
    const closeOnOutsidePointer = (event) => {
      if (!actionMenuRef.current?.contains(event.target)) setActionMenuOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setActionMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [actionMenuOpen])

  useEffect(() => () => clearTimeout(holdTimerRef.current), [])

  async function attachFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('Choose an image to attach to this message.', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Choose an image smaller than 5 MB.', 'error')
      return
    }
    try {
      onPendingImage({ base64: await fileToBase64(file), name: file.name })
    } catch {
      toast('FounderLab could not read that image. Please try another file.', 'error')
    }
  }

  function openImagePicker() {
    setActionMenuOpen(false)
    fileRef.current?.click()
  }

  function toggleVoiceInput() {
    if (recording) onVoiceFinish()
    else onVoiceStart()
  }

  function releaseVoicePointer(event, { cancelled = false } = {}) {
    if (pointerIdRef.current !== event.pointerId) return
    clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
    try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch {}
    const heldToDictate = heldToDictateRef.current
    const wasRecording = pressedWhileRecordingRef.current
    pointerIdRef.current = null
    heldToDictateRef.current = false
    pressedWhileRecordingRef.current = false
    if (heldToDictate || wasRecording) {
      if (!cancelled || heldToDictate) onVoiceFinish()
      suppressVoiceClickRef.current = true
      return
    }
    if (!cancelled) {
      onVoiceStart()
      suppressVoiceClickRef.current = true
    }
  }

  function beginVoicePointer(event) {
    if (event.button !== 0) return
    pointerIdRef.current = event.pointerId
    pressedWhileRecordingRef.current = recording
    heldToDictateRef.current = false
    try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch {}
    if (recording) return
    clearTimeout(holdTimerRef.current)
    holdTimerRef.current = setTimeout(() => {
      if (pointerIdRef.current !== event.pointerId) return
      heldToDictateRef.current = true
      onVoiceStart()
    }, HOLD_TO_DICTATE_DELAY_MS)
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
            <span style={{ flex: 1, minWidth: 0, color: C.t2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: C.t3 }}>Image ready · </span>{pendingImage.name}</span>
            <button type="button" onClick={() => onPendingImage(null)} aria-label="Remove image" style={{ background: 'transparent', border: 'none', color: C.t2, cursor: 'pointer', fontSize: 17 }}>×</button>
          </div>
        )}
        {voiceStatus && (
          <div className={`fl-chat-dictation-status ${listening ? 'is-listening' : ''} ${voiceError ? 'is-error' : ''}`} role="status" aria-live="polite">
            <span aria-hidden="true" className="fl-chat-dictation-status-dot" />
            <span className="fl-chat-dictation-status-copy"><strong>{listening ? 'Listening live' : voiceError ? 'Dictation paused' : 'Reconnecting'}</strong>{voiceStatus}</span>
            <button type="button" onClick={voiceError ? onVoiceStart : onVoiceFinish}>{voiceError ? 'Try again' : 'Finish'}</button>
          </div>
        )}
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); attachFile(event.dataTransfer.files?.[0]) }}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '10px 11px', background: `${C.surf}e8`, border: `1px solid ${recording ? (listening ? C.red : C.borderFocus) : C.border}`, borderRadius: 17, boxShadow: '0 12px 34px rgba(0,0,0,.26)', transition: 'border-color .15s' }}>
          <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES} style={{ display: 'none' }} onChange={(event) => { attachFile(event.target.files?.[0]); event.target.value = '' }} />
          <div ref={actionMenuRef} className="fl-chat-composer-action-menu-anchor">
            <button type="button" className="fl-chat-composer-attachment" onClick={() => setActionMenuOpen((open) => !open)} title="Add visual context" aria-label="Add visual context" aria-expanded={actionMenuOpen} style={{ background: pendingImage || actionMenuOpen ? C.accentM : 'transparent', border: `1px solid ${pendingImage || actionMenuOpen ? C.borderFocus : C.border}`, borderRadius: 10, color: pendingImage || actionMenuOpen ? C.accent : C.t2, cursor: 'pointer', padding: '7px 9px', fontSize: 12, lineHeight: 1, fontFamily: 'inherit' }}><span aria-hidden="true" style={{ fontSize: 18, lineHeight: 0 }}>+</span></button>
            {actionMenuOpen && (
              <div className="fl-chat-composer-action-menu" role="menu" aria-label="Add to message">
                <div className="fl-chat-composer-action-menu-heading">
                  <span>Bring in context</span>
                  <small>Use a visual when it helps FounderLab understand your message.</small>
                </div>
                <button type="button" role="menuitem" className="fl-chat-composer-image-action" onClick={openImagePicker}>
                  <span aria-hidden="true">◫</span>
                  <span><strong>Upload an image</strong><small>PNG, JPG, WebP, or GIF · up to 5 MB</small></span>
                  <i aria-hidden="true">→</i>
                </button>
                <p className="fl-chat-composer-action-menu-hint">You can also paste an image directly into the message box.</p>
              </div>
            )}
          </div>
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
            placeholder={recording ? (listening ? 'Listening… keep speaking when you are ready' : 'Waiting for your next phrase…') : 'Message FounderLab'}
            aria-label="Message FounderLab"
            style={{ flex: 1, minWidth: 0, minHeight: 24, maxHeight: 200, overflowY: 'auto', resize: 'none', background: 'transparent', border: 'none', color: C.t1, outline: 'none', padding: '9px 3px', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.55 }}
          />
          <button type="button" className="fl-chat-composer-voice" onPointerDown={beginVoicePointer} onPointerUp={releaseVoicePointer} onPointerCancel={(event) => releaseVoicePointer(event, { cancelled: true })} onClick={() => { if (suppressVoiceClickRef.current) { suppressVoiceClickRef.current = false; return } toggleVoiceInput() }} title={recording ? 'Finish dictation' : voiceError ? 'Retry dictation' : 'Tap to dictate · hold while speaking'} aria-label={recording ? 'Finish dictation' : voiceError ? 'Retry dictation' : 'Start dictation'} style={{ background: recording ? C.redM : 'transparent', border: `1px solid ${recording ? C.red : 'transparent'}`, borderRadius: 10, color: recording ? C.red : C.t2, cursor: 'pointer', padding: '8px 9px', fontSize: 16, lineHeight: 1 }}>{listening ? <WaveformBars /> : recording ? '◌' : '◉'}</button>
          {sending ? (
            <button type="button" onClick={onStop} title="Stop generating" aria-label="Stop generating" style={{ background: C.red, border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', padding: '9px 12px', fontSize: 12, boxShadow: '0 3px 12px rgba(239,68,68,.25)' }}>■</button>
          ) : (
            <button type="button" className="fl-chat-composer-send" onClick={onSend} disabled={!canSend} title="Send message" aria-label="Send message" style={{ background: canSend ? `linear-gradient(135deg, ${C.accent}, #8b5cf6)` : C.surfHigh, border: 'none', borderRadius: 10, color: '#fff', cursor: canSend ? 'pointer' : 'not-allowed', opacity: canSend ? 1 : .5, padding: '8px 12px', fontSize: 17, lineHeight: 1, boxShadow: canSend ? '0 4px 14px rgba(99,102,241,.3)' : 'none' }}>↑</button>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 8, minHeight: 18, flexWrap: 'wrap' }}>
          {providerSwitcher}
          <span style={{ color: C.t3, fontSize: 10.5 }}>{recording ? 'Tap to finish · you can keep typing' : 'Tap mic to dictate · hold to talk · Enter to send · Shift+Enter for a new line'}</span>
        </div>
      </div>
    </div>
  )
}
