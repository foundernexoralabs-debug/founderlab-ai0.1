import { DEFAULT_VOICE_CONFIG } from '@/lib/voiceService'

const VOICE_STORAGE_KEY = 'fl_voice_config'

export function getVoiceConfig() {
  try {
    return { ...DEFAULT_VOICE_CONFIG, ...JSON.parse(localStorage.getItem(VOICE_STORAGE_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_VOICE_CONFIG }
  }
}

export function persistVoiceConfig(config) {
  try {
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Voice preferences are optional; the in-memory configuration still works.
  }
}
