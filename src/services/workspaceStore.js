import { persistSession, readPersistedSession } from '@/lib/persistedSession'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const SESSION_STORAGE_KEY = 'fl_session'

export const isWorkspaceConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const workspaceStore = {
  session: null,
  rememberSession: true,

  async boot() {
    try {
      const saved = readPersistedSession(localStorage, SESSION_STORAGE_KEY)
      if (!saved) return false
      const data = await this.requestAuth('/auth/v1/token?grant_type=refresh_token', { refresh_token: saved.refresh_token })
      this.saveSession(data, true)
      return true
    } catch {
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY)
      } catch {
        // A login screen is still usable when browser storage is unavailable.
      }
      return false
    }
  },

  saveSession(data, remember = this.rememberSession) {
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: data.user?.id,
      email: data.user?.email,
    }
    persistSession(localStorage, SESSION_STORAGE_KEY, this.session, remember)
  },

  async requestAuth(path, body, token) {
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }
    if (token) headers.Authorization = 'Bearer ' + token
    const response = await fetch(SUPABASE_URL + path, { method: 'POST', headers, body: JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.msg || data.error_description || data.message || 'Auth error')
    return data
  },

  async signUp(email, password) { return this.requestAuth('/auth/v1/signup', { email, password }) },
  async resetPassword(email) { return this.requestAuth('/auth/v1/recover', { email }) },
  async resendVerification(email) { return this.requestAuth('/auth/v1/resend', { type: 'signup', email }) },

  async signIn(email, password, remember = true) {
    this.rememberSession = remember
    const data = await this.requestAuth('/auth/v1/token?grant_type=password', { email, password })
    this.saveSession(data, remember)
    return data
  },

  async signOut() {
    try {
      await this.requestAuth('/auth/v1/logout', {}, this.session?.access_token)
    } catch {
      // Logout must also succeed locally if the network is unavailable.
    }
    this.session = null
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // Sign-out still completes when storage is unavailable.
    }
  },

  async updatePassword(password) {
    const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + this.session.access_token },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) throw new Error('Update failed')
  },

  headers() {
    return { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + this.session?.access_token }
  },

  async get(path) {
    try {
      const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: this.headers() })
      return response.ok ? await response.json() : null
    } catch {
      return null
    }
  },

  async patch(path, body, prefer = 'return=minimal') {
    try {
      const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method: 'PATCH', headers: { ...this.headers(), Prefer: prefer }, body: JSON.stringify(body) })
      if (!response.ok) return prefer.includes('representation') ? [] : false
      return prefer.includes('representation') ? await response.json() : true
    } catch {
      return prefer.includes('representation') ? [] : false
    }
  },

  async post(path, body, prefer = 'return=minimal') {
    try {
      const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method: 'POST', headers: { ...this.headers(), Prefer: prefer }, body: JSON.stringify(body) })
      return response.ok
    } catch {
      return false
    }
  },

  async getProfile() {
    const data = await this.get('profiles?id=eq.' + this.session.user_id + '&select=*')
    return Array.isArray(data) ? data[0] || null : null
  },

  async updateProfile(data) {
    return this.post('profiles', { id: this.session.user_id, ...data }, 'resolution=merge-duplicates,return=minimal')
  },

  async getData(key) {
    const data = await this.get('user_data?user_id=eq.' + this.session.user_id + '&key=eq.' + encodeURIComponent(key) + '&select=id,value&order=id.desc&limit=1')
    return Array.isArray(data) && data.length ? data[0].value : null
  },

  async setData(key, value) {
    const userId = this.session.user_id
    const path = 'user_data?user_id=eq.' + userId + '&key=eq.' + encodeURIComponent(key)
    const updated = await this.patch(path, { value }, 'return=representation')
    if (Array.isArray(updated) && updated.length > 0) return true
    return this.post('user_data', { user_id: userId, key, value }, 'return=minimal')
  },

  async exportAll() { return this.get('user_data?user_id=eq.' + this.session.user_id + '&select=key,value') || [] },

  async logEvent(event, page) {
    try {
      await this.post('usage_events', { user_id: this.session.user_id, event, page })
    } catch {
      // Analytics must never interrupt the user's primary action.
    }
  },

  async getEventCounts() {
    const data = await this.get('usage_events?user_id=eq.' + this.session.user_id + '&select=event')
    if (!Array.isArray(data)) return {}
    return data.reduce((counts, event) => {
      counts[event.event] = (counts[event.event] || 0) + 1
      return counts
    }, {})
  },

  async submitFeedback(type, description) {
    return this.post('fl_feedback', { user_id: this.session?.user_id, email: this.session?.email, type, description })
  },

  async getFeedback() {
    return this.get('fl_feedback?user_id=eq.' + this.session.user_id + '&select=*&order=created_at.desc') || []
  },

  async resolveFeedback(id) {
    return this.patch('fl_feedback?id=eq.' + id, { status: 'resolved' })
  },
}

export async function saveWorkspaceData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local persistence is a convenience fallback.
  }
  if (!workspaceStore.session?.user_id) return
  try {
    await workspaceStore.setData(key, value)
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[workspace:save-failed]', { key, message: error?.message })
    }
  }
}

export async function loadWorkspaceData(key, fallback = null) {
  if (workspaceStore.session?.user_id) {
    try {
      const cloudValue = await workspaceStore.getData(key)
      if (cloudValue !== null && cloudValue !== undefined) return cloudValue
    } catch {
      // Fall through to the device copy.
    }
  }
  try {
    const localValue = localStorage.getItem(key)
    return localValue ? JSON.parse(localValue) : fallback
  } catch {
    return fallback
  }
}

export async function migrateLocalWorkspaceToCloud() {
  for (const key of ['fl_convos', 'fl_notes', 'fl_tasks']) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const localValue = JSON.parse(raw)
      if (!localValue || (Array.isArray(localValue) && !localValue.length)) continue
      const cloudValue = await workspaceStore.getData(key)
      if (!cloudValue || (Array.isArray(cloudValue) && !cloudValue.length)) {
        await workspaceStore.setData(key, localValue)
        localStorage.removeItem(key)
      }
    } catch {
      // A corrupt local entry should not block other workspace data.
    }
  }
}
