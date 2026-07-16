import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '@/app/theme'
import { toast } from '@/app/toast'
import { copyText, flConsumeHandoff, flNavigate, ts, uid } from '@/lib/appUtils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTextToSpeech } from '@/hooks/useTextToSpeech'
import { getVoiceConfig, persistVoiceConfig } from '@/services/voicePreferences'
import { getAIProvider, getProviderModel, requestAIResult } from '@/services/aiProviderService'
import { loadWorkspaceData as load, saveWorkspaceData as save, workspaceStore } from '@/services/workspaceStore'
import { ChatComposer } from './ChatComposer'
import { ChatHistory } from './ChatHistory'
import { ChatMessage, ChatTypingIndicator } from './ChatMessage'
import {
  CHAT_STARTER_PROMPTS,
  CHAT_SYSTEM_PROMPT,
  createConversation,
  getChatErrorPresentation,
  getProviderPresentation,
  normalizeConversations,
  toChatRequestMessages,
} from './chatUtils'
import './chatPremium.css'

function uniqueMessageId() {
  return uid()
}

export function ChatWorkspace({ user }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [pendingImage, setPendingImage] = useState(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [historyOpen, setHistoryOpen] = useState(true)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [errorState, setErrorState] = useState(null)
  const [voiceConfig, setVoiceConfig] = useState(getVoiceConfig())
  const [activeTTS, setActiveTTS] = useState(null)

  const conversationsRef = useRef([])
  const saveTimerRef = useRef(null)
  const requestAbortRef = useRef(null)
  const requestSequenceRef = useRef(0)
  const messageEndRef = useRef(null)

  const { listening, transcript, setTranscript, start: startRecognition, stop: stopRecognition } = useSpeechRecognition()
  const { speak, stop: stopTTS, elAvailable } = useTextToSpeech(voiceConfig)
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null
  const messages = activeConversation?.messages || []
  const selectedProvider = useMemo(() => {
    const providerId = getAIProvider()
    return getProviderPresentation(providerId, getProviderModel(providerId))
  }, [conversations, activeId, sending])
  const activeError = errorState?.conversationId === activeId ? errorState : null

  useEffect(() => {
    let alive = true
    async function initialise() {
      setLoading(true)
      workspaceStore.logEvent('chat', 'chat')
      const stored = normalizeConversations(await load('fl_convos', []))
      if (!alive) return
      let next = stored
      const handoff = flConsumeHandoff('chat')
      if (handoff?.message && typeof handoff.message === 'string') {
        const conversation = createConversation({ id: uid(), title: handoff.message.slice(0, 64), now: ts() })
        next = [conversation, ...stored]
        setActiveId(conversation.id)
        setInput(handoff.message)
        save('fl_convos', next)
        toast('Message ready from Code AI — review it and press Enter to send.', 'success')
      }
      conversationsRef.current = next
      setConversations(next)
      setLoading(false)
    }
    initialise()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (transcript) setInput(transcript)
  }, [transcript])

  useEffect(() => {
    persistVoiceConfig(voiceConfig)
  }, [voiceConfig])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: sending ? 'smooth' : 'auto', block: 'end' })
  }, [activeId, messages.length, sending])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) setHistoryOpen(false)
  }, [])

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current)
    requestAbortRef.current?.abort()
  }, [])

  function persist(next) {
    conversationsRef.current = next
    setConversations(next)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      save('fl_convos', next).catch(() => {
        toast('This chat is saved on this device. Cloud sync will retry when available.', 'error')
      })
    }, 500)
  }

  function updateConversation(conversationId, update) {
    const next = conversationsRef.current.map((conversation) => conversation.id === conversationId
      ? { ...conversation, ...update, updated_at: update.updated_at || ts() }
      : conversation)
    persist(next)
    return next
  }

  function createNewConversation() {
    const conversation = createConversation({ id: uid(), now: ts() })
    persist([conversation, ...conversationsRef.current])
    setActiveId(conversation.id)
    setInput('')
    setPendingImage(null)
    setEditingMessageId(null)
    setErrorState(null)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) setHistoryOpen(false)
  }

  function selectConversation(conversationId) {
    setActiveId(conversationId)
    setEditingMessageId(null)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) setHistoryOpen(false)
  }

  function beginEdit(message) {
    setEditingMessageId(message.id)
    setInput(message.content || '')
    setPendingImage(message.image ? { base64: message.image, name: 'Attached image' } : null)
    setErrorState(null)
  }

  function cancelEdit() {
    setEditingMessageId(null)
    setInput('')
    setPendingImage(null)
  }

  async function requestAssistantReply({ conversationId, conversationMessages, providerId, modelId }) {
    const requestSequence = ++requestSequenceRef.current
    const controller = new AbortController()
    requestAbortRef.current = controller
    setSending(true)
    setErrorState(null)

    const result = await requestAIResult({
      provider: providerId,
      model: modelId,
      messages: toChatRequestMessages(conversationMessages, providerId),
      system: CHAT_SYSTEM_PROMPT,
      maxTokens: 1800,
      localOllamaAllowed: true,
    }, { signal: controller.signal })

    if (requestSequence !== requestSequenceRef.current || controller.signal.aborted) return
    requestAbortRef.current = null
    setSending(false)

    if (!result.ok) {
      setErrorState({
        conversationId,
        ...getChatErrorPresentation({ ...result.error, provider: result.provider, model: result.model }, providerId),
      })
      return
    }

    const assistantMessage = {
      id: uniqueMessageId(),
      role: 'assistant',
      content: result.text,
      provider: result.provider || providerId,
      model: result.model || modelId,
      ts: ts(),
    }
    const latest = conversationsRef.current
    const next = latest.map((conversation) => conversation.id === conversationId
      ? { ...conversation, messages: [...conversation.messages, assistantMessage], updated_at: ts() }
      : conversation)
    persist(next)
  }

  async function send(textOverride) {
    const content = typeof textOverride === 'string' ? textOverride.trim() : input.trim()
    if ((!content && !pendingImage) || sending) return

    const providerId = getAIProvider()
    const modelId = getProviderModel(providerId)
    const image = pendingImage
    setInput('')
    setPendingImage(null)
    setTranscript('')
    stopRecognition()
    setErrorState(null)

    let conversationId = activeId
    let next = conversationsRef.current
    let outgoingMessages
    if (editingMessageId && activeConversation) {
      const messageIndex = activeConversation.messages.findIndex((message) => message.id === editingMessageId)
      if (messageIndex < 0) {
        cancelEdit()
        return
      }
      const previousMessage = activeConversation.messages[messageIndex]
      const editedMessage = {
        ...previousMessage,
        content: content || (image ? `[Image: ${image.name}]` : ''),
        ...(image ? { image: image.base64 } : {}),
        ts: ts(),
      }
      outgoingMessages = [...activeConversation.messages.slice(0, messageIndex), editedMessage]
      next = next.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: outgoingMessages, updated_at: ts() }
        : conversation)
      setEditingMessageId(null)
    } else {
      if (!conversationId) {
        const conversation = createConversation({ id: uid(), title: content || 'Image chat', now: ts() })
        next = [conversation, ...next]
        conversationId = conversation.id
        setActiveId(conversationId)
      }
      const target = next.find((conversation) => conversation.id === conversationId)
      if (!target) return
      const userMessage = {
        id: uniqueMessageId(),
        role: 'user',
        content: content || `[Image: ${image.name}]`,
        ...(image ? { image: image.base64 } : {}),
        ts: ts(),
      }
      outgoingMessages = [...target.messages, userMessage]
      next = next.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: outgoingMessages, title: target.messages.length === 0 && content ? content.slice(0, 64) : conversation.title, updated_at: ts() }
        : conversation)
    }
    const active = next.find((conversation) => conversation.id === conversationId)
    next = [active, ...next.filter((conversation) => conversation.id !== conversationId)]
    persist(next)
    await requestAssistantReply({ conversationId, conversationMessages: outgoingMessages, providerId, modelId })
  }

  async function regenerate(messageId) {
    if (!activeConversation || sending) return
    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId)
    if (messageIndex < 1 || activeConversation.messages[messageIndex]?.role !== 'assistant') return
    const conversationMessages = activeConversation.messages.slice(0, messageIndex)
    const next = updateConversation(activeConversation.id, { messages: conversationMessages })
    await requestAssistantReply({
      conversationId: activeConversation.id,
      conversationMessages,
      providerId: getAIProvider(),
      modelId: getProviderModel(getAIProvider()),
      conversations: next,
    })
  }

  async function retryLastMessage() {
    if (!activeConversation || sending) return
    const lastUserIndex = activeConversation.messages.map((message) => message.role).lastIndexOf('user')
    if (lastUserIndex < 0) return
    const conversationMessages = activeConversation.messages.slice(0, lastUserIndex + 1)
    updateConversation(activeConversation.id, { messages: conversationMessages })
    await requestAssistantReply({
      conversationId: activeConversation.id,
      conversationMessages,
      providerId: getAIProvider(),
      modelId: getProviderModel(getAIProvider()),
    })
  }

  function stopGenerating() {
    if (!sending) return
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    requestSequenceRef.current += 1
    setSending(false)
    toast('Generation stopped. Your message is still saved.', 'success')
  }

  function clearConversation() {
    if (!activeConversation || !activeConversation.messages.length) return
    if (!window.confirm('Clear every message in this conversation? This cannot be undone.')) return
    updateConversation(activeConversation.id, { messages: [] })
    setErrorState(null)
    toast('Conversation cleared', 'success')
  }

  function deleteConversation(conversationId) {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return
    const next = conversationsRef.current.filter((conversation) => conversation.id !== conversationId)
    persist(next)
    if (activeId === conversationId) setActiveId(next[0]?.id || null)
    toast('Conversation deleted', 'success')
  }

  function deleteMessage(messageId) {
    if (!activeConversation) return
    updateConversation(activeConversation.id, { messages: activeConversation.messages.filter((message) => message.id !== messageId) })
  }

  function saveRename(conversationId) {
    const title = renameValue.trim()
    if (title) updateConversation(conversationId, { title })
    setRenamingId(null)
  }

  async function saveToNotes(message) {
    const notes = await load('fl_notes', [])
    const note = { id: uid(), title: message.content.slice(0, 50) || 'Chat note', content: message.content, tags: ['from-chat'], created_at: ts(), updated_at: ts() }
    await save('fl_notes', [note, ...(Array.isArray(notes) ? notes : [])])
    toast('Saved to Notes', 'success')
  }

  async function createTask(message) {
    const tasks = await load('fl_tasks', [])
    const task = { id: uid(), title: message.content.slice(0, 80), status: 'todo', priority: 'medium', description: message.content, due_date: '', created_at: ts(), updated_at: ts() }
    await save('fl_tasks', [task, ...(Array.isArray(tasks) ? tasks : [])])
    toast('Task created', 'success')
  }

  function readAloud(message) {
    if (activeTTS === message.id) {
      stopTTS()
      setActiveTTS(null)
      return
    }
    setActiveTTS(message.id)
    Promise.resolve(speak(message.content)).finally(() => setActiveTTS(null))
  }

  function changeVoiceConfig(change) {
    setVoiceConfig((current) => ({ ...current, ...change }))
  }

  function togglePin(conversationId) {
    const conversation = conversationsRef.current.find((entry) => entry.id === conversationId)
    if (conversation) updateConversation(conversationId, { pinned: !conversation.pinned })
  }

  return (
    <div className="fl-chat-shell" style={{ background: C.bg }}>
      {historyOpen && <button type="button" className="fl-chat-mobile-backdrop" aria-label="Close chat history" onClick={() => setHistoryOpen(false)} />}
      <ChatHistory
        conversations={conversations}
        activeId={activeId}
        loading={loading}
        open={historyOpen}
        search={search}
        renamingId={renamingId}
        renameValue={renameValue}
        onSearch={setSearch}
        onSelect={selectConversation}
        onNewChat={createNewConversation}
        onRenameStart={(conversation) => { setRenamingId(conversation.id); setRenameValue(conversation.title) }}
        onRenameChange={setRenameValue}
        onRenameCommit={saveRename}
        onRenameCancel={() => setRenamingId(null)}
        onTogglePin={togglePin}
        onDelete={deleteConversation}
      />

      <main className="fl-chat-main" aria-label="FounderLab Chat">
        <header style={{ minHeight: 57, display: 'flex', alignItems: 'center', gap: 10, padding: '11px 20px', borderBottom: `1px solid ${C.border}`, background: `${C.bg}dd`, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', flexShrink: 0, zIndex: 2 }}>
          <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-label={historyOpen ? 'Hide chat history' : 'Show chat history'} aria-expanded={historyOpen} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.t2, cursor: 'pointer', borderRadius: 8, padding: '5px 7px', fontSize: 14, lineHeight: 1 }}>☰</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.t1, fontSize: 14, fontWeight: 680 }}>{activeConversation?.title || 'FounderLab Chat'}</div>
            {activeConversation && <div style={{ color: C.t3, fontSize: 10.5, marginTop: 2 }}>{selectedProvider.local ? 'Local, private AI' : 'Cloud AI'} · {selectedProvider.name}</div>}
          </div>
          {activeConversation?.messages.length > 0 && <button type="button" onClick={clearConversation} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.t2, cursor: 'pointer', borderRadius: 8, padding: '5px 8px', fontSize: 11, fontFamily: 'inherit' }}>Clear</button>}
          {elAvailable === true && <span title="Premium voice is available" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 7px', borderRadius: 99, background: C.greenM, border: '1px solid rgba(16,185,129,.22)', color: C.green, fontSize: 10, fontWeight: 700 }}>● Voice</span>}
        </header>

        {!activeId ? (
          <section style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', placeItems: 'center', padding: 28 }} aria-labelledby="chat-welcome-title">
            <div style={{ width: 'min(100%, 680px)', textAlign: 'center' }}>
              <div aria-hidden="true" style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: 17, display: 'grid', placeItems: 'center', fontSize: 25, color: '#fff', background: `linear-gradient(135deg, ${C.accent}, #a855f7)`, boxShadow: '0 10px 32px rgba(99,102,241,.32)' }}>✦</div>
              <h1 id="chat-welcome-title" style={{ margin: '0 0 9px', fontSize: 'clamp(26px, 4vw, 34px)', letterSpacing: '-.035em', color: C.t1 }}>A clearer way to build.</h1>
              <p style={{ margin: '0 auto 28px', maxWidth: 480, color: C.t2, fontSize: 14, lineHeight: 1.6 }}>FounderLab helps you think through decisions, turn ideas into plans, and keep momentum without the noise.</p>
              <div className="fl-chat-starter-grid" style={{ margin: '0 auto', textAlign: 'left' }}>
                {CHAT_STARTER_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => send(prompt)} style={{ background: `${C.surf}cc`, border: `1px solid ${C.border}`, borderRadius: 13, color: C.t2, cursor: 'pointer', padding: '14px 15px', textAlign: 'left', lineHeight: 1.5, fontSize: 13, fontFamily: 'inherit' }}>{prompt}</button>)}
              </div>
            </div>
          </section>
        ) : (
          <>
            <div className="fl-chat-scroll">
              <div className="fl-chat-reading-column">
                {messages.length === 0 && <div style={{ display: 'grid', placeItems: 'center', minHeight: 220, textAlign: 'center', color: C.t3, fontSize: 13 }}>Start with a question, a decision, or a draft you want to improve.</div>}
                {messages.map((message) => <ChatMessage key={message.id} message={message} user={user} sending={sending} activeTTS={activeTTS} onCopy={copyText} onEdit={beginEdit} onDelete={deleteMessage} onRegenerate={regenerate} onSaveToNotes={saveToNotes} onCreateTask={createTask} onReact={() => {}} onReadAloud={readAloud} voiceCfg={voiceConfig} onVoiceChange={changeVoiceConfig} elevenLabsAvailable={elAvailable} />)}
                {sending && <ChatTypingIndicator provider={selectedProvider} onStop={stopGenerating} />}
                {activeError && <ChatErrorBanner error={activeError} onRetry={retryLastMessage} onDismiss={() => setErrorState(null)} onOpenProviders={() => flNavigate('settings')} />}
                <div ref={messageEndRef} />
              </div>
            </div>
          </>
        )}
        <ChatComposer input={input} onInput={setInput} onSend={send} sending={sending} onStop={stopGenerating} pendingImage={pendingImage} onPendingImage={setPendingImage} listening={listening} onMic={() => listening ? stopRecognition() : startRecognition((text) => setInput(text))} provider={selectedProvider} editing={Boolean(editingMessageId)} onCancelEdit={cancelEdit} onOpenProviders={() => flNavigate('settings')} />
      </main>
    </div>
  )
}

function ChatErrorBanner({ error, onRetry, onDismiss, onOpenProviders }) {
  return (
    <section role="alert" style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginTop: 24, padding: '13px 14px', background: 'rgba(239,68,68,.075)', border: '1px solid rgba(239,68,68,.26)', borderRadius: 12, animation: 'flChatFadeIn .2s ease' }}>
      <span aria-hidden="true" style={{ color: C.red, fontSize: 16 }}>!</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: C.t1, fontSize: 13, fontWeight: 650, marginBottom: 4 }}>{error.title}</div>
        <div style={{ color: C.t2, fontSize: 12.5, lineHeight: 1.5 }}>{error.message}</div>
        <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
          {error.retryable && <button type="button" onClick={onRetry} style={{ background: C.accentM, border: `1px solid ${C.borderFocus}`, borderRadius: 7, color: C.accent, cursor: 'pointer', fontSize: 12, padding: '5px 9px', fontFamily: 'inherit' }}>Retry message</button>}
          <button type="button" onClick={onOpenProviders} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 7, color: C.t2, cursor: 'pointer', fontSize: 12, padding: '5px 9px', fontFamily: 'inherit' }}>AI Providers</button>
          <button type="button" onClick={onDismiss} style={{ background: 'transparent', border: 'none', color: C.t3, cursor: 'pointer', fontSize: 12, padding: '5px 7px', fontFamily: 'inherit' }}>Dismiss</button>
        </div>
      </div>
    </section>
  )
}
