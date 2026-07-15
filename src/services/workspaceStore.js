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
const PENDING_ONBOARDING_PREFIX = 'fl_pending_onboarding_'
const ONBOARDING_DATA_KEY = 'fl_onboarding_profile'
const DEFAULT_ONBOARDING_RETRY_DELAYS = [250, 750]
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000

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

function getPendingOnboardingKey(userId) {
  return PENDING_ONBOARDING_PREFIX + userId
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

function normalizeOnboardingDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const role = typeof value.role === 'string' ? value.role.trim() : ''
  const goal = typeof value.goal === 'string' ? value.goal.trim() : ''
  if (!role || !goal) return null
  return {
    role,
    goal,
    onboarding_completed: true,
    onboarding_completed_at: typeof value.onboarding_completed_at === 'string'
      ? value.onboarding_completed_at
      : new Date().toISOString(),
  }
}

function readPendingOnboarding(storage, userId) {
  if (!userId) return null
  try {
    return normalizeOnboardingDetails(JSON.parse(storage?.getItem(getPendingOnboardingKey(userId)) || ''))
  } catch {
    try { storage?.removeItem(getPendingOnboardingKey(userId)) } catch {}
    return null
  }
}

function writePendingOnboarding(storage, userId, details) {
  const normalized = normalizeOnboardingDetails(details)
  if (!userId || !normalized) return
  try { storage?.setItem(getPendingOnboardingKey(userId), JSON.stringify(normalized)) } catch {}
}

function clearPendingOnboarding(storage, userId) {
  try { storage?.removeItem(getPendingOnboardingKey(userId)) } catch {}
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function decodeAccessTokenExpiry(accessToken) {
  if (typeof accessToken !== 'string') return 0
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return 0
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    if (typeof globalThis.atob !== 'function') return 0
    const parsed = JSON.parse(globalThis.atob(base64))
    const expiry = Number(parsed?.exp)
    return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : 0
  } catch {
    return 0
  }
}

function normalizeExpiryMilliseconds(value) {
  const expiry = Number(value)
  if (!Number.isFinite(expiry) || expiry <= 0) return 0
  return expiry < 100000000000 ? expiry * 1000 : expiry
}

function getSessionExpiry(data) {
  return normalizeExpiryMilliseconds(data?.expires_at)
    || (Number.isFinite(Number(data?.expires_in)) ? Date.now() + Number(data.expires_in) * 1000 : 0)
    || decodeAccessTokenExpiry(data?.access_token)
}

function isAccessTokenExpiring(session, now = Date.now()) {
  const expiry = normalizeExpiryMilliseconds(session?.expires_at) || decodeAccessTokenExpiry(session?.access_token)
  return expiry > 0 && expiry - now <= ACCESS_TOKEN_REFRESH_MARGIN_MS
}

async function retryWorkspaceOperation(operation, retryDelays, sleep) {
  let attempts = 0
  for (let index = 0; index <= retryDelays.length; index += 1) {
    attempts += 1
    try {
      if (await operation()) return { saved: true, attempts }
    } catch {
      // The caller decides which small, recoverable value to retain locally.
    }
    if (index < retryDelays.length) await sleep(retryDelays[index])
  }
  return { saved: false, attempts }
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
  sleep = defaultSleep,
  onboardingRetryDelays = DEFAULT_ONBOARDING_RETRY_DELAYS,
} = {}) {
  let sessionRefreshPromise = null
  let authEpoch = 0
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
        await store.refreshSession(saved.refresh_token, true)
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
      authEpoch += 1
      store.session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user_id: data.user?.id,
        email: data.user?.email,
        expires_at: getSessionExpiry(data) || undefined,
      }
      persistSession(storage, SESSION_STORAGE_KEY, store.session, remember)
    },

    async refreshSession(refreshToken = store.session?.refresh_token, remember = store.rememberSession) {
      if (!refreshToken) throw new Error('Authentication session is unavailable.')
      const epoch = authEpoch
      const data = await store.requestAuth('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken })
      if (authEpoch !== epoch) return ''
      store.saveSession(data, remember)
      return store.session?.access_token || ''
    },

    async getActiveAccessToken({ forceRefresh = false } = {}) {
      const session = store.session
      if (!session) return ''
      if (!forceRefresh && session.access_token && !isAccessTokenExpiring(session)) return session.access_token
      if (!session.refresh_token) return ''

      if (!sessionRefreshPromise) {
        sessionRefreshPromise = store.refreshSession(session.refresh_token, store.rememberSession)
          .finally(() => { sessionRefreshPromise = null })
      }
      return sessionRefreshPromise
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
      authEpoch += 1
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
      const pendingProfile = readPendingProfile(storage, store.session?.user_id)
      if (profile && (profile.onboarded || !pendingProfile?.onboarded)) {
        if (profile.onboarded) {
          clearPendingProfile(storage, store.session?.user_id)
        }
        await store.syncPendingOnboardingDetails()
        return profile
      }

      if (!pendingProfile) return profile
      const coreProfile = { id: pendingProfile.id, onboarded: pendingProfile.onboarded === true }
      const legacyDetails = normalizeOnboardingDetails(pendingProfile)
      if (legacyDetails) writePendingOnboarding(storage, coreProfile.id, legacyDetails)
      const retry = await retryWorkspaceOperation(
        () => store.post('profiles?on_conflict=id', coreProfile, 'resolution=merge-duplicates,return=minimal'),
        onboardingRetryDelays,
        sleep,
      )
      if (retry.saved) {
        clearPendingProfile(storage, store.session?.user_id)
        await store.syncPendingOnboardingDetails()
      }
      return profile ? { ...profile, onboarded: coreProfile.onboarded } : coreProfile
    },

    async updateProfile(data) {
      if (!store.session?.user_id) return false
      const profile = normalizeProfile({ id: store.session.user_id, ...data }, store.session.user_id)
      const saved = await store.post('profiles', profile, 'resolution=merge-duplicates,return=minimal')
      if (saved) clearPendingProfile(storage, profile.id)
      else writePendingProfile(storage, profile)
      return saved
    },

    async syncPendingOnboardingDetails() {
      const userId = store.session?.user_id
      const details = readPendingOnboarding(storage, userId)
      if (!details) return { saved: true, attempts: 0 }
      const retry = await retryWorkspaceOperation(
        () => store.setData(ONBOARDING_DATA_KEY, details),
        onboardingRetryDelays,
        sleep,
      )
      if (retry.saved) clearPendingOnboarding(storage, userId)
      return retry
    },

    async completeOnboarding({ role, goal } = {}) {
      const userId = store.session?.user_id
      const details = normalizeOnboardingDetails({ role, goal })
      if (!userId || !details) return { saved: false, metadataSaved: false, attempts: 0, profile: null }

      const profile = { id: userId, onboarded: true }
      const profileRetry = await retryWorkspaceOperation(
        () => store.post('profiles?on_conflict=id', profile, 'resolution=merge-duplicates,return=minimal'),
        onboardingRetryDelays,
        sleep,
      )

      if (!profileRetry.saved) {
        writePendingProfile(storage, profile)
        writePendingOnboarding(storage, userId, details)
        return { saved: false, metadataSaved: false, attempts: profileRetry.attempts, profile: { ...profile, ...details } }
      }

      clearPendingProfile(storage, userId)
      writePendingOnboarding(storage, userId, details)
      const detailsRetry = await store.syncPendingOnboardingDetails()
      return {
        saved: true,
        metadataSaved: detailsRetry.saved,
        attempts: profileRetry.attempts + detailsRetry.attempts,
        profile: { ...profile, ...details },
      }
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
