const CHAT_UI_PREFERENCES_KEY = 'fl_chat_ui_preferences'

function readStorage(storage = typeof localStorage === 'undefined' ? null : localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(CHAT_UI_PREFERENCES_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function getChatUIPreferences(storage) {
  const saved = readStorage(storage)
  return { historyOpen: typeof saved.historyOpen === 'boolean' ? saved.historyOpen : true }
}

export function persistChatUIPreferences(preferences, storage = typeof localStorage === 'undefined' ? null : localStorage) {
  const safe = { historyOpen: preferences?.historyOpen !== false }
  try {
    storage?.setItem(CHAT_UI_PREFERENCES_KEY, JSON.stringify(safe))
    return true
  } catch {
    return false
  }
}
