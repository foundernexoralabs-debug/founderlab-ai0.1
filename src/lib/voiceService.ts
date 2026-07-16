// Voice configuration types and constants
import { getVoiceProvider } from '@/ai/voiceProviderRegistry'
import { DEFAULT_VOICE_PREFERENCE } from '@/lib/voicePreferencesUtils'
import { cleanTextForSpeech } from '@/lib/speechTextUtils'

export const BROWSER_VOICES = {
  male:   ['Microsoft Ryan Online (Natural) - English (United Kingdom)', 'Microsoft Ryan - English (United Kingdom)', 'Google UK English Male', 'Daniel', 'Arthur', 'Alex'],
  female: ['Microsoft Sonia Online (Natural) - English (United Kingdom)', 'Microsoft Sonia - English (United Kingdom)', 'Google UK English Female', 'Samantha', 'Karen', 'Moira'],
} as const

// Voice identifiers are registry-owned; requests remain proxied server-side.
const ELEVENLABS_PROVIDER = getVoiceProvider('elevenlabs')!
export const ELEVENLABS_VOICES = {
  male:   { name: ELEVENLABS_PROVIDER.voiceLabels.male,   id: ELEVENLABS_PROVIDER.voices.male },
  female: { name: ELEVENLABS_PROVIDER.voiceLabels.female, id: ELEVENLABS_PROVIDER.voices.female },
} as const

export type VoiceProvider = 'browser' | 'elevenlabs'
export type Gender = 'male' | 'female'

export interface VoiceConfig {
  provider: VoiceProvider
  gender:   Gender
  speed:    number   // percentage offset from normal: -50 to +150 → 0.5× to 2.5×
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  ...DEFAULT_VOICE_PREFERENCE,
}

export function pickBrowserVoice(gender: Gender, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const priority = BROWSER_VOICES[gender] as readonly string[]
  const explicit = priority.reduce<SpeechSynthesisVoice | null>(
    (found, name) => found ?? (voices.find((voice) => voice.name === name) ?? null),
    null,
  )
  if (explicit) return explicit

  const genderHints = gender === 'female'
    ? ['sonia', 'samantha', 'ava', 'karen', 'moira', 'zira', 'aria']
    : ['ryan', 'daniel', 'arthur', 'alex', 'aaron', 'david', 'fred']
  const qualityHints = ['natural', 'enhanced', 'neural', 'premium', 'online', 'google', 'siri']
  const english = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('en'))
  const candidates = english.length ? english : voices
  return candidates
    .map((voice) => {
      const name = voice.name.toLowerCase()
      const languageScore = voice.lang?.toLowerCase() === 'en-gb' ? 20 : 8
      const qualityScore = qualityHints.some((hint) => name.includes(hint)) ? 12 : 0
      const genderScore = genderHints.some((hint) => name.includes(hint)) ? 8 : 0
      const remoteQualityScore = voice.localService === false ? 3 : 0
      // Platform defaults are often the most complete locally installed
      // voices. This is only a tie-breaker; explicit natural/neural matches
      // and the selected voice style still take precedence.
      const defaultScore = voice.default ? 2 : 0
      return { voice, score: languageScore + qualityScore + genderScore + remoteQualityScore + defaultScore }
    })
    .sort((left, right) => right.score - left.score)[0]?.voice ?? null
}

export function cleanForSpeech(text: string): string {
  return cleanTextForSpeech(text)
}
