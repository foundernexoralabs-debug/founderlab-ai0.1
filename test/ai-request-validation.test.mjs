import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  getDefaultModel,
  getPurposeModel,
  getProvider,
  isSupportedModel,
  listProviders,
} from '../src/ai/providerRegistry.js'
import { getVoiceProvider } from '../src/ai/voiceProviderRegistry.js'
import { classifyAIError } from '../src/ai/errorClassifier.js'
import { normalizeOllamaUrl, normalizeServerAIRequest } from '../src/ai/normalizeRequest.js'
import { createAIResult, normalizeApiResult } from '../src/ai/normalizeResponse.js'
import { routeAIRequest } from '../src/ai/providerRouter.js'
import { discoverOllama, normalizeOllamaModels } from '../src/ai/providers/ollama.js'
import {
  getProviderConnectionState,
  getProviderConnectionStatus,
  resetProviderConnectionStatuses,
  setProviderConnectionStatus,
} from '../src/ai/providerConnectionState.js'
import {
  getProviderConfigurationState,
  normalizeProviderAvailability,
  resolveConfiguredProvider,
} from '../src/ai/providerAvailability.js'
import {
  createProviderConnectionTestRequest,
  OLLAMA_CONNECTION_TEST_MAX_TOKENS,
  PROVIDER_CONNECTION_TEST_MAX_TOKENS,
  refreshProviderAvailability,
  requestAIResult,
} from '../src/services/aiProviderService.js'
import { workspaceStore } from '../src/services/workspaceStore.js'
import {
  getAIProviderPreference,
  getOllamaModelPreference,
  getOllamaURLPreference,
  getProviderModelPreference,
  setAIProviderPreference,
  setOllamaModelPreference,
  setOllamaURLPreference,
  setProviderModelPreference,
} from '../src/ai/providerPreferences.js'

const require = createRequire(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const aiHandler = require('../api/ai.js')
const youtubeHandler = require('../api/youtube.js')
const ttsHandler = require('../api/tts.js')
const groqProvider = require('../api/ai/providers/groq.js')
const {
  authenticateRequest,
  enforceRequestLimit,
  getRateLimitIdentifier,
  getSupabaseConfig: getServerSupabaseConfig,
  getUpstashConfig,
  isAllowedCorsOrigin,
  resetInMemoryRateLimits,
} = require('../api/_lib/apiSecurity.js')

const message = (content = 'hello', image) => ({ role: 'user', content, ...(image && { image }) })
const TEST_ENV = Object.freeze({
  NODE_ENV: 'development',
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'public-anon-key',
  FOUNDERLAB_ALLOWED_ORIGINS: 'https://app.founderlab.test',
})

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(statusCode) {
      this.statusCode = statusCode
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    send(body) {
      this.body = body
      return this
    },
    end() {
      this.ended = true
      return this
    },
  }
}

function createRequest({ method = 'POST', url = '/api/ai', body = {}, headers = {} } = {}) {
  return { method, url, body, headers }
}

function jsonResponse({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: async () => body }
}

function authenticatedFetch(extraHandler) {
  return async (url, options) => {
    if (url === TEST_ENV.SUPABASE_URL + '/auth/v1/user') {
      assert.equal(options.headers.Authorization, 'Bearer verified-access-token')
      return jsonResponse({ body: { id: 'verified-user-id', email: 'founder@example.test' } })
    }
    return extraHandler?.(url, options)
  }
}

function allowRateLimit() {
  return async () => ({ allowed: true, retryAfter: 0, durable: true })
}

test('provider registry is the single source of supported providers, defaults, and capability flags', () => {
  assert.deepEqual(listProviders().map((provider) => provider.id), ['anthropic', 'groq', 'gemini', 'ollama'])
  assert.equal(getDefaultModel('anthropic'), 'claude-sonnet-4-6')
  assert.equal(getProvider('ollama').capabilities.dynamicModels, true)
  assert.equal(isSupportedModel('groq', 'openai/gpt-oss-120b'), true)
  assert.equal(isSupportedModel('groq', 'not-a-real-model'), false)
  assert.deepEqual(getPurposeModel('youtube-analysis'), { provider: 'groq', model: 'llama-3.3-70b-versatile' })
  assert.equal(isSupportedModel('groq', 'llama-3.3-70b-versatile'), false)
  assert.equal(isSupportedModel('groq', 'llama-3.3-70b-versatile', { includeInternal: true }), true)
})

test('provider availability resolves only configured providers and preserves Local Ollama as a deliberate option', () => {
  const supabaseConfiguredWithoutAnthropic = normalizeProviderAvailability({
    ollama: { configured: true, local: true },
  })
  assert.equal(resolveConfiguredProvider('anthropic', supabaseConfiguredWithoutAnthropic), 'ollama')
  assert.equal(getProviderConfigurationState('anthropic', supabaseConfiguredWithoutAnthropic), 'not_configured')
  assert.equal(getProviderConfigurationState('ollama', supabaseConfiguredWithoutAnthropic), 'local')

  const geminiOnly = normalizeProviderAvailability({ gemini: { configured: true } })
  assert.equal(resolveConfiguredProvider('', geminiOnly), 'gemini')
  assert.equal(resolveConfiguredProvider('anthropic', geminiOnly), 'gemini')

  const groqOnly = normalizeProviderAvailability({ groq: { configured: true } })
  assert.equal(resolveConfiguredProvider('', groqOnly), 'groq')
  assert.equal(resolveConfiguredProvider('gemini', groqOnly), 'groq')

  const multipleProviders = normalizeProviderAvailability({
    groq: { configured: true },
    gemini: { configured: true },
  })
  assert.equal(resolveConfiguredProvider('gemini', multipleProviders), 'gemini')
  assert.equal(resolveConfiguredProvider('anthropic', multipleProviders), 'groq')
})

test('voice configuration centralizes the ElevenLabs model, voice IDs, and browser fallback capability', () => {
  const voice = getVoiceProvider('elevenlabs')
  assert.equal(voice.defaultModel, 'eleven_multilingual_v2')
  assert.equal(voice.capabilities.browserFallback, true)
  assert.equal(voice.voices.male, 'nPczCjzI2devNBz1zQrb')
  assert.equal(voice.voiceLabels.female, 'Custom Female')

  const browserVoiceSource = fs.readFileSync(path.join(repositoryRoot, 'src/lib/voiceService.ts'), 'utf8')
  assert.equal(browserVoiceSource.includes('nPczCjzI2devNBz1zQrb'), false)
  assert.equal(browserVoiceSource.includes('EST9Ui6982FZPSi7gCHi'), false)
})

test('server request normalization accepts a large Builder prompt within the bounded text limit', () => {
  const result = normalizeServerAIRequest({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    messages: [message('x'.repeat(100000))],
    system: 'Builder system prompt',
    max_tokens: 4500,
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.maxTokens, 4500)
  assert.equal(result.value.model, 'claude-sonnet-4-6')
})

test('server request normalization rejects invalid models, oversized messages, and unsupported image paths', () => {
  assert.equal(normalizeServerAIRequest({ provider: 'unknown', messages: [message()] }).error.code, 'REQUEST_INVALID')
  assert.equal(normalizeServerAIRequest({ provider: 'groq', model: 'llama-3.3-70b-versatile', messages: [message()] }).error.code, 'INVALID_MODEL')
  assert.equal(normalizeServerAIRequest({ provider: 'groq', messages: [message()], temperature: 1.1 }).error.code, 'REQUEST_INVALID')
  assert.equal(normalizeServerAIRequest({ provider: 'groq', model: 'x'.repeat(161), messages: [message()] }).error.code, 'REQUEST_INVALID')
  assert.equal(normalizeServerAIRequest({ provider: 'groq', model: 'openai/gpt-oss-120b', messages: [message('x'.repeat(160001))] }).error.code, 'REQUEST_INVALID')
  assert.equal(normalizeServerAIRequest({ provider: 'groq', model: 'openai/gpt-oss-120b', messages: [message('image', 'data:image/png;base64,a')] }).error.code, 'REQUEST_INVALID')
  assert.equal(normalizeServerAIRequest({ provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [message('one', 'data:image/png;base64,a'), message('two', 'data:image/png;base64,b')] }).error.code, 'REQUEST_INVALID')
})

test('request normalization accepts one bounded Anthropic image and limits Ollama to a local origin on the server', () => {
  const image = 'data:image/png;base64,' + 'a'.repeat(1000000)
  const result = normalizeServerAIRequest({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    messages: [message('Describe this image', image)],
    max_tokens: 999999,
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.maxTokens, 12000)
  assert.equal(normalizeOllamaUrl('http://localhost:11434/api/tags'), 'http://localhost:11434')
  assert.equal(normalizeOllamaUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434')
  assert.equal(normalizeOllamaUrl('http://169.254.169.254/latest/meta-data'), null)
  assert.equal(normalizeOllamaUrl('https://localhost.evil.example'), null)
})

test('AI results normalize malformed output and premium failure categories without upstream text', () => {
  const success = createAIResult({ provider: 'groq', model: 'openai/gpt-oss-120b', text: 'Useful answer' })
  assert.equal(success.ok, true)
  assert.deepEqual(success.content, [{ type: 'text', text: 'Useful answer' }])
  assert.equal(createAIResult({ provider: 'groq', model: 'openai/gpt-oss-120b', text: '   ' }).error.code, 'EMPTY_RESPONSE')
  assert.equal(classifyAIError({ provider: 'gemini', status: 429 }).code, 'RATE_LIMITED')
  assert.equal(classifyAIError({ provider: 'gemini', status: 503 }).code, 'PROVIDER_UNAVAILABLE')
  assert.equal(classifyAIError({ provider: 'anthropic', code: 'MISSING_CONFIGURATION' }).retryable, false)
  assert.equal(
    classifyAIError({ provider: 'anthropic', code: 'MISSING_CONFIGURATION' }).message,
    'Anthropic is not configured. Choose another provider or add ANTHROPIC_API_KEY.'
  )
  assert.equal(classifyAIError({ code: 'AUTHENTICATION_REQUIRED' }).status, 401)

  const normalized = normalizeApiResult({
    ok: false,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    error: { code: 'INVALID_MODEL', message: 'raw upstream text is not shown' },
  })
  assert.equal(normalized.error.code, 'INVALID_MODEL')
  assert.equal(normalized.error.message.includes('raw upstream text'), false)
})

test('browser provider router preserves the stable API contract and sends the supplied model', async () => {
  let requestBody
  const result = await routeAIRequest({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    messages: [message('hello')],
    maxTokens: 200,
  }, {
    accessToken: 'browser-session-token',
    fetchImpl: async (_, options) => {
      requestBody = JSON.parse(options.body)
      assert.equal(options.headers.Authorization, 'Bearer browser-session-token')
      return jsonResponse({ body: {
        ok: true,
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        text: 'Consistent result',
        content: [{ type: 'text', text: 'Consistent result' }],
        meta: { usage: null, finishReason: 'stop' },
      } })
    },
  })
  assert.equal(requestBody.max_tokens, 200)
  assert.equal(result.ok, true)
  assert.equal(result.text, 'Consistent result')
})

test('an active workspace session is used by both Chat and provider-status requests', async () => {
  const previousSession = workspaceStore.session
  workspaceStore.session = {
    access_token: 'active-workspace-access-token',
    refresh_token: 'refresh-token',
    user_id: 'user-id',
  }

  try {
    const chatResult = await requestAIResult({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      messages: [message('Hello from Chat')],
    }, {
      fetchImpl: async (_, options) => {
        assert.equal(options.headers.Authorization, 'Bearer active-workspace-access-token')
        return jsonResponse({ body: {
          ok: true,
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          text: 'Chat is authenticated.',
        } })
      },
    })
    assert.equal(chatResult.ok, true)

    const status = await refreshProviderAvailability({
      fetchImpl: async (_, options) => {
        assert.equal(options.headers.Authorization, 'Bearer active-workspace-access-token')
        return jsonResponse({ body: {
          ok: true,
          providers: {
            anthropic: { configured: false },
            groq: { configured: true },
            gemini: { configured: true },
            ollama: { configured: true, local: true },
          },
        } })
      },
    })
    assert.equal(status.providers.groq.configured, true)
    assert.equal(status.providers.gemini.configured, true)
    assert.equal(status.providers.anthropic.configured, false)
  } finally {
    workspaceStore.session = previousSession
  }
})

test('provider availability keeps a Local Ollama selection made while status refresh is in flight', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
    },
  })

  try {
    setAIProviderPreference('groq')
    const status = await refreshProviderAvailability({
      accessToken: 'active-workspace-access-token',
      fetchImpl: async () => {
        // This mirrors selecting the Local Ollama card before the status
        // response returns. A stale result must not switch the card away.
        setAIProviderPreference('ollama')
        return jsonResponse({ body: {
          ok: true,
          providers: {
            anthropic: { configured: false },
            groq: { configured: true },
            gemini: { configured: true },
            ollama: { configured: true, local: true },
          },
        } })
      },
    })

    assert.equal(status.provider, 'ollama')
    assert.equal(getAIProviderPreference(), 'ollama')
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', originalStorage)
  }
})

test('a genuinely signed-out browser request has no token and receives the normalized authentication error', async () => {
  const previousSession = workspaceStore.session
  workspaceStore.session = null
  try {
    const result = await requestAIResult({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      messages: [message()],
    }, {
      fetchImpl: async (_, options) => {
        assert.equal(options.headers.Authorization, undefined)
        return jsonResponse({ status: 401, body: {
          ok: false,
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          error: { code: 'AUTHENTICATION_REQUIRED', status: 401 },
        } })
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'AUTHENTICATION_REQUIRED')
  } finally {
    workspaceStore.session = previousSession
  }
})

test('provider connection labels distinguish configured, testing, connected, failed, and local providers', () => {
  assert.deepEqual(getProviderConnectionState('not_configured'), { state: 'not_configured', label: 'Not configured' })
  assert.deepEqual(getProviderConnectionState('ready'), { state: 'ready', label: 'Ready to test' })
  assert.deepEqual(getProviderConnectionState('ready', 'testing'), { state: 'testing', label: 'Testing' })
  assert.deepEqual(getProviderConnectionState('ready', 'connected'), { state: 'connected', label: 'Connected' })
  assert.deepEqual(getProviderConnectionState('ready', 'failed'), { state: 'failed', label: 'Failed' })
  assert.deepEqual(getProviderConnectionState('local'), { state: 'local', label: 'Local Ollama' })
  assert.deepEqual(getProviderConnectionState('local', 'detecting'), { state: 'detecting', label: 'Detecting' })
  assert.deepEqual(getProviderConnectionState('local', 'no_models'), { state: 'no_models', label: 'No models found' })
  assert.deepEqual(getProviderConnectionState('local', 'unavailable'), { state: 'unavailable', label: 'Not available' })
})

test('Ollama discovery only reports a real readable local models response', async () => {
  const unavailable = await discoverOllama('http://localhost:11434', {
    fetchImpl: async () => { throw new TypeError('CORS or network failure') },
  })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.state, 'unavailable')
  assert.equal(unavailable.models.length, 0)

  const noModels = await discoverOllama('http://localhost:11434', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://localhost:11434/api/tags')
      assert.equal(options.credentials, 'omit')
      assert.equal(options.mode, 'cors')
      assert.equal(options.cache, 'no-store')
      assert.equal(options.targetAddressSpace, 'loopback')
      return jsonResponse({ body: { models: [] } })
    },
  })
  assert.equal(noModels.ok, true)
  assert.equal(noModels.state, 'no_models')

  const discovered = await discoverOllama('http://localhost:11434', {
    fetchImpl: async () => jsonResponse({ body: {
      models: [
        { name: 'gemma3:latest', size: 3338801804, details: { family: 'gemma', parameter_size: '4.3B' } },
        { name: 'qwen3:8b', details: { family: 'qwen3', parameter_size: '8B' } },
      ],
    } }),
  })
  assert.equal(discovered.ok, true)
  assert.equal(discovered.state, 'models_available')
  assert.deepEqual(discovered.models.map((model) => model.id), ['gemma3:latest', 'qwen3:8b'])
  assert.equal(discovered.models[0].parameterSize, '4.3B')
})

test('Ollama model discovery preserves a valid model.model value and tagged names', () => {
  const models = normalizeOllamaModels([
    { model: 'llama3.2:3b-instruct-q4_K_M', details: { family: 'llama' } },
    { name: 'llama3.2:3b-instruct-q4_K_M' },
    { name: '  qwen3:8b  ' },
    { name: '' },
  ])
  assert.deepEqual(models.map((model) => model.id), ['llama3.2:3b-instruct-q4_K_M', 'qwen3:8b'])
})

test('Ollama model and localhost preferences persist safely without accepting a remote endpoint', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
    },
  })
  try {
    assert.equal(setOllamaModelPreference('gemma3:latest'), true)
    assert.equal(getOllamaModelPreference(), 'gemma3:latest')
    assert.equal(setOllamaURLPreference('http://127.0.0.1:11434/api/tags'), true)
    assert.equal(getOllamaURLPreference(), 'http://127.0.0.1:11434')
    assert.equal(setOllamaURLPreference('https://remote.example.test'), false)
    store.set('fl_ollama_url', 'https://remote.example.test')
    assert.equal(getOllamaURLPreference(), 'http://localhost:11434')
    assert.deepEqual([...store.keys()].sort(), ['fl_ollama_model', 'fl_ollama_url'])
    assert.equal([...store.values()].some((value) => /api.?key|token|secret/i.test(value)), false)
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', originalStorage)
  }
})

test('Ollama test and Chat route directly to localhost without cloud authentication', async () => {
  resetProviderConnectionStatuses()
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    assert.equal(url, 'http://localhost:11434/api/chat')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.mode, 'cors')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.targetAddressSpace, 'loopback')
    assert.equal(options.headers.Authorization, undefined)
    const body = JSON.parse(options.body)
    assert.equal(body.stream, false)
    assert.equal(body.model, 'gemma3:latest')
    assert.equal(body.options.num_predict, calls.length === 1 ? OLLAMA_CONNECTION_TEST_MAX_TOKENS : 300)
    return jsonResponse({ body: {
      message: { role: 'assistant', content: 'CONNECTED' },
      done_reason: 'stop',
      eval_count: 4,
    } })
  }
  try {
    const tested = await requestAIResult({
      ...createProviderConnectionTestRequest({ provider: 'ollama', model: 'gemma3:latest' }),
      localOllamaAllowed: true,
    }, { fetchImpl })
    assert.equal(tested.ok, true)
    assert.equal(getProviderConnectionStatus('ollama'), 'connected')

    const chat = await requestAIResult({
      provider: 'ollama',
      model: 'gemma3:latest',
      messages: [message('Draft a launch update')],
      maxTokens: 300,
      localOllamaAllowed: true,
    }, { fetchImpl })
    assert.equal(chat.ok, true)
    assert.equal(chat.text, 'CONNECTED')
    assert.equal(calls.length, 2)
  } finally {
    resetProviderConnectionStatuses()
  }
})

test('Ollama failures remain isolated and an accidental server route is rejected', async () => {
  resetProviderConnectionStatuses()
  try {
    const restricted = await requestAIResult({
      provider: 'ollama',
      model: 'gemma3:latest',
      messages: [message('A non-Chat feature request')],
    }, { fetchImpl: async () => assert.fail('Non-Chat Ollama use must not fetch') })
    assert.equal(restricted.ok, false)
    assert.equal(restricted.error.code, 'OLLAMA_CHAT_ONLY')

    setProviderConnectionStatus('groq', 'connected')
    const failed = await requestAIResult({
      ...createProviderConnectionTestRequest({ provider: 'ollama', model: 'missing-local-model' }),
      localOllamaAllowed: true,
    }, {
      fetchImpl: async () => jsonResponse({ ok: false, status: 404, body: { error: 'model not found' } }),
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.error.code, 'OLLAMA_MODEL_UNAVAILABLE')
    assert.equal(getProviderConnectionStatus('ollama'), 'failed')
    assert.equal(getProviderConnectionStatus('groq'), 'connected')

    let fetched = false
    const routed = await routeAIRequest({
      provider: 'ollama',
      model: 'gemma3:latest',
      ollamaUrl: 'https://remote.example.test',
      messages: [message()],
    }, { fetchImpl: async () => { fetched = true; throw new Error('must not fetch') } })
    assert.equal(routed.ok, false)
    assert.equal(routed.error.code, 'REQUEST_INVALID')
    assert.equal(fetched, false)

    const response = createResponseRecorder()
    await aiHandler(createRequest({
      headers: { authorization: 'Bearer verified-access-token' },
      body: { provider: 'ollama', model: 'gemma3:latest', ollamaUrl: 'http://localhost:11434', messages: [message()] },
    }), response, {
      env: TEST_ENV,
      fetchImpl: authenticatedFetch(async () => assert.fail('The server must not execute a local Ollama request')),
      rateLimiter: async () => assert.fail('The local-only rejection must happen before rate limiting'),
    })
    assert.equal(response.statusCode, 400)
    assert.equal(response.body.error.code, 'OLLAMA_LOCAL_ONLY')
  } finally {
    resetProviderConnectionStatuses()
  }
})

test('Ollama retains a browser local-access category without exposing browser internals', async () => {
  const denied = await discoverOllama('http://localhost:11434', {
    permissionQuery: async () => ({ state: 'denied' }),
    fetchImpl: async () => assert.fail('A denied browser permission must not send a request'),
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'OLLAMA_BROWSER_ACCESS_DENIED')

  const blocked = await requestAIResult({
    ...createProviderConnectionTestRequest({ provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M' }),
    localOllamaAllowed: true,
  }, {
    permissionQuery: async () => ({ state: 'prompt' }),
    fetchImpl: async () => { throw new TypeError('browser refused local request') },
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'OLLAMA_BROWSER_ACCESS_BLOCKED')
  assert.equal(blocked.error.message.includes('browser refused local request'), false)

  const deniedTest = await requestAIResult({
    ...createProviderConnectionTestRequest({ provider: 'ollama', model: 'llama3.2:3b-instruct-q4_K_M' }),
    localOllamaAllowed: true,
  }, {
    permissionQuery: async () => ({ state: 'denied' }),
    fetchImpl: async () => assert.fail('A denied browser permission must not send a test request'),
  })
  assert.equal(deniedTest.ok, false)
  assert.equal(deniedTest.error.code, 'OLLAMA_BROWSER_ACCESS_DENIED')
})

test('Ollama is presented as a first-class local provider without stale CORS setup guidance', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'src/App.jsx'), 'utf8')
  const panelSource = fs.readFileSync(path.join(repositoryRoot, 'src/features/settings/OllamaProviderPanel.jsx'), 'utf8')
  assert.match(appSource, /Cloud providers/)
  assert.match(appSource, /Local provider/)
  assert.match(appSource, /<OllamaProviderPanel/)
  assert.match(panelSource, /Local · Free/)
  assert.match(panelSource, /Models available/)
  assert.match(panelSource, /Test connection/)
  assert.match(panelSource, /local app/)
  assert.doesNotMatch(appSource, /OLLAMA_ORIGINS=\*/)
  assert.doesNotMatch(panelSource, /OLLAMA_ORIGINS/)
})

test('provider connection checks use the same normalized path as Chat and preserve a known successful provider', async () => {
  const previousSession = workspaceStore.session
  workspaceStore.session = {
    access_token: 'active-workspace-access-token',
    refresh_token: 'refresh-token',
    user_id: 'user-id',
  }
  resetProviderConnectionStatuses()

  try {
    const testRequest = createProviderConnectionTestRequest({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    })
    assert.equal(testRequest.maxTokens, PROVIDER_CONNECTION_TEST_MAX_TOKENS)
    assert.ok(testRequest.maxTokens > 20)

    const testResult = await requestAIResult(testRequest, {
      fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body)
        assert.equal(body.max_tokens, PROVIDER_CONNECTION_TEST_MAX_TOKENS)
        return jsonResponse({ body: {
          ok: true,
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          text: 'CONNECTED',
        } })
      },
    })
    assert.equal(testResult.ok, true)
    assert.equal(testResult.text, 'CONNECTED')
    assert.equal(getProviderConnectionStatus('groq'), 'connected')

    const chatResult = await requestAIResult({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      messages: [message('Hello from Chat')],
      maxTokens: 2000,
    }, {
      fetchImpl: async (_, options) => {
        assert.equal(JSON.parse(options.body).max_tokens, 2000)
        return jsonResponse({ body: {
          ok: true,
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          text: 'A real Chat response',
        } })
      },
    })
    assert.equal(chatResult.ok, true)
    assert.equal(getProviderConnectionStatus('groq'), 'connected')

    const failedRetest = await requestAIResult(testRequest, {
      fetchImpl: async () => jsonResponse({
        ok: false,
        status: 502,
        body: {
          ok: false,
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          error: { code: 'EMPTY_RESPONSE', status: 502 },
        },
      }),
    })
    assert.equal(failedRetest.error.code, 'EMPTY_RESPONSE')
    assert.equal(getProviderConnectionStatus('groq'), 'connected')
  } finally {
    workspaceStore.session = previousSession
    resetProviderConnectionStatuses()
  }
})

test('Gemini failures are provider-specific, sanitized, and isolated from a working Groq connection', async () => {
  const previousSession = workspaceStore.session
  workspaceStore.session = {
    access_token: 'active-workspace-access-token',
    refresh_token: 'refresh-token',
    user_id: 'user-id',
  }
  resetProviderConnectionStatuses()

  try {
    const groqResult = await requestAIResult({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      messages: [message()],
    }, {
      fetchImpl: async () => jsonResponse({ body: {
        ok: true,
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        text: 'Groq remains available',
      } }),
    })
    assert.equal(groqResult.ok, true)

    const geminiResult = await requestAIResult(createProviderConnectionTestRequest({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    }), {
      fetchImpl: async () => jsonResponse({
        ok: false,
        status: 400,
        body: {
          ok: false,
          provider: 'gemini',
          model: 'gemini-3.5-flash',
          error: { code: 'GEMINI_REQUEST_INVALID', status: 400, message: 'upstream detail must not leak' },
        },
      }),
    })
    assert.equal(geminiResult.ok, false)
    assert.equal(geminiResult.error.code, 'GEMINI_REQUEST_INVALID')
    assert.equal(geminiResult.error.message.includes('upstream detail'), false)
    assert.equal(getProviderConnectionStatus('gemini'), 'failed')
    assert.equal(getProviderConnectionStatus('groq'), 'connected')
  } finally {
    workspaceStore.session = previousSession
    resetProviderConnectionStatuses()
  }
})

test('missing and invalid Supabase credentials are rejected before provider execution', async () => {
  const missing = await authenticateRequest(createRequest(), { env: TEST_ENV, fetchImpl: authenticatedFetch() })
  assert.deepEqual(missing, { ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' })

  const invalid = await authenticateRequest(createRequest({ headers: { authorization: 'Bearer expired-token' } }), {
    env: TEST_ENV,
    fetchImpl: async () => jsonResponse({ ok: false, status: 401 }),
  })
  assert.deepEqual(invalid, { ok: false, status: 401, code: 'AUTHENTICATION_INVALID' })
})

test('server authentication safely falls back to the browser Supabase values', async () => {
  const env = {
    NODE_ENV: 'development',
    VITE_SUPABASE_URL: TEST_ENV.SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: TEST_ENV.SUPABASE_ANON_KEY,
  }
  assert.deepEqual(getServerSupabaseConfig(env), {
    url: TEST_ENV.SUPABASE_URL,
    anonKey: TEST_ENV.SUPABASE_ANON_KEY,
  })
  const authenticated = await authenticateRequest(createRequest({ headers: { authorization: 'Bearer verified-access-token' } }), {
    env,
    fetchImpl: authenticatedFetch(),
  })
  assert.equal(authenticated.ok, true)
})

test('accepted authentication derives a verified identity and never uses request body identity', async () => {
  const authenticated = await authenticateRequest(createRequest({
    body: { user_id: 'attacker-controlled-id' },
    headers: { authorization: 'Bearer verified-access-token' },
  }), { env: TEST_ENV, fetchImpl: authenticatedFetch() })
  assert.deepEqual(authenticated, {
    ok: true,
    user: { id: 'verified-user-id', email: 'founder@example.test' },
  })
})

test('the explicit local auth bypass cannot activate outside development', async () => {
  const developmentBypass = await authenticateRequest(createRequest(), {
    env: { ...TEST_ENV, FOUNDERLAB_DEV_AUTH_BYPASS: 'true' },
  })
  assert.equal(developmentBypass.ok, true)
  assert.equal(developmentBypass.user.id, 'development-bypass')

  const productionBypass = await authenticateRequest(createRequest(), {
    env: { ...TEST_ENV, NODE_ENV: 'production', FOUNDERLAB_DEV_AUTH_BYPASS: 'true' },
  })
  assert.deepEqual(productionBypass, { ok: false, status: 401, code: 'AUTHENTICATION_REQUIRED' })
})

test('CORS permits the production origin and only Preview hosts matching the configured project and team', () => {
  assert.equal(isAllowedCorsOrigin('https://app.founderlab.test', TEST_ENV), true)
  assert.equal(isAllowedCorsOrigin('https://evil.example', TEST_ENV), false)
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', TEST_ENV), true)
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', { ...TEST_ENV, NODE_ENV: 'production' }), false)
  const previewEnv = {
    ...TEST_ENV,
    NODE_ENV: 'production',
    FOUNDERLAB_VERCEL_PREVIEW_HOST_PREFIXES: 'founderlab-ai01-',
    FOUNDERLAB_VERCEL_PREVIEW_HOST_SUFFIXES: '-fouderlab-ai-s-projects.vercel.app',
  }
  assert.equal(isAllowedCorsOrigin('https://founderlab-ai01-git-phase-2-abc-fouderlab-ai-s-projects.vercel.app', previewEnv), true)
  assert.equal(isAllowedCorsOrigin('https://another-project-fouderlab-ai-s-projects.vercel.app', previewEnv), false)
  assert.equal(isAllowedCorsOrigin('https://founderlab-ai01-git-phase-2-abc-other-team.vercel.app', previewEnv), false)
  assert.equal(isAllowedCorsOrigin('https://founderlab-ai01-git-phase-2-abc-fouderlab-ai-s-projects.vercel.app', {
    ...TEST_ENV,
    NODE_ENV: 'production',
  }), false)

  const securitySource = fs.readFileSync(path.join(repositoryRoot, 'api/_lib/apiSecurity.js'), 'utf8')
  assert.equal(securitySource.includes("Access-Control-Allow-Origin', '*"), false)
})

test('Upstash rate protection uses isolated identifiers, scopes, retry data, and fails closed without a durable backend', async () => {
  resetInMemoryRateLimits()
  const developmentEnv = { ...TEST_ENV, FOUNDERLAB_DEV_RATE_LIMIT_FALLBACK: 'true', FOUNDERLAB_RATE_LIMIT_AI_LIMIT: '1', FOUNDERLAB_RATE_LIMIT_AI_WINDOW_SECONDS: '60' }
  assert.equal((await enforceRequestLimit({ userId: 'verified-user-id', scope: 'ai', env: developmentEnv, now: 1000 })).allowed, true)
  const blocked = await enforceRequestLimit({ userId: 'verified-user-id', scope: 'ai', env: developmentEnv, now: 1001 })
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfter > 0)

  const production = await enforceRequestLimit({ userId: 'verified-user-id', scope: 'ai', env: { ...TEST_ENV, NODE_ENV: 'production' } })
  assert.deepEqual(production, {
    allowed: false,
    status: 503,
    code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
    retryAfter: 0,
    durable: false,
  })

  const upstashEnv = {
    ...TEST_ENV,
    NODE_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://unit-test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'server-only-upstash-token',
  }
  assert.deepEqual(getUpstashConfig(upstashEnv), {
    url: 'https://unit-test.upstash.io',
    token: 'server-only-upstash-token',
  })
  assert.equal(getUpstashConfig({ ...upstashEnv, UPSTASH_REDIS_REST_TOKEN: ' ' }), null)
  assert.notEqual(getRateLimitIdentifier('verified-user-id'), getRateLimitIdentifier('another-user-id'))
  assert.equal(getRateLimitIdentifier('verified-user-id').includes('verified-user-id'), false)

  const counts = new Map()
  const configuredPolicies = []
  const upstashLimiterFactory = async ({ scope, policy }) => {
    configuredPolicies.push({ scope, policy })
    return { limit: async (identifier) => {
      const key = scope + ':' + identifier
      const count = (counts.get(key) || 0) + 1
      counts.set(key, count)
      return { success: count <= 1, reset: Date.now() + 12_000 }
    } }
  }
  const firstUserAI = await enforceRequestLimit({ userId: 'verified-user-id', scope: 'ai', env: upstashEnv, upstashLimiterFactory })
  const firstUserAIExceeded = await enforceRequestLimit({ userId: 'verified-user-id', scope: 'ai', env: upstashEnv, upstashLimiterFactory })
  const secondUserAI = await enforceRequestLimit({ userId: 'another-user-id', scope: 'ai', env: upstashEnv, upstashLimiterFactory })
  const firstUserYouTube = await enforceRequestLimit({ userId: 'verified-user-id', scope: 'youtube', env: upstashEnv, upstashLimiterFactory })
  assert.deepEqual(firstUserAI, { allowed: true, retryAfter: 0, durable: true })
  assert.equal(firstUserAIExceeded.allowed, false)
  assert.equal(firstUserAIExceeded.durable, true)
  assert.ok(firstUserAIExceeded.retryAfter >= 11 && firstUserAIExceeded.retryAfter <= 12)
  assert.deepEqual(secondUserAI, { allowed: true, retryAfter: 0, durable: true })
  assert.deepEqual(firstUserYouTube, { allowed: true, retryAfter: 0, durable: true })
  assert.deepEqual(configuredPolicies, [
    { scope: 'ai', policy: { limit: 30, windowSeconds: 60 } },
    { scope: 'ai', policy: { limit: 30, windowSeconds: 60 } },
    { scope: 'ai', policy: { limit: 30, windowSeconds: 60 } },
    { scope: 'youtube', policy: { limit: 10, windowSeconds: 60 } },
  ])

  const malformed = await enforceRequestLimit({
    userId: 'verified-user-id', scope: 'tts', env: upstashEnv,
    upstashLimiterFactory: async () => ({ limit: async () => ({ success: true }) }),
  })
  assert.deepEqual(malformed, {
    allowed: false,
    status: 503,
    code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
    retryAfter: 0,
    durable: false,
  })

  const genericOnly = await enforceRequestLimit({
    userId: 'verified-user-id',
    scope: 'ai',
    env: { ...TEST_ENV, NODE_ENV: 'production', FOUNDERLAB_RATE_LIMITER_URL: 'https://legacy-limiter.example.test' },
  })
  assert.deepEqual(genericOnly, {
    allowed: false,
    status: 503,
    code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
    retryAfter: 0,
    durable: false,
  })

  const securitySource = fs.readFileSync(path.join(repositoryRoot, 'api/_lib/apiSecurity.js'), 'utf8')
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'src/App.jsx'), 'utf8')
  assert.equal(securitySource.includes('FOUNDERLAB_RATE_LIMITER_URL'), false)
  assert.equal(securitySource.includes('FOUNDERLAB_RATE_LIMITER_TOKEN'), false)
  assert.equal(appSource.includes('UPSTASH_REDIS_REST_'), false)
})

test('AI endpoint returns normalized missing-auth, CORS, rate-limit, and accepted-auth contracts', async () => {
  const preflight = createResponseRecorder()
  await aiHandler(createRequest({ method: 'OPTIONS', headers: { origin: 'https://app.founderlab.test' } }), preflight, { env: TEST_ENV })
  assert.equal(preflight.statusCode, 204)
  assert.equal(preflight.ended, true)
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://app.founderlab.test')

  const missingAuth = createResponseRecorder()
  await aiHandler(createRequest({ body: { provider: 'groq', messages: [message()] } }), missingAuth, { env: TEST_ENV, fetchImpl: authenticatedFetch() })
  assert.equal(missingAuth.statusCode, 401)
  assert.deepEqual(Object.keys(missingAuth.body).sort(), ['error', 'model', 'ok', 'provider'])
  assert.equal(missingAuth.body.error.code, 'AUTHENTICATION_REQUIRED')

  const deniedOrigin = createResponseRecorder()
  await aiHandler(createRequest({ headers: { origin: 'https://evil.example' }, body: { provider: 'groq', messages: [message()] } }), deniedOrigin, { env: TEST_ENV, fetchImpl: authenticatedFetch() })
  assert.equal(deniedOrigin.statusCode, 403)
  assert.equal(deniedOrigin.body.error.code, 'CORS_ORIGIN_DENIED')
  assert.equal(deniedOrigin.headers['Access-Control-Allow-Origin'], undefined)

  const rateLimited = createResponseRecorder()
  await aiHandler(createRequest({ headers: { authorization: 'Bearer verified-access-token' }, body: { provider: 'groq', model: 'openai/gpt-oss-120b', messages: [message()] } }), rateLimited, {
    env: TEST_ENV,
    fetchImpl: authenticatedFetch(),
    rateLimiter: async ({ userId }) => {
      assert.equal(userId, 'verified-user-id')
      return { allowed: false, retryAfter: 12, durable: true }
    },
  })
  assert.equal(rateLimited.statusCode, 429)
  assert.equal(rateLimited.body.error.code, 'RATE_LIMITED')
  assert.equal(rateLimited.headers['Retry-After'], '12')

  const accepted = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token', origin: 'https://app.founderlab.test' },
    body: { provider: 'groq', model: 'openai/gpt-oss-120b', messages: [message()], user_id: 'spoofed' },
  }), accepted, {
    env: { ...TEST_ENV, GROQ_API_KEY: 'server-only-key' },
    fetchImpl: authenticatedFetch(async (url) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
      return jsonResponse({ body: { choices: [{ message: { content: 'Verified response' }, finish_reason: 'stop' }] } })
    }),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(accepted.statusCode, 200)
  assert.equal(accepted.body.ok, true)
  assert.equal(accepted.body.text, 'Verified response')
  assert.equal(accepted.headers['Access-Control-Allow-Origin'], 'https://app.founderlab.test')
})

test('Gemini uses the current GenerateContent contract and preserves a safe provider-specific 400', async () => {
  const accepted = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token' },
    body: {
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      messages: [message('Say only: CONNECTED')],
      system: 'Keep answers concise.',
      max_tokens: 256,
    },
  }), accepted, {
    env: { ...TEST_ENV, GEMINI_API_KEY: 'server-only-gemini-key' },
    fetchImpl: authenticatedFetch(async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')
      assert.equal(url.includes('key='), false)
      assert.equal(options.headers['x-goog-api-key'], 'server-only-gemini-key')
      const body = JSON.parse(options.body)
      assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Keep answers concise.' }] })
      assert.equal(body.generationConfig.maxOutputTokens, 256)
      return jsonResponse({ body: {
        candidates: [{ content: { parts: [{ text: 'CONNECTED' }] }, finishReason: 'STOP' }],
      } })
    }),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(accepted.statusCode, 200)
  assert.equal(accepted.body.text, 'CONNECTED')

  const rejected = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token' },
    body: { provider: 'gemini', model: 'gemini-3.5-flash', messages: [message()] },
  }), rejected, {
    env: { ...TEST_ENV, GEMINI_API_KEY: 'server-only-gemini-key' },
    fetchImpl: authenticatedFetch(async () => jsonResponse({
      ok: false,
      status: 400,
      body: { error: { status: 'INVALID_ARGUMENT', message: 'raw Gemini diagnostic must never reach a browser' } },
    })),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.body.error.code, 'GEMINI_REQUEST_INVALID')
  assert.equal(rejected.body.error.message, 'Google Gemini rejected this request. Choose another Gemini model or check server-side Google AI access.')
  assert.equal(JSON.stringify(rejected.body).includes('raw Gemini diagnostic'), false)
})

test('authenticated provider availability exposes no keys and supports independent optional providers', async () => {
  const noAnthropic = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token' },
    body: { action: 'provider-status' },
  }), noAnthropic, { env: TEST_ENV, fetchImpl: authenticatedFetch() })
  assert.equal(noAnthropic.statusCode, 200)
  assert.equal(noAnthropic.body.ok, true)
  assert.deepEqual(noAnthropic.body.providers, {
    anthropic: { configured: false, local: false },
    groq: { configured: false, local: false },
    gemini: { configured: false, local: false },
    ollama: { configured: true, local: true },
  })
  assert.equal(JSON.stringify(noAnthropic.body).includes('API_KEY'), false)

  const geminiOnly = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token' },
    body: { action: 'provider-status' },
  }), geminiOnly, {
    env: { ...TEST_ENV, GEMINI_API_KEY: 'server-only-gemini-key' },
    fetchImpl: authenticatedFetch(),
  })
  assert.equal(geminiOnly.body.providers.gemini.configured, true)
  assert.equal(geminiOnly.body.providers.anthropic.configured, false)
  assert.equal(resolveConfiguredProvider('anthropic', geminiOnly.body.providers), 'gemini')

  const groqOnly = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token' },
    body: { action: 'provider-status' },
  }), groqOnly, {
    env: { ...TEST_ENV, GROQ_API_KEY: 'server-only-groq-key' },
    fetchImpl: authenticatedFetch(),
  })
  assert.equal(groqOnly.body.providers.groq.configured, true)
  assert.equal(resolveConfiguredProvider('gemini', groqOnly.body.providers), 'groq')
})

test('a selected cloud provider without a key returns the premium missing-configuration message', async () => {
  const missingAnthropic = createResponseRecorder()
  await aiHandler(createRequest({
    headers: { authorization: 'Bearer verified-access-token' },
    body: { provider: 'anthropic', model: 'claude-sonnet-4-6', messages: [message()] },
  }), missingAnthropic, {
    env: TEST_ENV,
    fetchImpl: authenticatedFetch(),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(missingAnthropic.statusCode, 503)
  assert.equal(missingAnthropic.body.error.code, 'MISSING_CONFIGURATION')
  assert.equal(missingAnthropic.body.error.message, 'Anthropic is not configured. Choose another provider or add ANTHROPIC_API_KEY.')
})

test('YouTube and TTS endpoint failures use the normalized error contract without raw upstream details', async () => {
  const youtube = createResponseRecorder()
  await youtubeHandler(createRequest({
    url: '/api/youtube/analyze',
    headers: { authorization: 'Bearer verified-access-token' },
    body: { transcript: '' },
  }), youtube, { env: TEST_ENV, fetchImpl: authenticatedFetch(), rateLimiter: allowRateLimit() })
  assert.equal(youtube.statusCode, 400)
  assert.equal(youtube.body.ok, false)
  assert.equal(youtube.body.provider, 'groq')
  assert.equal(youtube.body.error.code, 'REQUEST_INVALID')

  const youtubeProviderFailure = createResponseRecorder()
  await youtubeHandler(createRequest({
    url: '/api/youtube/analyze',
    headers: { authorization: 'Bearer verified-access-token' },
    body: { transcript: 'A real transcript for provider failure coverage.' },
  }), youtubeProviderFailure, {
    env: { ...TEST_ENV, GROQ_API_KEY: 'server-only-key' },
    fetchImpl: authenticatedFetch(async () => jsonResponse({
      ok: false,
      status: 500,
      body: { error: { message: 'raw YouTube provider diagnostic must not leak' } },
    })),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(youtubeProviderFailure.statusCode, 500)
  assert.equal(youtubeProviderFailure.body.error.code, 'PROVIDER_UNAVAILABLE')
  assert.equal(JSON.stringify(youtubeProviderFailure.body).includes('raw YouTube provider diagnostic'), false)

  const ttsMissingConfig = createResponseRecorder()
  await ttsHandler(createRequest({ headers: { authorization: 'Bearer verified-access-token' }, body: { text: 'Hello' } }), ttsMissingConfig, {
    env: TEST_ENV,
    fetchImpl: authenticatedFetch(),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(ttsMissingConfig.statusCode, 503)
  assert.equal(ttsMissingConfig.body.provider, 'elevenlabs')
  assert.equal(ttsMissingConfig.body.error.code, 'MISSING_CONFIGURATION')

  const ttsProviderFailure = createResponseRecorder()
  await ttsHandler(createRequest({ headers: { authorization: 'Bearer verified-access-token' }, body: { text: 'Hello' } }), ttsProviderFailure, {
    env: { ...TEST_ENV, ELEVENLABS_API_KEY: 'server-only-key' },
    fetchImpl: authenticatedFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'upstream raw detail must not leak' } }) })),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(ttsProviderFailure.statusCode, 500)
  assert.equal(ttsProviderFailure.body.error.code, 'PROVIDER_UNAVAILABLE')
  assert.equal(JSON.stringify(ttsProviderFailure.body).includes('upstream raw detail'), false)
})

test('viral clip analysis uses the selected configured cloud provider and rejects internal model selection', async () => {
  const geminiAnalysis = createResponseRecorder()
  await youtubeHandler(createRequest({
    url: '/api/youtube/analyze',
    headers: { authorization: 'Bearer verified-access-token' },
    body: {
      transcript: 'A real transcript for configured Gemini analysis.',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    },
  }), geminiAnalysis, {
    env: { ...TEST_ENV, GEMINI_API_KEY: 'server-only-gemini-key' },
    fetchImpl: authenticatedFetch(async (url) => {
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//)
      return jsonResponse({ body: {
        candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify({
          viralityScore: 88,
          reason: 'Strong narrative arc.',
          peakMoment: 42,
          suggestedTitle: 'A better title',
          hook: 'Watch this now',
          hashtags: ['#founders'],
          clipRanges: [{ start: 12, end: 42, label: 'Key insight', score: 88 }],
          shortScript: 'A concise short script.',
          thumbnailIdea: 'A clear thumbnail.',
        }) + '\n```' }] } }],
      } })
    }),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(geminiAnalysis.statusCode, 200)
  assert.equal(geminiAnalysis.body.viralityScore, 88)

  const internalModel = createResponseRecorder()
  await youtubeHandler(createRequest({
    url: '/api/youtube/analyze',
    headers: { authorization: 'Bearer verified-access-token' },
    body: {
      transcript: 'A real transcript for internal model validation.',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
    },
  }), internalModel, {
    env: { ...TEST_ENV, GROQ_API_KEY: 'server-only-groq-key' },
    fetchImpl: authenticatedFetch(async () => assert.fail('Internal models must be rejected before execution')),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(internalModel.statusCode, 400)
  assert.equal(internalModel.body.error.code, 'INVALID_MODEL')
})

test('authenticated voice availability probes expose registry availability without executing a provider request', async () => {
  const probe = createResponseRecorder()
  await ttsHandler(createRequest({ headers: { authorization: 'Bearer verified-access-token' }, body: { probe: true } }), probe, {
    env: { ...TEST_ENV, ELEVENLABS_API_KEY: 'server-only-key' },
    fetchImpl: authenticatedFetch(async () => assert.fail('A probe must not call ElevenLabs')),
    rateLimiter: allowRateLimit(),
  })
  assert.equal(probe.statusCode, 200)
  assert.deepEqual(probe.body, {
    ok: true,
    provider: 'elevenlabs',
    model: 'eleven_multilingual_v2',
    available: true,
  })
})

test('removed stale ClipStudio routes return normalized 404s and have no reachable component', async () => {
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'src/components/viral-clip-studio/ClipStudio.jsx')), false)
  const response = createResponseRecorder()
  await youtubeHandler(createRequest({
    url: '/api/youtube/analyze-all',
    headers: { authorization: 'Bearer verified-access-token' },
  }), response, { env: TEST_ENV, fetchImpl: authenticatedFetch(), rateLimiter: allowRateLimit() })
  assert.equal(response.statusCode, 404)
  assert.equal(response.body.ok, false)
  assert.equal(response.body.error.code, 'REQUEST_INVALID')
})

test('Groq adapter preserves normalized options for structured internal AI requests', async () => {
  const selection = getPurposeModel('youtube-analysis')
  let body
  const output = await groqProvider.execute({
    request: {
      provider: selection.provider,
      model: selection.model,
      messages: [message('Analyze this transcript')],
      maxTokens: 2000,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    },
    env: { GROQ_API_KEY: 'test-key' },
    fetchImpl: async (_, options) => {
      body = JSON.parse(options.body)
      return jsonResponse({ body: { choices: [{ message: { content: '{"viralityScore":88}' }, finish_reason: 'stop' }] } })
    },
  })
  assert.equal(body.model, selection.model)
  assert.equal(body.temperature, 0.2)
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.equal(output.text, '{"viralityScore":88}')
  assert.equal(groqProvider.extractGroqText([{ type: 'text', text: 'CONNECTED' }]), 'CONNECTED')
  assert.equal(groqProvider.extractGroqText([{ type: 'reasoning', text: 'internal reasoning' }, { type: 'text', text: 'CONNECTED' }]), 'CONNECTED')

  await assert.rejects(
    groqProvider.execute({ request: { ...body }, env: {}, fetchImpl: async () => null }),
    { code: 'MISSING_CONFIGURATION' }
  )
})

test('provider preferences self-heal invalid and malformed values while preserving dynamic Ollama names', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
    },
  })
  try {
    assert.equal(setAIProviderPreference('groq'), true)
    assert.equal(setProviderModelPreference('groq', 'openai/gpt-oss-20b'), true)
    assert.equal(setProviderModelPreference('groq', 'llama-3.3-70b-versatile'), false)
    assert.equal(getAIProviderPreference(), 'groq')
    assert.equal(getProviderModelPreference('groq'), 'openai/gpt-oss-20b')
    assert.deepEqual([...store.keys()].sort(), ['fl_ai_models', 'fl_ai_provider'])
    assert.equal([...store.values()].some((value) => /api.?key|token|secret/i.test(value)), false)

    store.set('fl_ai_provider', 'unknown-provider')
    assert.equal(getAIProviderPreference(), '')
    store.set('fl_ai_models', '{malformed')
    assert.equal(getProviderModelPreference('groq'), 'openai/gpt-oss-120b')
    store.set('fl_ai_models', JSON.stringify({ groq: 'llama-3.3-70b-versatile' }))
    assert.equal(getProviderModelPreference('groq'), 'openai/gpt-oss-120b')
    store.set('fl_ai_models', JSON.stringify({ ollama: 'my-local-model:latest' }))
    assert.equal(getProviderModelPreference('ollama'), 'my-local-model:latest')
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', originalStorage)
  }
})
