import { getProvider, getProviderModel } from '../../ai/providerRegistry.js'
import { hasExplicitSelfCorrection as hasExplicitSelfCorrectionPhrase } from '../../lib/conversationLanguage.js'
import { classifyChatRequest, getChatIntentGuidance } from './chatRequestIntent.js'
import { LIVE_CALL_MAX_OUTPUT_TOKENS } from './liveCallUtils.js'

// Keep model behavior consistent across cloud and local routes without
// pretending every provider has identical generation controls.
export const CHAT_RESPONSE_OPTIONS = Object.freeze({ maxTokens: 1500, temperature: 0.52 })
export const LIVE_CALL_RESPONSE_OPTIONS = Object.freeze({ maxTokens: LIVE_CALL_MAX_OUTPUT_TOKENS, temperature: 0.4 })

export const CHAT_SYSTEM_PROMPT = `You are FounderLab AI — a sharp, practical assistant built for founders, developers, and creators.

Response style:
- Be concise by default and answer immediately without filler.
- Choose the response shape before drafting: use 1–3 natural sentences for a simple request; use a brief takeaway followed by 3–7 bullets or steps for an actionable, multi-part, or decision-oriented request; use a short summary before longer detail when it materially improves scanability.
- Adapt to the request instead of applying one house style: a quick friendly reply can stay plain; a decision can lead with a recommendation; independent actions can use bullets; ordered work can use steps. Use a single lightweight emoji only when it genuinely adds warmth or scanability in an informal reply, never as decoration or in technical output.
- Lead with the answer, recommendation, or useful next move. For a simple conversational question, do not add a heading or a list just to look structured.
- Make one quiet decision before answering: respond directly when the request is clear, structure the answer only when it makes action easier, and clarify only when the unresolved detail would change the answer in a meaningful way.
- Do not default to a large heading, a wall of text, or a checklist. Structure is useful only when it helps the user act or understand faster.
- Give complete, actionable advice with specific examples when useful.
- Use Markdown thoughtfully: bold for key terms, code formatting for technical terms, and fenced blocks for code.
- Match the requested depth. Do not turn a quick question into an essay.
- Keep a warm, calm, capable tone. Be helpful without performative personality or generic reassurance.

Conversation intelligence:
- Read the conversation as a whole. Treat likely typos, homophones, fragments, and harmless speech-recognition errors as interpretation noise, not a new objective.
- Prefer the user's most recent explicit self-correction (for example “I mean”, “I meant”, “actually”, “to be clear”, or “correction”) when it resolves a local word or phrase. A later correction wins over an earlier local slip; preserve the established goal and surrounding context.
- When a reasonable, harmless interpretation is clear, proceed helpfully. Do not make the user repeat context or get stuck on one questionable word.
- Prefer the most likely benign meaning before asking a question. Do not manufacture uncertainty from a small typo, a homophone, a hesitation, or a single imperfect transcription.
- When a likely intended meaning is clear, silently use it. Do not lead with “did you mean”, explain a harmless typo back to the user, or turn a local wording issue into the subject of the answer.
- A direct follow-up to an earlier assistant question normally resolves that question. Treat a plausible answer or correction as progress and continue the task instead of restarting the same clarification loop.
- Once a plausible correction or answer resolves a local ambiguity, treat it as settled. Do not quote the likely misheard word back, reopen the same ambiguity, or make a benign interpretation error the reason to refuse otherwise helpful guidance.
- When a low-risk assumption keeps the user moving, state it briefly and proceed instead of asking for permission. Before clarifying, check whether the answer is already present in the conversation.
- Ask one short clarifying question only when the unresolved ambiguity would materially change a high-impact, safety-sensitive, or irreversible outcome. When possible, give the useful low-risk part first and then ask that one question. State the best current interpretation once; do not list variants, echo the mistaken word, repeat a clarification the user has resolved, or ask another version of the same question.
- Keep applicable safety boundaries for requests that are clearly unsafe; do not invent unsafe intent from an isolated likely transcription error.`

export const CHAT_HARMLESS_SOCIAL_GUIDANCE = `Harmless social and relationship questions:
- Treat ordinary questions about dating, finding a girlfriend or boyfriend, meeting someone, talking to a person the user likes, confidence, or relationships as normal, helpful conversation.
- Offer respectful, consent-aware, practical guidance without a blanket refusal or an unnecessary safety lecture.
- Apply a safety boundary only when the actual request, not an isolated ambiguous word, requires one.`

export const CHAT_CONTROL_CENTER_PROMPT = `FounderLab workflow guidance:
- When a user asks to build an app, website, feature, or project, first provide a compact execution plan when planning would reduce rework. Infer ordinary product decisions and clarify only a genuinely blocking choice.
- For websites, landing pages, and product concepts, prepare a concrete brief that can continue in Builder. For components, code, debugging, tests, or GitHub preparation, prepare a concrete implementation plan that can continue in Code AI.
- When a user asks to turn work into a task or note, provide the useful result first. FounderLab may offer an explicit action after your response; never claim a task, note, GitHub repository, commit, or deployment was created unless it actually happened.
- When a user asks for YouTube content, create a usable content brief and suggest continuing in YouTube AI when it would help.
- Keep tool handoffs scoped and reversible. Never imply a cloud provider, Local Ollama, Builder, Code AI, or GitHub action was used unless the user selected that action.`

export const LIVE_CALL_SYSTEM_PROMPT = `Live-call response rules:
- You are speaking in a real-time FounderLab voice call, not drafting a text-chat essay.
- Respond naturally in two to four concise sentences and roughly 55–125 spoken words by default. Give a direct answer first, then the most useful reason, example, or next move. Answer the useful part now; do not describe what you would do later instead of doing it in this turn.
- Do not use Markdown, headings, long lists, tables, citations, or code blocks in a live reply. Do not narrate formatting.
- If the user asks for a broad, technical, or multi-step answer, give the useful spoken recommendation, why it matters, and the next one or two steps in this call. Be concise without becoming vague, empty, or overly cautious. Do not defer useful help until after the call, mention a future text answer, or deliver a long written plan aloud.
- Preserve the conversation-intelligence rules above: resolve likely harmless transcription noise from context, respect a later self-correction, and ask one short clarification only when it is genuinely needed.`

export function hasExplicitSelfCorrection(value) {
  return hasExplicitSelfCorrectionPhrase(value)
}

/**
 * Give every provider the same small, explicit response target. This is
 * deliberately guidance, not a rigid response template: the assistant can
 * still respond naturally while avoiding both book-length answers and thin,
 * over-cautious replies.
 */
export function getChatResponseGuidance(value = '', intent = null) {
  const text = typeof value === 'string' ? value.trim() : ''
  const wordCount = text ? text.split(/\s+/).length : 0
  if (intent?.requiresPlan) {
    return 'Use a compact plan: lead with the recommendation or outcome, then give two to four concrete steps and the clearest next action. Infer ordinary low-risk details instead of asking for permission.'
  }
  if (/\b(?:how do i|how can i|steps?|plan|strategy|compare|choose|review|improve|help me|should i)\b/i.test(text)) {
    return 'Give a direct recommendation first, then a short actionable explanation. Use bullets only when they make the next actions easier to scan.'
  }
  if (wordCount > 42 || /[?]$/.test(text)) {
    return 'Answer the core question directly in natural prose. Add only the amount of structure needed to make the answer easier to use.'
  }
  return 'Keep this conversational and complete: answer directly in one to three natural sentences unless a short list clearly helps.'
}

/**
 * Models receive the full conversation, but a short explicit reference cue
 * prevents a common low-quality failure mode: rewriting the previous answer
 * from scratch when the user is asking how to use, refine, or clarify it.
 */
export function getConversationMemoryGuidance(messages = []) {
  const items = Array.isArray(messages) ? messages : []
  const latestUserIndex = items.map((message) => message?.role).lastIndexOf('user')
  if (latestUserIndex < 1) return ''
  const latestUser = typeof items[latestUserIndex]?.content === 'string' ? items[latestUserIndex].content.trim() : ''
  const previousAssistant = items.slice(0, latestUserIndex).reverse().find((message) => message?.role === 'assistant' && typeof message?.content === 'string' && message.content.trim())
  if (!latestUser || !previousAssistant) return ''

  const referencesRecentAnswer = /\b(?:that|this|it|the previous|above)\s+(?:answer|code|plan|example|snippet|implementation|approach)\b|\b(?:use|run|apply|change|improve|explain|summari[sz]e|fix|adapt|review)\s+(?:that|this|it)\b/i.test(latestUser)
  const explicitlyRequestsFullRepeat = /\b(?:repeat|repost|resend|paste|show|print)\b[^.?!]{0,36}\b(?:again|full|entire|complete|all|code|answer)\b|\b(?:full|entire|complete)\s+(?:code|answer|plan)\b/i.test(latestUser)
  if (!referencesRecentAnswer && !explicitlyRequestsFullRepeat) return ''
  return explicitlyRequestsFullRepeat
    ? 'The user explicitly asked to see recent content again. Reproduce the relevant answer or code cleanly, then add only the useful update.'
    : 'The latest request likely refers to the immediately preceding assistant answer. Use that answer as context: briefly orient the user, explain, refine, or apply the relevant part, and avoid rewriting the whole answer unless they clearly ask for it again.'
}

export function getChatRequestContext(messages) {
  const items = Array.isArray(messages) ? messages : []
  const latestUserIndex = items.map((message) => message?.role).lastIndexOf('user')
  if (latestUserIndex < 0) {
    return { latestMessageIsVoice: false, latestMessageHasCorrection: false, followsAssistantQuestion: false, intent: classifyChatRequest(''), responseGuidance: getChatResponseGuidance(''), memoryGuidance: '' }
  }
  const latestUser = items[latestUserIndex]
  const previousAssistant = items.slice(0, latestUserIndex).reverse().find((message) => message?.role === 'assistant')
  const intent = classifyChatRequest(latestUser?.content)
  return {
    latestMessageIsVoice: latestUser?.source === 'voice',
    latestMessageHasCorrection: hasExplicitSelfCorrection(latestUser?.content),
    followsAssistantQuestion: typeof previousAssistant?.content === 'string' && /\?\s*$/.test(previousAssistant.content.trim()),
    intent,
    responseGuidance: getChatResponseGuidance(latestUser?.content, intent),
    memoryGuidance: getConversationMemoryGuidance(items),
  }
}

export function getChatSystemPrompt({ latestMessageIsVoice = false, latestMessageHasCorrection = false, followsAssistantQuestion = false, intent = null, responseGuidance = '', memoryGuidance = '' } = {}) {
  const notes = []
  if (latestMessageIsVoice) {
    notes.push('The latest user message was dictated. Apply the conversation-intelligence rules carefully: use context and the latest self-correction before asking for clarification.')
  }
  if (latestMessageHasCorrection) {
    notes.push('The latest user message contains a self-correction. Prefer its corrected later meaning over the earlier local wording and continue the established task when safe.')
  }
  if (followsAssistantQuestion) {
    notes.push('The latest user turn follows an assistant question. Treat it as the likely answer or correction and continue unless a material ambiguity remains.')
  }
  const intentGuidance = getChatIntentGuidance(intent)
  if (intentGuidance) {
    notes.push(`Current request capability note: ${intentGuidance}`)
  }
  if (responseGuidance) {
    notes.push(`Current response-shape note: ${responseGuidance}`)
  }
  if (memoryGuidance) {
    notes.push(`Current conversation-memory note: ${memoryGuidance}`)
  }
  const prompt = `${CHAT_SYSTEM_PROMPT}\n\n${CHAT_HARMLESS_SOCIAL_GUIDANCE}\n\n${CHAT_CONTROL_CENTER_PROMPT}`
  if (!notes.length) return prompt
  return `${prompt}

Current-input note:
- ${notes.join('\n- ')} This note is not part of the user's request and must not be mentioned unless it helps them.`
}

/** A live call is intentionally voice-first and therefore has stricter output bounds than text Chat. */
export function getLiveCallSystemPrompt(context = {}) {
  return `${getChatSystemPrompt(context)}\n\n${LIVE_CALL_SYSTEM_PROMPT}`
}

export const CHAT_STARTER_PROMPTS = Object.freeze([
  'Help me brainstorm a content strategy for my startup',
  'Review my business idea and give me brutally honest feedback',
  'Write a cold email to potential investors or clients',
  'Break down my biggest goal into actionable daily tasks',
])

export function createConversation({ id, title = 'New chat', now = new Date().toISOString() } = {}) {
  return {
    id,
    title: cleanTitle(title) || 'New chat',
    pinned: false,
    messages: [],
    created_at: now,
    updated_at: now,
  }
}

const CHAT_DESTRUCTIVE_ACTIONS = Object.freeze({
  clear: {
    title: 'Clear this conversation?',
    description: 'Every message in this chat will be removed. This cannot be undone.',
    confirmLabel: 'Clear conversation',
  },
  conversation: {
    title: 'Delete this conversation?',
    description: 'This chat and its saved messages will be removed. This cannot be undone.',
    confirmLabel: 'Delete conversation',
  },
  message: {
    title: 'Delete this message?',
    description: 'This message will be removed from the conversation. This cannot be undone.',
    confirmLabel: 'Delete message',
  },
})

/**
 * Keep destructive-action language consistent wherever Chat offers a real
 * deletion. Deliberately do not introduce a share action here: Chat has no
 * persisted, access-controlled sharing flow yet, so presenting one would be
 * misleading rather than premium.
 */
export function getChatDestructiveActionCopy(action) {
  return CHAT_DESTRUCTIVE_ACTIONS[action] || null
}

export function getChatUserInitials(user) {
  const name = typeof user?.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name
    : typeof user?.email === 'string'
      ? user.email.split('@')[0]
      : ''
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return initials || 'U'
}

function cleanTitle(value) {
  return typeof value === 'string' ? value.trim().slice(0, 96) : ''
}

function cleanMessage(message) {
  if (!message || typeof message !== 'object') return null
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const content = typeof message.content === 'string' ? message.content : ''
  if (!content.trim() && !message.image) return null
  return {
    id: typeof message.id === 'string' && message.id ? message.id : null,
    role: message.role,
    content,
    ...(typeof message.image === 'string' && message.image.startsWith('data:image/') ? { image: message.image } : {}),
    ...(typeof message.provider === 'string' ? { provider: message.provider } : {}),
    ...(typeof message.model === 'string' ? { model: message.model } : {}),
    ...(message.role === 'user' && message.source === 'voice' ? { source: 'voice' } : {}),
    ...(typeof message.ts === 'string' ? { ts: message.ts } : {}),
  }
}

/**
 * Conversation storage is user-controlled browser data. Normalize it at the
 * feature boundary so one malformed legacy entry cannot take down Chat.
 */
export function normalizeConversations(value) {
  if (!Array.isArray(value)) return []
  return value.reduce((items, conversation) => {
    if (!conversation || typeof conversation !== 'object' || typeof conversation.id !== 'string' || !conversation.id) return items
    const messages = Array.isArray(conversation.messages)
      ? conversation.messages.map(cleanMessage).filter(Boolean)
      : []
    items.push({
      id: conversation.id,
      title: cleanTitle(conversation.title) || 'Untitled chat',
      pinned: conversation.pinned === true,
      messages,
      created_at: typeof conversation.created_at === 'string' ? conversation.created_at : '',
      updated_at: typeof conversation.updated_at === 'string' ? conversation.updated_at : conversation.created_at || '',
    })
    return items
  }, [])
}

export function sortConversations(conversations) {
  return [...conversations].sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
  })
}

export function filterConversations(conversations, query = '') {
  const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return sortConversations(conversations).filter((conversation) => {
    if (!normalizedQuery) return true
    return conversation.title.toLowerCase().includes(normalizedQuery)
  })
}

export function groupConversationsByRecency(conversations, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  const groups = new Map([
    ['Pinned', []],
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Earlier', []],
  ])
  filterConversations(conversations).forEach((conversation) => {
    if (conversation.pinned) {
      groups.get('Pinned').push(conversation)
      return
    }
    const updated = new Date(conversation.updated_at || 0)
    const updatedDay = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime()
    const ageInCalendarDays = Math.max(0, Math.floor((startOfToday - updatedDay) / day))
    const group = ageInCalendarDays === 0 ? 'Today' : ageInCalendarDays === 1 ? 'Yesterday' : ageInCalendarDays < 7 ? 'Previous 7 days' : 'Earlier'
    groups.get(group).push(conversation)
  })
  return [...groups.entries()].filter(([, entries]) => entries.length)
}

export function getProviderPresentation(providerId, modelId) {
  const provider = getProvider(providerId)
  const model = provider && !provider.capabilities.dynamicModels
    ? getProviderModel(providerId, modelId)
    : null
  return {
    id: providerId || '',
    name: provider?.name || 'AI provider',
    model: model?.label || modelId || provider?.default || 'Model not selected',
    local: provider?.capabilities.local === true,
    icon: provider?.icon || '✦',
  }
}

export function toChatRequestMessages(messages, providerId) {
  const supportsImages = getProvider(providerId)?.capabilities.imageInput === true
  return messages.map((message) => {
    const content = message.image && !supportsImages
      ? `${message.content || ''}\n[The user attached an image. Explain any visual limitation and respond to their text.]`.trim()
      : message.content
    return {
      role: message.role,
      // Voice interpretation belongs in the system policy, not in the user
      // content. Keeping the original text intact prevents the model from
      // treating a technical annotation as part of the user's request.
      content,
      ...(message.image && supportsImages ? { image: message.image } : {}),
    }
  })
}

/** Maps the normalized internal contract to a calm, user-facing Chat state. */
export function getChatErrorPresentation(error = {}, providerId) {
  const provider = getProviderPresentation(providerId || error.provider, error.model)
  const code = error.code || 'UNKNOWN'
  const generic = {
    title: `${provider.name} could not answer`,
    message: 'Try again in a moment. Your conversation is still here.',
    retryable: error.retryable !== false,
  }
  const presentations = {
    AUTHENTICATION_REQUIRED: {
      title: 'Sign in required',
      message: 'Your session is no longer active. Sign in again, then retry this message.',
      retryable: false,
    },
    AUTHENTICATION_INVALID: {
      title: 'Your session needs attention',
      message: 'Sign in again to continue using AI features.',
      retryable: false,
    },
    AUTHENTICATION_UNAVAILABLE: {
      title: 'We could not verify your session',
      message: 'Try again in a moment. If this continues, sign in again.',
      retryable: true,
    },
    RATE_LIMITED: {
      title: `${provider.name} is busy`,
      message: 'This provider has temporarily reached its request limit. Try again shortly.',
      retryable: true,
    },
    RATE_LIMIT_BACKEND_UNAVAILABLE: {
      title: 'AI request protection is unavailable',
      message: 'Chat is safe to keep using, but new AI requests are temporarily paused for this deployment.',
      retryable: true,
    },
    MISSING_CONFIGURATION: {
      title: `${provider.name} is not configured`,
      message: 'Choose another provider from the AI picker below the composer, then try again.',
      retryable: false,
    },
    OLLAMA_BROWSER_UNSUPPORTED: {
      title: 'Local Ollama needs a Chromium browser',
      message: 'Use Chrome, Edge, Brave, or Arc on desktop for direct local Ollama access. This is a browser limitation, not an Ollama installation problem.',
      retryable: false,
    },
    OLLAMA_BROWSER_ACCESS_DENIED: {
      title: 'Allow local access for FounderLab',
      message: 'Allow local-network access for this site, reload FounderLab, then retry your message.',
      retryable: true,
    },
    OLLAMA_BROWSER_ACCESS_BLOCKED: {
      title: 'Your browser blocked Local Ollama',
      message: 'Open FounderLab in a normal Chromium browser tab, allow local access if prompted, reload, then retry.',
      retryable: true,
    },
    OLLAMA_UNAVAILABLE: {
      title: 'Local Ollama is not reachable',
      message: 'Start Ollama on this Mac, then refresh local models from the AI picker below the composer.',
      retryable: true,
    },
    OLLAMA_MODEL_REQUIRED: {
      title: 'Choose a local model first',
      message: 'Open the AI picker below the composer, refresh Local Ollama, and select one of your installed models.',
      retryable: false,
    },
    OLLAMA_MODEL_UNAVAILABLE: {
      title: 'That local model is unavailable',
      message: 'Refresh your local models from the AI picker and choose an installed model before retrying.',
      retryable: false,
    },
    OLLAMA_TIMEOUT: {
      title: 'Local Ollama took too long',
      message: 'The selected model may be starting up or too large for this device. Wait a moment, then retry.',
      retryable: true,
    },
    CORS_ORIGIN_DENIED: {
      title: 'This deployment is not allowed to call AI',
      message: 'The deployment origin needs approval before this protected feature can run.',
      retryable: false,
    },
    INVALID_MODEL: {
      title: 'The selected model is unavailable',
      message: 'Choose another model from the AI picker below the composer, then retry.',
      retryable: false,
    },
    NETWORK_FAILURE: {
      title: `${provider.name} could not be reached`,
      message: 'Check your connection and try again. Your conversation has not been lost.',
      retryable: true,
    },
    MALFORMED_RESPONSE: {
      title: `${provider.name} sent an incomplete reply`,
      message: 'No partial response was saved. Retry the message to request a fresh answer.',
      retryable: true,
    },
    EMPTY_RESPONSE: {
      title: `${provider.name} returned no answer`,
      message: 'Try the message again. If it repeats, choose another model from the AI picker below the composer.',
      retryable: true,
    },
  }
  return { code, provider, ...(presentations[code] || generic) }
}
