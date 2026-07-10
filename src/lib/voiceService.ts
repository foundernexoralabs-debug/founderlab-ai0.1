// Voice configuration types and constants

export const BROWSER_VOICES = {
  male:   ['Microsoft Ryan Online (Natural) - English (United Kingdom)', 'Microsoft Ryan - English (United Kingdom)', 'Google UK English Male', 'Daniel', 'Arthur'],
  female: ['Microsoft Sonia Online (Natural) - English (United Kingdom)', 'Microsoft Sonia - English (United Kingdom)', 'Google UK English Female', 'Karen', 'Moira'],
} as const

// ElevenLabs voice IDs — proxied server-side via /api/tts (key never exposed)
export const ELEVENLABS_VOICES = {
  male:   { name: 'Brian',          id: 'nPczCjzI2devNBz1zQrb' },
  female: { name: 'Custom Female',  id: 'EST9Ui6982FZPSi7gCHi' },
} as const

export type VoiceProvider = 'browser' | 'elevenlabs'
export type Gender = 'male' | 'female'

export interface VoiceConfig {
  provider: VoiceProvider
  gender:   Gender
  speed:    number   // -50 to +50 → spoken rate 0.5× to 1.5×
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  provider: 'browser',
  gender:   'male',
  speed:    0,
}

export function pickBrowserVoice(gender: Gender, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const priority = BROWSER_VOICES[gender] as readonly string[]
  return priority.reduce<SpeechSynthesisVoice | null>(
    (found, name) => found ?? (voices.find(v => v.name === name) ?? null),
    null
  ) ?? voices.find(v => v.lang === 'en-GB') ?? voices.find(v => v.lang.startsWith('en')) ?? null
}

export function cleanForSpeech(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, 'code block')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .trim()
}
