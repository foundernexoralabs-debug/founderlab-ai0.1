/**
 * Speech synthesis service.
 * Provider priority: ElevenLabs (via /api/tts proxy) → Browser Web Speech API.
 * API keys never touch the frontend — the proxy reads process.env server-side.
 */
import { VoiceConfig, pickBrowserVoice, cleanForSpeech } from '@/lib/voiceService'

let _browserVoices: SpeechSynthesisVoice[] = []

// Load browser voices async — must wait for voiceschanged event
export function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const synth = window.speechSynthesis
    if (!synth) { resolve([]); return }
    const voices = synth.getVoices()
    if (voices.length) { _browserVoices = voices; resolve(voices); return }
    synth.addEventListener('voiceschanged', function handler() {
      const v = synth.getVoices()
      if (v.length) { _browserVoices = v; synth.removeEventListener('voiceschanged', handler); resolve(v) }
    })
  })
}

export async function synthesizeSpeech(config: VoiceConfig, text: string): Promise<void> {
  const clean = cleanForSpeech(text)
  if (!clean) return

  if (config.provider === 'elevenlabs') {
    const ok = await speakElevenLabs(config, clean)
    if (ok) return
    // ElevenLabs failed (no key, quota, network) — fall through to browser
  }
  return speakBrowser(config, clean)
}

export function stopSpeech(): void {
  window.speechSynthesis?.cancel()
}

async function speakElevenLabs(config: VoiceConfig, text: string): Promise<boolean> {
  try {
    const r = await fetch('/api/tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: text.slice(0, 2500), gender: config.gender }),
    })
    const ct = r.headers.get('Content-Type') || ''
    if (!ct.includes('audio')) return false   // got JSON fallback response
    const blob = await r.blob()
    if (!blob.size) return false
    const url = URL.createObjectURL(blob)
    return new Promise(resolve => {
      const audio = new Audio(url)
      audio.playbackRate = 1 + config.speed / 100  // -50..+50 → 0.5..1.5
      audio.onended  = () => { URL.revokeObjectURL(url); resolve(true) }
      audio.onerror  = () => { URL.revokeObjectURL(url); resolve(false) }
      audio.play().catch(() => resolve(false))
    })
  } catch { return false }
}

function speakBrowser(config: VoiceConfig, text: string): Promise<void> {
  return new Promise(resolve => {
    const synth = window.speechSynthesis
    if (!synth) { resolve(); return }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang  = 'en-GB'
    u.rate  = 1 + config.speed / 100
    u.pitch = 1.0
    const voice = pickBrowserVoice(config.gender, _browserVoices)
    if (voice) u.voice = voice
    u.onend   = () => resolve()
    u.onerror = () => resolve()
    synth.speak(u)
  })
}
