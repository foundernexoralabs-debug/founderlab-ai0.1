/**
 * Speech synthesis service.
 * Provider priority: ElevenLabs (via /api/tts proxy) → Browser Web Speech API.
 * API keys never touch the frontend — the proxy reads process.env server-side.
 */
import { VoiceConfig, pickBrowserVoice, cleanForSpeech } from '@/lib/voiceService'
import { authenticatedFetch } from '@/services/authenticatedFetch'

let _browserVoices: SpeechSynthesisVoice[] = []
let activeAudio: HTMLAudioElement | null = null
let activeAudioUrl = ''
let activeAudioFinish: ((completed: boolean) => void) | null = null
let playbackGeneration = 0

function releaseActiveAudio() {
  const finish = activeAudioFinish
  activeAudioFinish = null
  if (activeAudio) {
    activeAudio.onended = null
    activeAudio.onerror = null
    activeAudio.pause()
    activeAudio = null
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl)
    activeAudioUrl = ''
  }
  return finish
}

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

export async function synthesizeSpeech(config: VoiceConfig, text: string): Promise<'elevenlabs' | 'browser' | null> {
  const clean = cleanForSpeech(text)
  if (!clean) return null
  const generation = ++playbackGeneration

  if (config.provider === 'elevenlabs') {
    const ok = await speakElevenLabs(config, clean)
    // An explicit stop or a newer response must not be misclassified as a
    // provider fallback and start browser speech after the user pressed Stop.
    if (generation !== playbackGeneration) return null
    if (ok) return 'elevenlabs'
    // ElevenLabs failed (no key, quota, network) — fall through to browser
  }
  if (generation !== playbackGeneration) return null
  await speakBrowser(config, clean)
  if (generation !== playbackGeneration) return null
  return 'browser'
}

export function stopSpeech(): void {
  playbackGeneration += 1
  releaseActiveAudio()?.(false)
  window.speechSynthesis?.cancel()
}

async function speakElevenLabs(config: VoiceConfig, text: string): Promise<boolean> {
  try {
    const r = await authenticatedFetch('/api/tts', {
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
      releaseActiveAudio()?.(false)
      const audio = new Audio(url)
      activeAudio = audio
      activeAudioUrl = url
      audio.playbackRate = 1 + config.speed / 100  // -50..+150 → 0.5..2.5
      const complete = (ok: boolean) => {
        if (activeAudio === audio) releaseActiveAudio()?.(ok)
      }
      activeAudioFinish = resolve
      audio.onended = () => complete(true)
      audio.onerror = () => complete(false)
      audio.play().catch(() => complete(false))
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
