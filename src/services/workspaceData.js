const COLLECTION_KEYS = new Set(['fl_convos', 'fl_notes', 'fl_tasks', 'fl_projects'])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeTimestamp(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

/**
 * FounderLab's persisted feature collections are arrays of records. Older
 * clients could leave malformed values behind, so normalize at the storage
 * boundary instead of making every feature defend against them independently.
 */
export function normalizeWorkspaceValue(key, value, fallback = []) {
  if (!COLLECTION_KEYS.has(key)) {
    return { value: value ?? fallback, repaired: false }
  }

  const safeFallback = Array.isArray(fallback) ? fallback.filter(isRecord) : []
  if (value === null || value === undefined) {
    return { value: safeFallback, repaired: false }
  }
  if (!Array.isArray(value)) {
    return { value: safeFallback, repaired: true }
  }

  const records = value.filter(isRecord)
  return { value: records, repaired: records.length !== value.length }
}

/**
 * Keeps dashboard rendering independent of optional analytics and malformed
 * workspace records. This is deliberately pure so it can be regression tested
 * without a browser or Supabase connection.
 */
export function buildDashboardState({ eventCounts, notes, tasks } = {}) {
  const counts = isRecord(eventCounts) ? Object.fromEntries(
    Object.entries(eventCounts).map(([key, value]) => [
      key,
      Number.isFinite(value) && value > 0 ? value : 0,
    ]),
  ) : {}
  const safeNotes = normalizeWorkspaceValue('fl_notes', notes).value
  const safeTasks = normalizeWorkspaceValue('fl_tasks', tasks).value
  const sortedNotes = [...safeNotes].sort((left, right) => safeTimestamp(right.updated_at) - safeTimestamp(left.updated_at))
  const pending = safeTasks.filter((task) => task.status !== 'done').length
  const note = sortedNotes[0] || null

  return {
    counts,
    banner: note || pending > 0 ? { note, pending } : null,
  }
}
