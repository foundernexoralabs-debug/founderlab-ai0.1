import { getLiveCallCopy, getLiveCallProviderSupport } from './liveCallUtils'

/** One compact, bottom-anchored surface for a complete live voice call. */
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
  const listening = ['connecting', 'listening'].includes(call.phase)
  const sourceLabel = call.phase === 'speaking'
    ? `${voiceLabel} · Reply from ${providerSupport.label}`
    : providerSupport.label

  return (
    <section className={`fl-chat-live-call is-${call.phase}`} aria-label="FounderLab live call" aria-live="polite">
      <div className="fl-chat-live-call-state">
        <span className="fl-chat-live-call-pulse" aria-hidden="true" />
        <div className="fl-chat-live-call-copy">
          <div><strong>Live call · {copy.title}</strong><span>{sourceLabel}</span></div>
          <p>{call.error || call.note || copy.detail}</p>
        </div>
      </div>

      {listening && call.transcript && <div className="fl-chat-live-call-transcript">“{call.transcript}”</div>}

      <div className="fl-chat-live-call-controls">
        {call.phase === 'error' ? (
          <button type="button" className="is-primary" onClick={onResume}>Resume call</button>
        ) : (
          <button type="button" aria-pressed={call.muted === true} onClick={onToggleMute}>{call.muted ? 'Unmute' : 'Mute'}</button>
        )}
        {busy && <button type="button" className="is-quiet" onClick={onStopTurn}>Stop response</button>}
        <button type="button" className="is-end" onClick={onEnd}>End call</button>
      </div>
    </section>
  )
}
