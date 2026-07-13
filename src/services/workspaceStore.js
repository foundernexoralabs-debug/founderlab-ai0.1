import { persistSession, readPersistedSession } from '../lib/persistedSession.js'
import {
  getSupabaseConfig,
  getSupabaseRequestUrl,
  requireSupabaseConfig,
  withAuthRedirect,
} from '../lib/supabaseConfig.js'
import { normalizeWorkspaceValue } from './workspaceData.js'

const supabaseConfig = getSupabaseConfig(import.meta.env || {})
const SESSION_STORAGE_KEY = 'fl_session'
const PENDING_PROFILE_PREFIX = 'fl_pending_profile_'

export const isWorkspaceConfigured = supabaseConfig.valid

function getBrowserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage
}

function getFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('Authentication service is unavailable. Please try again.')
  return fetchImpl
}

function getPendingProfileKey(userId) {
  return PENDING_PROFILE_PREFIX + userId
}

function normalizeProfile(profile, userId) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  return {
    ...profile,
    id: typeof profile.id === 'string' && profile.id ? profile.id : userId,
    onboarded: profile.onboarded === true,
  }
}

function readPendingProfile(storage, userId) {
  if (!userId) return null
  try {
    return normalizeProfile(JSON.parse(storage?.getItem(getPendingProfileKey(userId)) || ''), userId)
  } catch {
    try { storage?.removeItem(getPendingProfileKey(userId)) } catch {}
    return null
  }
}

function writePendingProfile(storage, profile) {
  if (!profile?.id) return
  try { storage?.setItem(getPendingProfileKey(profile.id), JSON.stringify(profile)) } catch {}
}

function clearPendingProfile(storage, userId) {
  try { storage?.removeItem(getPendingProfileKey(userId)) } catch {}
}

function readLocalWorkspaceValue(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return { value: fallback, found: false }
    const normalized = normalizeWorkspaceValue(key, JSON.parse(raw), fallback)
    if (normalized.repaired) storage?.setItem(key, JSON.stringify(normalized.value))
    return { value: normalized.value, found: true }
  } catch {
    try { storage?.removeItem(key) } catch {}
    return { value: fallback, found: false }
  }
}

export function createWorkspaceStore({
  config = supabaseConfig,
  fetchImpl = globalThis.fetch,
  storage = getBrowserStorage(),
  location = globalThis.location,
} = {}) {
  const requestUrl = (path) => getSupabaseRequestUrl(config, path)
  const headers = (token) => {
    const activeConfig = requireSupabaseConfig(config)
    return {
      'Content-Type': 'application/json',
      apikey: activeConfig.anonKey,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    }
  }

  const store = {
    session: null,
    rememberSession: true,

    async boot() {
      try {
        const saved = readPersistedSession(storage, SESSION_STORAGE_KEY)
        if (!saved) return false
        const data = await store.requestAuth('/auth/v1/token?grant_type=refresh_token', { refresh_token: saved.refresh_token })
        store.saveSession(data, true)
        return true
      } catch {
        try {
          storage?.removeItem(SESSION_STORAGE_KEY)
        } catch {
          // A login screen is still usable when browser storage is unavailable.
        }
        return false
      }
    },

    saveSession(data, remember = store.rememberSession) {
      store.session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user?.id,
        email: data.user?.email,
      }
      persistSession(storage, SESSION_STORAGE_KEY, store.session, remember)
    },

    async requestAuth(path, body, token) {
      const response = await getFetch(fetchImpl)(requestUrl(path), {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.msg || data.error_description || data.message || 'Auth error')
      return data
    },

    async signUp(email, password) {
      return store.requestAuth('/auth/v1/signup', withAuthRedirect({ email, password }, 'redirect_to', location))
    },

    async resetPassword(email) {
      return store.requestAuth('/auth/v1/recover', withAuthRedirect({ email }, 'redirect_to', location))
    },

    async resendVerification(email) {
      return store.requestAuth('/auth/v1/resend', withAuthRedirect({ type: 'signup', email }, 'email_redirect_to', location))
    },

    async signIn(email, password, remember = true) {
      store.rememberSession = remember
      const data = await store.requestAuth('/auth/v1/token?grant_type=password', { email, password })
      store.saveSession(data, remember)
      return data
    },

    async signOut() {
      try {
        await store.requestAuth('/auth/v1/logout', {}, store.session?.access_token)
      } catch {
        // Logout must also succeed locally if the network is unavailable.
      }
      store.session = null
      try {
        storage?.removeItem(SESSION_STORAGE_KEY)
      } catch {
        // Sign-out still completes when storage is unavailable.
      }
    },

    async updatePassword(password) {
      const response = await getFetch(fetchImpl)(requestUrl('/auth/v1/user'), {
        method: 'PUT',
        headers: headers(store.session?.access_token),
        body: JSON.stringify({ password }),
      })
      if (!response.ok) throw new Error('Update failed')
    },

    headers() {
      return headers(store.session?.access_token)
    },

    async get(path) {
      try {
        const response = await getFetch(fetchImpl)(requestUrl('/rest/v1/' + path), { headers: store.headers() })
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    },

    async patch(path, body, prefer = 'return=minimal') {
      try {
        const response = await getFetch(fetchImpl)(requestUrl('/rest/v1/' + path), {
          method: 'PATCH',
          headers: { ...store.headers(), Prefer: prefer },
          body: JSON.stringify(body),
        })
        if (!response.ok) return prefer.includes('representation') ? [] : false
        return prefer.includes('representation') ? await response.json() : true
      } catch {
        return prefer.includes('representation') ? [] : false
      }
    },

    async post(path, body, prefer = 'return=minimal') {
      try {
        const response = await getFetch(fetchImpl)(requestUrl('/rest/v1/' + path), {
          method: 'POST',
          headers: { ...store.headers(), Prefer: prefer },
          body: JSON.stringify(body),
        })
        return response.ok
      } catch {
        return false
      }
    },

    async getProfile() {
      const data = await store.get('profiles?id=eq.' + store.session.user_id + '&select=*')
      const profile = Array.isArray(data) ? normalizeProfile(data[0], store.session?.user_id) : null
      if (profile) {
        clearPendingProfile(storage, store.session?.user_id)
        return profile
      }

      const pendingProfile = readPendingProfile(storage, store.session?.user_id)
      if (!pendingProfile) return null
      if (await store.post('profiles', pendingProfile, 'resolution=merge-duplicates,return=minimal')) {
        clearPendingProfile(storage, pendingProfile.id)
      }
      return pendingProfile
    },

    async updateProfile(data) {
      if (!store.session?.user_id) return false
      const profile = normalizeProfile({ id: store.session.user_id, ...data }, store.session.user_id)
      const saved = await store.post('profiles', profile, 'resolution=merge-duplicates,return=minimal')
      if (saved) clearPendingProfile(storage, profile.id)
      else writePendingProfile(storage, profile)
      return saved
    },

    async getData(key) {
      const data = await store.get('user_data?user_id=eq.' + store.session.user_id + '&key=eq.' + encodeURIComponent(key) + '&select=id,value&order=id.desc&limit=1')
      return Array.isArray(data) && data.length ? data[0].value : null
    },

    async setData(key, value) {
      const userId = store.session.user_id
      const path = 'user_data?user_id=eq.' + userId + '&key=eq.' + encodeURIComponent(key)
      const updated = await store.patch(path, { value }, 'return=representation')
      if (Array.isArray(updated) && updated.length > 0) return true
      return store.post('user_data', { user_id: userId, key, value }, 'return=minimal')
    },

    async exportAll() {
      return store.get('user_data?user_id=eq.' + store.session.user_id + '&select=key,value') || []
    },

    async logEvent(event, page) {
      try {
        await store.post('usage_events', { user_id: store.session.user_id, event, page })
      } catch {
        // Analytics must never interrupt the user's primary action.
      }
    },

    async getEventCounts() {
      const data = await store.get('usage_events?user_id=eq.' + store.session.user_id + '&select=event')
      if (!Array.isArray(data)) return {}
      return data.reduce((counts, event) => {
        counts[event.event] = (counts[event.event] || 0) + 1
        return counts
      }, {})
    },

    async submitFeedback(type, description) {
      return store.post('fl_feedback', { user_id: store.session?.user_id, email: store.session?.email, type, description })
    },

    async getFeedback() {
      return store.get('fl_feedback?user_id=eq.' + store.session.user_id + '&select=*&order=created_at.desc') || []
    },

    async resolveFeedback(id) {
      return store.patch('fl_feedback?id=eq.' + id, { status: 'resolved' })
    },
  }

  return store
}

export const workspaceStore = createWorkspaceStore()

export async function saveWorkspaceData(key, value) {
  const normalized = normalizeWorkspaceValue(key, value)
  const safeValue = normalized.value
  const storage = getBrowserStorage()
  try {
    storage?.setItem(key, JSON.stringify(safeValue))
  } catch {
    // Local persistence is a convenience fallback.
  }
  if (!workspaceStore.session?.user_id) return
  try {
    await workspaceStore.setData(key, safeValue)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[workspace:save-failed]', { key, message: error?.message })
    }
  }
}

export async function loadWorkspaceData(key, fallback = null) {
  const storage = getBrowserStorage()
  if (workspaceStore.session?.user_id) {
    try {
      const cloudValue = await workspaceStore.getData(key)
      if (cloudValue !== null && cloudValue !== undefined) {
        const cloud = normalizeWorkspaceValue(key, cloudValue, fallback)
        if (!cloud.repaired) return cloud.value

        const local = readLocalWorkspaceValue(storage, key, fallback)
        const recoveredValue = local.found ? local.value : cloud.value
        try { await workspaceStore.setData(key, recoveredValue) } catch {}
        return recoveredValue
      }
    } catch {
      // Fall through to the device copy.
    }
  }
  return readLocalWorkspaceValue(storage, key, fallback).value
}

export async function migrateLocalWorkspaceToCloud() {
  const storage = getBrowserStorage()
  for (const key of ['fl_convos', 'fl_notes', 'fl_tasks', 'fl_projects']) {
    try {
      const local = readLocalWorkspaceValue(storage, key, [])
      if (!local.found) continue
      const localValue = local.value
      if (!localValue || (Array.isArray(localValue) && !localValue.length)) continue
      const cloudValue = await workspaceStore.getData(key)
      if (!cloudValue || (Array.isArray(cloudValue) && !cloudValue.length)) {
        await workspaceStore.setData(key, localValue)
        storage?.removeItem(key)
      }
    } catch {
      // A corrupt local entry should not block other workspace data.
    }
  }
}
