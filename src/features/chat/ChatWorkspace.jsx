import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '@/app/theme'
import { toast } from '@/app/toast'
import { copyText, flConsumeHandoff, flNavigate, ts, uid } from '@/lib/appUtils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTextToSpeech } from '@/hooks/useTextToSpeech'
import { getVoiceSpeedLabel } from '@/lib/voicePreferencesUtils'
import { mergeLiveTranscript } from '@/hooks/speechRecognitionUtils'
import { getVoiceConfig, persistVoiceConfig } from '@/services/voicePreferences'
import {
  discoverLocalOllama,
  getAIProvider,
  getProviderAvailability,
  getProviderModel,
  refreshProviderAvailability,
  requestAIResult,
  setAIProvider,
  setProviderModel,
} from '@/services/aiProviderService'
import { loadWorkspaceData as load, saveWorkspaceData as save, workspaceStore } from '@/services/workspaceStore'
import { ChatComposer } from './ChatComposer'
import { ChatConfirmDialog } from './ChatConfirmDialog'
import { ChatHistory } from './ChatHistory'
import { ChatMessage, ChatTypingIndicator } from './ChatMessage'
import { ChatProviderSwitcher } from './ChatProviderSwitcher'
import { getChatUIPreferences, persistChatUIPreferences } from './chatPreferences'
import { getChatProviderPresentation } from './chatProviderUtils'
import { useConversationScroll } from './useConversationScroll'
import {
  CHAT_STARTER_PROMPTS,
  CHAT_SYSTEM_PROMPT,
  createConversation,
  getChatErrorPresentation,
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
  const [historyOpen, setHistoryOpen] = useState(() => getChatUIPreferences().historyOpen)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [errorState, setErrorState] = useState(null)
  const [voiceConfig, setVoiceConfig] = useState(getVoiceConfig())
  const [activeTTS, setActiveTTS] = useState(null)
  const [providerAvailability, setProviderAvailability] = useState(getProviderAvailability)
  const [providerSelection, setProviderSelection] = useState(() => {
    const providerId = getAIProvider()
    return { id: providerId, model: getProviderModel(providerId) }
  })
  const [localModels, setLocalModels] = useState([])
  const [localModelState, setLocalModelState] = useState('idle')

  const conversationsRef = useRef([])
  const saveTimerRef = useRef(null)
  const requestAbortRef = useRef(null)
  const requestSequenceRef = useRef(0)
  const liveDictationRef = useRef({ active: false, lastTranscript: '' })

  const {
    listening,
    clearVoiceDraft,
    hasRecognizedSpeech,
    voiceInputState,
    start: startRecognition,
    stop: stopRecognition,
  } = useSpeechRecognition()
  const { speaking, speak, stop: stopTTS, activeProvider: activeVoiceProvider, elAvailable } = useTextToSpeech(voiceConfig)
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null
  const messages = activeConversation?.messages || []
  const { scrollRef: conversationScrollRef, showJumpToLatest, scrollToLatest } = useConversationScroll({
    conversationId: activeId,
    messageCount: messages.length,
    sending,
  })
  const selectedProvider = useMemo(() => {
    return { ...getChatProviderPresentation(providerSelection.id, providerSelection.model), modelId: providerSelection.model }
  }, [providerSelection])
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
      } else if (next[0]?.id) {
        // Returning to the most recently persisted chat should feel like
        // continuity, not a blank reset. New users still receive the calm
        // welcome state because they have no saved conversation yet.
        setActiveId(next[0].id)
      }
      conversationsRef.current = next
      setConversations(next)
      setLoading(false)
    }
    initialise()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    persistVoiceConfig(voiceConfig)
  }, [voiceConfig])

  useEffect(() => {
    let active = true
    refreshProviderAvailability().then(({ provider, providers }) => {
      if (!active) return
      setProviderAvailability(providers)
      setProviderSelection((current) => {
        // The persisted preference is read at completion so a selection made
        // while the authenticated availability request is in flight wins.
        const providerId = getAIProvider() || provider || current.id
        return { id: providerId, model: getProviderModel(providerId) }
      })
    }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) setHistoryOpen(false)
  }, [])

  function changeHistoryOpen(next) {
    setHistoryOpen(next)
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 760px)').matches) {
      persistChatUIPreferences({ historyOpen: next })
    }
  }

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
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) changeHistoryOpen(false)
  }

  function selectConversation(conversationId) {
    setActiveId(conversationId)
    setEditingMessageId(null)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) changeHistoryOpen(false)
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

  function startDictation() {
    const initialTranscript = input
    liveDictationRef.current = { active: true, lastTranscript: initialTranscript }
    return startRecognition((nextTranscript) => {
      setInput((current) => {
        const liveDictation = liveDictationRef.current
        if (!liveDictation.active) return current
        const next = mergeLiveTranscript(current, liveDictation.lastTranscript, nextTranscript)
        liveDictation.lastTranscript = nextTranscript
        return next
      })
    }, { initialTranscript }).then((started) => {
      if (!started) liveDictationRef.current.active = false
      return started
    })
  }

  function finishDictation() {
    liveDictationRef.current.active = false
    stopRecognition()
  }

  function selectChatProvider(providerId) {
    if (!setAIProvider(providerId)) {
      toast('That AI provider is not available for this workspace.', 'error')
      return
    }
    const model = getProviderModel(providerId)
    setProviderSelection({ id: providerId, model })
    setErrorState(null)
  }

  function selectChatModel(model) {
    const providerId = providerSelection.id
    if (!providerId || !setProviderModel(providerId, model)) {
      toast('That model is not available. Choose another model and try again.', 'error')
      return
    }
    setProviderSelection({ id: providerId, model })
    setErrorState(null)
  }

  async function discoverChatOllamaModels() {
    setLocalModelState('discovering')
    let result
    try {
      result = await discoverLocalOllama()
    } catch {
      setLocalModelState('failed')
      return
    }
    if (!result.ok) {
      setLocalModelState('failed')
      return
    }
    const models = Array.isArray(result.models) ? result.models : []
    setLocalModels(models)
    setLocalModelState(models.length ? 'ready' : 'empty')
    if (!models.length) return

    const remembered = getProviderModel('ollama')
    const model = models.some((candidate) => candidate.id === remembered) ? remembered : models[0].id
    if (model && model !== remembered) setProviderModel('ollama', model)
    setProviderSelection((current) => current.id === 'ollama' ? { id: 'ollama', model } : current)
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

    const providerId = providerSelection.id
    const modelId = providerSelection.model
    if (!providerId) {
      toast('Choose an AI provider below the composer before sending a message.', 'error')
      return
    }
    const image = pendingImage
    const source = hasRecognizedSpeech ? 'voice' : undefined
    liveDictationRef.current.active = false
    setInput('')
    setPendingImage(null)
    clearVoiceDraft()
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
        ...(source ? { source } : {}),
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
      providerId: providerSelection.id,
      modelId: providerSelection.model,
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
      providerId: providerSelection.id,
      modelId: providerSelection.model,
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

  function requestClearConversation() {
    if (!activeConversation || !activeConversation.messages.length) return
    setConfirmation({ type: 'clear', conversationId: activeConversation.id })
  }

  function clearConversation(conversationId) {
    const conversation = conversationsRef.current.find((entry) => entry.id === conversationId)
    if (!conversation?.messages.length) return
    updateConversation(conversationId, { messages: [] })
    setErrorState(null)
    toast('Conversation cleared', 'success')
  }

  function requestDeleteConversation(conversationId) {
    if (!conversationsRef.current.some((conversation) => conversation.id === conversationId)) return
    setConfirmation({ type: 'conversation', conversationId })
  }

  function deleteConversation(conversationId) {
    const next = conversationsRef.current.filter((conversation) => conversation.id !== conversationId)
    persist(next)
    if (activeId === conversationId) setActiveId(next[0]?.id || null)
    toast('Conversation deleted', 'success')
  }

  function requestDeleteMessage(messageId) {
    if (!activeConversation?.messages.some((message) => message.id === messageId)) return
    setConfirmation({ type: 'message', conversationId: activeConversation.id, messageId })
  }

  function deleteMessage(conversationId, messageId) {
    const conversation = conversationsRef.current.find((entry) => entry.id === conversationId)
    if (!conversation?.messages.some((message) => message.id === messageId)) return
    updateConversation(conversationId, { messages: conversation.messages.filter((message) => message.id !== messageId) })
    toast('Message deleted', 'success')
  }

  function confirmPendingAction() {
    const action = confirmation
    setConfirmation(null)
    if (!action) return
    if (action.type === 'clear') clearConversation(action.conversationId)
    if (action.type === 'conversation') deleteConversation(action.conversationId)
    if (action.type === 'message') deleteMessage(action.conversationId, action.messageId)
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
    Promise.resolve(speak(message.content)).finally(() => setActiveTTS((current) => current === message.id ? null : current))
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
      {historyOpen && <button type="button" className="fl-chat-mobile-backdrop" aria-label="Close chat history" onClick={() => changeHistoryOpen(false)} />}
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
        onDelete={requestDeleteConversation}
      />
      <ChatConfirmDialog action={confirmation} onCancel={() => setConfirmation(null)} onConfirm={confirmPendingAction} />

      <main className="fl-chat-main" aria-label="FounderLab Chat">
        <header className="fl-chat-topbar">
          <button type="button" className="fl-chat-history-toggle" onClick={() => changeHistoryOpen(!historyOpen)} aria-label={historyOpen ? 'Hide chat history' : 'Show chat history'} aria-expanded={historyOpen}>☰</button>
          <div className="fl-chat-topbar-title">
            <div>{activeConversation?.title || 'FounderLab Chat'}</div>
            {activeConversation && <div>{selectedProvider.local ? 'Local, private AI' : 'Cloud AI'} · {selectedProvider.name}</div>}
          </div>
          {activeConversation?.messages.length > 0 && <button type="button" className="fl-chat-clear" onClick={requestClearConversation}>Clear</button>}
          {elAvailable === true && <span title="Premium voice is available" className="fl-chat-voice-ready">● Voice</span>}
        </header>

        {activeTTS && speaking && (
          <div className="fl-chat-playback-dock" role="status" aria-live="polite">
            <span aria-hidden="true" className="fl-chat-playback-wave">◌</span>
            <span style={{ flex: 1, minWidth: 0 }}>Reading aloud · {activeVoiceProvider === 'elevenlabs' ? 'ElevenLabs voice' : activeVoiceProvider === 'browser' ? 'System voice' : 'Starting playback'} · {getVoiceSpeedLabel(voiceConfig.speed)}</span>
            <button type="button" onClick={() => { stopTTS(); setActiveTTS(null) }}>Stop</button>
          </div>
        )}

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
            <div ref={conversationScrollRef} className="fl-chat-scroll" role="region" aria-label="Conversation" tabIndex={0}>
              <div className="fl-chat-reading-column">
                {messages.length === 0 && <div style={{ display: 'grid', placeItems: 'center', minHeight: 220, textAlign: 'center', color: C.t3, fontSize: 13 }}>Start with a question, a decision, or a draft you want to improve.</div>}
                {messages.map((message) => <ChatMessage key={message.id} message={message} user={user} sending={sending} activeTTS={activeTTS} onCopy={copyText} onEdit={beginEdit} onDelete={requestDeleteMessage} onRegenerate={regenerate} onSaveToNotes={saveToNotes} onCreateTask={createTask} onReact={() => {}} onReadAloud={readAloud} onPreviewVoice={() => readAloud({ id: 'voice-preview', content: 'This is a quick FounderLab voice preview.' })} voiceCfg={voiceConfig} onVoiceChange={changeVoiceConfig} elevenLabsAvailable={elAvailable} />)}
                {sending && <ChatTypingIndicator provider={selectedProvider} onStop={stopGenerating} />}
                {activeError && <ChatErrorBanner error={activeError} onRetry={retryLastMessage} onDismiss={() => setErrorState(null)} onOpenProviders={() => flNavigate('settings')} />}
                {showJumpToLatest && <button type="button" className="fl-chat-jump-latest" onClick={() => scrollToLatest()}><span aria-hidden="true">↓</span> Latest</button>}
              </div>
            </div>
          </>
        )}
        <ChatComposer
          input={input}
          onInput={setInput}
          onSend={send}
          sending={sending}
          onStop={stopGenerating}
          pendingImage={pendingImage}
          onPendingImage={setPendingImage}
          listening={listening}
          voiceInputState={voiceInputState}
          onVoiceStart={startDictation}
          onVoiceFinish={finishDictation}
          providerSwitcher={<ChatProviderSwitcher
            provider={selectedProvider}
            availability={providerAvailability}
            localModels={localModels}
            localState={localModelState}
            onSelectProvider={selectChatProvider}
            onSelectModel={selectChatModel}
            onDiscoverLocal={discoverChatOllamaModels}
            onOpenSettings={() => flNavigate('settings')}
          />}
          editing={Boolean(editingMessageId)}
          onCancelEdit={cancelEdit}
        />
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
          <button type="button" onClick={onOpenProviders} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 7, color: C.t2, cursor: 'pointer', fontSize: 12, padding: '5px 9px', fontFamily: 'inherit' }}>Manage providers</button>
          <button type="button" onClick={onDismiss} style={{ background: 'transparent', border: 'none', color: C.t3, cursor: 'pointer', fontSize: 12, padding: '5px 7px', fontFamily: 'inherit' }}>Dismiss</button>
        </div>
      </div>
    </section>
  )
}
