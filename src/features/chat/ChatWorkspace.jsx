import { useEffect, useMemo, useRef, useState } from 'react'
import { C } from '@/app/theme'
import { toast } from '@/app/toast'
import { getVoiceProvider } from '@/ai/voiceProviderRegistry'
import { copyText, flConsumeHandoff, flNavigate, ts, uid } from '@/lib/appUtils'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTextToSpeech } from '@/hooks/useTextToSpeech'
import { getVoiceSpeedLabel } from '@/lib/voicePreferencesUtils'
import { getVoiceConfig, persistVoiceConfig } from '@/services/voicePreferences'
import { getGithubToken } from '@/services/githubTokenSession'
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
import { ChatLiveCallSurface } from './ChatLiveCallSurface'
import { ChatMessage, ChatTypingIndicator } from './ChatMessage'
import { ChatProviderSwitcher } from './ChatProviderSwitcher'
import { getChatUIPreferences, persistChatUIPreferences } from './chatPreferences'
import { getChatProviderPresentation } from './chatProviderUtils'
import { CHAT_MEMORY_KEY, buildWorkspaceAwareness, normalizeChatMemory, reconcileChatMemory } from './chatMemory'
import { useConversationScroll } from './useConversationScroll'
import {
  CHAT_RESPONSE_OPTIONS,
  CHAT_STARTER_PROMPTS,
  LIVE_CALL_RESPONSE_OPTIONS,
  getChatRequestContext,
  getChatSystemPrompt,
  getLiveCallSystemPrompt,
  createConversation,
  getChatErrorPresentation,
  normalizeConversations,
  toChatRequestMessages,
} from './chatUtils'
import { buildChatHandoffPayload, getAssistantControlActions } from './chatControlCenterUtils'
import { createAssistantOrchestration, recordOrchestrationAction } from './chatOrchestrator'
import { buildLiveCallRequestContext, canInterruptLiveCall, createLiveCallRecap, EMPTY_LIVE_CALL, getLiveCallProviderSupport, getLiveCallTurnDelay, shouldQueueLiveCallTurn } from './liveCallUtils'
import { createLiveCallResponsePlan, createReadAloudPlan, createVoiceResponsePlan, normalizeLiveCallResponseText } from './voiceResponseUtils'
import './chatPremium.css'

function uniqueMessageId() {
  return uid()
}

const EMPTY_VOICE_SESSION = Object.freeze({ phase: 'idle', transcript: '', note: '', error: '' })
const ELEVENLABS_VOICE_PROVIDER = getVoiceProvider('elevenlabs')

export function ChatWorkspace({ user }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [pendingImage, setPendingImage] = useState(null)
  const [sending, setSending] = useState(false)
  const [streamingReply, setStreamingReply] = useState(null)
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
  const [playbackNote, setPlaybackNote] = useState('')
  const [voiceSession, setVoiceSession] = useState(EMPTY_VOICE_SESSION)
  const [liveCall, setLiveCall] = useState(EMPTY_LIVE_CALL)
  const [providerAvailability, setProviderAvailability] = useState(getProviderAvailability)
  const [providerSelection, setProviderSelection] = useState(() => {
    const providerId = getAIProvider()
    return { id: providerId, model: getProviderModel(providerId) }
  })
  const [localModels, setLocalModels] = useState([])
  const [localModelState, setLocalModelState] = useState('idle')

  const conversationsRef = useRef([])
  const saveTimerRef = useRef(null)
  const memorySaveTimerRef = useRef(null)
  const chatMemoryRef = useRef(normalizeChatMemory(null).value)
  const workspaceRecordsRef = useRef({ projects: [], tasks: [], notes: [] })
  const workspaceAwarenessRef = useRef(buildWorkspaceAwareness())
  const requestAbortRef = useRef(null)
  const requestSequenceRef = useRef(0)
  const streamingReplyRef = useRef(null)
  const voiceSessionRequestRef = useRef(0)
  const voiceSessionRef = useRef({ active: false, transcript: '' })
  const liveCallRef = useRef({ active: false, muted: false, phase: 'idle', transcript: '', turns: [], providerId: '', modelId: '', turnTimer: null, turn: 0, inFlight: false, monitoringInterrupt: false })

  const {
    clearVoiceDraft,
    prepare: prepareVoiceInput,
    voiceInputState,
    start: startRecognition,
    stop: stopRecognition,
  } = useSpeechRecognition()
  const { speaking, speak, stop: stopTTS, activeProvider: activeVoiceProvider, elAvailable } = useTextToSpeech(voiceConfig)
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null
  const messages = activeConversation?.messages || []
  const { scrollRef: conversationScrollRef, showJumpToLatest, scrollToLatest } = useConversationScroll({
    conversationId: activeId,
    messageCount: messages.length + (streamingReply?.conversationId === activeId ? 1 : 0),
    sending,
  })
  const selectedProvider = useMemo(() => {
    return { ...getChatProviderPresentation(providerSelection.id, providerSelection.model), modelId: providerSelection.model }
  }, [providerSelection])
  const liveCallProvider = useMemo(() => {
    if (liveCall.phase === 'idle' || !liveCall.providerId) return selectedProvider
    return { ...getChatProviderPresentation(liveCall.providerId, liveCall.modelId), modelId: liveCall.modelId }
  }, [liveCall.modelId, liveCall.phase, liveCall.providerId, selectedProvider])
  const activeError = errorState?.conversationId === activeId ? errorState : null
  const voiceSessionLabel = activeVoiceProvider === 'elevenlabs'
    ? `ElevenLabs · ${ELEVENLABS_VOICE_PROVIDER?.voiceLabels[voiceConfig.gender] || 'Premium voice'}`
    : 'Best available browser voice'
  const chatRoutingPreview = useMemo(() => {
    const request = input.trim()
    if (!request) return null
    const draftMessage = {
      role: 'user',
      content: request,
      ...(pendingImage?.base64 ? { image: pendingImage.base64 } : {}),
    }
    return getChatRequestContext([...messages, draftMessage], getPersistentChatContext(activeId, {
      providerId: providerSelection.id,
      modelId: providerSelection.model,
      hasImage: Boolean(pendingImage?.base64),
    })).modelRouting
  }, [activeId, input, localModelState, localModels, messages, pendingImage, providerAvailability, providerSelection])

  useEffect(() => {
    let alive = true
    async function initialise() {
      setLoading(true)
      workspaceStore.logEvent('chat', 'chat')
      const safeLoad = (key, fallback) => load(key, fallback).catch(() => fallback)
      const [storedConversations, storedMemory, projects, tasks, notes] = await Promise.all([
        safeLoad('fl_convos', []),
        safeLoad(CHAT_MEMORY_KEY, null),
        safeLoad('fl_projects', []),
        safeLoad('fl_tasks', []),
        safeLoad('fl_notes', []),
      ])
      if (!alive) return
      const stored = normalizeConversations(storedConversations)
      workspaceRecordsRef.current = {
        projects: Array.isArray(projects) ? projects : [],
        tasks: Array.isArray(tasks) ? tasks : [],
        notes: Array.isArray(notes) ? notes : [],
      }
      workspaceAwarenessRef.current = buildWorkspaceAwareness(workspaceRecordsRef.current)
      let next = stored
      let nextActiveId = ''
      const handoff = flConsumeHandoff('chat')
      if (handoff?.message && typeof handoff.message === 'string') {
        const conversation = createConversation({ id: uid(), title: handoff.message.slice(0, 64), now: ts() })
        next = [conversation, ...stored]
        nextActiveId = conversation.id
        setActiveId(nextActiveId)
        setInput(handoff.message)
        save('fl_convos', next)
        toast('Message ready from Code AI — review it and press Enter to send.', 'success')
      } else if (next[0]?.id) {
        // Returning to the most recently persisted chat should feel like
        // continuity, not a blank reset. New users still receive the calm
        // welcome state because they have no saved conversation yet.
        nextActiveId = next[0].id
        setActiveId(nextActiveId)
      }
      conversationsRef.current = next
      const memory = reconcileChatMemory(normalizeChatMemory(storedMemory).value, next, workspaceAwarenessRef.current, nextActiveId)
      chatMemoryRef.current = memory
      // A repaired or newly derived memory index only contains bounded titles,
      // objectives, and action evidence—not raw conversation content.
      save(CHAT_MEMORY_KEY, memory)
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

  useEffect(() => {
    if (voiceSessionRef.current.active && voiceInputState === 'error') {
      voiceSessionRef.current.active = false
      setVoiceSession((current) => ({
        ...current,
        phase: 'error',
        error: 'Voice capture stopped before FounderLab could finish your message. Your existing chat is unchanged.',
      }))
    }
    if (liveCallRef.current.active && voiceInputState === 'error') {
      // A microphone used only to detect a spoken interruption is optional.
      // If that secondary listener cannot start, keep the spoken reply alive
      // instead of presenting a false call failure.
      if (liveCallRef.current.phase === 'speaking' && liveCallRef.current.monitoringInterrupt) {
        liveCallRef.current.monitoringInterrupt = false
        return
      }
      clearLiveCallTurnTimer()
      liveCallRef.current.phase = 'error'
      setLiveCall((current) => ({
        ...current,
        phase: 'error',
        error: 'Live call listening stopped. Check microphone access, then resume when ready.',
      }))
    }
  }, [voiceInputState])

  function changeHistoryOpen(next) {
    setHistoryOpen(next)
    if (typeof window === 'undefined' || !window.matchMedia('(max-width: 760px)').matches) {
      persistChatUIPreferences({ historyOpen: next })
    }
  }

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current)
    clearTimeout(memorySaveTimerRef.current)
    clearLiveCallTurnTimer()
    liveCallRef.current.active = false
    requestAbortRef.current?.abort()
    streamingReplyRef.current = null
  }, [])

  function synchronizePersistentMemory(next, activeConversationId = activeId) {
    const memory = reconcileChatMemory(chatMemoryRef.current, next, workspaceAwarenessRef.current, activeConversationId)
    chatMemoryRef.current = memory
    clearTimeout(memorySaveTimerRef.current)
    memorySaveTimerRef.current = setTimeout(() => {
      save(CHAT_MEMORY_KEY, memory).catch(() => {
        // Chat conversations remain the source of truth; a failed index write
        // must never interrupt sending or make the assistant invent memory.
      })
    }, 550)
  }

  function updateWorkspaceAwareness(collection, records) {
    workspaceRecordsRef.current = { ...workspaceRecordsRef.current, [collection]: Array.isArray(records) ? records : [] }
    workspaceAwarenessRef.current = buildWorkspaceAwareness(workspaceRecordsRef.current)
    synchronizePersistentMemory(conversationsRef.current)
  }

  function getPersistentChatContext(conversationId, {
    providerId = providerSelection.id,
    modelId = providerSelection.model,
    hasImage = false,
  } = {}) {
    return {
      memory: chatMemoryRef.current,
      workspace: workspaceAwarenessRef.current,
      conversationId,
      routing: {
        availability: providerAvailability,
        currentSelection: { provider: providerId, model: modelId },
        localModels,
        hasImage,
      },
      integrations: {
        github: { connected: Boolean(getGithubToken()) },
      },
    }
  }

  function persist(next, activeConversationId = activeId) {
    conversationsRef.current = next
    setConversations(next)
    synchronizePersistentMemory(next, activeConversationId)
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
    if (liveCallRef.current.active) {
      toast('End the live call before starting another conversation.', 'error')
      return
    }
    const conversation = createConversation({ id: uid(), now: ts() })
    persist([conversation, ...conversationsRef.current], conversation.id)
    setActiveId(conversation.id)
    setInput('')
    setPendingImage(null)
    setEditingMessageId(null)
    setErrorState(null)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) changeHistoryOpen(false)
  }

  function selectConversation(conversationId) {
    if (liveCallRef.current.active) {
      toast('End the live call before switching conversations.', 'error')
      return
    }
    setActiveId(conversationId)
    synchronizePersistentMemory(conversationsRef.current, conversationId)
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

  async function startVoiceSession() {
    if (sending) {
      toast('Wait for the current response or stop it before starting a voice session.', 'error')
      return false
    }
    stopTTS()
    setActiveTTS(null)
    setPlaybackNote('')
    voiceSessionRef.current = { active: true, starting: true, transcript: '', initialInput: input, finishRequested: false, cancelled: false }
    setVoiceSession({ phase: 'starting', transcript: '', note: '', error: '' })
    const started = await startRecognition((nextTranscript) => {
      if (!voiceSessionRef.current.active) return
      voiceSessionRef.current.transcript = nextTranscript
      setVoiceSession((current) => ['starting', 'listening'].includes(current.phase)
        ? { ...current, phase: 'listening' }
        : current)
    })
    if (!started) {
      if (voiceSessionRef.current.cancelled) return false
      voiceSessionRef.current.active = false
      setVoiceSession({ phase: 'error', transcript: '', note: '', error: 'FounderLab could not start voice capture. Check microphone access and try again.' })
      return false
    }
    if (!voiceSessionRef.current.active || voiceSessionRef.current.cancelled) {
      stopRecognition()
      return false
    }
    const finishRequested = voiceSessionRef.current.finishRequested
    voiceSessionRef.current.starting = false
    if (finishRequested) finishVoiceCapture()
    return started
  }

  function finishVoiceCapture() {
    if (voiceSessionRef.current.starting) {
      voiceSessionRef.current.finishRequested = true
      return
    }
    const spokenTranscript = voiceSessionRef.current.transcript.trim()
    const initialInput = typeof voiceSessionRef.current.initialInput === 'string' ? voiceSessionRef.current.initialInput.trim() : ''
    const transcript = [initialInput, spokenTranscript].filter(Boolean).join(initialInput && spokenTranscript ? ' ' : '').trim()
    voiceSessionRef.current = { active: false, transcript, cancelled: false }
    stopRecognition()
    if (!transcript) {
      setVoiceSession({ phase: 'error', transcript: '', note: '', error: 'No words were captured. Try again when you are ready.' })
      return
    }
    setInput(transcript)
    setVoiceSession({ phase: 'ready', transcript, note: '', error: '' })
  }

  function cancelVoiceCapture({ quiet = false } = {}) {
    voiceSessionRef.current = { active: false, transcript: '', cancelled: true }
    stopRecognition()
    clearVoiceDraft()
    setVoiceSession(EMPTY_VOICE_SESSION)
    if (!quiet) toast('Voice capture discarded', 'success')
  }

  /** A completed or stopped voice turn should hand control back to Chat. */
  function resetVoiceSession() {
    voiceSessionRef.current = { active: false, transcript: '', cancelled: false }
    clearVoiceDraft()
    setActiveTTS(null)
    setPlaybackNote('')
    setVoiceSession(EMPTY_VOICE_SESSION)
  }

  function endVoiceSession() {
    const current = voiceSession
    const cancellingRequest = current.phase === 'thinking'
    if (cancellingRequest) {
      voiceSessionRef.current.cancelled = true
      voiceSessionRequestRef.current += 1
      stopGenerating()
    }
    if (current.phase === 'speaking') stopTTS()
    if (current.phase === 'error') setErrorState(null)
    if (current.phase === 'error' && current.transcript && !input.trim()) setInput(current.transcript)
    voiceSessionRef.current = { active: false, transcript: '', cancelled: cancellingRequest }
    stopRecognition()
    clearVoiceDraft()
    setActiveTTS(null)
    setPlaybackNote('')
    setVoiceSession(EMPTY_VOICE_SESSION)
  }

  function editVoiceDraft() {
    if (voiceSession.transcript) setInput(voiceSession.transcript)
    setVoiceSession(EMPTY_VOICE_SESSION)
  }

  function clearLiveCallTurnTimer() {
    if (liveCallRef.current.turnTimer) clearTimeout(liveCallRef.current.turnTimer)
    liveCallRef.current.turnTimer = null
  }

  function setLiveCallPhase(phase, patch = {}) {
    liveCallRef.current.phase = phase
    setLiveCall((current) => ({ ...current, ...patch, phase }))
  }

  function handleLiveCallTranscript(nextTranscript, { isFinal = false } = {}) {
    const call = liveCallRef.current
    if (!call.active || call.muted) return
    const transcript = typeof nextTranscript === 'string' ? nextTranscript.trim() : ''
    if (!transcript) return

    // Keep a small interruption monitor active while FounderLab speaks. The
    // first real utterance stops playback and becomes the next call turn;
    // audio itself never competes with the caller for the visible transcript.
    if (canInterruptLiveCall(call) && call.monitoringInterrupt) {
      clearLiveCallTurnTimer()
      call.monitoringInterrupt = false
      call.inFlight = false
      call.turn += 1
      call.transcript = transcript
      stopTTS()
      setActiveTTS(null)
      setLiveCallPhase('interrupted', { transcript, note: '', error: '' })
      if (isFinal) queueLiveCallTurn(transcript)
      return
    }

    if (!['connecting', 'ready', 'listening', 'interrupted', 'reconnecting'].includes(call.phase)) return
    call.transcript = transcript
    setLiveCallPhase('listening', { transcript, error: '' })
    if (shouldQueueLiveCallTurn({ active: call.active, muted: call.muted, isFinal, transcript })) {
      queueLiveCallTurn(transcript)
    } else if (!isFinal) {
      // New interim speech means the caller is still talking, so do not send a
      // previously finalised fragment halfway through their thought.
      clearLiveCallTurnTimer()
    }
  }

  async function beginLiveCallListening({ connecting = false } = {}) {
    const call = liveCallRef.current
    if (!call.active) return false
    clearLiveCallTurnTimer()
    call.monitoringInterrupt = false
    if (call.muted) {
      setLiveCallPhase('muted', { transcript: '', error: '' })
      return false
    }
    call.transcript = ''
    setLiveCallPhase(connecting ? 'connecting' : 'ready', { transcript: '', note: '', error: '' })
    const started = await startRecognition(handleLiveCallTranscript)
    if (!started) {
      if (call.active) {
        setLiveCallPhase('error', {
          error: 'FounderLab could not start live call listening. Check microphone access and try again.',
        })
      }
      return false
    }
    if (!call.active || call.muted) {
      stopRecognition()
      return false
    }
    setLiveCallPhase('listening', { transcript: '', note: '', error: '' })
    return true
  }

  async function startLiveCall() {
    if (liveCallRef.current.active) return true
    if (sending) {
      toast('Wait for the current response or stop it before starting a live call.', 'error')
      return false
    }
    if (editingMessageId) {
      toast('Finish or cancel the message edit before starting a live call.', 'error')
      return false
    }
    const support = getLiveCallProviderSupport(selectedProvider)
    if (!support.supported) {
      toast(support.label, 'error')
      return false
    }
    if (voiceSession.phase !== 'idle') endVoiceSession()
    stopTTS()
    setActiveTTS(null)
    liveCallRef.current = {
      active: true,
      muted: false,
      phase: 'connecting',
      transcript: '',
      turns: [],
      providerId: providerSelection.id,
      modelId: providerSelection.model,
      turnTimer: null,
      turn: 0,
      inFlight: false,
      monitoringInterrupt: false,
    }
    setErrorState(null)
    setLiveCall({ ...EMPTY_LIVE_CALL, phase: 'connecting', providerId: providerSelection.id, modelId: providerSelection.model })
    return beginLiveCallListening({ connecting: true })
  }

  function queueLiveCallTurn(transcript) {
    clearLiveCallTurnTimer()
    liveCallRef.current.turnTimer = setTimeout(() => {
      liveCallRef.current.turnTimer = null
      sendLiveCallTurn()
    }, getLiveCallTurnDelay(transcript || liveCallRef.current.transcript))
  }

  async function beginLiveCallInterruptionMonitor(turn) {
    const call = liveCallRef.current
    if (!canInterruptLiveCall(call) || call.turn !== turn) return false
    call.monitoringInterrupt = true
    const started = await startRecognition(handleLiveCallTranscript)
    if (!call.active || call.turn !== turn || call.phase !== 'speaking') {
      stopRecognition()
      return false
    }
    // Speech recognition is an enhancement for barge-in. A browser that does
    // not allow the secondary listener must not turn a healthy spoken reply
    // into a failed call.
    call.monitoringInterrupt = started
    return started
  }

  async function sendLiveCallTurn() {
    const call = liveCallRef.current
    const transcript = typeof call.transcript === 'string' ? call.transcript.trim() : ''
    if (!call.active || call.muted || !transcript || call.inFlight) return
    clearLiveCallTurnTimer()
    call.transcript = ''
    call.inFlight = true
    const turn = ++call.turn
    stopRecognition()
    call.monitoringInterrupt = false
    clearVoiceDraft()
    const userTurn = { id: uniqueMessageId(), role: 'user', content: transcript, source: 'voice', ts: ts() }
    call.turns = [...call.turns, userTurn]
    setLiveCallPhase('thinking', { transcript: '', turns: call.turns, note: '', error: '' })
    const baseMessages = conversationsRef.current.find((conversation) => conversation.id === activeId)?.messages || []
    const response = await requestLiveCallReply({
      conversationMessages: baseMessages,
      liveTurns: call.turns,
      providerId: call.providerId,
      modelId: call.modelId,
    })
    if (!call.active || turn !== call.turn) return
    call.inFlight = false

    if (!response?.ok || !response.message) {
      setLiveCallPhase('error', {
        error: response?.cancelled
          ? 'That call turn was stopped. Resume when you are ready.'
          : response?.presentation?.message || 'FounderLab could not complete that call turn. Resume when ready.',
      })
      return
    }

    call.turns = [...call.turns, response.message]
    const plan = createLiveCallResponsePlan(response.message.content)
    if (!plan.spokenText) {
      setLiveCallPhase('listening', { turns: call.turns, transcript: '', note: '', error: '' })
      await beginLiveCallListening()
      return
    }

    setLiveCallPhase('speaking', { transcript: '', turns: call.turns, note: plan.note, error: '' })
    setActiveTTS(response.message.id)
    let playbackFailed = false
    try {
      const playback = speak(plan.spokenText)
      void beginLiveCallInterruptionMonitor(turn)
      await playback
    } catch {
      playbackFailed = true
    } finally {
      if (turn !== call.turn) return
      setActiveTTS((current) => current === response.message.id ? null : current)
    }
    if (!call.active || turn !== call.turn) return
    stopRecognition()
    call.monitoringInterrupt = false
    if (call.muted) {
      setLiveCallPhase('muted', { transcript: '', note: 'Response complete. Unmute when you are ready.', error: '' })
      return
    }
    if (playbackFailed) setLiveCallPhase('ready', { note: 'Voice playback was unavailable for that reply. You can keep talking.', error: '' })
    await beginLiveCallListening()
  }

  function toggleLiveCallMute() {
    const call = liveCallRef.current
    if (!call.active) return
    if (call.muted) {
      call.muted = false
      if (!['thinking', 'speaking'].includes(call.phase)) beginLiveCallListening({ connecting: call.phase === 'error' })
      else setLiveCall((current) => ({ ...current, muted: false }))
      return
    }
    call.muted = true
    call.transcript = ''
    clearLiveCallTurnTimer()
    stopRecognition()
    call.monitoringInterrupt = false
    clearVoiceDraft()
    if (['connecting', 'ready', 'listening', 'interrupted', 'reconnecting'].includes(call.phase)) {
      setLiveCallPhase('muted', { muted: true, transcript: '', note: '', error: '' })
    } else {
      setLiveCall((current) => ({ ...current, muted: true }))
    }
  }

  function cancelLiveCallCapture() {
    const call = liveCallRef.current
    if (!call.active || !['connecting', 'ready', 'listening', 'interrupted', 'reconnecting'].includes(call.phase)) return
    clearLiveCallTurnTimer()
    call.transcript = ''
    stopRecognition()
    clearVoiceDraft()
    setLiveCallPhase('ready', { transcript: '', note: 'Capture cleared. Ready when you are.', error: '' })
    void beginLiveCallListening()
  }

  function stopLiveCallTurn() {
    const call = liveCallRef.current
    if (!call.active) return
    clearLiveCallTurnTimer()
    call.turn += 1
    call.inFlight = false
    call.monitoringInterrupt = false
    if (call.phase === 'thinking') {
      requestAbortRef.current?.abort()
      requestAbortRef.current = null
      requestSequenceRef.current += 1
      setSending(false)
    }
    if (call.phase === 'speaking') {
      stopTTS()
      setActiveTTS(null)
    }
    if (call.muted) {
      setLiveCallPhase('muted', { transcript: '', note: 'Response stopped. Unmute when ready.', error: '' })
      return
    }
    beginLiveCallListening()
  }

  function resumeLiveCall() {
    const call = liveCallRef.current
    if (!call.active) return startLiveCall()
    call.muted = false
    setErrorState(null)
    setLiveCallPhase('reconnecting', { muted: false, error: '' })
    return beginLiveCallListening({ connecting: true })
  }

  function persistLiveCallRecap(call) {
    if (call.recapSaved) return
    const recap = createLiveCallRecap(call.turns)
    if (!recap) return
    call.recapSaved = true
    let conversationId = activeId
    let next = conversationsRef.current
    if (!conversationId) {
      const conversation = createConversation({ id: uid(), title: 'Live call', now: ts() })
      conversationId = conversation.id
      next = [conversation, ...next]
      setActiveId(conversationId)
    }
    const target = next.find((conversation) => conversation.id === conversationId)
    if (!target) return
    const recapMessage = {
      id: uniqueMessageId(),
      role: 'assistant',
      content: recap,
      provider: call.providerId || providerSelection.id,
      model: call.modelId || providerSelection.model,
      ts: ts(),
    }
    next = next.map((conversation) => conversation.id === conversationId
      ? { ...conversation, messages: [...conversation.messages, recapMessage], updated_at: ts() }
      : conversation)
    const active = next.find((conversation) => conversation.id === conversationId)
    persist([active, ...next.filter((conversation) => conversation.id !== conversationId)], conversationId)
  }

  function endLiveCall({ quiet = false, persistCall = true } = {}) {
    const call = liveCallRef.current
    const wasActive = call.active
    if (persistCall) persistLiveCallRecap(call)
    call.active = false
    call.phase = 'ended'
    call.muted = false
    call.inFlight = false
    call.monitoringInterrupt = false
    call.turn += 1
    call.transcript = ''
    clearLiveCallTurnTimer()
    stopRecognition()
    clearVoiceDraft()
    stopTTS()
    setActiveTTS(null)
    if (requestAbortRef.current) {
      requestAbortRef.current.abort()
      requestAbortRef.current = null
      requestSequenceRef.current += 1
      setSending(false)
    }
    setErrorState(null)
    setLiveCall(EMPTY_LIVE_CALL)
    if (wasActive && !quiet) toast('Live call ended', 'success')
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

  function applyChatRouting(recommendation) {
    const providerId = recommendation?.provider
    const modelId = recommendation?.model
    if (!providerId || !modelId || !setProviderModel(providerId, modelId) || !setAIProvider(providerId)) {
      toast('FounderLab could not apply that recommended route. Choose a provider and model directly.', 'error')
      return
    }
    setProviderSelection({ id: providerId, model: modelId })
    setErrorState(null)
    const presentation = getChatProviderPresentation(providerId, modelId)
    toast(`Using ${presentation.name} · ${presentation.model} for this request.`, 'success')
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

    const requestContext = getChatRequestContext(conversationMessages, getPersistentChatContext(conversationId, { providerId, modelId }))
    const orchestration = createAssistantOrchestration(requestContext)
    const transientReply = {
      id: `stream-${requestSequence}`,
      requestSequence,
      conversationId,
      role: 'assistant',
      content: '',
      provider: providerId,
      model: modelId,
      orchestration,
      streaming: true,
    }
    streamingReplyRef.current = transientReply
    setStreamingReply(transientReply)
    const updateStream = (event) => {
      if (requestSequence !== requestSequenceRef.current || controller.signal.aborted) return
      if (event?.type === 'delta' && typeof event.text === 'string' && event.text) {
        const current = streamingReplyRef.current
        if (!current || current.requestSequence !== requestSequence) return
        const next = { ...current, content: current.content + event.text, phase: 'responding' }
        streamingReplyRef.current = next
        setStreamingReply(next)
      }
      if (event?.type === 'started') {
        const current = streamingReplyRef.current
        if (!current || current.requestSequence !== requestSequence) return
        const next = { ...current, provider: event.provider || current.provider, model: event.model || current.model, phase: 'responding' }
        streamingReplyRef.current = next
        setStreamingReply(next)
      }
    }
    const result = await requestAIResult({
      provider: providerId,
      model: modelId,
      messages: toChatRequestMessages(conversationMessages, providerId),
      system: getChatSystemPrompt(requestContext),
      maxTokens: CHAT_RESPONSE_OPTIONS.maxTokens,
      temperature: CHAT_RESPONSE_OPTIONS.temperature,
      localOllamaAllowed: true,
      stream: true,
    }, { signal: controller.signal, onStreamEvent: updateStream })

    if (requestSequence !== requestSequenceRef.current || controller.signal.aborted) {
      if (streamingReplyRef.current?.requestSequence === requestSequence) {
        streamingReplyRef.current = null
        setStreamingReply(null)
      }
      return { ok: false, cancelled: true }
    }
    requestAbortRef.current = null
    setSending(false)
    const receivedText = (typeof result.partialText === 'string' ? result.partialText : streamingReplyRef.current?.content || '').trim()
    streamingReplyRef.current = null
    setStreamingReply(null)

    if (!result.ok) {
      if (receivedText) {
        const interruptedMessage = {
          id: uniqueMessageId(),
          role: 'assistant',
          content: receivedText,
          provider: result.provider || providerId,
          model: result.model || modelId,
          orchestration,
          incomplete: true,
          ts: ts(),
        }
        const latest = conversationsRef.current
        const next = latest.map((conversation) => conversation.id === conversationId
          ? { ...conversation, messages: [...conversation.messages, interruptedMessage], updated_at: ts() }
          : conversation)
        persist(next, conversationId)
      }
      const presentation = {
        conversationId,
        ...getChatErrorPresentation({ ...result.error, provider: result.provider, model: result.model }, providerId),
      }
      setErrorState(presentation)
      return { ok: false, error: result.error, presentation }
    }

    const assistantMessage = {
      id: uniqueMessageId(),
      role: 'assistant',
      content: result.text,
      provider: result.provider || providerId,
      model: result.model || modelId,
      orchestration,
      ts: ts(),
    }
    const latest = conversationsRef.current
    const next = latest.map((conversation) => conversation.id === conversationId
      ? { ...conversation, messages: [...conversation.messages, assistantMessage], updated_at: ts() }
      : conversation)
    persist(next, conversationId)
    return { ok: true, message: assistantMessage }
  }

  /**
   * Live Call deliberately shares the protected provider router but not the
   * normal Chat persistence path. Its turns stay in the call surface until a
   * concise recap is saved when the caller ends the session.
   */
  async function requestLiveCallReply({ conversationMessages, liveTurns, providerId, modelId }) {
    const requestSequence = ++requestSequenceRef.current
    const controller = new AbortController()
    requestAbortRef.current = controller
    setSending(true)
    setErrorState(null)

    const callMessages = buildLiveCallRequestContext(conversationMessages, liveTurns)
    const result = await requestAIResult({
      provider: providerId,
      model: modelId,
      messages: toChatRequestMessages(callMessages, providerId),
      system: getLiveCallSystemPrompt(getChatRequestContext(callMessages, getPersistentChatContext(activeId, { providerId, modelId }))),
      maxTokens: LIVE_CALL_RESPONSE_OPTIONS.maxTokens,
      temperature: LIVE_CALL_RESPONSE_OPTIONS.temperature,
      localOllamaAllowed: true,
    }, { signal: controller.signal })

    if (requestSequence !== requestSequenceRef.current || controller.signal.aborted) return { ok: false, cancelled: true }
    requestAbortRef.current = null
    setSending(false)

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        presentation: getChatErrorPresentation({ ...result.error, provider: result.provider, model: result.model }, providerId),
      }
    }

    return {
      ok: true,
      message: {
        id: uniqueMessageId(),
        role: 'assistant',
        content: normalizeLiveCallResponseText(result.text),
        provider: result.provider || providerId,
        model: result.model || modelId,
        ts: ts(),
      },
    }
  }

  async function send(textOverride, { source: sourceOverride } = {}) {
    const content = typeof textOverride === 'string' ? textOverride.trim() : input.trim()
    const image = pendingImage
    if ((!content && !image) || sending) return

    const providerId = providerSelection.id
    const modelId = providerSelection.model
    if (!providerId) {
      toast('Choose an AI provider below the composer before sending a message.', 'error')
      return
    }
    const source = sourceOverride
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
    persist(next, conversationId)
    return requestAssistantReply({ conversationId, conversationMessages: outgoingMessages, providerId, modelId })
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

  async function sendVoiceSession() {
    const transcript = (voiceSessionRef.current.transcript || voiceSession.transcript || input).trim()
    if (!transcript) {
      setVoiceSession({ phase: 'error', transcript: '', note: '', error: 'There is no captured voice message to send yet.' })
      return
    }
    const voiceRequest = ++voiceSessionRequestRef.current
    voiceSessionRef.current = { active: false, transcript, cancelled: false }
    stopRecognition()
    setVoiceSession({ phase: 'thinking', transcript, note: '', error: '' })
    const response = await send(transcript, { source: 'voice' })
    if (voiceRequest !== voiceSessionRequestRef.current) return
    if (!response?.ok || !response.message) {
      setVoiceSession({
        phase: 'error',
        transcript,
        note: '',
        error: response?.cancelled
          ? 'The voice request was stopped. Your message remains in the conversation.'
          : response?.presentation?.message || 'FounderLab could not complete that voice response. You can retry from the chat.',
      })
      return
    }

    const plan = createVoiceResponsePlan(response.message.content)
    if (!plan.spokenText) {
      resetVoiceSession()
      return
    }

    setVoiceSession({ phase: 'speaking', transcript: '', note: plan.note, error: '', responseId: response.message.id })
    setActiveTTS(response.message.id)
    try {
      await speak(plan.spokenText)
      if (voiceRequest === voiceSessionRequestRef.current) resetVoiceSession()
    } finally {
      setActiveTTS((current) => current === response.message.id ? null : current)
    }
  }

  function stopVoiceSessionActivity() {
    if (voiceSession.phase === 'thinking') {
      voiceSessionRef.current.cancelled = true
      voiceSessionRequestRef.current += 1
      stopGenerating()
      resetVoiceSession()
      return
    }
    if (voiceSession.phase === 'speaking') {
      stopTTS()
      resetVoiceSession()
    }
  }

  function stopGenerating() {
    if (!sending) return
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    requestSequenceRef.current += 1
    streamingReplyRef.current = null
    setStreamingReply(null)
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
    const nextActiveId = activeId === conversationId ? next[0]?.id || '' : activeId
    persist(next, nextActiveId)
    if (activeId === conversationId) setActiveId(nextActiveId || null)
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

  /**
   * Chat records only the action it actually completed. This compact evidence
   * is persisted with the assistant response so a later follow-up can
   * distinguish “opened Builder” from “a Builder project was created”.
   */
  function recordActionEvidence(messageId, action) {
    const conversation = conversationsRef.current.find((entry) => entry.messages?.some((message) => message.id === messageId))
    if (!conversation || !action?.id || !action?.status) return false
    const messagesWithEvidence = conversation.messages.map((entry) => entry.id === messageId
      ? { ...entry, orchestration: recordOrchestrationAction(entry.orchestration, action) }
      : entry)
    updateConversation(conversation.id, { messages: messagesWithEvidence })
    return true
  }

  function saveRename(conversationId) {
    const title = renameValue.trim()
    if (title) updateConversation(conversationId, { title })
    setRenamingId(null)
  }

  async function saveToNotes(message) {
    try {
      const notes = await load('fl_notes', [])
      const note = { id: uid(), title: message.content.slice(0, 50) || 'Chat note', content: message.content, tags: ['from-chat'], created_at: ts(), updated_at: ts() }
      const nextNotes = [note, ...(Array.isArray(notes) ? notes : [])]
      await save('fl_notes', nextNotes)
      updateWorkspaceAwareness('notes', nextNotes)
      recordActionEvidence(message.id, { id: 'save-note', status: 'completed', resource: { type: 'note', id: note.id, title: note.title } })
      toast('Saved to Notes', 'success')
      return true
    } catch {
      toast('FounderLab could not save that note. Your conversation is unchanged.', 'error')
      return false
    }
  }

  async function createTask(message) {
    try {
      const tasks = await load('fl_tasks', [])
      const task = { id: uid(), title: message.content.slice(0, 80), status: 'todo', priority: 'medium', description: message.content, due_date: '', created_at: ts(), updated_at: ts() }
      const nextTasks = [task, ...(Array.isArray(tasks) ? tasks : [])]
      await save('fl_tasks', nextTasks)
      updateWorkspaceAwareness('tasks', nextTasks)
      recordActionEvidence(message.id, { id: 'create-task', status: 'completed', resource: { type: 'task', id: task.id, title: task.title } })
      toast('Task created', 'success')
      return true
    } catch {
      toast('FounderLab could not create that task. Your conversation is unchanged.', 'error')
      return false
    }
  }

  async function continueFromChat(action, message) {
    if (action.id === 'save-note') return saveToNotes(message)
    if (action.id === 'create-task') return createTask(message)
    const payload = buildChatHandoffPayload(action.id, { request: action.request, response: message.content })
    if (!payload || !action.target) return false
    recordActionEvidence(message.id, { id: action.id, status: 'handoff-opened' })
    flNavigate(action.target, payload)
    const destination = action.target === 'builder' ? 'Builder' : action.target === 'code' ? 'Code AI' : 'YouTube AI'
    toast(`Opening ${destination} with this chat brief.`, 'success')
    return true
  }

  function readAloud(message) {
    if (activeTTS === message.id) {
      stopTTS()
      setActiveTTS(null)
      setPlaybackNote('')
      return
    }
    if (['starting', 'listening'].includes(voiceSession.phase)) cancelVoiceCapture({ quiet: true })
    const plan = createReadAloudPlan(message.content)
    if (!plan.spokenText) {
      toast('There is no readable text in this response.', 'error')
      return
    }
    setActiveTTS(message.id)
    setPlaybackNote(plan.note || 'Reading aloud.')
    Promise.resolve(speak(plan.spokenText)).finally(() => {
      setActiveTTS((current) => current === message.id ? null : current)
      setPlaybackNote('')
    })
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
        onRenameStart={(conversation) => {
          if (liveCallRef.current.active) {
            toast('End the live call before changing this conversation.', 'error')
            return
          }
          setRenamingId(conversation.id)
          setRenameValue(conversation.title)
        }}
        onRenameChange={setRenameValue}
        onRenameCommit={saveRename}
        onRenameCancel={() => setRenamingId(null)}
        onTogglePin={(conversationId) => {
          if (liveCallRef.current.active) {
            toast('End the live call before changing this conversation.', 'error')
            return
          }
          togglePin(conversationId)
        }}
        onDelete={(conversationId) => {
          if (liveCallRef.current.active) {
            toast('End the live call before changing this conversation.', 'error')
            return
          }
          requestDeleteConversation(conversationId)
        }}
      />
      <ChatConfirmDialog action={confirmation} onCancel={() => setConfirmation(null)} onConfirm={confirmPendingAction} />

      <main className="fl-chat-main" aria-label="FounderLab Chat">
        <header className="fl-chat-topbar">
          <button type="button" className="fl-chat-history-toggle" onClick={() => changeHistoryOpen(!historyOpen)} aria-label={historyOpen ? 'Hide chat history' : 'Show chat history'} aria-expanded={historyOpen}>☰</button>
          <div className="fl-chat-topbar-title">
            <div>{liveCall.phase === 'idle' ? activeConversation?.title || 'FounderLab Chat' : 'Live call'}</div>
            <div>{liveCall.phase === 'idle'
              ? activeConversation ? `${selectedProvider.local ? 'Local, private AI' : 'Cloud AI'} · ${selectedProvider.name}` : ''
              : 'Your conversation is focused in the live session'}</div>
          </div>
          {liveCall.phase === 'idle' && <button type="button" className="fl-chat-live-call-start" onClick={startLiveCall} aria-label="Start a live voice call"><span aria-hidden="true">◌</span> Live call</button>}
          {liveCall.phase === 'idle' && activeConversation?.messages.length > 0 && <button type="button" className="fl-chat-clear" onClick={requestClearConversation}>Clear</button>}
          {elAvailable === true && <span title="Premium voice is available" className="fl-chat-voice-ready">● Voice</span>}
        </header>

        {activeTTS && speaking && voiceSession.phase === 'idle' && liveCall.phase === 'idle' && (
          <div className="fl-chat-playback-dock" role="status" aria-live="polite">
            <span aria-hidden="true" className="fl-chat-playback-wave">◌</span>
            <span style={{ flex: 1, minWidth: 0 }}>{playbackNote || 'Reading aloud.'} · {activeVoiceProvider === 'elevenlabs' ? 'ElevenLabs voice' : activeVoiceProvider === 'browser' ? 'System voice' : 'Starting playback'} · {getVoiceSpeedLabel(voiceConfig.speed)}</span>
            <button type="button" onClick={() => { stopTTS(); setActiveTTS(null); setPlaybackNote('') }}>Stop</button>
          </div>
        )}

        {liveCall.phase !== 'idle' ? (
          <section className="fl-chat-live-call-stage" aria-label="Live call session">
            <ChatLiveCallSurface
              call={liveCall}
              provider={liveCallProvider}
              voiceLabel={voiceSessionLabel}
              onToggleMute={toggleLiveCallMute}
              onStopTurn={stopLiveCallTurn}
              onCancelCapture={cancelLiveCallCapture}
              onResume={resumeLiveCall}
              onEnd={endLiveCall}
            />
          </section>
        ) : !activeId ? (
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
                {messages.map((message, index) => <ChatMessage key={message.id} message={message} user={user} sending={sending} activeTTS={activeTTS} onCopy={copyText} onEdit={beginEdit} onDelete={requestDeleteMessage} onRegenerate={regenerate} onSaveToNotes={saveToNotes} onCreateTask={createTask} onReact={() => {}} onReadAloud={readAloud} onPreviewVoice={() => readAloud({ id: 'voice-preview', content: 'This is a quick FounderLab voice preview.' })} voiceCfg={voiceConfig} onVoiceChange={changeVoiceConfig} elevenLabsAvailable={elAvailable} controlActions={getAssistantControlActions(messages, index)} onControlAction={continueFromChat} />)}
                {streamingReply?.conversationId === activeId && voiceSession.phase === 'idle' && liveCall.phase === 'idle' && <ChatMessage key={streamingReply.id} message={streamingReply} user={user} sending={sending} activeTTS={activeTTS} streaming onStopStreaming={stopGenerating} />}
                {sending && voiceSession.phase === 'idle' && liveCall.phase === 'idle' && !streamingReply && <ChatTypingIndicator provider={selectedProvider} onStop={stopGenerating} />}
                {activeError && voiceSession.phase === 'idle' && liveCall.phase === 'idle' && <ChatErrorBanner error={activeError} onRetry={retryLastMessage} onDismiss={() => setErrorState(null)} onOpenProviders={() => flNavigate('settings')} />}
                {showJumpToLatest && <button type="button" className="fl-chat-jump-latest" onClick={() => scrollToLatest()}><span aria-hidden="true">↓</span> Latest</button>}
              </div>
            </div>
          </>
        )}
        {liveCall.phase === 'idle' && (
          <ChatComposer
            input={input}
            onInput={setInput}
            onSend={send}
            sending={sending}
            onStop={stopGenerating}
            pendingImage={pendingImage}
            onPendingImage={setPendingImage}
            voiceSession={voiceSession}
            voiceSessionActions={{
              provider: selectedProvider,
              voiceLabel: voiceSessionLabel,
              onFinish: finishVoiceCapture,
              onCancel: cancelVoiceCapture,
              onSend: sendVoiceSession,
              onStop: stopVoiceSessionActivity,
              onEnd: endVoiceSession,
              onStartAgain: startVoiceSession,
              onEditDraft: editVoiceDraft,
            }}
            onVoiceStart={startVoiceSession}
            onVoicePrepare={prepareVoiceInput}
            onVoiceFinish={finishVoiceCapture}
            providerSwitcher={<ChatProviderSwitcher
              provider={selectedProvider}
              availability={providerAvailability}
              localModels={localModels}
              localState={localModelState}
              routing={chatRoutingPreview}
              onSelectProvider={selectChatProvider}
              onSelectModel={selectChatModel}
              onApplyRouting={applyChatRouting}
              onDiscoverLocal={discoverChatOllamaModels}
              onOpenSettings={() => flNavigate('settings')}
            />}
            editing={Boolean(editingMessageId)}
            onCancelEdit={cancelEdit}
          />
        )}
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
