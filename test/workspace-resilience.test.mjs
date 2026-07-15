import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildDashboardState, normalizeWorkspaceValue } from '../src/services/workspaceData.js'
import { createWorkspaceStore } from '../src/services/workspaceStore.js'
import { getSupabaseConfig } from '../src/lib/supabaseConfig.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = getSupabaseConfig({
  VITE_SUPABASE_URL: 'https://founderlab-test.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
})

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

function response(body, ok = true) {
  return { ok, json: async () => body }
}

function authenticatedStore({ storage = createStorage(), fetchImpl, onboardingRetryDelays = [], sleep = async () => {} } = {}) {
  const store = createWorkspaceStore({ config, storage, fetchImpl, onboardingRetryDelays, sleep })
  store.session = {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    user_id: 'user-id',
    email: 'founder@example.test',
  }
  return store
}

test('a first-time user safely has no profile or user_data rows', async () => {
  const store = authenticatedStore({
    fetchImpl: async (url) => response(url.includes('user_data') ? [] : []),
  })

  assert.equal(await store.getProfile(), null)
  assert.equal(await store.getData('fl_notes'), null)
})

test('new users complete onboarding with an idempotent core profile upsert and separate metadata', async () => {
  const requests = []
  const store = authenticatedStore({
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options })
      if (url.includes('profiles') && options.method === 'POST') return response({})
      if (url.includes('user_data') && options.method === 'PATCH') return response([])
      return response({})
    },
  })

  const result = await store.completeOnboarding({ role: 'Founder', goal: 'Save time with AI' })
  const profileWrite = requests.find(({ url, options }) => url.includes('profiles?on_conflict=id') && options.method === 'POST')
  const metadataWrite = requests.find(({ url, options }) => url.includes('user_data') && options.method === 'POST')

  assert.equal(result.saved, true)
  assert.equal(result.metadataSaved, true)
  assert.deepEqual(JSON.parse(profileWrite.options.body), { id: 'user-id', onboarded: true })
  assert.deepEqual(JSON.parse(metadataWrite.options.body), {
    user_id: 'user-id',
    key: 'fl_onboarding_profile',
    value: {
      role: 'Founder',
      goal: 'Save time with AI',
      onboarding_completed: true,
      onboarding_completed_at: result.profile.onboarding_completed_at,
    },
  })
})

test('an existing profile is updated safely and completed onboarding prevents a repeat after refresh or a new session', async () => {
  const writes = []
  const completingStore = authenticatedStore({
    fetchImpl: async (url, options = {}) => {
      if (url.includes('profiles') && options.method === 'POST') {
        writes.push(JSON.parse(options.body))
        return response({})
      }
      if (url.includes('user_data') && options.method === 'PATCH') return response([{ id: 'metadata-id' }])
      return response({})
    },
  })

  assert.equal((await completingStore.completeOnboarding({ role: 'Developer', goal: 'Learn faster' })).saved, true)
  assert.deepEqual(writes, [{ id: 'user-id', onboarded: true }])

  for (const label of ['refresh', 'sign-out/sign-in']) {
    const restoredStore = authenticatedStore({
      fetchImpl: async (url) => response(url.includes('profiles') ? [{ id: 'user-id', onboarded: true }] : []),
    })
    assert.deepEqual(await restoredStore.getProfile(), { id: 'user-id', onboarded: true }, label)
  }
})

test('a temporary onboarding profile write failure retries with bounded backoff', async () => {
  let profileAttempts = 0
  const waits = []
  const store = authenticatedStore({
    onboardingRetryDelays: [10, 20],
    sleep: async (delay) => { waits.push(delay) },
    fetchImpl: async (url, options = {}) => {
      if (url.includes('profiles') && options.method === 'POST') {
        profileAttempts += 1
        return response({}, profileAttempts > 1)
      }
      if (url.includes('user_data') && options.method === 'PATCH') return response([{ id: 'metadata-id' }])
      return response({})
    },
  })

  const result = await store.completeOnboarding({ role: 'Founder', goal: 'Grow my business' })
  assert.equal(result.saved, true)
  assert.equal(profileAttempts, 2)
  assert.deepEqual(waits, [10])
})

test('a permanent onboarding failure keeps a temporary device copy and returns an honest failed result', async () => {
  const storage = createStorage()
  const store = authenticatedStore({
    storage,
    onboardingRetryDelays: [1, 2],
    fetchImpl: async (url, options = {}) => {
      if (url.includes('profiles') && options.method === 'POST') return response({ message: 'write unavailable' }, false)
      if (url.includes('profiles')) return response([{ id: 'user-id', onboarded: false }])
      return response([])
    },
  })

  const result = await store.completeOnboarding({ role: 'Founder', goal: 'Grow my business' })
  assert.equal(result.saved, false)
  assert.equal(result.attempts, 3)
  assert.deepEqual(JSON.parse(storage.getItem('fl_pending_profile_user-id')), { id: 'user-id', onboarded: true })
  assert.deepEqual(JSON.parse(storage.getItem('fl_pending_onboarding_user-id')), {
    role: 'Founder',
    goal: 'Grow my business',
    onboarding_completed: true,
    onboarding_completed_at: result.profile.onboarding_completed_at,
  })
  assert.deepEqual(await store.getProfile(), { id: 'user-id', onboarded: true })
})

test('legacy pending onboarding values with unsupported profile fields are migrated without replaying them to profiles', async () => {
  const storage = createStorage({
    'fl_pending_profile_user-id': JSON.stringify({
      id: 'user-id',
      onboarded: true,
      role: 'Founder',
      goal: 'Save time with AI',
    }),
  })
  const profileWrites = []
  const store = authenticatedStore({
    storage,
    fetchImpl: async (url, options = {}) => {
      if (url.includes('profiles') && options.method === 'POST') {
        profileWrites.push(JSON.parse(options.body))
        return response({})
      }
      if (url.includes('profiles')) return response([{ id: 'user-id', onboarded: false }])
      if (url.includes('user_data') && options.method === 'PATCH') return response([{ id: 'metadata-id' }])
      return response([])
    },
  })

  assert.deepEqual(await store.getProfile(), { id: 'user-id', onboarded: true })
  assert.deepEqual(profileWrites, [{ id: 'user-id', onboarded: true }])
  assert.equal(storage.getItem('fl_pending_profile_user-id'), null)
  assert.equal(storage.getItem('fl_pending_onboarding_user-id'), null)
})

test('the onboarding UI offers an explicit retry instead of claiming a failed save succeeded', () => {
  const source = fs.readFileSync(path.join(repositoryRoot, 'src/features/auth/AuthScreens.jsx'), 'utf8')
  assert.match(source, /Retry Save/)
  assert.match(source, /couldn’t save your onboarding choices/)
  assert.doesNotMatch(source, /Your workspace is ready\. We will retry saving your onboarding choices/)
})

test('workspace collections recover from malformed legacy values without rendering invalid records', () => {
  assert.deepEqual(normalizeWorkspaceValue('fl_notes', { legacy: true }), { value: [], repaired: true })
  assert.deepEqual(normalizeWorkspaceValue('fl_tasks', [null, 'broken', { id: 'task-1', status: 'todo' }]), {
    value: [{ id: 'task-1', status: 'todo' }],
    repaired: true,
  })
  assert.deepEqual(normalizeWorkspaceValue('fl_projects', null), { value: [], repaired: false })
})

test('dashboard boot is safe with empty Supabase responses, malformed feature data, and one failed feature load', () => {
  assert.deepEqual(buildDashboardState({ eventCounts: null, notes: null, tasks: null }), {
    counts: {},
    banner: null,
  })

  const dashboard = buildDashboardState({
    eventCounts: { chat: 3, note: 'invalid' },
    notes: [null, { id: 'note-1', title: 'Recovered note', updated_at: '2026-07-13T12:00:00.000Z' }],
    tasks: [undefined, { id: 'task-1', status: 'todo' }],
  })
  assert.deepEqual(dashboard.counts, { chat: 3, note: 0 })
  assert.deepEqual(dashboard.banner, {
    note: { id: 'note-1', title: 'Recovered note', updated_at: '2026-07-13T12:00:00.000Z' },
    pending: 1,
  })
})

test('the dashboard imports every component used by its restored-state banner', () => {
  const source = fs.readFileSync(path.join(repositoryRoot, 'src/features/dashboard/Dashboard.jsx'), 'utf8')
  assert.match(source, /import \{ Button, Card, Spinner \} from '@\/components\/ui\/Primitives'/)
  assert.match(source, /<Button onClick=\{\(\)=>setPage\('notes'\)\}/)
})

test('Preview diagnostics expose only safe classification while development retains stack details', () => {
  const source = fs.readFileSync(path.join(repositoryRoot, 'src/app/ErrorBoundary.jsx'), 'utf8')
  assert.match(source, /function getSafeDiagnosticMessage/)
  assert.match(source, /import\.meta\.env\.VERCEL_ENV === 'preview'/)
  assert.match(source, /import\.meta\.env\.DEV && this\.state\.error\?\.stack/)
  assert.doesNotMatch(source, /Message: \{this\.state\.error\?\.message/)
})
