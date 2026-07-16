import { useState } from 'react'
import { C } from '@/app/theme'
import { renderMsg } from '@/components/content/MessageContent'
import { getProviderPresentation } from './chatUtils'

function ActionButton({ label, icon, onClick, active = false, danger = false }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} style={{
      background: active ? C.accentM : 'transparent',
      border: `1px solid ${active ? C.borderFocus : 'transparent'}`,
      color: active ? C.accent : (danger ? C.t3 : C.t2),
      cursor: 'pointer', fontSize: 12, lineHeight: 1,
      padding: '5px 7px', borderRadius: 7, fontFamily: 'inherit',
    }}>
      {icon}
    </button>
  )
}

function VoiceSettings({ voiceCfg, onVoiceChange, elevenLabsAvailable }) {
  return (
    <div style={{ marginTop: 9, padding: '11px 12px', background: `${C.surf}e6`, borderRadius: 10, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 520 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: C.t3, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>Voice</span>
        {[
          { id: 'elevenlabs', label: elevenLabsAvailable === true ? 'ElevenLabs' : 'ElevenLabs unavailable', available: elevenLabsAvailable === true },
          { id: 'browser', label: 'Browser', available: true },
        ].map((voice) => (
          <button key={voice.id} type="button" disabled={!voice.available} onClick={() => onVoiceChange({ provider: voice.id })} style={{
            padding: '4px 9px', borderRadius: 99, border: `1px solid ${voiceCfg.provider === voice.id ? C.borderFocus : C.border}`,
            background: voiceCfg.provider === voice.id ? C.accentM : 'transparent', color: voiceCfg.provider === voice.id ? C.accent : C.t2,
            cursor: voice.available ? 'pointer' : 'not-allowed', opacity: voice.available ? 1 : .45, fontSize: 11, fontFamily: 'inherit',
          }}>{voice.label}</button>
        ))}
        {['male', 'female'].map((gender) => (
          <button key={gender} type="button" onClick={() => onVoiceChange({ gender })} style={{
            padding: '4px 9px', borderRadius: 99, border: `1px solid ${voiceCfg.gender === gender ? C.borderFocus : C.border}`,
            background: voiceCfg.gender === gender ? C.accentM : 'transparent', color: voiceCfg.gender === gender ? C.accent : C.t2,
            cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', textTransform: 'capitalize',
          }}>{gender}</button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.t2 }}>
        <span style={{ color: C.t3, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 10 }}>Speed</span>
        <input aria-label="Speech speed" type="range" min={-50} max={50} value={voiceCfg.speed} onChange={(event) => onVoiceChange({ speed: Number(event.target.value) })} style={{ flex: 1, minWidth: 120, accentColor: C.accent }} />
        <span style={{ minWidth: 48, textAlign: 'right' }}>{voiceCfg.speed === 0 ? 'Normal' : `${voiceCfg.speed > 0 ? '+' : ''}${voiceCfg.speed}%`}</span>
      </label>
    </div>
  )
}

export function ChatMessage({
  message,
  user,
  sending,
  activeTTS,
  onCopy,
  onEdit,
  onDelete,
  onRegenerate,
  onSaveToNotes,
  onCreateTask,
  onReact,
  onReadAloud,
  voiceCfg,
  onVoiceChange,
  elevenLabsAvailable,
}) {
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false)
  const [reaction, setReaction] = useState(null)
  const assistant = message.role === 'assistant'
  const provider = assistant ? getProviderPresentation(message.provider, message.model) : null
  const time = message.ts ? new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const ttsActive = activeTTS === message.id

  function react(value) {
    const next = reaction === value ? null : value
    setReaction(next)
    onReact(message.id, next)
  }

  return (
    <article className={`fl-chat-message ${assistant ? 'is-assistant' : 'is-user'}`} aria-label={assistant ? 'FounderLab response' : 'Your message'}>
      <div aria-hidden="true" className="fl-chat-avatar" style={{
        color: '#fff', fontSize: assistant ? 14 : 11, fontWeight: assistant ? 500 : 750,
        background: assistant ? `linear-gradient(135deg, ${C.accent}, #a855f7)` : 'linear-gradient(135deg, #1f2937, #475569)',
      }}>{assistant ? '✦' : (user?.email?.split('@')[0]?.split(/[._-]/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U')}</div>

      <div className="fl-chat-message-body">
        <div className="fl-chat-message-card">
          <div className="fl-chat-message-meta">
            <span style={{ fontSize: 10.5, fontWeight: 750, letterSpacing: '.06em', textTransform: 'uppercase', color: assistant ? C.t2 : '#c7d2fe' }}>{assistant ? 'FounderLab' : 'You'}</span>
            {assistant && message.provider && (
              <span title={`${provider.name} · ${provider.model}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 99, background: provider.local ? 'rgba(16,185,129,.1)' : C.accentM, border: `1px solid ${provider.local ? 'rgba(16,185,129,.22)' : C.borderFocus}`, color: provider.local ? C.green : C.accent, fontSize: 10, fontWeight: 650 }}>
                {provider.local ? 'Local' : 'Cloud'} · {provider.name.replace('Local ', '')}
              </span>
            )}
            {time && <time style={{ color: assistant ? C.t3 : 'rgba(224,231,255,.62)', fontSize: 10 }}>{time}</time>}
          </div>

          {message.image && <img src={message.image} alt={assistant ? 'Referenced attachment' : 'Attached by you'} style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 11, display: 'block', objectFit: 'cover', border: `1px solid ${C.border}`, marginBottom: 10 }} />}
          <div className="fl-chat-message-content">
            {assistant ? renderMsg(message.content) : <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>}
          </div>
        </div>

        <div className={`fl-chat-message-actions ${ttsActive || voiceMenuOpen || reaction ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 7, flexWrap: 'wrap' }}>
          <ActionButton label="Copy" icon="⧉" onClick={() => onCopy(message.content)} />
          {assistant ? <>
            <ActionButton label={ttsActive ? 'Stop reading' : 'Read aloud'} icon={ttsActive ? '■' : '◖'} active={ttsActive} onClick={() => onReadAloud(message)} />
            <ActionButton label="Voice settings" icon="⚙" active={voiceMenuOpen} onClick={() => setVoiceMenuOpen((open) => !open)} />
            {!sending && <ActionButton label="Regenerate response" icon="↻" onClick={() => onRegenerate(message.id)} />}
            <ActionButton label="Good response" icon="↑" active={reaction === 'up'} onClick={() => react('up')} />
            <ActionButton label="Poor response" icon="↓" active={reaction === 'down'} onClick={() => react('down')} />
            <ActionButton label="Save to Notes" icon="◫" onClick={() => onSaveToNotes(message)} />
            <ActionButton label="Create task" icon="✓" onClick={() => onCreateTask(message)} />
          </> : <ActionButton label="Edit and resend" icon="✎" onClick={() => onEdit(message)} />}
          <ActionButton label="Delete message" icon="×" danger onClick={() => onDelete(message.id)} />
        </div>

        {assistant && voiceMenuOpen && <VoiceSettings voiceCfg={voiceCfg} onVoiceChange={onVoiceChange} elevenLabsAvailable={elevenLabsAvailable} />}
      </div>
    </article>
  )
}

export function ChatTypingIndicator({ provider, onStop }) {
  return (
    <div className="fl-chat-message is-assistant" aria-live="polite" aria-label={`${provider.name} is responding`}>
      <div aria-hidden="true" className="fl-chat-avatar" style={{ color: '#fff', fontSize: 13, background: `linear-gradient(135deg, ${C.accent}, #a855f7)` }}>✦</div>
      <div className="fl-chat-message-body" style={{ paddingTop: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.055em', textTransform: 'uppercase', color: C.t2, marginBottom: 8 }}>FounderLab · {provider.local ? 'Local Ollama' : provider.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 5, height: 16 }}>
            {[0, 1, 2].map((index) => <span key={index} style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, animation: `flChatTyping 1.2s ease-in-out ${index * .14}s infinite` }} />)}
          </div>
          <button type="button" onClick={onStop} style={{ border: `1px solid ${C.border}`, background: 'transparent', borderRadius: 7, color: C.t2, cursor: 'pointer', padding: '4px 9px', fontSize: 11, fontFamily: 'inherit' }}>Stop</button>
        </div>
      </div>
    </div>
  )
}
