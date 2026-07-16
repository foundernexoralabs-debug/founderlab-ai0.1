import { getLiveCallCopy, getLiveCallProviderSupport, getLiveCallTranscriptPreview } from './liveCallUtils'

/** A single, voice-first surface for an active FounderLab conversation. */
export function ChatLiveCallSurface({
  call,
  provider,
  voiceLabel,
  onToggleMute,
  onStopTurn,
  onCancelCapture,
  onResume,
  onEnd,
}) {
  if (!call || call.phase === 'idle') return null

  const copy = getLiveCallCopy(call.phase)
  const providerSupport = getLiveCallProviderSupport(provider)
  const busy = ['thinking', 'speaking'].includes(call.phase)
  const capturing = ['connecting', 'ready', 'listening', 'interrupted', 'reconnecting'].includes(call.phase)
  const transcript = typeof call.transcript === 'string' ? call.transcript.trim() : ''
  const providerKind = providerSupport.local ? 'Local & private' : 'Cloud AI'
  const caption = transcript
    ? `“${getLiveCallTranscriptPreview(transcript)}”`
    : call.error || call.note || copy.detail

  return (
    <section className={`fl-chat-live-call is-${call.phase}`} aria-label="FounderLab live call">
      <header className="fl-chat-live-call-header">
        <div className="fl-chat-live-call-status" role="status" aria-live="polite">
          <span className="fl-chat-live-call-pulse" aria-hidden="true" />
          <div className="fl-chat-live-call-copy">
            <span className="fl-chat-live-call-eyebrow">FounderLab · Live call</span>
            <strong>{copy.title}</strong>
          </div>
        </div>
        <div className="fl-chat-live-call-provider" aria-label={`Using ${providerSupport.label}`}>
          <span className={providerSupport.local ? 'is-local' : 'is-cloud'}>{providerKind}</span>
          <strong>{providerSupport.label}</strong>
          {call.phase === 'speaking' && <small>{voiceLabel}</small>}
        </div>
      </header>

      <div className="fl-chat-live-call-focus" aria-label={`Live call is ${copy.title.toLowerCase()}`}>
        <div className="fl-chat-live-call-orb" aria-hidden="true">
          <span className="fl-chat-live-call-orb-ring is-one" />
          <span className="fl-chat-live-call-orb-ring is-two" />
          <span className="fl-chat-live-call-orb-core">✦</span>
        </div>
        <p className={`fl-chat-live-call-caption${transcript ? ' has-transcript' : ''}`}>{caption}</p>
        <span className="fl-chat-live-call-privacy">Live turns stay focused here until you end the call.</span>
      </div>

      <footer className="fl-chat-live-call-controls">
        {call.phase === 'error' ? (
          <button type="button" className="is-primary" onClick={onResume}>Resume call</button>
        ) : (
          <button type="button" className={call.muted ? 'is-primary' : ''} aria-pressed={call.muted === true} onClick={onToggleMute}>{call.muted ? 'Unmute mic' : 'Mute mic'}</button>
        )}
        {busy && <button type="button" className="is-quiet" onClick={onStopTurn}>Stop response</button>}
        {capturing && transcript && <button type="button" className="is-quiet" onClick={onCancelCapture}>Cancel capture</button>}
        <button type="button" className="is-end" onClick={onEnd}>End call</button>
      </footer>
    </section>
  )
}
