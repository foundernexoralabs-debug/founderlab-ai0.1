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

function authenticatedStore({ storage = createStorage(), fetchImpl } = {}) {
  const store = createWorkspaceStore({ config, storage, fetchImpl })
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

test('onboarding profile saves return success and clear any pending local fallback', async () => {
  const storage = createStorage({ 'fl_pending_profile_user-id': JSON.stringify({ id: 'user-id', onboarded: true }) })
  const store = authenticatedStore({ storage, fetchImpl: async () => response({}) })

  assert.equal(await store.updateProfile({ onboarded: true, role: 'Founder', goal: 'Save time with AI' }), true)
  assert.equal(storage.getItem('fl_pending_profile_user-id'), null)
})

test('a failed onboarding save retains a safe local profile and avoids an onboarding reload loop', async () => {
  const storage = createStorage()
  const store = authenticatedStore({
    storage,
    fetchImpl: async (url, options = {}) => {
      if (options.method === 'POST') return response({ message: 'profile write unavailable' }, false)
      if (url.includes('profiles')) return response([])
      return response([])
    },
  })

  assert.equal(await store.updateProfile({ onboarded: true, role: 'Founder', goal: 'Grow my business' }), false)
  const savedFallback = JSON.parse(storage.getItem('fl_pending_profile_user-id'))
  assert.deepEqual(savedFallback, {
    id: 'user-id',
    onboarded: true,
    role: 'Founder',
    goal: 'Grow my business',
  })
  assert.deepEqual(await store.getProfile(), savedFallback)
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
