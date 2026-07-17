const VOICE_SESSION_COPY = {
  starting: {
    title: 'Connecting microphone',
    detail: 'Voice is starting now. Begin speaking as soon as listening appears.',
  },
  listening: {
    title: 'Listening',
    detail: 'Speak naturally. FounderLab will wait for your review.',
  },
  ready: {
    title: 'Ready to review',
    detail: 'Check the interpreted message, then send or edit it.',
  },
  thinking: {
    title: 'Thinking',
    detail: 'Your message is safely in the conversation.',
  },
  speaking: {
    title: 'Speaking',
    detail: 'Keep reading or stop playback at any time.',
  },
  complete: {
    title: 'Voice response complete',
    detail: 'The complete answer is preserved in chat.',
  },
  error: {
    title: 'Voice needs attention',
    detail: 'Your chat stays intact. Try again when ready.',
  },
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
  const sourceLabel = session.phase === 'speaking'
    ? voiceLabel
    : provider?.local
      ? 'Private local AI'
      : provider?.name || 'AI voice'

  return (
    <section className={`fl-chat-voice-dock is-${session.phase}`} aria-labelledby="fl-chat-voice-session-title" aria-live="polite">
      <div className="fl-chat-voice-dock-status">
        <span className="fl-chat-voice-dock-pulse" aria-hidden="true" />
        <div className="fl-chat-voice-dock-copy">
          <div><strong id="fl-chat-voice-session-title">{copy.title}</strong><span>{sourceLabel}</span></div>
          <p>{session.error || session.note || copy.detail}</p>
        </div>
      </div>
      {session.phase === 'ready' && session.transcript && <div className="fl-chat-voice-dock-transcript">“{session.transcript}”</div>}
      <div className="fl-chat-voice-dock-actions">
        {isListening && <>
          <button type="button" className="is-quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="is-primary" onClick={onFinish}>Review</button>
        </>}
        {session.phase === 'ready' && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End</button>
          <button type="button" className="is-quiet" onClick={onEditDraft}>Edit</button>
          <button type="button" className="is-primary" onClick={onSend}>Send</button>
        </>}
        {isBusy && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End</button>
          <button type="button" className="is-primary" onClick={onStop}>Stop</button>
        </>}
        {session.phase === 'complete' && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End</button>
          <button type="button" className="is-primary" onClick={onStartAgain}>Speak again</button>
        </>}
        {session.phase === 'error' && <>
          <button type="button" className="is-quiet" onClick={onEnd}>End</button>
          <button type="button" className="is-primary" onClick={onStartAgain}>Try again</button>
        </>}
      </div>
    </section>
  )
}
