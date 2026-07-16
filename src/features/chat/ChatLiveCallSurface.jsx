import { getLiveCallCopy, getLiveCallProviderSupport, truncateLiveCallText } from './liveCallUtils'

/** A single, focused surface for an active FounderLab voice conversation. */
export function ChatLiveCallSurface({
  call,
  provider,
  voiceLabel,
  onToggleMute,
  onStopTurn,
  onResume,
  onEnd,
}) {
  if (!call || call.phase === 'idle') return null
  const copy = getLiveCallCopy(call.phase)
  const providerSupport = getLiveCallProviderSupport(provider)
  const busy = ['thinking', 'speaking'].includes(call.phase)
  // Two compact exchanges maintain conversational continuity without turning
  // the call surface into a second full Chat thread.
  const latestTurns = Array.isArray(call.turns) ? call.turns.slice(-4) : []
  const transcript = typeof call.transcript === 'string' ? call.transcript.trim() : ''

  return (
    <section className={`fl-chat-live-call is-${call.phase}`} aria-label="FounderLab live call">
      <header className="fl-chat-live-call-header">
        <span className="fl-chat-live-call-pulse" aria-hidden="true" />
        <div className="fl-chat-live-call-copy" role="status" aria-live="polite">
          <span className="fl-chat-live-call-eyebrow">FounderLab · Live call</span>
          <strong>{copy.title}</strong>
          <p>{call.error || call.note || copy.detail}</p>
        </div>
      </header>

      <div className="fl-chat-live-call-provider" aria-label={`Using ${providerSupport.label}`}>
        <span className={providerSupport.local ? 'is-local' : 'is-cloud'}>{providerSupport.local ? 'Local & private' : 'Cloud AI'}</span>
        <strong>{providerSupport.label}</strong>
        {call.phase === 'speaking' && <small>Voice: {voiceLabel}</small>}
      </div>

      <div className="fl-chat-live-call-exchange" aria-label="Live call exchange">
        {latestTurns.map((turn) => (
          <div key={turn.id || `${turn.role}-${turn.ts || turn.content}`} className={`is-${turn.role}`}>
            <span>{turn.role === 'user' ? 'You' : 'FounderLab'}</span>
            <p>{truncateLiveCallText(turn.content, 260)}</p>
          </div>
        ))}
        {transcript && <div className="is-live"><span>Listening</span><p>“{truncateLiveCallText(transcript, 220)}”</p></div>}
        {!latestTurns.length && !transcript && <div className="is-empty"><p>Your conversation stays focused here until you end the call.</p></div>}
      </div>

      <footer className="fl-chat-live-call-controls">
        {call.phase === 'error' ? (
          <button type="button" className="is-primary" onClick={onResume}>Resume call</button>
        ) : (
          <button type="button" aria-pressed={call.muted === true} onClick={onToggleMute}>{call.muted ? 'Unmute mic' : 'Mute mic'}</button>
        )}
        {busy && <button type="button" className="is-quiet" onClick={onStopTurn}>Stop response</button>}
        <button type="button" className="is-end" onClick={onEnd}>End call</button>
      </footer>
    </section>
  )
}
