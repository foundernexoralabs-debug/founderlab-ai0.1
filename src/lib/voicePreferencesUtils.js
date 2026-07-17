export const DEFAULT_VOICE_PREFERENCE = {
  // New Chat voice sessions prefer the configured premium voice. If
  // ElevenLabs is unavailable, useTextToSpeech deliberately selects the
  // browser path without pretending an enhanced voice is active.
  provider: 'elevenlabs',
  gender: 'female',
  speed: 0,
}

// Values are stored as percentage offsets from normal speed so the previous
// `0` / `50` preferences remain compatible. The UI presents these as the
// clearer playback rates users expect (0.5× through 2.5×).
export const VOICE_SPEED_OPTIONS = Object.freeze([
  { value: -50, label: '0.5×' },
  { value: 0, label: '1×' },
  { value: 50, label: '1.5×' },
  { value: 100, label: '2×' },
  { value: 150, label: '2.5×' },
])

export function getVoiceSpeedLabel(speed) {
  return VOICE_SPEED_OPTIONS.find((option) => option.value === speed)?.label || '1×'
}

function nearestVoiceSpeed(value) {
  return VOICE_SPEED_OPTIONS.reduce((nearest, option) => (
    Math.abs(option.value - value) < Math.abs(nearest - value) ? option.value : nearest
  ), DEFAULT_VOICE_PREFERENCE.speed)
}

export function normalizeVoiceConfig(config) {
  const candidate = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  return {
    provider: ['browser', 'elevenlabs'].includes(candidate.provider) ? candidate.provider : DEFAULT_VOICE_PREFERENCE.provider,
    gender: ['female', 'male'].includes(candidate.gender) ? candidate.gender : DEFAULT_VOICE_PREFERENCE.gender,
    speed: Number.isFinite(Number(candidate.speed))
      ? nearestVoiceSpeed(Number(candidate.speed))
      : DEFAULT_VOICE_PREFERENCE.speed,
  }
}
