import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { routeAIRequest } from '../src/ai/providerRouter.js'
import {
  CHAT_STARTER_PROMPTS,
  createConversation,
  filterConversations,
  getChatErrorPresentation,
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
        { id: 'user-1', role: 'user', content: 'Build a plan', ts: '2026-07-16T08:00:00.000Z' },
        { id: 'assistant-1', role: 'assistant', content: 'Here is a plan', provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M' },
        { id: 'bad', role: 'system', content: 'ignore this' },
      ],
    },
  ])
  assert.equal(conversations.length, 1)
  assert.equal(conversations[0].title, 'Fundraising plan')
  assert.equal(conversations[0].messages.length, 2)
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

test('Chat feature modules preserve local routing, cancellable requests, and responsive history behavior', () => {
  const workspaceSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatWorkspace.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/chatPremium.css'), 'utf8')
  const composerSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/chat/ChatComposer.jsx'), 'utf8')
  assert.match(workspaceSource, /localOllamaAllowed: true/)
  assert.match(workspaceSource, /signal: controller\.signal/)
  assert.match(workspaceSource, /getChatErrorPresentation/)
  assert.match(workspaceSource, /ChatHistory/)
  assert.match(workspaceSource, /ChatMessage/)
  assert.match(composerSource, /Enter to send/)
  assert.match(composerSource, /Shift\+Enter/)
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /fl-chat-history\.is-closed/)
})
