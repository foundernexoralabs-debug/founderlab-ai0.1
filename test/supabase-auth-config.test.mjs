import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAuthRedirectUrl,
  getSafeAuthErrorMessage,
  getSupabaseConfig,
  SUPABASE_CONFIGURATION_ERROR,
  withAuthRedirect,
} from '../src/lib/supabaseConfig.js'
import { createWorkspaceStore } from '../src/services/workspaceStore.js'

const validEnvironment = Object.freeze({
  VITE_SUPABASE_URL: 'https://founderlab-test.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
})

function createStorage(initialValue = null) {
  let value = initialValue
  return {
    getItem: () => value,
    setItem: (_, nextValue) => { value = nextValue },
    removeItem: () => { value = null },
    get value() { return value },
  }
}

function successfulResponse(body = {}) {
  return { ok: true, json: async () => body }
}

test('Supabase configuration rejects missing, malformed, endpoint, and whitespace values', () => {
  assert.equal(getSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'public-anon-key' }).valid, false)
  assert.equal(getSupabaseConfig({ VITE_SUPABASE_URL: 'https://founderlab-test.supabase.co', VITE_SUPABASE_ANON_KEY: '' }).valid, false)
  assert.equal(getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_URL: 'https://founderlab-test.supabase.co/auth/v1' }).valid, false)
  assert.equal(getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_URL: 'https://founderlab-test.supabase.co/rest/v1' }).valid, false)
  assert.equal(getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_URL: ' https://founderlab-test.supabase.co' }).valid, false)
  assert.equal(getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_ANON_KEY: 'public-anon-key ' }).valid, false)
  assert.equal(getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_ANON_KEY: 'undefined' }).valid, false)
  assert.equal(getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_ANON_KEY: '"public-anon-key"' }).valid, false)
})

test('a valid Supabase configuration normalizes to the HTTPS project origin', () => {
  const config = getSupabaseConfig({ ...validEnvironment, VITE_SUPABASE_URL: 'https://founderlab-test.supabase.co/' })
  assert.deepEqual(config, {
    valid: true,
    url: 'https://founderlab-test.supabase.co',
    anonKey: 'public-anon-key',
  })
})

test('invalid Supabase configuration blocks every browser auth action before fetch', async () => {
  let fetchCalls = 0
  const store = createWorkspaceStore({
    config: getSupabaseConfig({ VITE_SUPABASE_URL: 'not a URL', VITE_SUPABASE_ANON_KEY: 'public-anon-key' }),
    fetchImpl: async () => {
      fetchCalls += 1
      return successfulResponse()
    },
    storage: createStorage(),
  })

  for (const action of [
    () => store.signIn('founder@example.test', 'safe-password'),
    () => store.signUp('founder@example.test', 'safe-password'),
    () => store.resetPassword('founder@example.test'),
    () => store.resendVerification('founder@example.test'),
  ]) {
    await assert.rejects(action, new RegExp(SUPABASE_CONFIGURATION_ERROR.replace(/[.]/g, '\\.')))
  }

  assert.equal(fetchCalls, 0)
})

test('a valid configuration sends auth requests to the expected Supabase endpoint', async () => {
  let capturedUrl = ''
  let capturedOptions = null
  const store = createWorkspaceStore({
    config: getSupabaseConfig(validEnvironment),
    fetchImpl: async (url, options) => {
      capturedUrl = url
      capturedOptions = options
      return successfulResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        user: { id: 'user-id', email: 'founder@example.test' },
      })
    },
    storage: createStorage(),
  })

  await store.signIn('founder@example.test', 'safe-password', false)
  assert.equal(capturedUrl, 'https://founderlab-test.supabase.co/auth/v1/token?grant_type=password')
  assert.equal(capturedOptions.headers.apikey, 'public-anon-key')
  assert.deepEqual(JSON.parse(capturedOptions.body), { email: 'founder@example.test', password: 'safe-password' })
  assert.equal(store.session.user_id, 'user-id')
})

test('email auth actions return to the current HTTPS preview origin', async () => {
  const previewLocation = { origin: 'https://founderlab-ai01-git-phase-2-foun.example.vercel.app' }
  const requests = []
  const store = createWorkspaceStore({
    config: getSupabaseConfig(validEnvironment),
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) })
      return successfulResponse()
    },
    storage: createStorage(),
    location: previewLocation,
  })

  await store.signUp('founder@example.test', 'safe-password')
  await store.resetPassword('founder@example.test')
  await store.resendVerification('founder@example.test')

  assert.deepEqual(requests, [
    {
      url: 'https://founderlab-test.supabase.co/auth/v1/signup',
      body: { email: 'founder@example.test', password: 'safe-password', redirect_to: previewLocation.origin },
    },
    {
      url: 'https://founderlab-test.supabase.co/auth/v1/recover',
      body: { email: 'founder@example.test', redirect_to: previewLocation.origin },
    },
    {
      url: 'https://founderlab-test.supabase.co/auth/v1/resend',
      body: { type: 'signup', email: 'founder@example.test', email_redirect_to: previewLocation.origin },
    },
  ])
  assert.equal(getAuthRedirectUrl(previewLocation), previewLocation.origin)
  assert.deepEqual(withAuthRedirect({ email: 'founder@example.test' }, 'redirect_to', previewLocation), {
    email: 'founder@example.test',
    redirect_to: previewLocation.origin,
  })
  assert.equal(getAuthRedirectUrl({ origin: 'http://localhost:5173' }), 'http://localhost:5173')
  assert.equal(getAuthRedirectUrl({ origin: 'http://example.test' }), null)
})

test('safe auth error mapping hides browser URL exceptions', () => {
  assert.equal(getSafeAuthErrorMessage(new TypeError('The string did not match the expected pattern.')), SUPABASE_CONFIGURATION_ERROR)
})

test('session restoration refreshes and persists a valid remembered session', async () => {
  const storage = createStorage(JSON.stringify({ refresh_token: 'stored-refresh-token' }))
  let refreshRequest = null
  const store = createWorkspaceStore({
    config: getSupabaseConfig(validEnvironment),
    fetchImpl: async (url, options) => {
      refreshRequest = { url, body: JSON.parse(options.body) }
      return successfulResponse({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        user: { id: 'user-id', email: 'founder@example.test' },
      })
    },
    storage,
  })

  assert.equal(await store.boot(), true)
  assert.deepEqual(refreshRequest, {
    url: 'https://founderlab-test.supabase.co/auth/v1/token?grant_type=refresh_token',
    body: { refresh_token: 'stored-refresh-token' },
  })
  assert.equal(JSON.parse(storage.value).refresh_token, 'new-refresh-token')
})
