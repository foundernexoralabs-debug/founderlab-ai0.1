/**
 * Speech synthesis service.
 * Provider priority: ElevenLabs (via /api/tts proxy) → Browser Web Speech API.
 * API keys never touch the frontend — the proxy reads process.env server-side.
 */
import { VoiceConfig, pickBrowserVoice, cleanForSpeech } from '@/lib/voiceService'
import { splitSpeechForPlayback } from '@/lib/speechTextUtils'
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
    const result = await speakElevenLabs(config, clean, generation)
    // An explicit stop or a newer response must not be misclassified as a
    // provider fallback and start browser speech after the user pressed Stop.
    if (generation !== playbackGeneration) return null
    if (result === 'complete' || result === 'partial') return 'elevenlabs'
    // ElevenLabs failed (no key, quota, network) — fall through to browser
  }
  if (generation !== playbackGeneration) return null
  await speakBrowser(config, clean, generation)
  if (generation !== playbackGeneration) return null
  return 'browser'
}

export function stopSpeech(): void {
  playbackGeneration += 1
  releaseActiveAudio()?.(false)
  window.speechSynthesis?.cancel()
}

type PlaybackResult = 'complete' | 'partial' | 'unavailable' | 'stopped'

async function speakElevenLabs(config: VoiceConfig, text: string, generation: number): Promise<PlaybackResult> {
  const chunks = splitSpeechForPlayback(text)
  let playedChunk = false
  for (const chunk of chunks) {
    if (generation !== playbackGeneration) return 'stopped'
    const result = await speakElevenLabsChunk(config, chunk, generation)
    if (result === 'complete') {
      playedChunk = true
      continue
    }
    if (result === 'stopped') return 'stopped'
    // Avoid replaying an already heard opening with a browser fallback when a
    // later enhanced-voice chunk has a transient failure.
    return playedChunk ? 'partial' : 'unavailable'
  }
  return playedChunk ? 'complete' : 'unavailable'
}

async function speakElevenLabsChunk(config: VoiceConfig, text: string, generation: number): Promise<'complete' | 'unavailable' | 'stopped'> {
  try {
    const r = await authenticatedFetch('/api/tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, gender: config.gender }),
    })
    if (generation !== playbackGeneration) return 'stopped'
    const ct = r.headers.get('Content-Type') || ''
    if (!ct.includes('audio')) return 'unavailable' // got JSON fallback response
    const blob = await r.blob()
    if (!blob.size) return 'unavailable'
    const url = URL.createObjectURL(blob)
    return new Promise<'complete' | 'unavailable' | 'stopped'>(resolve => {
      releaseActiveAudio()?.(false)
      const audio = new Audio(url)
      activeAudio = audio
      activeAudioUrl = url
      audio.playbackRate = 1 + config.speed / 100  // -50..+150 → 0.5..2.5
      const complete = (ok: boolean) => {
        if (activeAudio === audio) releaseActiveAudio()?.(ok)
      }
      activeAudioFinish = (completed) => resolve(completed ? 'complete' : generation !== playbackGeneration ? 'stopped' : 'unavailable')
      audio.onended = () => complete(true)
      audio.onerror = () => complete(false)
      audio.play().catch(() => complete(false))
    })
  } catch { return generation !== playbackGeneration ? 'stopped' : 'unavailable' }
}

async function speakBrowser(config: VoiceConfig, text: string, generation: number): Promise<void> {
  const chunks = splitSpeechForPlayback(text)
  for (const chunk of chunks) {
    if (generation !== playbackGeneration) return
    await speakBrowserChunk(config, chunk)
  }
}

function speakBrowserChunk(config: VoiceConfig, text: string): Promise<void> {
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
