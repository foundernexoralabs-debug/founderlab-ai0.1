import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { routeAIRequest } from '../src/ai/providerRouter.js'
import { getCodeGenerationReadiness, getLocalModelCapabilities } from '../src/ai/localModelCapabilities.js'
import { normalizeOllamaModels } from '../src/ai/providers/ollama.js'
import { requestCodeGenerationAI } from '../src/services/aiProviderService.js'
import { getChatUIPreferences, persistChatUIPreferences } from '../src/features/chat/chatPreferences.js'
import {
  getChatModelOptions,
  getChatProviderOptions,
  getChatProviderPresentation,
} from '../src/features/chat/chatProviderUtils.js'
import {
  getChatModelRouting,
  getChatRoutingEvidence,
} from '../src/features/chat/chatModelRouting.js'
import {
  CONVERSATION_BOTTOM_THRESHOLD,
  distanceToConversationBottom,
  isNearConversationBottom,
} from '../src/features/chat/useConversationScroll.js'
import { getVoiceSpeedLabel, normalizeVoiceConfig, VOICE_SPEED_OPTIONS } from '../src/lib/voicePreferencesUtils.js'
import {
  cleanTextForSpeech,
  MAX_SPEECH_PLAYBACK_CHUNK_LENGTH,
  splitSpeechForPlayback,
} from '../src/lib/speechTextUtils.js'
import { copyTextToClipboard } from '../src/components/content/messageContentUtils.js'
import {
  getExplicitSelfCorrection,
  isLikelyRestartExtension,
  isLikelySingleWordRevision,
  normalizeFinalSpokenPhrase,
} from '../src/lib/conversationLanguage.js'
import {
  createLiveCallResponsePlan,
  createReadAloudPlan,
  createVoiceResponsePlan,
  MAX_FULL_READ_ALOUD_LENGTH,
  MAX_FULL_VOICE_RESPONSE_LENGTH,
  MAX_LIVE_CALL_SPEECH_LENGTH,
  MAX_STRUCTURED_FULL_VOICE_RESPONSE_LENGTH,
  normalizeLiveCallResponseText,
} from '../src/features/chat/voiceResponseUtils.js'
import {
  buildLiveCallRequestContext,
  canInterruptLiveCall,
  createLiveCallRecap,
  EMPTY_LIVE_CALL,
  getLiveCallCopy,
  getLiveCallProviderSupport,
  getLiveCallTranscriptPreview,
  getLiveCallTurnDelay,
  LIVE_CALL_MAX_OUTPUT_TOKENS,
  LIVE_CALL_PHASES,
  LIVE_CALL_SHORT_TURN_DELAY_MS,
  LIVE_CALL_TURN_DELAY_MS,
  shouldQueueLiveCallTurn,
  truncateLiveCallText,
} from '../src/features/chat/liveCallUtils.js'
import {
  buildChatHandoffPayload,
  getAssistantControlActions,
  getChatControlActions,
} from '../src/features/chat/chatControlCenterUtils.js'
import { classifyChatRequest, getChatIntentGuidance } from '../src/features/chat/chatRequestIntent.js'
import {
  createAssistantOrchestration,
  getChatOrchestrationContext,
  getCompletedOrchestrationActions,
  getOrchestratorGuidance,
  normalizeMessageOrchestration,
  recordOrchestrationAction,
} from '../src/features/chat/chatOrchestrator.js'
import { getChatExecutionState, getChatExecutionTransparency } from '../src/features/chat/chatExecutionTransparency.js'
import {
  getChatExecutionBridge,
  getExecutionBridgeGuidance,
  getExecutionBridgeHandoffAction,
  getExecutionBridgePresentation,
  normalizeExecutionBridgeEvidence,
} from '../src/features/chat/chatExecutionBridge.js'
import {
  createRepositoryBranchPreparation,
  formatRepositoryBranchPreparationReport,
  formatRepositoryInspectionReport,
  inspectPublicGithubRepository,
  parsePublicGithubRepositoryReference,
} from '../src/features/chat/chatRepositoryInspection.js'
import {
  approveExecutionWorkflow,
  applyExecutionWorkflowEvidence,
  canApplyApprovedFileChange,
  canCreateApprovedBranchAction,
  createExecutionWorkflow,
  formatExecutionApprovalReport,
  formatExecutionBlockedReport,
  formatExecutionBranchCreatedReport,
  formatExecutionFileChangeReport,
  formatExecutionReviewReadyReport,
  formatExecutionValidationReport,
  formatExecutionWorkflowReport,
  getExecutionWorkflowGuidance,
  getExecutionWorkflowPresentation,
  normalizeExecutionWorkflow,
  recordExecutionWorkflowBlock,
  recordExecutionWorkflowBranchCreated,
  recordExecutionWorkflowFileChange,
  recordExecutionWorkflowFileChanges,
  recordExecutionWorkflowMergeReadiness,
  recordExecutionWorkflowReviewReadiness,
  recordExecutionWorkflowValidation,
  retryExecutionWorkflow,
} from '../src/features/chat/chatExecutionWorkflow.js'
import {
  createGithubBranch,
  getGithubBranchExecutionCapability,
  getGithubBranchExecutionErrorPresentation,
} from '../src/features/chat/githubBranchExecutor.js'
import {
  applyGithubMultiFileChange,
  getGithubFileExecutionErrorPresentation,
  getGithubMultiFileExecutionErrorPresentation,
  getGithubRepositoryFile,
} from '../src/features/chat/githubFileExecutor.js'
import {
  getGithubCommitValidation,
  getGithubValidationErrorPresentation,
} from '../src/features/chat/githubValidationExecutor.js'
import { getExecutionEvidenceTrail } from '../src/features/chat/chatExecutionTrail.js'
import {
  getCapabilityBridgeGuidance,
  getCapabilityBridgeHandoffAction,
  getCapabilityBridgePresentation,
  getChatCapabilityBridge,
  normalizeCapabilityBridge,
} from '../src/features/chat/chatCapabilityBridge.js'
import {
  getChatConnectorPlan,
  getConnectorActionEvidence,
  getConnectorPlanGuidance,
  getConnectorPlanPresentation,
  getConnectorRegistryEntry,
  normalizeConnectorActionEvidence,
  normalizeConnectorPlan,
  refreshConnectorPlanForExecution,
} from '../src/features/chat/chatConnectorFramework.js'
import {
  createConnectorExecutionRequest,
  executeConnectorAction,
  getConnectorActionReadiness,
  getConnectorForAction,
  getIntegrationSettingsConnectors,
  normalizeConnectorRuntime,
  resolveConnector,
} from '../src/features/integrations/connectorPlatform.js'
import { verifyGithubConnectorSession } from '../src/features/integrations/githubConnectorAdapter.js'
import {
  buildWorkspaceAwareness,
  getProjectAwareness,
  getProjectAwarenessGuidance,
  normalizeChatMemory,
  reconcileChatMemory,
} from '../src/features/chat/chatMemory.js'
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
  CHAT_HARMLESS_SOCIAL_GUIDANCE,
  CHAT_RESPONSE_OPTIONS,
  CHAT_CONTROL_CENTER_PROMPT,
  CHAT_STARTER_PROMPTS,
  createConversation,
  filterConversations,
  getChatDestructiveActionCopy,
  getChatErrorPresentation,
  getChatRequestContext,
  getConversationMemoryGuidance,
  getChatResponseGuidance,
  getChatSystemPrompt,
  getLiveCallSystemPrompt,
  hasExplicitSelfCorrection,
  LIVE_CALL_RESPONSE_OPTIONS,
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

test('Chat routing recommends explainable local or cloud paths without silently changing the active model', () => {
  const availability = {
    anthropic: { configured: true },
    groq: { configured: true },
    gemini: { configured: true },
  }
  const localModels = [
    { id: 'llama3.2:3b-instruct-q4_K_M' },
    { id: 'qwen2.5-coder:7b-instruct-q4_K_M' },
  ]
  const localGeneral = { provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M' }
  const code = getChatModelRouting({
    request: 'Implement a secure signup component with tests.',
    intent: classifyChatRequest('Implement a secure signup component with tests.'),
    availability,
    currentSelection: localGeneral,
    localModels,
  })
  assert.equal(code.taskClass, 'code')
  assert.equal(code.current.fit, 'limited')
  assert.deepEqual(code.recommendation, {
    provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M', path: 'local',
  })
  assert.equal(code.shouldOfferSwitch, true)
  assert.match(code.reason, /local coding model/i)

  const planning = getChatModelRouting({
    request: 'Plan a multi-step FounderLab launch strategy and identify the main tradeoffs.',
    intent: classifyChatRequest('Plan a multi-step FounderLab launch strategy and identify the main tradeoffs.'),
    availability,
    currentSelection: { provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M' },
    localModels,
  })
  assert.equal(planning.taskClass, 'planning')
  assert.equal(planning.reasoningLevel, 'high')
  assert.deepEqual(planning.recommendation, {
    provider: 'anthropic', model: 'claude-sonnet-4-6', path: 'cloud',
  })
  assert.equal(planning.shouldOfferSwitch, true)

  const localOnlyPlanning = getChatModelRouting({
    request: 'Plan a multi-step FounderLab launch strategy.',
    intent: classifyChatRequest('Plan a multi-step FounderLab launch strategy.'),
    availability: {},
    currentSelection: { provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M' },
    localModels,
  })
  assert.equal(localOnlyPlanning.current.fit, 'limited')
  assert.deepEqual(localOnlyPlanning.recommendation, {
    provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M', path: 'local',
  })
  assert.match(localOnlyPlanning.reason, /constrained fallback/i)

  const explicitPrivateCode = getChatModelRouting({
    request: 'Use local Ollama to refactor this component privately.',
    intent: classifyChatRequest('Use local Ollama to refactor this component privately.'),
    availability,
    currentSelection: { provider: 'groq', model: 'openai/gpt-oss-120b' },
    localModels,
  })
  assert.equal(explicitPrivateCode.preference, 'local')
  assert.deepEqual(explicitPrivateCode.recommendation, {
    provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M', path: 'local',
  })
  assert.equal(explicitPrivateCode.shouldOfferSwitch, true)

  const imageRoute = getChatModelRouting({
    request: 'Review the image I attached and suggest a clearer onboarding flow.',
    intent: classifyChatRequest('Review the image I attached and suggest a clearer onboarding flow.'),
    availability,
    currentSelection: { provider: 'gemini', model: 'gemini-3.5-flash' },
    localModels,
    hasImage: true,
  })
  assert.deepEqual(imageRoute.recommendation, {
    provider: 'anthropic', model: 'claude-sonnet-4-6', path: 'cloud',
  })
  assert.equal(imageRoute.current.fit, 'limited')
  assert.equal(imageRoute.shouldOfferSwitch, true)

  const evidence = getChatRoutingEvidence(code)
  assert.deepEqual(evidence, {
    version: 1,
    taskClass: 'code',
    reasoningLevel: 'focused',
    selected: { provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M', path: 'local' },
    recommendation: { provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M', path: 'local' },
  })
  assert.equal(JSON.stringify(evidence).includes('Implement a secure signup component'), false)
})

test('Chat routing is carried into prompt and persisted orchestration metadata as bounded route evidence', () => {
  const messages = [{ role: 'user', content: 'Prepare this GitHub change for review and verification.' }]
  const context = getChatRequestContext(messages, {
    routing: {
      availability: { gemini: { configured: true }, groq: { configured: true } },
      currentSelection: { provider: 'groq', model: 'openai/gpt-oss-120b' },
    },
  })
  assert.equal(context.modelRouting.taskClass, 'execution')
  assert.deepEqual(context.modelRouting.recommendation, {
    provider: 'groq', model: 'openai/gpt-oss-120b', path: 'cloud',
  })
  assert.equal(context.modelRouting.shouldOfferSwitch, false)
  assert.match(getChatSystemPrompt(context), /Current model-routing note/i)

  const orchestration = createAssistantOrchestration(context)
  assert.deepEqual(orchestration.routing, {
    version: 1,
    taskClass: 'execution',
    reasoningLevel: 'high',
    selected: { provider: 'groq', model: 'openai/gpt-oss-120b', path: 'cloud' },
    recommendation: { provider: 'groq', model: 'openai/gpt-oss-120b', path: 'cloud' },
  })
  assert.deepEqual(normalizeMessageOrchestration({
    mode: 'operator', operation: 'handoff', routing: { ...orchestration.routing, secret: 'never persist' }, actions: [],
  }).routing, orchestration.routing)
})

test('Local Qwen Coder models are detected as code-ready without misclassifying general local chat models', () => {
  assert.deepEqual(getLocalModelCapabilities('qwen2.5-coder:7b-instruct-q4_K_M'), {
    codeGeneration: true,
    label: 'Code-ready',
    detail: 'Local coding model · Builder and Code AI ready',
  })
  assert.equal(getLocalModelCapabilities('qwen3:8b').codeGeneration, false)
  assert.deepEqual(getCodeGenerationReadiness({ provider: 'ollama', model: 'qwen2.5-coder:7b-instruct-q4_K_M' }), {
    ready: true,
    local: true,
    provider: 'ollama',
    model: 'qwen2.5-coder:7b-instruct-q4_K_M',
    reason: '',
  })
  assert.equal(getCodeGenerationReadiness({ provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M' }).reason, 'coding-model-required')

  const models = normalizeOllamaModels([{ name: 'qwen2.5-coder:7b-instruct-q4_K_M', details: { family: 'qwen2' } }])
  assert.equal(models[0].capabilities.codeGeneration, true)
  const options = getChatModelOptions('ollama', { localModels: models })
  assert.equal(options[0].codeReady, true)
  assert.match(options[0].detail, /Builder and Code AI ready/)
})

test('Code-generation routing uses a selected local Qwen Coder directly and rejects a general local chat model honestly', async () => {
  const requests = []
  const result = await requestCodeGenerationAI({
    provider: 'ollama',
    model: 'qwen2.5-coder:7b-instruct-q4_K_M',
    ollamaUrl: 'http://localhost:11434',
    messages: [{ role: 'user', content: 'Write a small component.' }],
    system: 'Return code only.',
    maxTokens: 128,
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) })
      return { ok: true, status: 200, json: async () => ({ message: { content: 'export default function Ready() { return null }' }, done: true }) }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://localhost:11434/api/chat')
  assert.equal(requests[0].body.model, 'qwen2.5-coder:7b-instruct-q4_K_M')

  const blocked = await requestCodeGenerationAI({
    provider: 'ollama',
    model: 'llama3.2:3b-instruct-q4_K_M',
    messages: [{ role: 'user', content: 'Write a component.' }],
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'OLLAMA_CODE_MODEL_REQUIRED')

  const cloud = await requestCodeGenerationAI({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'Review this component.' }],
  }, {
    accessToken: 'verified-access-token',
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/ai')
      assert.equal(options.headers.Authorization, 'Bearer verified-access-token')
      return { ok: true, status: 200, json: async () => ({ ok: true, provider: 'groq', model: 'openai/gpt-oss-120b', text: 'Cloud route remains available.' }) }
    },
  })
  assert.equal(cloud.ok, true)
  assert.equal(cloud.text, 'Cloud route remains available.')
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
  assert.match(CHAT_SYSTEM_PROMPT, /another version of the same question/i)
  assert.match(CHAT_SYSTEM_PROMPT, /low-risk assumption/i)
  assert.match(CHAT_SYSTEM_PROMPT, /silently use it/i)
  assert.match(CHAT_SYSTEM_PROMPT, /treat it as settled/i)
  assert.match(CHAT_HARMLESS_SOCIAL_GUIDANCE, /dating/i)
  assert.match(CHAT_HARMLESS_SOCIAL_GUIDANCE, /without a blanket refusal/i)
  assert.match(CHAT_CONTROL_CENTER_PROMPT, /never claim a task, note, GitHub repository/i)
  assert.match(getChatSystemPrompt(), /FounderLab workflow guidance/i)
  const followUpContext = getChatRequestContext([
    { role: 'assistant', content: 'Which launch are you referring to?' },
    { role: 'user', source: 'voice', content: 'The investor launch.' },
  ])
  assert.equal(followUpContext.latestMessageIsVoice, true)
  assert.equal(followUpContext.latestMessageHasCorrection, false)
  assert.equal(followUpContext.followsAssistantQuestion, true)
  assert.equal(followUpContext.intent.primaryTool, '')
  assert.equal(hasExplicitSelfCorrection('Actually, I meant the investor launch.'), true)
  assert.equal(hasExplicitSelfCorrection('Draft a marketing page, actually a launch page.'), true)
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
  assert.deepEqual(CHAT_RESPONSE_OPTIONS, { maxTokens: 1500, temperature: 0.52 })
  assert.deepEqual(LIVE_CALL_RESPONSE_OPTIONS, { maxTokens: 190, temperature: 0.4 })
})

test('Chat gives providers adaptive response-shape guidance without forcing every request into one template', () => {
  assert.match(getChatResponseGuidance('What is a concise positioning statement?'), /direct recommendation|core question/i)
  assert.match(getChatResponseGuidance('Help me improve our onboarding strategy.'), /actionable explanation/i)
  assert.match(getChatResponseGuidance('Build a landing page for our founder coaching product.', classifyChatRequest('Build a landing page for our founder coaching product.')), /compact plan/i)
  const context = getChatRequestContext([{ role: 'user', content: 'How should I test this landing page?' }])
  assert.match(context.responseGuidance, /direct recommendation|actionable explanation/i)
  assert.match(getChatSystemPrompt(context), /Current response-shape note/i)
})

test('Chat uses immediate conversation context instead of rewriting a recent answer by default', () => {
  const referenced = [
    { role: 'user', content: 'Can you write the onboarding component?' },
    { role: 'assistant', content: 'Here is the component and how to mount it.' },
    { role: 'user', content: 'How do I use that code in my app?' },
  ]
  const guidance = getConversationMemoryGuidance(referenced)
  assert.match(guidance, /immediately preceding assistant answer/i)
  assert.match(guidance, /avoid rewriting the whole answer/i)
  const context = getChatRequestContext(referenced)
  assert.match(context.memoryGuidance, /immediately preceding/i)
  assert.match(getChatSystemPrompt(context), /Current conversation-memory note/i)

  const repeat = getConversationMemoryGuidance([
    ...referenced.slice(0, 2),
    { role: 'user', content: 'Please show the full code again.' },
  ])
  assert.match(repeat, /explicitly asked to see recent content again/i)
  assert.equal(getConversationMemoryGuidance([{ role: 'user', content: 'What should I do next?' }]), '')
})

test('Code copy uses the Clipboard API first and leaves empty code untouched', async () => {
  const copied = []
  assert.equal(await copyTextToClipboard('const launch = true', {
    clipboard: { writeText: async (value) => copied.push(value) },
  }), true)
  assert.deepEqual(copied, ['const launch = true'])
  assert.equal(await copyTextToClipboard('', { clipboard: { writeText: async () => {} } }), false)
})

test('Chat request intent keeps planning guidance and explicit handoffs aligned', () => {
  const builder = classifyChatRequest('Build me a website for founder onboarding.')
  assert.deepEqual(builder.intents, ['builder'])
  assert.equal(builder.primaryTool, 'builder')
  assert.equal(builder.requiresPlan, true)
  assert.match(getChatIntentGuidance(builder), /compact product brief/i)

  const captureAndGitHub = classifyChatRequest('Turn this into a task and prepare it for GitHub.')
  assert.equal(captureAndGitHub.wantsTask, true)
  assert.equal(captureAndGitHub.primaryTool, 'github')
  assert.match(getChatIntentGuidance(captureAndGitHub), /never claim the capture already happened/i)

  const genericPlan = classifyChatRequest('Make a project plan for this founder idea.')
  assert.equal(genericPlan.requiresPlan, true)
  assert.equal(genericPlan.primaryTool, 'builder')
  assert.deepEqual(classifyChatRequest('What is GitHub and how does an API work?').intents, [])

  const plannedPrompt = getChatSystemPrompt({ intent: builder })
  assert.match(plannedPrompt, /Current request capability note/i)
  assert.match(plannedPrompt, /Builder handoff/i)
})

test('Chat orchestrator differentiates conversation, planning, operator, and thread-follow-up requests without treating a tool mention as a command', () => {
  const conversation = classifyChatRequest('What is GitHub and how does an API work?')
  assert.equal(conversation.mode, 'conversation')
  assert.equal(conversation.primaryTool, '')

  const plan = classifyChatRequest('Give me a roadmap for the new onboarding project.')
  assert.equal(plan.mode, 'planning')
  assert.equal(plan.operation, 'plan')
  assert.equal(plan.requiresPlan, true)

  const operator = classifyChatRequest('Build a landing page for the founder coaching app.')
  assert.equal(operator.mode, 'operator')
  assert.equal(operator.operation, 'create')
  assert.equal(operator.primaryTool, 'builder')
  assert.equal(operator.isOperational, true)

  const followUp = classifyChatRequest('Continue from that and fix the code above.', { hasThreadReference: true })
  assert.equal(followUp.mode, 'follow-up')
  assert.equal(followUp.operation, 'continue')
})

test('Chat orchestrator carries immediate thread references and only treats explicit action records as completed work', () => {
  const context = getChatOrchestrationContext([
    { role: 'user', content: 'Build a landing page for a coaching product.' },
    {
      role: 'assistant',
      content: 'Here is the project plan and the first implementation step.',
      orchestration: {
        version: 1,
        mode: 'operator',
        operation: 'create',
        primaryTool: 'builder',
        actions: [{ id: 'builder', status: 'handoff-opened' }],
      },
    },
    { role: 'user', content: 'Continue from that and improve the plan.' },
  ])
  assert.equal(context.intent.mode, 'follow-up')
  assert.equal(context.reference.referencesPrevious, true)
  assert.equal(context.reference.artifactKind, 'plan')
  assert.match(context.activeObjective, /Build a landing page/i)
  assert.deepEqual(context.actionEvidence, [{ id: 'builder', status: 'handoff-opened' }])
  const guidance = getOrchestratorGuidance(context)
  assert.match(guidance, /handoff was opened; this does not confirm a Builder project was created/i)
  assert.match(guidance, /what the conversation proves, what you infer/i)
  assert.match(getChatSystemPrompt({ intent: context.intent, orchestration: context }), /Current operator-state note/i)
})

test('Chat orchestration metadata persists only safe evidence and keeps completed actions stable after reload', () => {
  const base = createAssistantOrchestration({ intent: classifyChatRequest('Prepare this feature for GitHub.') })
  const withHandoff = recordOrchestrationAction(base, { id: 'github', status: 'handoff-opened' })
  const withTask = recordOrchestrationAction(withHandoff, { id: 'create-task', status: 'completed' })
  assert.deepEqual(getCompletedOrchestrationActions(withTask), [
    { id: 'github', status: 'handoff-opened' },
    {
      id: 'create-task',
      status: 'completed',
      connectorAction: { connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified' },
    },
  ])
  assert.deepEqual(normalizeMessageOrchestration({
    mode: 'operator', operation: 'handoff', primaryTool: 'github', actions: [
      { id: 'github', status: 'handoff-opened', secret: 'never persist' },
      { id: 'invalid', status: 'completed' },
      { id: 'create-task', status: 'unverified' },
    ],
  }), {
    version: 1,
    mode: 'operator',
    operation: 'handoff',
    primaryTool: 'github',
    actions: [{ id: 'github', status: 'handoff-opened' }],
  })

  const normalized = normalizeConversations([{
    id: 'operator-chat', title: 'Operator', messages: [{
      id: 'assistant', role: 'assistant', content: 'A safe handoff is ready.', orchestration: withTask,
    }],
  }])
  assert.deepEqual(getCompletedOrchestrationActions(normalized[0].messages[0].orchestration), [
    { id: 'github', status: 'handoff-opened' },
    {
      id: 'create-task',
      status: 'completed',
      connectorAction: { connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified' },
    },
  ])
})

test('Execution bridge prepares repo-aware, branch-first work without claiming repository execution', () => {
  const projectAwareness = {
    project: { id: 'founderlab', name: 'FounderLab', type: 'product', updated_at: '' },
    task: { id: 'task-bug', title: 'Repair onboarding crash', status: 'todo', updated_at: '' },
    actions: [],
  }
  const modelRouting = {
    recommendation: { provider: 'groq', model: 'openai/gpt-oss-120b', path: 'cloud' },
  }
  const fix = getChatExecutionBridge({
    request: 'Fix this bug in the FounderLab codebase.',
    intent: classifyChatRequest('Fix this bug in the FounderLab codebase.'),
    projectAwareness,
    modelRouting,
  })
  assert.deepEqual(fix, {
    version: 1,
    target: {
      surface: 'repository',
      project: { id: 'founderlab', name: 'FounderLab', type: 'product' },
      task: { id: 'task-bug', title: 'Repair onboarding crash', status: 'todo' },
    },
    requestedOperation: 'change',
    repoAwareness: 'needed',
    readiness: 'ready-to-inspect',
    risk: 'medium',
    branch: 'required',
    inspection: 'required',
    approval: 'required',
    handoff: 'code',
  })
  const fixGuidance = getExecutionBridgeGuidance(fix)
  assert.match(fixGuidance, /no repository contents, branch, tests, or external state have been inspected/i)
  assert.match(fixGuidance, /requires explicit approval/i)
  assert.match(fixGuidance, /not proof that a tool, repository, branch, or external system was changed/i)
  const requestContext = getChatRequestContext([{ role: 'user', content: 'Fix this bug in the FounderLab codebase.' }])
  assert.equal(requestContext.executionBridge.target.surface, 'repository')
  assert.equal(requestContext.executionBridge.readiness, 'ready-to-inspect')
  assert.match(getChatSystemPrompt(requestContext), /Current execution-bridge note/i)
  assert.equal(createAssistantOrchestration(requestContext).execution.readiness, 'ready-to-inspect')

  const inspect = getChatExecutionBridge({
    request: 'Inspect this project for the onboarding crash.',
    intent: classifyChatRequest('Inspect this project for the onboarding crash.'),
    projectAwareness,
    modelRouting,
  })
  assert.equal(inspect.readiness, 'ready-to-inspect')
  assert.equal(inspect.branch, 'recommended')
  assert.equal(inspect.inspection, 'required')
  assert.equal(inspect.approval, 'not-required')

  const branchPreparation = getChatExecutionBridge({
    request: 'Prepare branch work for the current project.',
    intent: classifyChatRequest('Prepare branch work for the current project.'),
    projectAwareness,
    modelRouting,
  })
  assert.equal(branchPreparation.target.surface, 'repository')
  assert.equal(branchPreparation.branch, 'recommended')
  assert.equal(branchPreparation.inspection, 'recommended')
  assert.equal(branchPreparation.readiness, 'ready-to-inspect')

  const builder = getChatExecutionBridge({
    request: 'Prepare Builder work for a premium FounderLab landing page.',
    intent: classifyChatRequest('Prepare Builder work for a premium FounderLab landing page.'),
    projectAwareness,
    modelRouting,
  })
  assert.equal(builder.target.surface, 'builder')
  assert.equal(builder.repoAwareness, 'not-needed')
  assert.equal(builder.readiness, 'ready-to-handoff')
  assert.equal(builder.handoff, 'builder')

  const continueUpgrade = getChatExecutionBridge({
    request: 'Continue the FounderLab upgrade work.',
    intent: classifyChatRequest('Continue the FounderLab upgrade work.'),
    projectAwareness,
    modelRouting,
  })
  assert.equal(continueUpgrade.target.surface, 'project')
  assert.equal(continueUpgrade.target.project.name, 'FounderLab')
  assert.equal(continueUpgrade.readiness, 'execution-path-selected')

  const externallyUnverified = getChatExecutionBridge({
    request: 'Prepare Builder work for a premium FounderLab landing page.',
    intent: classifyChatRequest('Prepare Builder work for a premium FounderLab landing page.'),
    projectAwareness: { ...projectAwareness, actions: [{ id: 'builder', status: 'handoff-opened' }] },
    modelRouting,
  })
  assert.equal(externallyUnverified.readiness, 'externally-unverified')
  assert.match(getExecutionBridgePresentation(externallyUnverified).detail, /no downstream result is verified/i)
})

test('Execution bridge metadata is bounded and persists only safe target and readiness evidence', () => {
  const normalized = normalizeExecutionBridgeEvidence({
    target: {
      surface: 'repository',
      project: { id: 'founderlab', name: 'FounderLab', type: 'product', filePath: '/private/repo' },
      task: { id: 'task-1', title: 'Fix chat', status: 'todo', secret: 'never persist' },
    },
    requestedOperation: 'change',
    repoAwareness: 'needed',
    readiness: 'waiting-for-approval',
    risk: 'medium',
    branch: 'required',
    inspection: 'required',
    approval: 'required',
    handoff: 'code',
    request: 'never persist this raw prompt',
  })
  assert.deepEqual(normalized, {
    version: 1,
    target: {
      surface: 'repository',
      project: { id: 'founderlab', name: 'FounderLab', type: 'product' },
      task: { id: 'task-1', title: 'Fix chat', status: 'todo' },
    },
    requestedOperation: 'change',
    repoAwareness: 'needed',
    readiness: 'waiting-for-approval',
    risk: 'medium',
    branch: 'required',
    inspection: 'required',
    approval: 'required',
    handoff: 'code',
  })
  assert.equal(JSON.stringify(normalized).includes('private'), false)
  assert.equal(JSON.stringify(normalized).includes('raw prompt'), false)

  const orchestration = createAssistantOrchestration({
    intent: classifyChatRequest('Fix this bug in the FounderLab codebase.'),
    executionBridge: normalized,
  })
  assert.deepEqual(orchestration.execution, normalized)
  assert.deepEqual(normalizeMessageOrchestration({ ...orchestration, execution: { ...normalized, token: 'never persist' } }).execution, normalized)
})

test('Repository inspection reads only an explicit public GitHub reference and returns bounded metadata and paths', async () => {
  assert.deepEqual(parsePublicGithubRepositoryReference('Please inspect https://github.com/acme/founderlab.git/issues'), {
    provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab',
  })
  assert.deepEqual(parsePublicGithubRepositoryReference('Inspect acme/founderlab'), {
    provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab',
  })
  assert.equal(parsePublicGithubRepositoryReference('https://gitlab.com/acme/founderlab'), null)
  assert.equal(parsePublicGithubRepositoryReference('inspect this repository'), null)

  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    if (url.endsWith('/repos/acme/founderlab')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'founderlab', full_name: 'acme/founderlab', default_branch: 'main', language: 'JavaScript', private: false,
          description: 'A public founder workspace.', updated_at: '2026-07-23T12:00:00Z',
        }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        truncated: false,
        tree: [
          { type: 'blob', path: 'README.md', content: 'must not be retained' },
          { type: 'blob', path: 'package.json' },
          { type: 'blob', path: 'src/App.jsx' },
          { type: 'blob', path: 'docs/architecture.md' },
        ],
      }),
    }
  }
  const inspection = await inspectPublicGithubRepository('acme/founderlab', {
    fetchImpl,
    now: () => '2026-07-23T12:30:00Z',
  })
  assert.equal(requests.length, 2)
  assert.equal(inspection.repository.defaultBranch, 'main')
  assert.equal(inspection.tree.state, 'complete')
  assert.deepEqual(inspection.tree.sampleFiles, ['package.json', 'README.md', 'src/App.jsx', 'docs/architecture.md'])
  assert.equal(JSON.stringify(inspection).includes('must not be retained'), false)
  assert.match(formatRepositoryInspectionReport(inspection), /No branch was created and no files were changed/i)

  await assert.rejects(
    () => inspectPublicGithubRepository('acme/private-repo', {
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ private: true }) }),
    }),
    /public GitHub repositories only/i,
  )

  const preparation = createRepositoryBranchPreparation({ inspection, request: 'Fix the onboarding crash in the chat composer.' })
  assert.equal(preparation.proposedBranch, 'founderlab/fix-onboarding-crash-chat-composer')
  assert.equal(preparation.baseBranch, 'main')
  assert.match(formatRepositoryBranchPreparationReport(preparation), /No branch was created, no files were changed, and no tests were run/i)
})

test('Execution bridge promotes explicit public repository work through inspect then branch planning without a fake mutation', () => {
  const request = 'Fix the onboarding crash in https://github.com/acme/founderlab.'
  const intent = classifyChatRequest(request)
  const initial = getChatExecutionBridge({ request, intent })
  assert.deepEqual(initial.target.repository, { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' })
  assert.equal(initial.readiness, 'ready-to-inspect')
  assert.equal(initial.inspection, 'required')
  assert.equal(getExecutionBridgeHandoffAction(initial), '')

  const inspected = getChatExecutionBridge({
    request,
    intent,
    projectAwareness: {
      actions: [{
        id: 'inspect-repo', status: 'inspection-completed',
        resource: { type: 'repository', id: 'github:acme/founderlab@main', title: 'acme/founderlab' },
      }],
    },
  })
  assert.equal(inspected.inspection, 'completed')
  assert.equal(inspected.readiness, 'waiting-for-approval')
  assert.equal(getExecutionBridgeHandoffAction(inspected), '')
  assert.match(getExecutionBridgeGuidance(inspected), /read-only repository inspection is recorded/i)

  const transparency = getChatExecutionTransparency({
    mode: 'operator', operation: 'change', execution: inspected,
    actions: [{ id: 'inspect-repo', status: 'inspection-completed' }],
  })
  assert.equal(transparency.state.key, 'inspection-completed')
  assert.equal(transparency.outcome.kind, 'inspection')
  const branchTransparency = getChatExecutionTransparency({
    mode: 'operator', operation: 'change', actions: [{ id: 'prepare-branch', status: 'branch-prepared' }],
  })
  assert.equal(branchTransparency.state.key, 'branch-prepared')
  assert.equal(branchTransparency.outcome.kind, 'branch-prepared')
  const workflowTransparency = getChatExecutionTransparency({
    mode: 'operator', operation: 'change',
    actions: [{ id: 'prepare-execution', status: 'execution-prepared' }],
    workflow: normalizeExecutionWorkflow({
      version: 1, repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' },
      branch: { state: 'planned', base: 'main', proposed: 'founderlab/fix-chat' },
      change: { state: 'prepared', risk: 'medium', fileTargets: ['src/App.jsx'] },
      validation: { tests: 'required', build: 'required', report: 'required' },
      approval: 'required', review: 'awaiting-approval', execution: 'awaiting-approval', executor: 'not-available',
    }),
  })
  assert.equal(workflowTransparency.state.key, 'execution-prepared')
  assert.equal(workflowTransparency.outcome.kind, 'execution-prepared')
  assert.match(workflowTransparency.workflow.detail, /No branch was created/i)
})

test('Execution workflow persists bounded branch-first preparation and approval without inventing a repository mutation', () => {
  const inspection = {
    reference: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' },
    repository: { defaultBranch: 'main' },
    tree: {
      importantFiles: ['package.json', 'README.md'],
      sampleFiles: ['src/features/chat/ChatWorkspace.jsx', 'test/chat-premium.test.mjs', '../not-a-path', '/not-a-path'],
    },
  }
  const preparation = {
    repository: inspection.reference,
    baseBranch: 'main',
    proposedBranch: 'founderlab/fix-chat-workflow',
    risk: 'medium',
  }
  const workflow = createExecutionWorkflow({ inspection, preparation, request: 'Fix the Chat workflow and add a regression test.' })
  assert.deepEqual(workflow, {
    version: 1,
    repository: inspection.reference,
    branch: { state: 'planned', base: 'main', proposed: 'founderlab/fix-chat-workflow' },
    change: {
      state: 'prepared', risk: 'medium',
      fileTargets: ['test/chat-premium.test.mjs', 'package.json', 'src/features/chat/ChatWorkspace.jsx', 'README.md'],
    },
    validation: { tests: 'required', build: 'required', report: 'required' },
    approval: 'required',
    review: 'awaiting-approval',
    execution: 'awaiting-approval',
    executor: 'not-available',
    capability: { connection: 'not-connected', authorization: 'not-authorized', execution: 'unavailable' },
  })
  assert.match(formatExecutionWorkflowReport(workflow), /No branch was created, no files were changed, and no tests or build were run/i)
  assert.match(getExecutionWorkflowGuidance(workflow), /still needs explicit approval/i)
  assert.equal(JSON.stringify(normalizeExecutionWorkflow({ ...workflow, token: 'never persist' })).includes('token'), false)

  const approved = approveExecutionWorkflow(workflow)
  assert.equal(approved.approval, 'approved')
  assert.equal(approved.execution, 'awaiting-executor')
  assert.equal(approved.review, 'awaiting-executor')
  assert.deepEqual(getExecutionWorkflowPresentation(approved).state, 'approval-recorded')
  assert.match(formatExecutionApprovalReport(approved), /explicitly choose branch creation/i)

  const noOpEvidence = applyExecutionWorkflowEvidence(approved, { branch: { state: 'created' } })
  assert.equal(noOpEvidence.branch.state, 'planned')
  assert.equal(noOpEvidence.executor, 'not-available')
  assert.match(getExecutionWorkflowGuidance(noOpEvidence), /Do not claim a branch was created/i)

  const orchestration = recordOrchestrationAction(
    createAssistantOrchestration({ intent: classifyChatRequest('Fix this repository bug.') }),
    { id: 'prepare-execution', status: 'execution-prepared', workflow },
  )
  const withApproval = recordOrchestrationAction(orchestration, { id: 'approve-execution', status: 'approval-recorded', workflow: approved })
  assert.equal(withApproval.workflow.approval, 'approved')
  assert.equal(getCompletedOrchestrationActions(withApproval).at(-1).status, 'approval-recorded')
})

test('Explicit approved GitHub branch creation is bounded, evidenced, and classifies recovery states', async () => {
  assert.deepEqual(getGithubBranchExecutionCapability(''), { connection: 'not-connected', authorization: 'not-authorized', execution: 'unavailable' })
  assert.deepEqual(getGithubBranchExecutionCapability('session-token'), { connection: 'connected', authorization: 'unverified', execution: 'unverified' })
  const requests = []
  const created = await createGithubBranch({
    token: 'session-token',
    repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' },
    baseBranch: 'main',
    proposedBranch: 'founderlab/fix-chat',
    now: () => '2026-07-23T14:00:00.000Z',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options })
      if (url.endsWith('/git/ref/heads/main')) return { ok: true, status: 200, json: async () => ({ object: { sha: 'abc123' } }) }
      return { ok: true, status: 201, json: async () => ({ ref: 'refs/heads/founderlab/fix-chat' }) }
    },
  })
  assert.equal(requests.length, 2)
  assert.match(requests[0].options.headers.Authorization, /^Bearer /)
  assert.deepEqual(JSON.parse(requests[1].options.body), { ref: 'refs/heads/founderlab/fix-chat', sha: 'abc123' })
  assert.equal(JSON.stringify(created).includes('session-token'), false)
  let invalidBranchRequested = false
  await assert.rejects(
    () => createGithubBranch({
      token: 'session-token', repository: created.repository, baseBranch: 'main', proposedBranch: 'founderlab/../unsafe',
      fetchImpl: async () => { invalidBranchRequested = true; return { ok: true, json: async () => ({}) } },
    }),
    (error) => error?.code === 'execution-unavailable',
  )
  assert.equal(invalidBranchRequested, false)

  const workflow = approveExecutionWorkflow(createExecutionWorkflow({
    inspection: { reference: created.repository, repository: { defaultBranch: 'main' }, tree: { importantFiles: ['src/App.jsx', 'src/legacy.js'], sampleFiles: [] } },
    preparation: { repository: created.repository, baseBranch: 'main', proposedBranch: 'founderlab/fix-chat', risk: 'medium' },
    capability: getGithubBranchExecutionCapability('session-token'),
  }))
  assert.equal(canCreateApprovedBranchAction(workflow), false)
  assert.equal(canCreateApprovedBranchAction(workflow, {
    inspectionRecorded: true,
    branchPlanRecorded: true,
    approvalRecorded: true,
  }), true)
  const branchCreated = recordExecutionWorkflowBranchCreated(workflow)
  assert.equal(branchCreated.branch.state, 'created')
  assert.equal(branchCreated.execution, 'branch-created')
  assert.equal(branchCreated.capability.authorization, 'writable')
  assert.match(formatExecutionBranchCreatedReport(branchCreated), /GitHub confirmed branch creation/i)
  assert.equal(canApplyApprovedFileChange(branchCreated), false)
  assert.equal(canApplyApprovedFileChange(branchCreated, {
    inspectionRecorded: true,
    branchCreatedRecorded: true,
    approvalRecorded: true,
  }), true)
  const changed = recordExecutionWorkflowFileChange(branchCreated, {
    path: 'src/App.jsx', commitSha: 'abc123def4567', source: 'github-api',
  })
  assert.equal(changed.change.state, 'applied')
  assert.deepEqual(changed.change.appliedFiles, ['src/App.jsx'])
  assert.deepEqual(changed.change.updatedFiles, ['src/App.jsx'])
  assert.match(formatExecutionFileChangeReport(changed), /bounded multi-file commit/i)

  const multiChanged = recordExecutionWorkflowFileChanges(branchCreated, {
    changes: [
      { path: 'src/App.jsx', operation: 'update' },
      { path: 'src/new-feature.js', operation: 'create' },
      { path: 'src/legacy.js', operation: 'delete' },
    ],
    commitSha: 'abc123def4567',
    source: 'github-api',
  })
  assert.deepEqual(multiChanged.change.appliedFiles, ['src/App.jsx', 'src/new-feature.js', 'src/legacy.js'])
  assert.deepEqual(multiChanged.change.updatedFiles, ['src/App.jsx'])
  assert.deepEqual(multiChanged.change.createdFiles, ['src/new-feature.js'])
  assert.deepEqual(multiChanged.change.deletedFiles, ['src/legacy.js'])
  assert.match(formatExecutionFileChangeReport(multiChanged), /Created:.*new-feature/i)
  assert.match(getExecutionWorkflowGuidance(multiChanged), /updated src\/App\.jsx; created src\/new-feature\.js; deleted src\/legacy\.js/i)

  const validation = recordExecutionWorkflowValidation(multiChanged, {
    source: 'secure-executor', tests: 'passed', build: 'passed', report: 'passed',
  })
  const review = recordExecutionWorkflowReviewReadiness(validation)
  assert.equal(review.review, 'ready-for-review')
  assert.equal(review.execution, 'reported')
  assert.match(formatExecutionValidationReport(validation), /ready for an explicit human review/i)
  assert.match(formatExecutionReviewReadyReport(review), /No pull request or merge/i)
  assert.equal(recordExecutionWorkflowMergeReadiness(review, { source: 'approved-review' }).review, 'ready-to-merge')
  assert.equal(recordExecutionWorkflowMergeReadiness(review, { source: 'untrusted' }), null)

  const failedValidation = recordExecutionWorkflowValidation(multiChanged, {
    source: 'secure-executor', tests: 'passed', build: 'failed', report: 'passed',
  })
  assert.equal(failedValidation.execution, 'blocked')
  assert.equal(failedValidation.block.code, 'build-failed')
  assert.equal(recordExecutionWorkflowReviewReadiness(failedValidation).execution, 'blocked')

  const blocked = recordExecutionWorkflowBlock(workflow, { code: 'github-permission-denied', phase: 'branch' })
  assert.equal(blocked.execution, 'blocked')
  assert.equal(blocked.capability.authorization, 'denied')
  assert.match(formatExecutionBlockedReport(blocked), /permission/i)
  const cancelled = recordExecutionWorkflowBlock(workflow, { code: 'execution-cancelled', phase: 'branch' })
  assert.equal(cancelled.execution, 'cancelled')
  assert.equal(cancelled.review, 'not-ready')
  const reconnectRequired = recordExecutionWorkflowBlock(workflow, { code: 'github-connection-required', phase: 'integration', retryable: true })
  assert.equal(retryExecutionWorkflow(reconnectRequired).capability.execution, 'unavailable')
  assert.match(getGithubBranchExecutionErrorPresentation({ code: 'branch-conflict' }), /branch already exists/i)
  assert.equal(retryExecutionWorkflow(recordExecutionWorkflowBlock(workflow, { code: 'execution-unavailable', phase: 'branch', retryable: true })).execution, 'awaiting-executor')

  await assert.rejects(
    () => createGithubBranch({
      token: 'session-token', repository: created.repository, baseBranch: 'main', proposedBranch: 'founderlab/fix-chat',
      fetchImpl: async (url) => (url.endsWith('/git/ref/heads/main')
        ? { ok: true, status: 200, json: async () => ({ object: { sha: 'abc123' } }) }
        : { ok: false, status: 422, json: async () => ({}) }),
    }),
    (error) => error?.code === 'branch-conflict',
  )
})

test('Approved GitHub file reader loads one bounded candidate revision for the reviewed multi-file commit', async () => {
  const repository = { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' }
  const initial = 'export const answer = 1\n'
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ path: 'src/answer.js', sha: 'abcdef1234567', encoding: 'base64', content: Buffer.from(initial).toString('base64') }),
    }
  }
  const loaded = await getGithubRepositoryFile({ token: 'session-token', repository, branch: 'founderlab/fix-chat', path: 'src/answer.js', fetchImpl })
  assert.equal(loaded.content, initial)
  assert.equal(loaded.sha, 'abcdef1234567')
  assert.equal(JSON.stringify(loaded).includes('session-token'), false)
  assert.equal(requests.length, 1)
  assert.match(requests[0].options.headers.Authorization, /^Bearer /)

  let unsafeRequested = false
  await assert.rejects(
    () => getGithubRepositoryFile({ token: 'session-token', repository, branch: 'main', path: '../.env', fetchImpl: async () => { unsafeRequested = true; return { ok: true, json: async () => ({}) } } }),
    (error) => error?.code === 'execution-unavailable',
  )
  assert.equal(unsafeRequested, false)
  assert.match(getGithubFileExecutionErrorPresentation({ code: 'file-content-unavailable' }), /bounded text file/i)
})

test('Approved GitHub multi-file execution creates one atomic branch commit for updates, creates, and deletes', async () => {
  const repository = { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' }
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/git/refs/heads/founderlab%2Ffix-chat') && options.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ object: { sha: '4444444' } }) }
    }
    if (url.endsWith('/git/ref/heads/founderlab%2Ffix-chat')) {
      return { ok: true, status: 200, json: async () => ({ object: { sha: '1111111' } }) }
    }
    if (url.endsWith('/git/commits/1111111')) {
      return { ok: true, status: 200, json: async () => ({ tree: { sha: '2222222' } }) }
    }
    if (url.endsWith('/git/trees/2222222?recursive=1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ tree: [
          { path: 'src/existing.js', mode: '100644', type: 'blob', sha: 'aaaaaaa' },
          { path: 'src/legacy.js', mode: '100755', type: 'blob', sha: 'bbbbbbb' },
        ] }),
      }
    }
    if (url.endsWith('/git/trees') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ sha: '3333333' }) }
    }
    if (url.endsWith('/git/commits') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ sha: '4444444' }) }
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`)
  }
  const committed = await applyGithubMultiFileChange({
    token: 'session-token',
    repository,
    branch: 'founderlab/fix-chat',
    commitMessage: 'Apply reviewed FounderLab changes',
    changes: [
      { operation: 'update', path: 'src/existing.js', expectedSha: 'aaaaaaa', content: 'export const updated = true\n' },
      { operation: 'create', path: 'src/new-feature.js', content: 'export const created = true\n' },
      { operation: 'delete', path: 'src/legacy.js', expectedSha: 'bbbbbbb' },
    ],
    now: () => '2026-07-24T09:00:00.000Z',
    fetchImpl,
  })
  assert.equal(requests.length, 6)
  assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 2)
  assert.match(requests[0].options.headers.Authorization, /^Bearer /)
  const treeBody = JSON.parse(requests[3].options.body)
  assert.deepEqual(treeBody, {
    base_tree: '2222222',
    tree: [
      { path: 'src/existing.js', mode: '100644', type: 'blob', content: 'export const updated = true\n' },
      { path: 'src/new-feature.js', mode: '100644', type: 'blob', content: 'export const created = true\n' },
      { path: 'src/legacy.js', mode: '100755', type: 'blob', sha: null },
    ],
  })
  assert.deepEqual(JSON.parse(requests[4].options.body), {
    message: 'Apply reviewed FounderLab changes', tree: '3333333', parents: ['1111111'],
  })
  assert.deepEqual(JSON.parse(requests[5].options.body), { sha: '4444444', force: false })
  assert.equal(committed.commitSha, '4444444')
  assert.deepEqual(committed.updatedFiles, ['src/existing.js'])
  assert.deepEqual(committed.createdFiles, ['src/new-feature.js'])
  assert.deepEqual(committed.deletedFiles, ['src/legacy.js'])
  assert.equal(JSON.stringify(committed).includes('session-token'), false)

  let staleRequests = 0
  await assert.rejects(
    () => applyGithubMultiFileChange({
      token: 'session-token', repository, branch: 'main', commitMessage: 'Stale',
      changes: [{ operation: 'update', path: 'src/existing.js', expectedSha: 'aaaaaaa', content: 'next\n' }],
      fetchImpl: async (url) => {
        staleRequests += 1
        if (url.endsWith('/git/ref/heads/main')) return { ok: true, json: async () => ({ object: { sha: '1111111' } }) }
        if (url.endsWith('/git/commits/1111111')) return { ok: true, json: async () => ({ tree: { sha: '2222222' } }) }
        return { ok: true, json: async () => ({ tree: [{ path: 'src/existing.js', mode: '100644', type: 'blob', sha: 'ccccccc' }] }) }
      },
    }),
    (error) => error?.code === 'file-change-conflict',
  )
  assert.equal(staleRequests, 3)

  let unsafeRequested = false
  await assert.rejects(
    () => applyGithubMultiFileChange({
      token: 'session-token', repository, branch: 'main', commitMessage: 'Unsafe',
      changes: [
        { operation: 'create', path: 'src/new.js', content: 'one' },
        { operation: 'delete', path: 'src/new.js', expectedSha: 'aaaaaaa' },
      ],
      fetchImpl: async () => { unsafeRequested = true; return { ok: true, json: async () => ({}) } },
    }),
    (error) => error?.code === 'execution-unavailable',
  )
  assert.equal(unsafeRequested, false)

  const partialRequests = []
  await assert.rejects(
    () => applyGithubMultiFileChange({
      token: 'session-token', repository, branch: 'main', commitMessage: 'Branch update uncertain',
      changes: [{ operation: 'create', path: 'src/recovery-note.js', content: 'export const recovery = true\n' }],
      fetchImpl: async (url, options = {}) => {
        partialRequests.push({ url, options })
        if (url.endsWith('/git/ref/heads/main')) return { ok: true, json: async () => ({ object: { sha: '1111111' } }) }
        if (url.endsWith('/git/commits/1111111')) return { ok: true, json: async () => ({ tree: { sha: '2222222' } }) }
        if (url.endsWith('/git/trees/2222222?recursive=1')) return { ok: true, json: async () => ({ tree: [] }) }
        if (url.endsWith('/git/trees')) return { ok: true, json: async () => ({ sha: '3333333' }) }
        if (url.endsWith('/git/commits')) return { ok: true, json: async () => ({ sha: '4444444' }) }
        if (url.endsWith('/git/refs/heads/main')) return { ok: false, status: 422, json: async () => ({}) }
        throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`)
      },
    }),
    (error) => error?.code === 'partial-execution' && error?.commitSha === '4444444',
  )
  assert.equal(partialRequests.length, 6)
  assert.match(getGithubMultiFileExecutionErrorPresentation({ code: 'partial-execution', commitSha: '4444444' }), /created a commit/i)
})

test('GitHub validation records native check evidence without dispatching or inventing a test/build run', async () => {
  const result = await getGithubCommitValidation({
    token: 'session-token',
    repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' },
    commitSha: 'fedcba1234567',
    fetchImpl: async (url, options) => {
      assert.match(url, /check-runs\?per_page=24$/)
      assert.match(options.headers.Authorization, /^Bearer /)
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [
          { name: 'unit tests', status: 'completed', conclusion: 'success' },
          { name: 'production build', status: 'completed', conclusion: 'success' },
        ] }),
      }
    },
  })
  assert.deepEqual(result.validation, { tests: 'passed', build: 'passed', report: 'passed' })
  assert.equal(result.checks.length, 2)
  await assert.rejects(
    () => getGithubCommitValidation({ token: 'session-token', repository: result.repository, commitSha: result.commitSha, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }),
    (error) => error?.code === 'github-permission-denied',
  )
  assert.match(getGithubValidationErrorPresentation({ code: 'execution-unavailable' }), /No validation result was recorded/i)
})

test('Execution evidence trail keeps inspected, planned, approved, blocked, and externally verified branch states distinct', () => {
  const trail = getExecutionEvidenceTrail({
    actions: [
      { id: 'inspect-repo', status: 'inspection-completed', at: '2026-07-23T14:00:00.000Z', resource: { title: 'acme/founderlab' } },
      { id: 'prepare-branch', status: 'branch-prepared', at: '2026-07-23T14:01:00.000Z', resource: { title: 'founderlab/fix-chat' } },
      { id: 'approve-execution', status: 'approval-recorded', at: '2026-07-23T14:02:00.000Z' },
      { id: 'create-branch', status: 'branch-created', at: '2026-07-23T14:03:00.000Z', resource: { title: 'founderlab/fix-chat' } },
      { id: 'apply-file-change', status: 'change-applied', at: '2026-07-23T14:04:00.000Z', resource: { title: 'src/App.jsx' } },
      { id: 'validate', status: 'validation-passed', at: '2026-07-23T14:05:00.000Z', resource: { title: 'fedcba1234567' } },
      { id: 'review', status: 'review-ready', at: '2026-07-23T14:06:00.000Z', resource: { title: 'founderlab/fix-chat' } },
    ],
  })
  assert.deepEqual(trail.entries.map((entry) => entry.label), ['Repository inspected', 'Branch plan prepared', 'Execution approval recorded', 'Branch created', 'Reviewed commit applied', 'Validation passed', 'Review ready'])
  assert.equal(trail.entries.at(-1).resource, 'founderlab/fix-chat')
})

test('Capability bridge prepares real FounderLab routes and external integrations without inventing a connector action', () => {
  const emailIntent = classifyChatRequest('Email the launch update to our client and turn it into a task.')
  const emailCapability = getChatCapabilityBridge({
    request: 'Email the launch update to our client and turn it into a task.',
    intent: emailIntent,
  })
  assert.deepEqual(emailCapability, {
    version: 1,
    primary: 'email',
    routes: [
      { id: 'tasks', kind: 'workspace', availability: 'available', action: 'create-task' },
      { id: 'email', kind: 'integration', availability: 'not-installed', action: 'send-email' },
    ],
  })
  assert.equal(getCapabilityBridgeHandoffAction(emailCapability), '')
  assert.deepEqual(getCapabilityBridgePresentation(emailCapability), {
    id: 'email',
    state: 'connector-install-needed',
    label: 'Capability route: Email available to install',
    detail: 'Email is not installed. FounderLab did not attempt an external action.',
  })
  assert.match(getCapabilityBridgeGuidance(emailCapability), /not installed/i)
  assert.match(getCapabilityBridgeGuidance(emailCapability), /Do not claim/i)
  const emailContext = getChatRequestContext([{ role: 'user', content: 'Email the launch update to our client and turn it into a task.' }])
  assert.equal(emailContext.capabilityBridge.primary, 'email')
  assert.match(getChatSystemPrompt(emailContext), /Current capability-route note/i)
  assert.equal(getChatCapabilityBridge({ request: 'How should I write a better email to a client?', intent: classifyChatRequest('How should I write a better email to a client?') }), null)

  const repositoryIntent = classifyChatRequest('Audit this repository and prepare branch work.')
  const repositoryExecution = getChatExecutionBridge({
    request: 'Audit this repository and prepare branch work.',
    intent: repositoryIntent,
    modelRouting: { recommendation: { provider: 'groq', model: 'openai/gpt-oss-120b', path: 'cloud' } },
  })
  const githubCapability = getChatCapabilityBridge({
    request: 'Audit this repository and prepare branch work.',
    intent: repositoryIntent,
    executionBridge: repositoryExecution,
    integrations: { github: { connected: true, token: 'never persist' } },
  })
  assert.deepEqual(githubCapability, {
    version: 1,
    primary: 'github',
    routes: [{ id: 'github', kind: 'integration', availability: 'available', action: 'inspect-repo' }],
  })
  assert.equal(getCapabilityBridgeHandoffAction(githubCapability), '')

  const readOnlyGithub = getChatCapabilityBridge({
    request: 'Audit this repository and prepare branch work.',
    intent: repositoryIntent,
    executionBridge: repositoryExecution,
    executionWorkflow: { approval: 'approved', branch: { state: 'planned' } },
    integrations: { github: { connected: true, writable: false } },
  })
  assert.equal(getCapabilityBridgePresentation(readOnlyGithub).state, 'read-only-integration')
  assert.match(getCapabilityBridgeGuidance(readOnlyGithub), /read-only/i)
  assert.equal(getChatExecutionState({ mode: 'operator', capability: getCapabilityBridgePresentation(readOnlyGithub) }).key, 'read-only-integration')

  const unauthorizedGithub = getChatCapabilityBridge({
    request: 'Audit this repository and prepare branch work.',
    intent: repositoryIntent,
    executionBridge: repositoryExecution,
    executionWorkflow: { approval: 'approved', branch: { state: 'planned' } },
    integrations: { github: { connected: true, authorization: 'denied' } },
  })
  assert.equal(getCapabilityBridgePresentation(unauthorizedGithub).state, 'authorization-needed')

  const normalized = normalizeCapabilityBridge({
    primary: 'email',
    routes: [
      { id: 'email', kind: 'integration', availability: 'not-connected', account: 'private@example.com' },
      { id: 'invalid', kind: 'integration', availability: 'connected' },
    ],
    rawRequest: 'never persist',
  })
  assert.deepEqual(normalized, {
    version: 1,
    primary: 'email',
    routes: [{ id: 'email', kind: 'integration', availability: 'not-connected' }],
  })
  assert.equal(JSON.stringify(normalized).includes('private'), false)

  const orchestration = createAssistantOrchestration({ intent: emailIntent, capabilityBridge: emailCapability })
  assert.deepEqual(orchestration.capabilities, emailCapability)
  assert.deepEqual(normalizeMessageOrchestration({ ...orchestration, capabilities: { ...emailCapability, secret: 'never persist' } }).capabilities, emailCapability)
})

test('Connector framework unifies discovery, authorization, fallback, and safe action evidence without persisting credentials', () => {
  assert.deepEqual(getConnectorRegistryEntry('github'), {
    id: 'github', label: 'GitHub', kind: 'integration', scope: 'external',
    actions: [
      { id: 'inspect-repo', label: 'Inspect public repository', access: 'read', approval: 'not-required', publicRead: true },
      { id: 'prepare-branch', label: 'Prepare branch plan', access: 'read', approval: 'not-required', localPreparation: true },
      { id: 'prepare-execution', label: 'Prepare execution workflow', access: 'read', approval: 'not-required', localPreparation: true },
      { id: 'approve-execution', label: 'Record execution approval', access: 'write', approval: 'not-required', localPreparation: true },
      { id: 'create-branch', label: 'Create approved branch', access: 'write', approval: 'required' },
      { id: 'apply-file-change', label: 'Commit reviewed changes', access: 'write', approval: 'required' },
      { id: 'validate', label: 'Read commit validation', access: 'read', approval: 'not-required' },
      { id: 'review', label: 'Prepare review summary', access: 'read', approval: 'not-required', localPreparation: true },
      { id: 'retry-execution', label: 'Restore retry path', access: 'read', approval: 'not-required', localPreparation: true },
    ],
  })
  assert.equal(getConnectorRegistryEntry('unknown'), null)

  const request = 'Email the launch update to our client.'
  const intent = classifyChatRequest(request)
  const stateFor = (integrations, executionWorkflow = null) => getChatConnectorPlan({ request, intent, integrations, executionWorkflow })
  const email = (plan) => plan.connectors.find((connector) => connector.id === 'email')

  const notInstalled = stateFor()
  assert.equal(notInstalled.decision, 'integration-blocked')
  assert.equal(email(notInstalled).installation, 'not-installed')
  assert.equal(email(notInstalled).actionReadiness, 'not-installed')
  assert.deepEqual(notInstalled.fallback, { kind: 'manual', label: 'Continue in Chat with manual guidance' })
  assert.match(getConnectorPlanGuidance(notInstalled), /available as a future connector|safe fallback/i)
  assert.equal(getConnectorPlanPresentation(notInstalled).state, 'connector-install-needed')

  const notConfigured = stateFor({ email: { installed: true, configured: false, token: 'never persist' } })
  assert.equal(email(notConfigured).installation, 'installed')
  assert.equal(email(notConfigured).configuration, 'not-configured')
  assert.equal(email(notConfigured).actionReadiness, 'not-configured')

  const unauthorized = stateFor({ email: { installed: true, configured: true, connected: false, authorization: 'not-authorized' } })
  assert.equal(email(unauthorized).authorization, 'not-authorized')
  assert.equal(email(unauthorized).actionReadiness, 'not-authorized')

  const readOnly = stateFor({ email: { installed: true, configured: true, connected: true, writable: false } })
  assert.equal(email(readOnly).access, 'read-only')
  assert.equal(email(readOnly).actionReadiness, 'read-only')

  const awaitingApproval = stateFor({ email: { installed: true, configured: true, connected: true, writable: true } })
  assert.equal(awaitingApproval.decision, 'approval-required')
  assert.equal(email(awaitingApproval).actionReadiness, 'approval-required')
  const writable = stateFor(
    { email: { installed: true, configured: true, connected: true, writable: true } },
    { approval: 'approved', branch: { state: 'planned' } },
  )
  assert.equal(writable.decision, 'tool-required')
  assert.equal(email(writable).access, 'writable')
  assert.equal(email(writable).actionReadiness, 'available')

  const unavailable = stateFor({ email: { installed: true, configured: true, connected: true, writable: true, temporarilyUnavailable: true } })
  assert.equal(email(unavailable).health, 'temporarily-unavailable')
  assert.equal(email(unavailable).actionReadiness, 'temporarily-unavailable')

  const githubRequest = 'Audit this repository and prepare a fix branch.'
  const githubIntent = classifyChatRequest(githubRequest)
  const githubPlan = getChatConnectorPlan({
    request: githubRequest,
    intent: githubIntent,
    executionBridge: { target: { surface: 'github', repository: { owner: 'acme', repo: 'founderlab' } }, branch: 'required' },
    integrations: { github: { temporarilyUnavailable: true } },
  })
  assert.equal(githubPlan.primary, 'github')
  assert.deepEqual(githubPlan.fallback, { kind: 'connector', id: 'code', label: 'Code AI is an acceptable fallback' })

  const approvedGithubPlan = getChatConnectorPlan({
    request: githubRequest,
    intent: githubIntent,
    executionBridge: { target: { surface: 'github', repository: { owner: 'acme', repo: 'founderlab' } }, branch: 'required' },
    executionWorkflow: { approval: 'approved', branch: { state: 'planned' }, capability: { connection: 'connected', authorization: 'writable', execution: 'write-ready' } },
    integrations: { github: { configured: true, connected: true, authorization: 'authorized', writable: true } },
  })
  assert.equal(approvedGithubPlan.connectors.find((connector) => connector.id === 'github').action, 'create-branch')
  const changeReadyPlan = refreshConnectorPlanForExecution(approvedGithubPlan, {
    approval: 'approved', branch: { state: 'created' }, change: { state: 'prepared' }, capability: { connection: 'connected', authorization: 'writable', execution: 'write-ready' },
  })
  assert.equal(changeReadyPlan.connectors.find((connector) => connector.id === 'github').action, 'apply-file-change')
  const validationReadyPlan = refreshConnectorPlanForExecution(changeReadyPlan, {
    approval: 'approved', branch: { state: 'created' }, change: { state: 'applied' }, capability: { connection: 'connected', authorization: 'writable', execution: 'write-ready' },
  })
  assert.equal(validationReadyPlan.connectors.find((connector) => connector.id === 'github').action, 'validate')

  const normalized = normalizeConnectorPlan({
    ...writable,
    secret: 'never persist',
    connectors: [{ ...email(writable), account: 'private@example.com', token: 'never persist' }],
  })
  assert.equal(JSON.stringify(normalized).includes('private'), false)
  assert.equal(JSON.stringify(normalized).includes('never persist'), false)
  assert.deepEqual(getConnectorActionEvidence({ id: 'create-task', status: 'completed' }), {
    connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified',
  })
  assert.equal(normalizeConnectorActionEvidence({ connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified', raw: 'never persist' }).raw, undefined)

  const context = getChatRequestContext([{ role: 'user', content: request }])
  assert.equal(context.connectorPlan.primary, 'email')
  assert.match(getChatSystemPrompt(context), /Current connector-selection note/i)
})

test('Shared integrations platform resolves safe connector states and dispatches only real approved executors', async () => {
  const githubDefault = resolveConnector('github')
  assert.deepEqual(githubDefault, {
    id: 'github', label: 'GitHub', description: 'Inspect repositories and make explicitly approved branch-first changes.', icon: '⌘',
    kind: 'integration', scope: 'external', installation: 'installed', configuration: 'not-configured', authorization: 'not-authorized', access: 'not-applicable', health: 'healthy', readiness: 'not-configured',
    action: 'inspect-repo', actionLabel: 'Inspect public repository', actionReadiness: 'available', approval: 'not-required',
  })
  assert.equal(getConnectorForAction('apply-file-change'), 'github')
  assert.equal(getConnectorForAction('send-email'), 'email')
  assert.equal(getConnectorForAction('unknown-action'), '')

  const authorizedGitHub = normalizeConnectorRuntime('github', {
    installed: true, configured: true, connected: true, authorization: 'authorized', writable: true, token: 'never persist', account: 'private@example.com',
  })
  assert.deepEqual(authorizedGitHub, {
    installation: 'installed', configuration: 'configured', authorization: 'authorized', access: 'writable', health: 'healthy',
  })
  assert.equal(JSON.stringify(authorizedGitHub).includes('never persist'), false)
  assert.equal(getConnectorActionReadiness('github', 'create-branch', authorizedGitHub), 'approval-required')
  assert.equal(getConnectorActionReadiness('github', 'create-branch', authorizedGitHub, { approvalRecorded: true }), 'available')
  assert.equal(getConnectorActionReadiness('github', 'prepare-branch', githubDefault), 'available')
  assert.deepEqual(createConnectorExecutionRequest({
    connectorId: 'github', actionId: 'create-branch', runtime: authorizedGitHub, approvalRecorded: true,
  }), {
    connectorId: 'github', actionId: 'create-branch', runtime: authorizedGitHub, approvalRecorded: true,
  })

  const settingsConnectors = getIntegrationSettingsConnectors({ github: { configured: true, connected: true, authorization: 'authorized', writable: true } })
  assert.deepEqual(settingsConnectors.map((connector) => connector.id), ['github', 'email', 'calendar'])
  assert.equal(settingsConnectors.find((connector) => connector.id === 'github').readiness, 'writable')
  assert.equal(settingsConnectors.find((connector) => connector.id === 'email').readiness, 'not-installed')

  let calls = 0
  const blocked = await executeConnectorAction({
    connectorId: 'github', actionId: 'create-branch', runtime: null, approvalRecorded: true,
    executor: async () => { calls += 1; return { branch: 'should-not-exist' } },
  })
  assert.deepEqual(blocked, {
    connector: 'github', action: 'create-branch', state: 'blocked', evidence: 'failure-recorded', reason: 'not-configured',
  })
  assert.equal(calls, 0)

  const prepared = await executeConnectorAction({
    connectorId: 'github', actionId: 'prepare-branch', runtime: null,
    executor: async () => { calls += 1; return { branch: 'founderlab/fix-chat' } },
  })
  assert.equal(prepared.state, 'completed')
  assert.equal(prepared.evidence, 'locally-verified')
  assert.equal(prepared.result.branch, 'founderlab/fix-chat')
  assert.equal(calls, 1)

  const created = await executeConnectorAction({
    connectorId: 'github', actionId: 'create-branch', runtime: authorizedGitHub, approvalRecorded: true,
    executor: async () => { calls += 1; return { branch: 'founderlab/fix-chat', commitSha: 'abc1234' } },
  })
  assert.equal(created.state, 'completed')
  assert.equal(created.evidence, 'externally-verified')
  assert.equal(created.result.commitSha, 'abc1234')
  assert.equal(calls, 2)
})

test('GitHub connector verification returns a safe capability result without retaining token or raw provider detail', async () => {
  const connected = await verifyGithubConnectorSession(' ghp_private ', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.github.com/user')
      assert.equal(options.headers.Authorization, 'Bearer ghp_private')
      return { ok: true, json: async () => ({ login: 'founderlab-ai' }) }
    },
  })
  assert.deepEqual(connected, {
    ok: true,
    identity: { login: 'founderlab-ai' },
    runtime: { configured: true, connected: true, authorization: 'authorized', health: 'healthy' },
  })
  assert.equal(JSON.stringify(connected).includes('ghp_private'), false)

  const rejected = await verifyGithubConnectorSession('ghp_private', { fetchImpl: async () => ({ ok: false }) })
  assert.deepEqual(rejected, {
    ok: false, reason: 'not-authorized', runtime: { configured: true, connected: false, authorization: 'not-authorized', health: 'healthy' },
  })
  const unavailable = await verifyGithubConnectorSession('ghp_private', { fetchImpl: async () => { throw new Error('network details never leak') } })
  assert.deepEqual(unavailable, {
    ok: false, reason: 'temporarily-unavailable', runtime: { configured: true, connected: false, authorization: 'not-authorized', health: 'temporarily-unavailable' },
  })
})

test('operator transparency labels a recommendation, handoff, and FounderLab-local completion without claiming external execution', () => {
  const recommendation = getChatExecutionTransparency({
    mode: 'planning',
    operation: 'plan',
    routing: { selected: { provider: 'gemini', model: 'gemini-3.5-flash', path: 'cloud' } },
    actions: [],
  })
  assert.equal(recommendation.outcome.kind, 'recommendation')
  assert.equal(recommendation.outcome.label, 'Plan prepared')
  assert.match(recommendation.outcome.detail, /has not performed/i)
  assert.equal(recommendation.intentLabel, 'Understanding: a planning request')
  assert.equal(recommendation.route.label, 'Route: Cloud gemini · gemini-3.5-flash')

  const handoff = getChatExecutionTransparency({
    mode: 'operator', operation: 'handoff', actions: [{ id: 'builder', status: 'handoff-opened' }],
  })
  assert.equal(handoff.outcome.kind, 'handoff')
  assert.match(handoff.outcome.detail, /no external work is confirmed/i)

  const completed = getChatExecutionTransparency({
    mode: 'operator', operation: 'capture', actions: [{ id: 'create-task', status: 'completed' }],
  })
  assert.equal(completed.outcome.kind, 'completed')
  assert.equal(completed.outcome.label, 'Created a task in FounderLab')
  assert.match(completed.nextStep, /recorded FounderLab action/i)
  assert.equal(getChatExecutionTransparency({ mode: 'conversation', operation: 'explain', actions: [] }), null)
})

test('Execution-state reporting distinguishes planning, inspection, approval, handoff, local completion, and external integration needs', () => {
  const emailCapability = getChatCapabilityBridge({ request: 'Send an email update.', intent: classifyChatRequest('Send an email update.') })
  const integration = getChatExecutionTransparency({
    mode: 'operator', operation: 'handoff', actions: [], capabilities: emailCapability,
  })
  assert.equal(integration.state.key, 'connector-install-needed')

  const inspection = getChatExecutionState({
    mode: 'operator',
    execution: { readiness: 'ready-to-inspect' },
  })
  assert.equal(inspection.key, 'inspection-needed')
  const approval = getChatExecutionState({
    mode: 'operator',
    execution: { readiness: 'waiting-for-approval' },
  })
  assert.equal(approval.key, 'waiting-for-approval')
  const ready = getChatExecutionState({
    mode: 'operator',
    execution: { readiness: 'execution-path-selected' },
  })
  assert.equal(ready.key, 'ready-for-execution')
  const handoff = getChatExecutionState({
    mode: 'operator',
    actions: [{ kind: 'handoff' }],
  })
  assert.equal(handoff.key, 'handoff-opened')
  const completed = getChatExecutionState({
    mode: 'operator',
    actions: [{ kind: 'completed' }],
  })
  assert.equal(completed.key, 'completed-locally')
  assert.equal(getChatExecutionState({ mode: 'planning' }).key, 'plan-prepared')
  assert.equal(getChatExecutionState().key, 'conversational-only')
})

test('Project-aware Chat memory persists bounded working context without copying note bodies, project files, or raw answers', () => {
  const workspace = buildWorkspaceAwareness({
    projects: [{ id: 'builder-project', name: 'Coachly Landing', type: 'builder', files: [{ path: 'secret.tsx', content: 'never include' }], updated_at: '2026-07-23T10:00:00.000Z' }],
    tasks: [{ id: 'task-1', title: 'Review onboarding flow', status: 'todo', description: 'never include', updated_at: '2026-07-23T09:00:00.000Z' }],
    notes: [{ id: 'note-1', title: 'Launch decisions', content: 'private note content', updated_at: '2026-07-23T08:00:00.000Z' }],
  })
  assert.deepEqual(workspace.projects, [{ id: 'builder-project', name: 'Coachly Landing', type: 'builder', updated_at: '2026-07-23T10:00:00.000Z' }])
  assert.deepEqual(workspace.tasks, [{ id: 'task-1', title: 'Review onboarding flow', status: 'todo', updated_at: '2026-07-23T09:00:00.000Z' }])
  assert.deepEqual(workspace.notes, [{ id: 'note-1', title: 'Launch decisions', updated_at: '2026-07-23T08:00:00.000Z' }])

  const conversations = [{
    id: 'coachly-chat', title: 'Coachly build', updated_at: '2026-07-23T10:05:00.000Z', messages: [
      { role: 'user', content: 'Build a landing page for Coachly.' },
      { role: 'assistant', content: 'Here is the plan.', orchestration: {
        mode: 'operator', operation: 'create', primaryTool: 'builder', actions: [{ id: 'builder', status: 'handoff-opened' }],
      } },
    ],
  }]
  const memory = reconcileChatMemory(null, conversations, workspace, 'coachly-chat')
  assert.equal(memory.activeConversationId, 'coachly-chat')
  assert.equal(memory.threads.length, 1)
  assert.equal(memory.threads[0].objective, 'Build a landing page for Coachly.')
  assert.equal(memory.threads[0].project.name, 'Coachly Landing')
  assert.equal(memory.threads[0].artifact, 'plan')
  assert.doesNotMatch(JSON.stringify(memory), /private note content|never include|Here is the plan/i)
  assert.deepEqual(normalizeChatMemory({ version: 1, activeConversationId: 42, threads: [null, { conversationId: '', actions: [] }] }).value, {
    version: 1,
    activeConversationId: '',
    threads: [],
  })
})

test('Project-aware Chat context carries a verified task and project forward without claiming external execution', () => {
  const workspace = buildWorkspaceAwareness({
    projects: [{ id: 'founderlab-project', name: 'FounderLab', type: 'product' }],
    tasks: [{ id: 'task-1', title: 'Review onboarding flow', status: 'todo' }],
  })
  const memory = reconcileChatMemory({
    version: 1,
    activeConversationId: 'thread-1',
    threads: [{
      conversationId: 'thread-1', title: 'Onboarding', objective: 'Improve FounderLab onboarding.', updated_at: '2026-07-23T10:00:00.000Z',
      actions: [{ id: 'create-task', status: 'completed', resource: { type: 'task', id: 'task-1', title: 'Review onboarding flow' } }],
    }],
  }, [{
    id: 'thread-1', title: 'Onboarding', updated_at: '2026-07-23T10:00:00.000Z', messages: [{
      role: 'assistant', content: 'The onboarding task is ready.', orchestration: {
        mode: 'operator', operation: 'capture', actions: [{
          id: 'create-task', status: 'completed', resource: { type: 'task', id: 'task-1', title: 'Review onboarding flow' },
          connectorAction: { connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified' },
        }],
      },
    }],
  }], workspace, 'thread-1')
  const orchestration = getChatOrchestrationContext([
    { role: 'assistant', content: 'The onboarding task is ready.' },
    { role: 'user', content: 'Continue the FounderLab work on that task from earlier.' },
  ])
  const awareness = getProjectAwareness(memory, workspace, {
    conversationId: 'thread-1', request: 'Continue the FounderLab work on that task from earlier.', orchestration,
  })
  assert.equal(awareness.project.name, 'FounderLab')
  assert.equal(awareness.task.title, 'Review onboarding flow')
  assert.deepEqual(awareness.actions[0].connectorAction, {
    connector: 'tasks', action: 'create-task', state: 'completed', evidence: 'locally-verified',
  })
  const guidance = getProjectAwarenessGuidance(awareness)
  assert.match(guidance, /does not confirm its files, repository, or deployment were inspected/i)
  assert.match(guidance, /not proof that work was verified/i)
  assert.match(getChatSystemPrompt({ intent: orchestration.intent, orchestration, projectAwareness: awareness }), /Current project-awareness note/i)

  const resumed = getProjectAwareness(memory, workspace, {
    conversationId: 'fresh-thread', request: 'Continue the FounderLab project we were working on.', orchestration,
  })
  assert.equal(resumed.scope, 'recent-memory')
  assert.equal(resumed.task.title, 'Review onboarding flow')
  assert.match(getProjectAwarenessGuidance(resumed), /recent saved Chat working context/i)

  const codeMemory = reconcileChatMemory(null, [{
    id: 'code-thread', title: 'Code', updated_at: '2026-07-23T11:00:00.000Z', messages: [
      { role: 'user', content: 'Implement a signup form.' },
      { role: 'assistant', content: '```tsx\nexport function Signup() { return null }\n```' },
    ],
  }], workspace, 'code-thread')
  const codeAwareness = getProjectAwareness(codeMemory, workspace, {
    conversationId: 'fresh-thread', request: 'Continue the code from before.', orchestration,
  })
  assert.equal(codeAwareness.artifact, 'code')
  assert.match(getProjectAwarenessGuidance(codeAwareness), /raw content is not loaded into this thread/i)
})

test('Chat control center offers only explicit, real workspace actions and bounded handoffs', () => {
  assert.deepEqual(getChatControlActions('Can you turn this into a task?').map((action) => action.id), ['create-task'])
  assert.deepEqual(getChatControlActions('Save this in Notes and use this idea in Builder.').map((action) => action.id), ['save-note', 'builder'])
  assert.deepEqual(getChatControlActions('Help me create an app for investor onboarding.').map((action) => action.id), ['builder'])
  assert.deepEqual(getChatControlActions('Prepare this implementation for GitHub.').map((action) => action.id), ['github'])
  assert.deepEqual(getChatControlActions('Inspect https://github.com/acme/founderlab and fix the onboarding crash.').map((action) => action.id), ['inspect-repo'])
  assert.deepEqual(getChatControlActions('Use this idea for YouTube content.').map((action) => action.id), ['youtube'])
  assert.deepEqual(getChatControlActions('What time is it in London?'), [])
  assert.deepEqual(getChatControlActions('What is GitHub and how does an API work?'), [])

  const emailRequest = 'Email the launch update to our client.'
  const emailConnectorPlan = getChatConnectorPlan({ request: emailRequest, intent: classifyChatRequest(emailRequest) })
  const blockedConnectorActions = getAssistantControlActions([
    { role: 'user', content: emailRequest },
    { role: 'assistant', content: 'Email needs a verified connector first.', orchestration: { connectorPlan: emailConnectorPlan, actions: [] } },
  ], 1)
  assert.deepEqual(blockedConnectorActions.map((action) => action.id), ['manage-integrations'])

  const actions = getAssistantControlActions([
    { role: 'user', content: 'Turn this into a task and prepare it for GitHub.' },
    { role: 'assistant', content: 'Here is a safe implementation plan.' },
  ], 1)
  assert.deepEqual(actions.map((action) => action.id), ['create-task', 'github'])
  assert.match(actions[1].request, /GitHub/i)

  const executionActions = getAssistantControlActions([
    { role: 'user', content: 'Fix this bug in the FounderLab codebase.' },
    { role: 'assistant', content: 'I prepared an inspection path.', orchestration: {
      version: 1,
      mode: 'operator',
      operation: 'change',
      execution: {
        target: { surface: 'repository', project: { id: 'founderlab', name: 'FounderLab', type: 'product' } },
        requestedOperation: 'change', repoAwareness: 'needed', readiness: 'waiting-for-approval', risk: 'medium', branch: 'required', inspection: 'required', approval: 'required', handoff: 'code',
      },
      actions: [],
    } },
  ], 1)
  assert.deepEqual(executionActions.map((action) => action.id), [])

  const branchActions = getAssistantControlActions([
    { role: 'user', content: 'Fix the onboarding crash in https://github.com/acme/founderlab.' },
    { role: 'assistant', content: 'I inspected the repository.', orchestration: {
      version: 1,
      mode: 'operator',
      operation: 'change',
      execution: {
        target: { surface: 'repository', repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' } },
        requestedOperation: 'change', repoAwareness: 'needed', readiness: 'waiting-for-approval', risk: 'medium', branch: 'required', inspection: 'completed', approval: 'required', handoff: 'code',
      },
      actions: [{ id: 'inspect-repo', status: 'inspection-completed', resource: { type: 'repository', id: 'github:acme/founderlab@main', title: 'acme/founderlab' } }],
    } },
  ], 1)
  assert.deepEqual(branchActions.map((action) => action.id), ['prepare-branch'])

  const preparedWorkflow = normalizeExecutionWorkflow({
    version: 1,
    repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' },
    branch: { state: 'planned', base: 'main', proposed: 'founderlab/fix-onboarding-crash' },
    change: { state: 'prepared', risk: 'medium', fileTargets: ['src/App.jsx'] },
    validation: { tests: 'required', build: 'required', report: 'required' },
    approval: 'required', review: 'awaiting-approval', execution: 'awaiting-approval', executor: 'not-available',
  })
  const executionWorkflowActions = getAssistantControlActions([
    { role: 'user', content: 'Fix the onboarding crash in https://github.com/acme/founderlab.' },
    { role: 'assistant', content: 'The branch plan is ready.', orchestration: {
      version: 1,
      mode: 'operator',
      operation: 'change',
      execution: {
        target: { surface: 'repository', repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' } },
        requestedOperation: 'change', repoAwareness: 'needed', readiness: 'waiting-for-approval', risk: 'medium', branch: 'required', inspection: 'completed', approval: 'required', handoff: 'code',
      },
      actions: [
        { id: 'inspect-repo', status: 'inspection-completed', resource: { type: 'repository', id: 'github:acme/founderlab@main', title: 'acme/founderlab' } },
        { id: 'prepare-branch', status: 'branch-prepared', resource: { type: 'branch', id: 'github:acme/founderlab#founderlab/fix-onboarding-crash', title: 'founderlab/fix-onboarding-crash' } },
      ],
    } },
  ], 1)
  assert.deepEqual(executionWorkflowActions.map((action) => action.id), ['prepare-execution'])

  const approvalActions = getAssistantControlActions([
    { role: 'user', content: 'Fix the onboarding crash in https://github.com/acme/founderlab.' },
    { role: 'assistant', content: 'The execution workflow is ready.', orchestration: {
      version: 1,
      mode: 'operator',
      operation: 'change',
      execution: {
        target: { surface: 'repository', repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' } },
        requestedOperation: 'change', repoAwareness: 'needed', readiness: 'waiting-for-approval', risk: 'medium', branch: 'required', inspection: 'completed', approval: 'required', handoff: 'code',
      },
      workflow: preparedWorkflow,
      actions: [
        { id: 'inspect-repo', status: 'inspection-completed', resource: { type: 'repository', id: 'github:acme/founderlab@main', title: 'acme/founderlab' } },
        { id: 'prepare-branch', status: 'branch-prepared', resource: { type: 'branch', id: 'github:acme/founderlab#founderlab/fix-onboarding-crash', title: 'founderlab/fix-onboarding-crash' } },
        { id: 'prepare-execution', status: 'execution-prepared', resource: { type: 'branch', id: 'github:acme/founderlab#founderlab/fix-onboarding-crash', title: 'founderlab/fix-onboarding-crash' } },
      ],
    } },
  ], 1)
  assert.deepEqual(approvalActions.map((action) => action.id), ['approve-execution'])

  const approvedWorkflow = approveExecutionWorkflow(preparedWorkflow)
  const approvedAssistant = [
    { role: 'user', content: 'Fix the onboarding crash in https://github.com/acme/founderlab.' },
    { role: 'assistant', content: 'Approval is recorded.', orchestration: {
      version: 1, mode: 'operator', operation: 'change',
      execution: {
        target: { surface: 'repository', repository: { provider: 'github', owner: 'acme', name: 'founderlab', slug: 'acme/founderlab' } },
        requestedOperation: 'change', repoAwareness: 'needed', readiness: 'waiting-for-approval', risk: 'medium', branch: 'required', inspection: 'completed', approval: 'required', handoff: 'code',
      },
      workflow: approvedWorkflow,
      actions: [
        { id: 'inspect-repo', status: 'inspection-completed', resource: { type: 'repository', id: 'github:acme/founderlab@main', title: 'acme/founderlab' } },
        { id: 'prepare-branch', status: 'branch-prepared', resource: { type: 'branch', id: 'github:acme/founderlab#founderlab/fix-onboarding-crash', title: 'founderlab/fix-onboarding-crash' } },
        { id: 'prepare-execution', status: 'execution-prepared', resource: { type: 'branch', id: 'github:acme/founderlab#founderlab/fix-onboarding-crash', title: 'founderlab/fix-onboarding-crash' } },
        { id: 'approve-execution', status: 'approval-recorded', resource: { type: 'branch', id: 'github:acme/founderlab#founderlab/fix-onboarding-crash', title: 'founderlab/fix-onboarding-crash' } },
      ],
    } },
  ]
  assert.deepEqual(getAssistantControlActions(approvedAssistant, 1).map((action) => action.id), ['connect-github'])
  assert.deepEqual(getAssistantControlActions(approvedAssistant, 1, { githubConnected: true }).map((action) => action.id), ['create-branch'])

  const createdWorkflow = recordExecutionWorkflowBranchCreated(approvedWorkflow)
  const createdAssistant = [approvedAssistant[0], {
    ...approvedAssistant[1],
    orchestration: {
      ...approvedAssistant[1].orchestration,
      workflow: createdWorkflow,
      actions: [...approvedAssistant[1].orchestration.actions, { id: 'create-branch', status: 'branch-created' }],
    },
  }]
  assert.deepEqual(getAssistantControlActions(createdAssistant, 1, { githubConnected: true }).map((action) => action.id), ['apply-file-change'])

  const changedWorkflow = recordExecutionWorkflowFileChange(createdWorkflow, {
    path: 'src/App.jsx', commitSha: 'abcdef1234567', source: 'github-api',
  })
  const changedAssistant = [approvedAssistant[0], {
    ...approvedAssistant[1],
    orchestration: {
      ...approvedAssistant[1].orchestration,
      workflow: changedWorkflow,
      actions: [...createdAssistant[1].orchestration.actions, { id: 'apply-file-change', status: 'change-applied' }],
    },
  }]
  assert.deepEqual(getAssistantControlActions(changedAssistant, 1, { githubConnected: true }).map((action) => action.id), ['validate'])

  const validatedWorkflow = recordExecutionWorkflowValidation(changedWorkflow, {
    tests: 'passed', build: 'passed', report: 'passed', source: 'github-api',
  })
  const validatedAssistant = [approvedAssistant[0], {
    ...approvedAssistant[1],
    orchestration: {
      ...approvedAssistant[1].orchestration,
      workflow: validatedWorkflow,
      actions: [...changedAssistant[1].orchestration.actions, { id: 'validate', status: 'validation-passed' }],
    },
  }]
  assert.deepEqual(getAssistantControlActions(validatedAssistant, 1, { githubConnected: true }).map((action) => action.id), ['review'])

  const builderPayload = buildChatHandoffPayload('builder', { request: 'Create an onboarding app', response: 'Plan the user flow first.' })
  assert.match(builderPayload.desc, /FounderLab Chat brief/)
  assert.match(builderPayload.desc, /Create an onboarding app/)
  const boundedPayload = buildChatHandoffPayload('code', { request: 'x'.repeat(3000), response: 'y'.repeat(6000) })
  assert.equal(boundedPayload.desc.length <= 6200, true)
  const githubPayload = buildChatHandoffPayload('github', { request: 'Prepare this for GitHub', response: 'Add tests first.' })
  assert.match(githubPayload.desc, /Do not push anything until the user explicitly confirms/i)
  assert.deepEqual(buildChatHandoffPayload('youtube', { request: 'Create founder content' }), { title: 'Create founder content' })
  assert.equal(buildChatHandoffPayload('unknown', { request: 'No action' }), null)
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
  assert.deepEqual(
    applyFinalSpeechPhrase(['Draft the gim plan'], 'Draft the gym plan for investors'),
    ['Draft the gym plan for investors'],
  )
  assert.deepEqual(
    applyFinalSpeechPhrase(['Draft the gim plan'], 'Draft the gym plan'),
    ['Draft the gym plan'],
  )
  assert.deepEqual(
    applyFinalSpeechPhrase(['Draft the launch plan'], 'Draft the launch plan'),
    ['Draft the launch plan'],
  )
  assert.deepEqual(
    applyFinalSpeechPhrase(['Draft a marketing plan'], 'Draft a marketing plan, actually draft a launch plan'),
    ['draft a launch plan'],
  )
  assert.equal(normalizeFinalSpokenPhrase(' um, draft the launch plan '), 'draft the launch plan')
  assert.equal(getExplicitSelfCorrection('Draft a marketing plan; actually draft a launch plan'), 'draft a launch plan')
  assert.equal(getExplicitSelfCorrection('Draft the marketing plan, sorry, draft the launch plan'), 'draft the launch plan')
  assert.equal(getExplicitSelfCorrection('I said gym, not gim'), 'gym')
  assert.equal(isLikelyRestartExtension('Draft the gim plan', 'Draft the gym plan for investors'), true)
  assert.equal(isLikelyRestartExtension('Draft the launch plan', 'Draft the budget plan for investors'), false)
  assert.equal(isLikelySingleWordRevision('Draft the gim plan', 'Draft the gym plan'), true)
  assert.equal(isLikelySingleWordRevision('Draft the launch plan', 'Draft the budget plan'), false)
  assert.equal(mergeLiveTranscript('Launch plan', 'Launch plan', 'Launch plan with a stronger CTA'), 'Launch plan with a stronger CTA')
  assert.equal(mergeLiveTranscript('Launch plan please', 'Launch plan', 'Launch plan with a stronger CTA'), 'Launch plan with a stronger CTA please')
  assert.equal(mergeLiveTranscript('Manual revision', 'Launch plan', 'Launch plan with a stronger CTA'), 'Manual revision with a stronger CTA')
  assert.equal(shouldResumeVoiceInput({ desired: true, error: 'no-speech' }), true)
  assert.equal(shouldResumeVoiceInput({ desired: true, error: '' }), true)
  assert.equal(shouldResumeVoiceInput({ desired: false, error: 'no-speech' }), false)
  assert.equal(shouldResumeVoiceInput({ desired: true, error: 'not-allowed' }), false)
  assert.equal(VOICE_INPUT_RESTART_DELAY_MS >= 150 && VOICE_INPUT_RESTART_DELAY_MS <= 250, true)
  assert.match(voiceInputStatusCopy('starting'), /begin speaking/i)
  assert.match(voiceInputStatusCopy('listening'), /pause naturally/i)
  assert.match(voiceInputStatusCopy('resuming'), /keeping your place/i)
})

test('Normal read-aloud and voice sessions preserve full ordinary answers before using a summary', () => {
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

  const long = createVoiceResponsePlan('A practical plan starts with a clear customer promise. '.repeat(150))
  assert.equal(long.mode, 'summary')
  assert.equal(long.spokenText.length <= MAX_FULL_VOICE_RESPONSE_LENGTH, true)
  assert.match(long.spokenText, /full breakdown in the chat/i)

  const structured = createVoiceResponsePlan('## Launch plan\n\n- Clarify the customer promise\n- Test the onboarding flow\n- Measure conversion before scaling\n\n[Research](https://example.com/research)')
  assert.equal(structured.mode, 'conversational')
  assert.match(structured.spokenText, /Clarify the customer promise/i)
  assert.match(structured.spokenText, /Measure conversion before scaling/i)
  assert.equal(structured.spokenText.includes('https://'), false)
  assert.equal(structured.spokenText.includes('full breakdown in the chat'), false)

  const mediumStructured = createVoiceResponsePlan(`## Working plan\n\n${Array.from({ length: 5 }, (_, index) => `- Helpful action ${index + 1} that keeps the launch moving`).join('\n')}`)
  assert.equal(mediumStructured.spokenText.length < MAX_STRUCTURED_FULL_VOICE_RESPONSE_LENGTH, true)
  assert.equal(mediumStructured.mode, 'conversational')

  const normalReadAloud = createReadAloudPlan('## Clear plan\n\n' + Array.from({ length: 18 }, (_, index) => `- Useful point ${index + 1} that remains readable aloud`).join('\n'))
  assert.equal(normalReadAloud.mode, 'full-read-aloud')
  assert.equal(normalReadAloud.spokenText.includes('full breakdown in the chat'), false)
  assert.equal(normalReadAloud.spokenText.length < MAX_FULL_READ_ALOUD_LENGTH, true)

  const mediumReadAloud = createReadAloudPlan('A founder-ready answer should stay complete when it is still comfortable to hear. '.repeat(86))
  assert.equal(mediumReadAloud.mode, 'full-read-aloud')
  assert.equal(mediumReadAloud.spokenText.includes('full breakdown in the chat'), false)
  assert.match(mediumReadAloud.spokenText, /comfortable to hear/i)

  const mediumStructuredReadAloud = createReadAloudPlan(Array.from({ length: 25 }, (_, index) => `- Practical step ${index + 1} for the launch`).join('\n'))
  assert.equal(mediumStructuredReadAloud.mode, 'full-read-aloud')
  assert.equal(mediumStructuredReadAloud.spokenText.includes('full breakdown in the chat'), false)

  const technicalReadAloud = createReadAloudPlan('Here is the implementation:\n```js\nconst answer = buildLaunchPlan()\n```')
  assert.equal(technicalReadAloud.mode, 'code-summary')
  assert.match(technicalReadAloud.spokenText, /full code and details in the chat/i)

  const tableReadAloud = createReadAloudPlan('| Owner | Status |\n| --- | --- |\n| Ada | Ready |\n| Sam | Review |')
  assert.equal(tableReadAloud.mode, 'data-summary')
  assert.match(tableReadAloud.spokenText, /full table in the chat/i)
})

test('Speech playback chunks long narration without truncating its ending', () => {
  const source = `${'A useful sentence for a founder. '.repeat(120)}The final recommendation must remain audible.`.trim()
  const chunks = splitSpeechForPlayback(source, 420)
  assert.equal(chunks.length > 1, true)
  assert.equal(chunks.every((chunk) => chunk.length <= 420), true)
  assert.match(chunks.at(-1), /final recommendation must remain audible/i)
  assert.equal(splitSpeechForPlayback('Short answer.').length, 1)
  assert.equal(MAX_SPEECH_PLAYBACK_CHUNK_LENGTH >= 1200, true)
})

test('Live Call uses one bounded turn model and accurately describes local and cloud provider support', () => {
  assert.equal(EMPTY_LIVE_CALL.phase, 'idle')
  assert.equal(LIVE_CALL_TURN_DELAY_MS >= 250 && LIVE_CALL_TURN_DELAY_MS <= 350, true)
  assert.equal(LIVE_CALL_SHORT_TURN_DELAY_MS >= 500 && LIVE_CALL_SHORT_TURN_DELAY_MS <= 650, true)
  assert.equal(getLiveCallTurnDelay('Help me shape the launch message.'), LIVE_CALL_TURN_DELAY_MS)
  assert.equal(getLiveCallTurnDelay('Hmm'), LIVE_CALL_SHORT_TURN_DELAY_MS)
  assert.equal(shouldQueueLiveCallTurn({ active: true, muted: false, isFinal: true, transcript: 'Help me plan a launch.' }), true)
  assert.equal(shouldQueueLiveCallTurn({ active: true, muted: true, isFinal: true, transcript: 'Do not send.' }), false)
  assert.equal(shouldQueueLiveCallTurn({ active: true, muted: false, isFinal: false, transcript: 'Still speaking' }), false)
  assert.equal(shouldQueueLiveCallTurn({ active: true, muted: false, isFinal: true, transcript: '   ' }), false)
  assert.equal(canInterruptLiveCall({ active: true, muted: false, phase: 'speaking' }), true)
  assert.equal(canInterruptLiveCall({ active: true, muted: true, phase: 'speaking' }), false)
  assert.equal(canInterruptLiveCall({ active: true, muted: false, phase: 'thinking' }), false)
  assert.equal(LIVE_CALL_PHASES.includes('interrupted'), true)
  assert.equal(LIVE_CALL_PHASES.includes('reconnecting'), true)

  assert.deepEqual(getLiveCallProviderSupport(null), {
    supported: false,
    label: 'Choose an AI provider before starting a live call.',
  })
  assert.deepEqual(getLiveCallProviderSupport({ id: 'ollama', local: true, model: 'llama3.2:3b-instruct-q4_K_M' }), {
    supported: true,
    local: true,
    label: 'Private local call · llama3.2:3b-instruct-q4_K_M',
  })
  assert.deepEqual(getLiveCallProviderSupport({ id: 'groq', name: 'Groq', local: false, model: 'GPT-OSS 120B' }), {
    supported: true,
    local: false,
    label: 'Groq · GPT-OSS 120B',
  })
  assert.match(getLiveCallCopy('listening').detail, /short pause/i)
  assert.match(getLiveCallCopy('speaking').detail, /interrupt/i)
  assert.match(getLiveCallCopy('interrupted').title, /listening/i)
  assert.match(getLiveCallCopy('unknown').title, /Call needs attention/i)
})

test('Live Call keeps turns ephemeral, saves one compact recap, and asks providers for conversational answers', () => {
  const recap = createLiveCallRecap([
    { role: 'user', content: 'Help me sharpen my launch positioning.' },
    { role: 'assistant', content: 'Lead with the concrete customer outcome, then support it with one clear proof point.' },
    { role: 'user', content: 'What should I test first?' },
    { role: 'assistant', content: 'Test the headline against the current version with a small, measurable audience.' },
    { role: 'user', content: 'This unfinished turn should not be written into the recap.' },
  ])
  assert.match(recap, /^## Live call recap/m)
  assert.match(recap, /What should I test first/i)
  assert.equal(recap.includes('This unfinished turn'), false)
  assert.match(recap, /FounderLab/i)
  assert.equal(createLiveCallRecap([{ role: 'user', content: 'No response yet.' }]), '')
  assert.equal(truncateLiveCallText('A useful answer. '.repeat(60), 120).length <= 121, true)
  assert.equal(getLiveCallTranscriptPreview('A useful answer. '.repeat(60)).length <= 141, true)

  const longPlan = createLiveCallResponsePlan('## Launch plan\n\n- Clarify the customer promise\n- Test a sharper headline\n- Measure conversion\n\nUse this detail to plan the rest of the week. '.repeat(8))
  assert.equal(longPlan.spokenText.length <= MAX_LIVE_CALL_SPEECH_LENGTH, true)
  assert.equal(longPlan.mode, 'call-summary')
  assert.doesNotMatch(longPlan.spokenText, /after the call/i)
  assert.doesNotMatch(longPlan.spokenText, /expand on any part/i)
  assert.equal(normalizeLiveCallResponseText('We can expand after the call.'), 'We can expand now.')

  const simpleAnswer = createLiveCallResponsePlan('Start with the audience that already feels the problem most sharply.')
  assert.equal(simpleAnswer.mode, 'call-conversational')
  assert.match(simpleAnswer.spokenText, /audience/i)
  const usefulCallAnswer = createLiveCallResponsePlan('Start with your current active users, because they already understand the pain. Ask them which moment creates the most friction, then use their exact wording in your landing-page headline. That gives you a concrete message to test this week.')
  assert.equal(usefulCallAnswer.mode, 'call-conversational')
  assert.match(usefulCallAnswer.spokenText, /current active users/i)
  assert.match(usefulCallAnswer.spokenText, /test this week/i)
  const completeCallAnswer = createLiveCallResponsePlan('Start with your active users, then ask where the workflow feels slowest. Use the same language in your landing-page headline, keep the promise specific, and test it against your current version with a small audience. If the result improves sign-ups, keep that message and carry it through the first onboarding screen. This gives you a useful signal before you invest in a broader redesign.')
  assert.equal(completeCallAnswer.mode, 'call-conversational')
  assert.match(completeCallAnswer.spokenText, /broader redesign/i)
  assert.match(getLiveCallSystemPrompt({ latestMessageIsVoice: true }), /real-time FounderLab voice call/i)
  assert.match(getLiveCallSystemPrompt(), /two to four concise sentences/i)
  assert.match(getLiveCallSystemPrompt(), /next one or two steps/i)
})

test('Live Call bounds context for faster turns without dropping the newest spoken request', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `Saved context ${index}`,
  }))
  const liveTurns = Array.from({ length: 10 }, (_, index) => ({
    role: index === 9 ? 'user' : index % 2 ? 'assistant' : 'user',
    content: index === 9 ? 'The newest live request must remain available.' : `Live turn ${index}`,
    ...(index === 9 ? { source: 'voice' } : {}),
  }))
  const context = buildLiveCallRequestContext(history, liveTurns)
  assert.equal(context.length <= 10, true)
  assert.equal(context.some((message) => message.content === 'Saved context 0'), false)
  assert.equal(context.at(-1)?.content, 'The newest live request must remain available.')
  assert.equal(context.at(-1)?.source, 'voice')
  assert.equal(context.reduce((sum, message) => sum + message.content.length, 0) <= 6000, true)
  assert.equal(LIVE_CALL_RESPONSE_OPTIONS.maxTokens, 190)
})

test('Voice narration removes presentation artifacts, links, emojis, and code while retaining natural meaning', () => {
  const narration = cleanTextForSpeech('## Launch update!!! 🚀\nUse `npm test` / `npm run build`; see [the guide](https://example.com/docs).\n```js\nconsole.log("internal")\n```')
  assert.equal(narration.includes('🚀'), false)
  assert.equal(narration.includes('https://'), false)
  assert.equal(narration.includes('console.log'), false)
  assert.equal(narration.includes('/'), false)
  assert.match(narration, /npm test or npm run build/i)
  assert.match(narration, /detailed code is available in the chat/i)

  const naturalPacing = cleanTextForSpeech('Here is the approach: start with one clear promise; then test it with five customers, and keep the wording that lands.')
  assert.match(naturalPacing, /approach: start with one clear promise\. then test it with five customers, and keep the wording that lands\./i)

  const structuredNarration = cleanTextForSpeech('> **Next steps**\n1. Confirm the plan\n2. Send the update\n| Owner | Status |\n| --- | --- |\n[^1]')
  assert.equal(structuredNarration.includes('Owner'), false)
  assert.equal(structuredNarration.includes('[^1]'), false)
  assert.match(structuredNarration, /First, Confirm the plan\. Next, Send the update/i)
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
    provider: 'elevenlabs', gender: 'female', speed: 150,
  })
  assert.deepEqual(normalizeVoiceConfig(null), { provider: 'elevenlabs', gender: 'female', speed: 0 })
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
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'src/App.jsx'), 'utf8')
  const voiceSessionSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatVoiceSession.jsx'), 'utf8')
  const controlActionsSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatControlActions.jsx'), 'utf8')
  const controlUtilsSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/chatControlCenterUtils.js'), 'utf8')
  const repositoryChangeSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatRepositoryChangeDialog.jsx'), 'utf8')
  const fileExecutorSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/githubFileExecutor.js'), 'utf8')
  const validationExecutorSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/githubValidationExecutor.js'), 'utf8')
  const integrationsSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/integrations/IntegrationsControlCenter.jsx'), 'utf8')
  const connectorPlatformSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/integrations/connectorPlatform.js'), 'utf8')
  const voiceResponseSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/voiceResponseUtils.js'), 'utf8')
  const liveCallSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatLiveCallSurface.jsx'), 'utf8')
  const liveCallUtilsSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/liveCallUtils.js'), 'utf8')
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
  assert.match(workspaceSource, /createReadAloudPlan/)
  assert.match(workspaceSource, /continueFromChat/)
  assert.match(workspaceSource, /prepareRepositoryExecutionFromChat/)
  assert.match(workspaceSource, /approveRepositoryExecutionFromChat/)
  assert.match(workspaceSource, /createApprovedRepositoryBranchFromChat/)
  assert.match(workspaceSource, /createGithubBranch/)
  assert.match(workspaceSource, /ChatRepositoryChangeDialog/)
  assert.match(workspaceSource, /applyGithubMultiFileChange/)
  assert.match(workspaceSource, /getGithubCommitValidation/)
  assert.match(workspaceSource, /No branch or files changed/)
  assert.match(workspaceSource, /getAssistantControlActions/)
  assert.match(workspaceSource, /getChatRequestContext/)
  assert.match(workspaceSource, /getChatSystemPrompt/)
  assert.match(workspaceSource, /executeConnectorAction/)
  assert.match(workspaceSource, /getGithubConnectorRuntime/)
  assert.match(workspaceSource, /stream: true/)
  assert.match(workspaceSource, /streamingReply/)
  assert.match(workspaceSource, /partialText/)
  assert.match(workspaceSource, /incomplete: true/)
  assert.match(workspaceSource, /finishRequested/)
  assert.match(workspaceSource, /startLiveCall/)
  assert.match(workspaceSource, /sendLiveCallTurn/)
  assert.match(workspaceSource, /requestLiveCallReply/)
  assert.match(workspaceSource, /getLiveCallSystemPrompt/)
  assert.match(workspaceSource, /createLiveCallResponsePlan/)
  assert.match(workspaceSource, /createLiveCallRecap/)
  assert.doesNotMatch(workspaceSource, /send\(transcript, \{ source: 'voice', preserveComposer: true \}\)/)
  assert.match(workspaceSource, /ChatLiveCallSurface/)
  assert.match(workspaceSource, /Start a live voice call/)
  assert.match(workspaceSource, /voiceSession\.phase === 'idle'/)
  assert.match(workspaceSource, /sending && voiceSession\.phase === 'idle'/)
  assert.match(workspaceSource, /activeError && voiceSession\.phase === 'idle'/)
  assert.doesNotMatch(workspaceSource, /<ChatVoiceSession/)
  assert.doesNotMatch(workspaceSource, /window\.confirm/)
  assert.match(workspaceSource, /ChatMessage/)
  assert.match(composerSource, /Enter to send/)
  assert.match(appSource, /IntegrationsControlCenter/)
  assert.match(integrationsSource, /Connector control center/)
  assert.match(integrationsSource, /GitHubConnectorCard/)
  assert.match(integrationsSource, /First-class connector/)
  assert.match(integrationsSource, /Retry connection/)
  assert.match(connectorPlatformSource, /getConnectorSelectionSignals/)
  assert.match(connectorPlatformSource, /executeConnectorAction/)
  assert.doesNotMatch(integrationsSource, /external-app/)
  assert.match(composerSource, /Shift\+Enter/)
  assert.match(composerSource, /Start a live voice session/)
  assert.match(composerSource, /ChatVoiceSession/)
  assert.match(composerSource, /Choose an image/)
  assert.match(composerSource, /paste an image directly/i)
  assert.match(composerSource, /voiceSessionActive && <ChatVoiceSession/)
  assert.doesNotMatch(composerSource, /Live dictation is flowing/i)
  assert.match(composerSource, /HOLD_TO_DICTATE_DELAY_MS/)
  assert.match(composerSource, /onPointerDown/)
  assert.match(composerSource, /voiceStartedByPointerRef/)
  assert.match(composerSource, /void onVoiceStart\(\)/)
  assert.match(composerSource, /void onVoicePrepare\?\.\(\{ quiet: true \}\)/)
  assert.match(composerSource, /onVoicePrepare/)
  assert.match(recognitionSource, /microphonePreparationRef/)
  assert.match(workspaceSource, /prepare: prepareVoiceInput/)
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
  assert.match(messageSource, /ChatControlActions/)
  assert.match(messageSource, /getChatExecutionTransparency/)
  assert.match(messageSource, /Operator report/)
  assert.match(messageSource, /Response interrupted/)
  assert.match(messageSource, /copyMessage/)
  assert.match(messageSource, /Copied/)
  assert.match(controlActionsSource, /Continue in FounderLab/)
  assert.match(controlActionsSource, /completedActions/)
  assert.match(controlActionsSource, /mountedRef/)
  assert.match(controlUtilsSource, /Do not push anything until the user explicitly confirms/)
  assert.match(controlUtilsSource, /getChatControlActions/)
  assert.match(controlUtilsSource, /Prepare execution workflow/)
  assert.match(controlUtilsSource, /Record execution approval/)
  assert.match(controlUtilsSource, /Create approved branch/)
  assert.match(controlUtilsSource, /Commit reviewed changes/)
  assert.match(controlUtilsSource, /Check GitHub validation/)
  assert.match(controlUtilsSource, /Connect GitHub/)
  assert.match(repositoryChangeSource, /Review a bounded branch commit/)
  assert.match(repositoryChangeSource, /aria-modal="true"/)
  assert.match(fileExecutorSource, /one reviewed multi-file Git commit/)
  assert.match(validationExecutorSource, /not dispatch arbitrary workflows/)
  assert.match(appSource, /flConsumeHandoff\('youtube'\)/)
  assert.match(appSource, /Content brief ready from Chat/)
  assert.match(voiceSessionSource, /fl-chat-voice-dock/)
  assert.match(voiceSessionSource, /Cancel/)
  assert.match(voiceSessionSource, /Review/)
  assert.match(voiceSessionSource, /Stop/)
  assert.match(voiceSessionSource, /End/)
  assert.match(voiceResponseSource, /full code and details in the chat/i)
  assert.match(voiceResponseSource, /createReadAloudPlan/)
  assert.match(liveCallSource, /Live call/)
  assert.match(liveCallSource, /Live turns stay focused here/)
  assert.match(liveCallSource, /fl-chat-live-call-orb/)
  assert.doesNotMatch(liveCallSource, /Live call exchange/)
  assert.match(liveCallSource, /Local & private/)
  assert.match(liveCallSource, /Mute/)
  assert.match(liveCallSource, /Stop response/)
  assert.match(liveCallSource, /Cancel capture/)
  assert.match(liveCallSource, /End call/)
  assert.match(liveCallSource, /showTranscript/)
  assert.match(liveCallUtilsSource, /Private local call/)
  assert.match(liveCallUtilsSource, /shouldQueueLiveCallTurn/)
  assert.match(liveCallUtilsSource, /canInterruptLiveCall/)
  assert.match(workspaceSource, /beginLiveCallInterruptionMonitor/)
  assert.match(workspaceSource, /LIVE_CALL_RESPONSE_OPTIONS/)
  assert.match(workspaceSource, /temperature: CHAT_RESPONSE_OPTIONS.temperature/)
  assert.match(workspaceSource, /temperature: LIVE_CALL_RESPONSE_OPTIONS.temperature/)
  assert.match(workspaceSource, /buildLiveCallRequestContext/)
  assert.match(liveCallUtilsSource, /Live call recap/)
  assert.match(voiceResponseSource, /cleanTextForSpeech/)
  assert.match(speechTextSource, /detailed code is available in the chat/i)
  const messageContentSource = fs.readFileSync(path.join(repositoryRoot, 'src/components/content/MessageContent.jsx'), 'utf8')
  const clipboardSource = fs.readFileSync(path.join(repositoryRoot, 'src/components/content/messageContentUtils.js'), 'utf8')
  assert.match(messageContentSource, /CodeBlock/)
  assert.match(messageContentSource, /Copy code/)
  assert.match(clipboardSource, /clipboard\.writeText/)
  assert.match(workspaceSource, /function resetVoiceSession/)
  assert.match(workspaceSource, /voiceSessionRequestRef/)
  assert.match(workspaceSource, /voiceRequest !== voiceSessionRequestRef\.current/)
  assert.match(workspaceSource, /if \(voiceRequest === voiceSessionRequestRef\.current\) resetVoiceSession\(\)/)
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
  assert.match(recognitionSource, /microphonePermissionReadyRef/)
  assert.match(recognitionSource, /getUserMedia round-trip/)
  assert.match(composerSource, /HOLD_TO_DICTATE_DELAY_MS = 120/)
  assert.match(speechSource, /let activeAudio/)
  assert.match(speechSource, /releaseActiveAudio\(\)\?\.\(false\)/)
  assert.match(speechSource, /let playbackGeneration = 0/)
  assert.match(speechSource, /generation !== playbackGeneration/)
  assert.match(speechSource, /splitSpeechForPlayback/)
  assert.doesNotMatch(speechSource, /text\.slice\(0, 2500\)/)
  assert.match(css, /height: 100dvh/)
  assert.match(css, /scrollbar-gutter: stable/)
  assert.match(css, /fl-chat-voice-popover/)
  assert.match(css, /fl-chat-confirm-dialog/)
  assert.match(css, /fl-chat-composer-image-action/)
  assert.match(css, /fl-chat-composer-shell/)
  assert.match(css, /fl-message-code-copy/)
  assert.match(css, /fl-chat-voice-dock/)
  assert.match(css, /fl-chat-live-call/)
  assert.match(css, /fl-chat-live-call-stage/)
  assert.match(css, /fl-chat-live-call-start/)
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
