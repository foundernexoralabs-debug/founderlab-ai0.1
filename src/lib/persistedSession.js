function clearPersistedSession(storage, key) {
  try {
    storage.removeItem(key)
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function readPersistedSession(storage, key) {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null

    const session = JSON.parse(raw)
    if (session?.refresh_token) return session

    clearPersistedSession(storage, key)
    return null
  } catch {
    clearPersistedSession(storage, key)
    return null
  }
}

export function persistSession(storage, key, session, remember) {
  try {
    if (remember) storage.setItem(key, JSON.stringify(session))
    else storage.removeItem(key)
  } catch {
    // Storage is optional; the in-memory session remains available.
  }
}
