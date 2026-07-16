const VOICE_SESSION_COPY = {
  starting: {
    title: 'Opening your microphone',
    detail: 'FounderLab is preparing a private voice capture on this device.',
  },
  listening: {
    title: 'I’m listening',
    detail: 'Speak naturally. FounderLab will prepare your message when you finish.',
  },
  ready: {
    title: 'Your message is ready',
    detail: 'Review it briefly, edit it if needed, then send when you are ready.',
  },
  thinking: {
    title: 'FounderLab is thinking',
    detail: 'Your message is saved in this conversation while the response is prepared.',
  },
  speaking: {
    title: 'FounderLab is speaking',
    detail: 'Keep reading or stop playback at any time.',
  },
  complete: {
    title: 'Your response is ready',
    detail: 'The complete answer is preserved in the conversation.',
  },
  error: {
    title: 'Voice session needs attention',
    detail: 'Your message is still available to review or try again.',
  },
}

function VoiceOrb({ phase }) {
  return (
    <div className={`fl-chat-voice-session-orb is-${phase}`} aria-hidden="true">
      <span />
      <i />
      <b />
    </div>
  )
}

export function ChatVoiceSession({
  session,
  provider,
  voiceLabel,
  onFinish,
  onCancel,
  onSend,
  onStop,
  onEnd,
  onStartAgain,
  onEditDraft,
}) {
  if (!session || session.phase === 'idle') return null
  const copy = VOICE_SESSION_COPY[session.phase] || VOICE_SESSION_COPY.error
  const isListening = ['starting', 'listening'].includes(session.phase)
  const isBusy = ['thinking', 'speaking'].includes(session.phase)

  return (
    <section className={`fl-chat-voice-session is-${session.phase}`} aria-labelledby="fl-chat-voice-session-title" aria-live="polite">
      <div className="fl-chat-voice-session-topline">
        <span>FounderLab voice</span>
        <span>{session.phase === 'speaking' ? voiceLabel : provider?.local ? 'Private local AI' : provider?.name || 'AI conversation'}</span>
      </div>
      <div className="fl-chat-voice-session-main">
        <VoiceOrb phase={session.phase} />
        <div className="fl-chat-voice-session-copy">
          <h2 id="fl-chat-voice-session-title">{copy.title}</h2>
          <p>{session.error || session.note || copy.detail}</p>
          {session.phase === 'ready' && session.transcript && <div className="fl-chat-voice-session-transcript">“{session.transcript}”</div>}
        </div>
      </div>
      <div className="fl-chat-voice-session-actions">
        {isListening && <>
          <button type="button" className="is-quiet" onClick={onCancel}>Cancel capture</button>
          <button type="button" className="is-primary" onClick={onFinish}>Stop & review</button>
        </>}
        {session.phase === 'ready' && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End voice</button>
          <button type="button" className="is-quiet" onClick={onEditDraft}>Edit draft</button>
          <button type="button" className="is-primary" onClick={onSend}>Send message</button>
        </>}
        {isBusy && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End voice</button>
          <button type="button" className="is-primary" onClick={onStop}>{session.phase === 'speaking' ? 'Stop speaking' : 'Stop request'}</button>
        </>}
        {session.phase === 'complete' && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End voice</button>
          <button type="button" className="is-primary" onClick={onStartAgain}>Speak again</button>
        </>}
        {session.phase === 'error' && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End voice</button>
          <button type="button" className="is-primary" onClick={onStartAgain}>Try again</button>
        </>}
      </div>
    </section>
  )
}
