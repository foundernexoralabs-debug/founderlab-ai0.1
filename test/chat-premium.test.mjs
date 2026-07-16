import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { routeAIRequest } from '../src/ai/providerRouter.js'
import { getChatUIPreferences, persistChatUIPreferences } from '../src/features/chat/chatPreferences.js'
import {
  getChatModelOptions,
  getChatProviderOptions,
  getChatProviderPresentation,
} from '../src/features/chat/chatProviderUtils.js'
import {
  CONVERSATION_BOTTOM_THRESHOLD,
  distanceToConversationBottom,
  isNearConversationBottom,
} from '../src/features/chat/useConversationScroll.js'
import { getVoiceSpeedLabel, normalizeVoiceConfig, VOICE_SPEED_OPTIONS } from '../src/lib/voicePreferencesUtils.js'
import { cleanTextForSpeech } from '../src/lib/speechTextUtils.js'
import { createVoiceResponsePlan } from '../src/features/chat/voiceResponseUtils.js'
import {
  applyFinalSpeechPhrase,
  appendVoiceTranscript,
  commitInterimTranscript,
  mergeLiveTranscript,
  shouldResumeVoiceInput,
  VOICE_INPUT_RESTART_DELAY_MS,
  voiceInputStatusCopy,
} from '../src/hooks/speechRecognitionUtils.js'
import {
  CHAT_SYSTEM_PROMPT,
  CHAT_STARTER_PROMPTS,
  createConversation,
  filterConversations,
  getChatDestructiveActionCopy,
  getChatErrorPresentation,
  getChatRequestContext,
  getChatSystemPrompt,
  hasExplicitSelfCorrection,
  getChatUserInitials,
  getProviderPresentation,
  groupConversationsByRecency,
  normalizeConversations,
  toChatRequestMessages,
} from '../src/features/chat/chatUtils.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('Chat safely normalizes persisted conversation history and preserves valid message attribution', () => {
  const conversations = normalizeConversations([
    null,
    { id: '', title: 'invalid' },
    {
      id: 'one',
      title: '  Fundraising plan  ',
      pinned: true,
      created_at: '2026-07-16T08:00:00.000Z',
      updated_at: '2026-07-16T08:30:00.000Z',
      messages: [
        { id: 'user-1', role: 'user', content: 'Build a plan', source: 'voice', ts: '2026-07-16T08:00:00.000Z' },
        { id: 'assistant-1', role: 'assistant', content: 'Here is a plan', provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M' },
        { id: 'bad', role: 'system', content: 'ignore this' },
      ],
    },
  ])
  assert.equal(conversations.length, 1)
  assert.equal(conversations[0].title, 'Fundraising plan')
  assert.equal(conversations[0].messages.length, 2)
  assert.equal(conversations[0].messages[0].source, 'voice')
  assert.equal(conversations[0].messages[1].provider, 'ollama')
  assert.equal(conversations[0].messages[1].model, 'llama3.2:3b-instruct-q4_K_M')
  assert.deepEqual(createConversation({ id: 'fresh', title: '  New launch  ', now: '2026-07-16T09:00:00.000Z' }), {
    id: 'fresh', title: 'New launch', pinned: false, messages: [], created_at: '2026-07-16T09:00:00.000Z', updated_at: '2026-07-16T09:00:00.000Z',
  })
})

test('Chat history supports search, active groups, and pinned conversations without obscuring recency', () => {
  const now = new Date('2026-07-16T12:00:00.000Z')
  const conversations = [
    { id: 'pin', title: 'Pinned strategy', pinned: true, updated_at: '2026-06-01T00:00:00.000Z', messages: [] },
    { id: 'today', title: 'Launch checklist', pinned: false, updated_at: '2026-07-16T09:00:00.000Z', messages: [] },
    { id: 'yesterday', title: 'Investor update', pinned: false, updated_at: '2026-07-15T11:00:00.000Z', messages: [] },
  ]
  assert.deepEqual(filterConversations(conversations, 'launch').map((conversation) => conversation.id), ['today'])
  assert.deepEqual(groupConversationsByRecency(conversations, now).map(([label, entries]) => [label, entries.map((conversation) => conversation.id)]), [
    ['Pinned', ['pin']], ['Today', ['today']], ['Yesterday', ['yesterday']],
  ])
})

test('Chat gives real destructive actions consistent in-product confirmation copy and keeps user identity tidy', () => {
  assert.deepEqual(getChatDestructiveActionCopy('conversation'), {
    title: 'Delete this conversation?',
    description: 'This chat and its saved messages will be removed. This cannot be undone.',
    confirmLabel: 'Delete conversation',
  })
  assert.equal(getChatDestructiveActionCopy('share'), null)
  assert.equal(getChatUserInitials({ user_metadata: { full_name: 'Ada Lovelace' }, email: 'ignored@example.com' }), 'AL')
  assert.equal(getChatUserInitials({ email: 'founder.one@example.com' }), 'FO')
  assert.equal(getChatUserInitials({}), 'U')
})

test('Chat labels the active local or cloud model clearly and keeps provider-specific message attribution', () => {
  assert.deepEqual(getProviderPresentation('ollama', 'llama3.2:3b-instruct-q4_K_M'), {
    id: 'ollama', name: 'Local Ollama', model: 'llama3.2:3b-instruct-q4_K_M', local: true, icon: '🦙',
  })
  const groq = getProviderPresentation('groq', 'openai/gpt-oss-120b')
  assert.equal(groq.local, false)
  assert.equal(groq.name, 'Groq')
  assert.match(groq.model, /GPT-OSS 120B/)
  assert.equal(CHAT_STARTER_PROMPTS.length >= 4, true)
})

test('Chat provider picker exposes configured cloud providers, Local Ollama, and only user-selectable models', () => {
  const providers = getChatProviderOptions({
    anthropic: { configured: false },
    groq: { configured: true },
    gemini: { configured: true },
    ollama: { configured: true, local: true },
  })
  assert.deepEqual(providers.map((provider) => provider.id), ['groq', 'gemini', 'ollama'])
  assert.equal(providers.find((provider) => provider.id === 'ollama').local, true)
  assert.equal(getChatModelOptions('groq').some((model) => model.id === 'llama-3.3-70b-versatile'), false)
  assert.deepEqual(getChatModelOptions('ollama', {
    localModels: [{ id: 'llama3.2:3b-instruct-q4_K_M', family: 'llama', parameterSize: '3.2B' }],
    selectedModel: 'llama3.2:3b-instruct-q4_K_M',
  }).map((model) => model.id), ['llama3.2:3b-instruct-q4_K_M'])
  assert.deepEqual(getChatProviderPresentation('gemini', 'gemini-3.5-flash'), {
    id: 'gemini', name: 'Google Gemini', model: 'Gemini 3.5 Flash (recommended)', local: false, icon: '✶',
  })
})

test('Chat reading flow only follows new content near the bottom and calculates a stable return-to-latest threshold', () => {
  assert.equal(distanceToConversationBottom({ scrollTop: 200, clientHeight: 500, scrollHeight: 1000 }), 300)
  assert.equal(distanceToConversationBottom({ scrollTop: 700, clientHeight: 500, scrollHeight: 1000 }), 0)
  assert.equal(isNearConversationBottom({ scrollTop: 405, clientHeight: 500, scrollHeight: 1000 }), true)
  assert.equal(isNearConversationBottom({ scrollTop: 350, clientHeight: 500, scrollHeight: 1000 }), false)
  assert.equal(CONVERSATION_BOTTOM_THRESHOLD, 96)
})

test('Chat keeps image input on capable providers and gives local/cloud text models an honest image limitation', () => {
  const messages = [{ role: 'user', content: 'Review this screenshot', image: 'data:image/png;base64,abc' }]
  const anthropic = toChatRequestMessages(messages, 'anthropic')
  assert.equal(anthropic[0].image, 'data:image/png;base64,abc')
  const groq = toChatRequestMessages(messages, 'groq')
  assert.equal(groq[0].image, undefined)
  assert.match(groq[0].content, /attached an image/i)
  const ollama = toChatRequestMessages(messages, 'ollama')
  assert.match(ollama[0].content, /visual limitation/i)
})

test('Voice requests use one contextual interpretation policy without polluting user message content', () => {
  const messages = toChatRequestMessages([{ role: 'user', source: 'voice', content: 'Please draft the next campaign message.' }], 'groq')
  assert.equal(messages[0].content, 'Please draft the next campaign message.')
  const voicePrompt = getChatSystemPrompt({ latestMessageIsVoice: true })
  assert.match(voicePrompt, /Current-input note/i)
  assert.match(voicePrompt, /most recent explicit self-correction/i)
  assert.match(voicePrompt, /Ask one short clarifying question/i)
  assert.match(CHAT_SYSTEM_PROMPT, /homophone/i)
  assert.match(CHAT_SYSTEM_PROMPT, /Choose the response shape/i)
  assert.match(CHAT_SYSTEM_PROMPT, /clearly unsafe/i)
  assert.equal(getChatSystemPrompt(), CHAT_SYSTEM_PROMPT)
  assert.deepEqual(getChatRequestContext([
    { role: 'assistant', content: 'Which launch are you referring to?' },
    { role: 'user', source: 'voice', content: 'The investor launch.' },
  ]), { latestMessageIsVoice: true, latestMessageHasCorrection: false, followsAssistantQuestion: true })
  assert.equal(hasExplicitSelfCorrection('Actually, I meant the investor launch.'), true)
  assert.equal(hasExplicitSelfCorrection('Please draft the investor launch.'), false)
  const correctionContext = getChatRequestContext([
    { role: 'assistant', content: 'Which launch are you referring to?' },
    { role: 'user', source: 'voice', content: 'Sorry, I meant the investor launch.' },
  ])
  assert.equal(correctionContext.latestMessageHasCorrection, true)
  assert.match(getChatSystemPrompt(correctionContext), /contains a self-correction/i)
  assert.match(getChatSystemPrompt(getChatRequestContext([
    { role: 'assistant', content: 'Which launch are you referring to?' },
    { role: 'user', content: 'The investor launch.' },
  ])), /likely answer or correction/i)
})

test('Chat turns normalized provider errors into scoped, recoverable UI states without raw details', () => {
  const unsupported = getChatErrorPresentation({ code: 'OLLAMA_BROWSER_UNSUPPORTED', retryable: false }, 'ollama')
  assert.match(unsupported.title, /Chromium/i)
  assert.match(unsupported.message, /browser limitation/i)
  assert.equal(unsupported.retryable, false)

  const rateLimit = getChatErrorPresentation({ code: 'RATE_LIMITED', retryable: true }, 'groq')
  assert.match(rateLimit.title, /Groq is busy/)
  assert.equal(rateLimit.retryable, true)

  const malformed = getChatErrorPresentation({ code: 'MALFORMED_RESPONSE', message: 'raw upstream token=secret' }, 'gemini')
  assert.equal(malformed.message.includes('secret'), false)
  assert.match(malformed.message, /partial response was saved/i)
})

test('Chat cancellation signal reaches the normalized protected cloud request path', async () => {
  const controller = new AbortController()
  const result = await routeAIRequest({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'Give me a concise launch plan.' }],
  }, {
    accessToken: 'active-session-token',
    signal: controller.signal,
    fetchImpl: async (_url, options) => {
      assert.equal(options.signal, controller.signal)
      assert.equal(options.headers.Authorization, 'Bearer active-session-token')
      return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'groq', model: 'openai/gpt-oss-120b', text: 'Plan' }) }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, 'Plan')
})

test('Voice input preserves a draft across brief pauses and only stops for explicit or meaningful failures', () => {
  assert.equal(appendVoiceTranscript('A typed opening', 'and a dictated follow-up'), 'A typed opening and a dictated follow-up')
  assert.equal(appendVoiceTranscript('First sentence.', 'Second sentence'), 'First sentence. Second sentence')
  assert.equal(commitInterimTranscript('Keep the opening', 'and preserve this final phrase'), 'Keep the opening and preserve this final phrase')
  assert.deepEqual(
    applyFinalSpeechPhrase(['Typed opening', 'Draft the launch email'], 'Sorry, I meant draft the investor update', 1),
    ['Typed opening', 'draft the investor update'],
  )
  assert.deepEqual(
    applyFinalSpeechPhrase(['Typed opening'], 'I mean add a clearer CTA', 1),
    ['Typed opening', 'add a clearer CTA'],
  )
  assert.deepEqual(
    applyFinalSpeechPhrase(['Typed opening', 'Draft an announcement'], 'Actually, draft an investor update', 1),
    ['Typed opening', 'draft an investor update'],
  )
  assert.deepEqual(
    applyFinalSpeechPhrase(['Typed opening', 'Draft the launch'], 'Draft the launch email for investors', 1),
    ['Typed opening', 'Draft the launch email for investors'],
  )
  assert.equal(mergeLiveTranscript('Launch plan', 'Launch plan', 'Launch plan with a stronger CTA'), 'Launch plan with a stronger CTA')
  assert.equal(mergeLiveTranscript('Launch plan please', 'Launch plan', 'Launch plan with a stronger CTA'), 'Launch plan with a stronger CTA please')
  assert.equal(mergeLiveTranscript('Manual revision', 'Launch plan', 'Launch plan with a stronger CTA'), 'Manual revision with a stronger CTA')
  assert.equal(shouldResumeVoiceInput({ desired: true, error: 'no-speech' }), true)
  assert.equal(shouldResumeVoiceInput({ desired: true, error: '' }), true)
  assert.equal(shouldResumeVoiceInput({ desired: false, error: 'no-speech' }), false)
  assert.equal(shouldResumeVoiceInput({ desired: true, error: 'not-allowed' }), false)
  assert.equal(VOICE_INPUT_RESTART_DELAY_MS >= 150 && VOICE_INPUT_RESTART_DELAY_MS <= 350, true)
  assert.match(voiceInputStatusCopy('listening'), /pause naturally/i)
  assert.match(voiceInputStatusCopy('resuming'), /keeping your place/i)
})

test('Voice sessions keep short answers conversational while preserving dense details and code in Chat', () => {
  const short = createVoiceResponsePlan('Your investor update is ready. I tightened the opening and added a clear next step.')
  assert.equal(short.mode, 'conversational')
  assert.match(short.spokenText, /investor update/i)

  const inlineCommand = createVoiceResponsePlan('Run `npm test` before you deploy.')
  assert.equal(inlineCommand.mode, 'conversational')
  assert.match(inlineCommand.spokenText, /npm test/i)

  const code = createVoiceResponsePlan('## API update\n\nHere is the implementation:\n```js\nconst secret = process.env.KEY\n```\n\nUse the endpoint after deployment.')
  assert.equal(code.mode, 'code-summary')
  assert.equal(code.spokenText.includes('process.env'), false)
  assert.match(code.spokenText, /full code and details in the chat/i)
  assert.match(code.note, /full code remains/i)

  const long = createVoiceResponsePlan('A practical plan starts with a clear customer promise. '.repeat(30))
  assert.equal(long.mode, 'summary')
  assert.equal(long.spokenText.length <= 660, true)
  assert.match(long.spokenText, /full breakdown in the chat/i)

  const structured = createVoiceResponsePlan('## Launch plan\n\n- Clarify the customer promise\n- Test the onboarding flow\n- Measure conversion before scaling\n\n[Research](https://example.com/research)')
  assert.equal(structured.mode, 'structured-summary')
  assert.match(structured.spokenText, /Here’s the short version/i)
  assert.match(structured.spokenText, /First, clarify the customer promise/i)
  assert.equal(structured.spokenText.includes('https://'), false)
  assert.match(structured.spokenText, /full breakdown in the chat/i)
})

test('Voice narration removes presentation artifacts, links, emojis, and code while retaining natural meaning', () => {
  const narration = cleanTextForSpeech('## Launch update!!! 🚀\nUse `npm test` / `npm run build`; see [the guide](https://example.com/docs).\n```js\nconsole.log("internal")\n```')
  assert.equal(narration.includes('🚀'), false)
  assert.equal(narration.includes('https://'), false)
  assert.equal(narration.includes('console.log'), false)
  assert.equal(narration.includes('/'), false)
  assert.match(narration, /npm test or npm run build/i)
  assert.match(narration, /detailed code is available in the chat/i)

  const structuredNarration = cleanTextForSpeech('> **Next steps**\n1. Confirm the plan\n2. Send the update\n| Owner | Status |\n| --- | --- |\n[^1]')
  assert.equal(structuredNarration.includes('Owner'), false)
  assert.equal(structuredNarration.includes('[^1]'), false)
  assert.match(structuredNarration, /Confirm the plan\. Send the update/i)
})

test('Chat UI preferences preserve the desktop history choice without accepting malformed saved values', () => {
  const storage = new Map()
  const browserStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) }
  assert.deepEqual(getChatUIPreferences(browserStorage), { historyOpen: true })
  assert.equal(persistChatUIPreferences({ historyOpen: false }, browserStorage), true)
  assert.deepEqual(getChatUIPreferences(browserStorage), { historyOpen: false })
  storage.set('fl_chat_ui_preferences', '{bad json')
  assert.deepEqual(getChatUIPreferences(browserStorage), { historyOpen: true })
})

test('Voice preferences persist only safe, predictable playback choices', () => {
  assert.deepEqual(normalizeVoiceConfig({ provider: 'elevenlabs', gender: 'female', speed: 130 }), {
    provider: 'elevenlabs', gender: 'female', speed: 150,
  })
  assert.deepEqual(normalizeVoiceConfig({ provider: 'browser', gender: 'male', speed: 0 }), {
    provider: 'browser', gender: 'male', speed: 0,
  })
  assert.deepEqual(normalizeVoiceConfig({ provider: 'unknown', gender: 'other', speed: 999 }), {
    provider: 'elevenlabs', gender: 'male', speed: 150,
  })
  assert.deepEqual(normalizeVoiceConfig(null), { provider: 'elevenlabs', gender: 'male', speed: 0 })
  assert.deepEqual(VOICE_SPEED_OPTIONS.map((option) => option.label), ['0.5×', '1×', '1.5×', '2×', '2.5×'])
  assert.equal(getVoiceSpeedLabel(100), '2×')
})

test('Chat feature modules preserve local routing, cancellable requests, and responsive history behavior', () => {
  const workspaceSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatWorkspace.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/chatPremium.css'), 'utf8')
  const composerSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatComposer.jsx'), 'utf8')
  const providerSwitcherSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatProviderSwitcher.jsx'), 'utf8')
  const providerUtilsSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/chatProviderUtils.js'), 'utf8')
  const scrollSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/useConversationScroll.js'), 'utf8')
  const messageSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatMessage.jsx'), 'utf8')
  const confirmationSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatConfirmDialog.jsx'), 'utf8')
  const voiceSessionSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatVoiceSession.jsx'), 'utf8')
  const voiceResponseSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/voiceResponseUtils.js'), 'utf8')
  const speechTextSource = fs.readFileSync(path.join(repositoryRoot, 'src/lib/speechTextUtils.js'), 'utf8')
  const recognitionSource = fs.readFileSync(path.join(repositoryRoot, 'src/hooks/useSpeechRecognition.js'), 'utf8')
  const speechSource = fs.readFileSync(path.join(repositoryRoot, 'src/services/speechService.ts'), 'utf8')
  assert.match(workspaceSource, /localOllamaAllowed: true/)
  assert.match(workspaceSource, /signal: controller\.signal/)
  assert.match(workspaceSource, /useConversationScroll/)
  assert.match(workspaceSource, /ChatProviderSwitcher/)
  assert.match(workspaceSource, /refreshProviderAvailability/)
  assert.doesNotMatch(workspaceSource, /scrollIntoView/)
  assert.match(workspaceSource, /getChatErrorPresentation/)
  assert.match(workspaceSource, /ChatHistory/)
  assert.match(workspaceSource, /ChatConfirmDialog/)
  assert.match(workspaceSource, /createVoiceResponsePlan/)
  assert.match(workspaceSource, /getChatRequestContext/)
  assert.match(workspaceSource, /getChatSystemPrompt/)
  assert.match(workspaceSource, /finishRequested/)
  assert.match(workspaceSource, /voiceSession\.phase === 'idle'/)
  assert.match(workspaceSource, /sending && voiceSession\.phase === 'idle'/)
  assert.match(workspaceSource, /activeError && voiceSession\.phase === 'idle'/)
  assert.doesNotMatch(workspaceSource, /<ChatVoiceSession/)
  assert.doesNotMatch(workspaceSource, /window\.confirm/)
  assert.match(workspaceSource, /ChatMessage/)
  assert.match(composerSource, /Enter to send/)
  assert.match(composerSource, /Shift\+Enter/)
  assert.match(composerSource, /Start a live voice session/)
  assert.match(composerSource, /ChatVoiceSession/)
  assert.match(composerSource, /Upload an image/)
  assert.match(composerSource, /paste an image directly/i)
  assert.match(composerSource, /voiceSessionActive && <ChatVoiceSession/)
  assert.doesNotMatch(composerSource, /Live dictation is flowing/i)
  assert.match(composerSource, /HOLD_TO_DICTATE_DELAY_MS/)
  assert.match(composerSource, /onPointerDown/)
  assert.match(composerSource, /role="menu"/)
  assert.match(composerSource, /providerSwitcher/)
  assert.match(providerSwitcherSource, /Choose your AI/)
  assert.match(providerSwitcherSource, /Refresh local models/)
  assert.match(providerUtilsSource, /internalOnly/)
  assert.match(scrollSource, /showJumpToLatest/)
  assert.match(scrollSource, /CONVERSATION_BOTTOM_THRESHOLD/)
  assert.match(scrollSource, /startedSending/)
  assert.match(messageSource, /document\.addEventListener\('pointerdown'/)
  assert.match(messageSource, /event\.key === 'Escape'/)
  assert.match(messageSource, /VOICE_SPEED_OPTIONS/)
  assert.match(messageSource, /Best available browser voice/)
  assert.match(messageSource, /getChatUserInitials/)
  assert.match(voiceSessionSource, /fl-chat-voice-dock/)
  assert.match(voiceSessionSource, /Cancel/)
  assert.match(voiceSessionSource, /Review/)
  assert.match(voiceSessionSource, /Stop/)
  assert.match(voiceSessionSource, /End/)
  assert.match(voiceResponseSource, /full code and details in the chat/i)
  assert.match(voiceResponseSource, /cleanTextForSpeech/)
  assert.match(speechTextSource, /detailed code is available in the chat/i)
  assert.match(confirmationSource, /role="alertdialog"/)
  assert.match(confirmationSource, /aria-modal="true"/)
  assert.match(workspaceSource, /fl-chat-playback-dock/)
  assert.match(css, /fl-chat-message\.is-user/)
  assert.match(css, /justify-content: flex-end/)
  assert.match(css, /fl-chat-message-card/)
  assert.match(recognitionSource, /recognition\.continuous = true/)
  assert.match(recognitionSource, /applyFinalSpeechPhrase/)
  assert.match(recognitionSource, /sessionRef\.current \+= 1/)
  assert.match(recognitionSource, /VOICE_INPUT_RESTART_DELAY_MS/)
  assert.match(recognitionSource, /lastPublishedTranscriptRef/)
  assert.match(speechSource, /let activeAudio/)
  assert.match(speechSource, /releaseActiveAudio\(\)\?\.\(false\)/)
  assert.match(speechSource, /let playbackGeneration = 0/)
  assert.match(speechSource, /generation !== playbackGeneration/)
  assert.match(css, /height: 100dvh/)
  assert.match(css, /scrollbar-gutter: stable/)
  assert.match(css, /fl-chat-voice-popover/)
  assert.match(css, /fl-chat-confirm-dialog/)
  assert.match(css, /fl-chat-composer-image-action/)
  assert.match(css, /fl-chat-voice-dock/)
  assert.doesNotMatch(css, /fl-chat-voice-session/)
  assert.doesNotMatch(css, /fl-chat-dictation-status/)
  assert.match(css, /flChatVoiceListen/)
  assert.match(css, /fl-chat-avatar\.is-user/)
  assert.match(css, /fl-chat-composer-action-menu/)
  assert.match(css, /fl-chat-provider-menu/)
  assert.match(css, /fl-chat-jump-latest/)
  assert.match(css, /fl-chat-history-item\.is-active/)
  assert.match(css, /flChatSpeakingGlow/)
  assert.match(css, /margin-left: auto/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /fl-chat-history\.is-closed/)
})
