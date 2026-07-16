import { DEFAULT_VOICE_PREFERENCE, normalizeVoiceConfig } from '@/lib/voicePreferencesUtils'

const VOICE_STORAGE_KEY = 'fl_voice_config'

export { normalizeVoiceConfig }

export function getVoiceConfig() {
  try {
    return normalizeVoiceConfig({ ...DEFAULT_VOICE_PREFERENCE, ...JSON.parse(localStorage.getItem(VOICE_STORAGE_KEY) || '{}') })
  } catch {
    return normalizeVoiceConfig(DEFAULT_VOICE_PREFERENCE)
  }
}

export function persistVoiceConfig(config) {
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(normalizeVoiceConfig(config)))
  } catch {
    // Voice preferences are optional; the in-memory configuration still works.
  }
}
