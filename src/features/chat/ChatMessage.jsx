import { useEffect, useRef, useState } from 'react'
import { C } from '@/app/theme'
import { getVoiceProvider } from '@/ai/voiceProviderRegistry'
import { renderMsg } from '@/components/content/MessageContent'
import { getVoiceSpeedLabel, VOICE_SPEED_OPTIONS } from '@/lib/voicePreferencesUtils'
import { getChatUserInitials, getProviderPresentation } from './chatUtils'
import { ChatControlActions } from './ChatControlActions'
import { getChatExecutionTransparency } from './chatExecutionTransparency'

const ELEVENLABS_VOICE_PROVIDER = getVoiceProvider('elevenlabs')
const VOICE_STYLE_OPTIONS = ['female', 'male'].map((voice) => ({
  id: voice,
  label: ELEVENLABS_VOICE_PROVIDER?.voiceLabels[voice] || voice,
}))

function ActionButton({ label, icon, onClick, active = false, danger = false, expanded }) {
  return (
    <button type="button" className={`fl-chat-message-action ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`} onClick={onClick} title={label} aria-label={label} aria-expanded={expanded} style={{
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

function VoiceSettings({ voiceCfg, onVoiceChange, elevenLabsAvailable, onClose, onPreviewVoice, previewing }) {
  const browserVoiceSelected = voiceCfg.provider !== 'elevenlabs' || elevenLabsAvailable !== true
  return (
    <section className="fl-chat-voice-popover" role="dialog" aria-label="Voice playback controls">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.t1 }}>Read aloud</div>
          <div style={{ color: C.t3, fontSize: 10.5, marginTop: 2 }}>Playback stays out of your way while you read.</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close voice controls" style={{ background: 'transparent', border: 'none', color: C.t3, cursor: 'pointer', padding: 1, fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      <div className="fl-chat-voice-option-group">
        <span className="fl-chat-voice-option-label">Playback voice</span>
        <button type="button" className={`fl-chat-voice-choice ${browserVoiceSelected ? 'is-selected' : ''}`} aria-pressed={browserVoiceSelected} onClick={() => onVoiceChange({ provider: 'browser' })}>Best available browser voice</button>
        {elevenLabsAvailable === true && <button type="button" className={`fl-chat-voice-choice ${voiceCfg.provider === 'elevenlabs' ? 'is-selected' : ''}`} aria-pressed={voiceCfg.provider === 'elevenlabs'} onClick={() => onVoiceChange({ provider: 'elevenlabs' })}>Enhanced voice · {ELEVENLABS_VOICE_PROVIDER?.voiceLabels[voiceCfg.gender] || 'Premium'}</button>}
        <span className="fl-chat-voice-guidance">{elevenLabsAvailable === true ? 'Choose enhanced playback when it is configured for this workspace.' : 'FounderLab picks the best available English system voice on this browser.'}</span>
      </div>

      <div className="fl-chat-voice-option-group">
        <span className="fl-chat-voice-option-label">Voice style</span>
        {VOICE_STYLE_OPTIONS.map((voice) => (
          <button key={voice.id} type="button" className={`fl-chat-voice-choice ${voiceCfg.gender === voice.id ? 'is-selected' : ''}`} aria-pressed={voiceCfg.gender === voice.id} onClick={() => onVoiceChange({ gender: voice.id })}>{voice.label}</button>
        ))}
      </div>

      <div className="fl-chat-voice-option-group">
        <span className="fl-chat-voice-option-label">Speed</span>
        {VOICE_SPEED_OPTIONS.map((option) => (
          <button key={option.value} type="button" className={`fl-chat-voice-speed ${voiceCfg.speed === option.value ? 'is-selected' : ''}`} aria-label={`Speech speed ${option.label}`} aria-pressed={voiceCfg.speed === option.value} onClick={() => onVoiceChange({ speed: option.value })}>{option.label}</button>
        ))}
      </div>
      <div className="fl-chat-voice-preview-row">
        <span>Selected speed: {getVoiceSpeedLabel(voiceCfg.speed)}</span>
        <button type="button" onClick={onPreviewVoice}>{previewing ? 'Stop preview' : 'Preview voice'}</button>
      </div>
    </section>
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
  onPreviewVoice,
  voiceCfg,
  onVoiceChange,
  elevenLabsAvailable,
  controlActions = [],
  onControlAction,
  streaming = false,
  onStopStreaming,
}) {
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false)
  const [reaction, setReaction] = useState(null)
  const [copied, setCopied] = useState(false)
  const voiceMenuRef = useRef(null)
  const copiedTimerRef = useRef(null)
  const assistant = message.role === 'assistant'
  const provider = assistant ? getProviderPresentation(message.provider, message.model) : null
  const time = message.ts ? new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const ttsActive = activeTTS === message.id
  const hasContextualNoteAction = controlActions.some((action) => action.id === 'save-note')
  const hasContextualTaskAction = controlActions.some((action) => action.id === 'create-task')
  const operatorReport = assistant ? getChatExecutionTransparency(message.orchestration) : null
  const executionTarget = operatorReport?.execution
    ? [operatorReport.execution.target, operatorReport.execution.inspection, operatorReport.execution.branch].filter(Boolean).join(' · ')
    : ''

  useEffect(() => {
    if (!voiceMenuOpen) return undefined
    const closeOnOutsidePointer = (event) => {
      if (!voiceMenuRef.current?.contains(event.target)) setVoiceMenuOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setVoiceMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [voiceMenuOpen])

  useEffect(() => () => clearTimeout(copiedTimerRef.current), [])

  function react(value) {
    const next = reaction === value ? null : value
    setReaction(next)
    onReact(message.id, next)
  }

  function copyMessage() {
    onCopy(message.content)
    setCopied(true)
    clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <article className={`fl-chat-message ${assistant ? 'is-assistant' : 'is-user'} ${ttsActive ? 'is-speaking' : ''} ${streaming ? 'is-streaming' : ''}`} aria-label={assistant ? 'FounderLab response' : 'Your message'}>
      <div aria-hidden="true" className={`fl-chat-avatar ${assistant ? 'is-assistant' : 'is-user'}`} style={{
        color: '#fff', fontSize: assistant ? 14 : 11, fontWeight: assistant ? 500 : 750,
        background: assistant ? `linear-gradient(135deg, ${C.accent}, #a855f7)` : 'linear-gradient(135deg, #1f2937, #475569)',
      }}>{assistant ? '✦' : getChatUserInitials(user)}</div>

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
          <div className="fl-chat-message-content" aria-live={streaming ? 'polite' : undefined}>
            {assistant && streaming && !message.content ? (
              <div className="fl-chat-stream-pending">
                <span aria-hidden="true" className="fl-chat-stream-pulse" />
                <span>FounderLab is connecting to {provider?.local ? 'your local model' : 'the selected model'}.</span>
                <button type="button" onClick={onStopStreaming}>Stop</button>
              </div>
            ) : assistant ? renderMsg(message.content) : <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>}
          </div>
          {message.incomplete === true && <div className="fl-chat-message-interrupted" role="status">Response interrupted. The text above is everything FounderLab received.</div>}
        </div>

        {assistant && !streaming && <ChatControlActions actions={controlActions} onAction={(action) => onControlAction?.(action, message)} />}

        {operatorReport && !streaming && (
          <details className="fl-chat-operator-report">
            <summary><span>Operator report</span><strong>{operatorReport.state.label}</strong></summary>
            <div className="fl-chat-operator-report-body">
              <p><b>{operatorReport.intentLabel}</b></p>
              <p>{operatorReport.outcome.detail}</p>
              {operatorReport.execution && (
                <p>
                  <b>{operatorReport.execution.label}</b><br />
                  {operatorReport.execution.detail}<br />
                  <span className="fl-chat-operator-report-next">
                    Target: {executionTarget}
                  </span>
                </p>
              )}
              {operatorReport.workflow && (
                <p>
                  <b>{operatorReport.workflow.label}</b><br />
                  {operatorReport.workflow.detail}<br />
                  <span className="fl-chat-operator-report-next">
                    {operatorReport.workflow.branch}<br />
                    {operatorReport.workflow.change}<br />
                    {operatorReport.workflow.validation}<br />
                    Review: {operatorReport.workflow.review} · {operatorReport.workflow.capability}<br />
                    Execution access: {operatorReport.workflow.executor}
                    {operatorReport.workflow.fileTargets?.length ? <><br />Candidate files: {operatorReport.workflow.fileTargets.join(', ')}</> : null}
                  </span>
                </p>
              )}
              {operatorReport.capability && <p><b>{operatorReport.capability.label}</b><br />{operatorReport.capability.detail}</p>}
              {operatorReport.route && <p><b>{operatorReport.route.label}</b><br />{operatorReport.route.detail}</p>}
              {operatorReport.trail?.entries?.length ? (
                <p>
                  <b>Execution trail</b><br />
                  {operatorReport.trail.entries.map((entry) => <span key={entry.id} className="fl-chat-operator-report-next">{entry.phase} · {entry.label}{entry.resource ? ` · ${entry.resource}` : ''}<br /></span>)}
                </p>
              ) : null}
              {operatorReport.facts.filter((fact) => fact.label !== operatorReport.outcome.label).map((fact) => <p key={`${fact.kind}-${fact.label}`}><b>{fact.label}</b><br />{fact.detail}</p>)}
              <p className="fl-chat-operator-report-next">{operatorReport.nextStep}</p>
            </div>
          </details>
        )}

        {!streaming && <div className={`fl-chat-message-actions ${ttsActive || voiceMenuOpen || reaction ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 7, flexWrap: 'wrap' }}>
          <ActionButton label={copied ? 'Copied' : 'Copy'} icon={copied ? '✓' : '⧉'} active={copied} onClick={copyMessage} />
          {assistant ? <>
            <ActionButton label={ttsActive ? 'Stop reading' : 'Read aloud'} icon={ttsActive ? '■' : '◖'} active={ttsActive} onClick={() => onReadAloud(message)} />
            <div ref={voiceMenuRef} className="fl-chat-voice-control">
              <ActionButton label="Voice settings" icon="⚙" active={voiceMenuOpen} expanded={voiceMenuOpen} onClick={() => setVoiceMenuOpen((open) => !open)} />
              {voiceMenuOpen && <VoiceSettings voiceCfg={voiceCfg} onVoiceChange={onVoiceChange} elevenLabsAvailable={elevenLabsAvailable} onClose={() => setVoiceMenuOpen(false)} onPreviewVoice={onPreviewVoice} previewing={activeTTS === 'voice-preview'} />}
            </div>
            {!sending && <ActionButton label="Regenerate response" icon="↻" onClick={() => onRegenerate(message.id)} />}
            <ActionButton label="Good response" icon="↑" active={reaction === 'up'} onClick={() => react('up')} />
            <ActionButton label="Poor response" icon="↓" active={reaction === 'down'} onClick={() => react('down')} />
            {!hasContextualNoteAction && <ActionButton label="Save to Notes" icon="◫" onClick={() => onSaveToNotes(message)} />}
            {!hasContextualTaskAction && <ActionButton label="Create task" icon="✓" onClick={() => onCreateTask(message)} />}
          </> : <ActionButton label="Edit and resend" icon="✎" onClick={() => onEdit(message)} />}
          <ActionButton label="Delete message" icon="×" danger onClick={() => onDelete(message.id)} />
        </div>
        }

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
          <span className="fl-chat-typing-copy">Working through your request</span>
          <button type="button" onClick={onStop} style={{ border: `1px solid ${C.border}`, background: 'transparent', borderRadius: 7, color: C.t2, cursor: 'pointer', padding: '4px 9px', fontSize: 11, fontFamily: 'inherit' }}>Stop</button>
        </div>
      </div>
    </div>
  )
}
