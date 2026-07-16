export const DEFAULT_VOICE_PREFERENCE = {
  provider: 'browser',
  gender: 'male',
  speed: 0,
}

export function normalizeVoiceConfig(config) {
  const candidate = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  return {
    provider: candidate.provider === 'elevenlabs' ? 'elevenlabs' : DEFAULT_VOICE_PREFERENCE.provider,
    gender: candidate.gender === 'female' ? 'female' : DEFAULT_VOICE_PREFERENCE.gender,
    speed: Number.isFinite(Number(candidate.speed))
      ? Math.max(-50, Math.min(50, Math.round(Number(candidate.speed))))
      : DEFAULT_VOICE_PREFERENCE.speed,
  }
}
