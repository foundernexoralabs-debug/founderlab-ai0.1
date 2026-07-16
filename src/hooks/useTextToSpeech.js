import { useEffect, useRef, useState } from 'react'
import { loadBrowserVoices, synthesizeSpeech, stopSpeech } from '@/services/speechService'
import { authenticatedFetch } from '@/services/authenticatedFetch'

export function useTextToSpeech(voiceConfig) {
  const [speaking, setSpeaking] = useState(false)
  const [elevenLabsAvailable, setElevenLabsAvailable] = useState(null)
  const [activeProvider, setActiveProvider] = useState(null)
  const playbackSequenceRef = useRef(0)

  useEffect(() => {
    loadBrowserVoices()
  }, [])

  useEffect(() => {
    authenticatedFetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: true }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        setElevenLabsAvailable(Boolean(response.ok && payload?.available))
      })
      .catch(() => setElevenLabsAvailable(false))
  }, [])

  async function speak(text) {
    // Starting another response should switch cleanly rather than requiring a
    // separate stop click first. `stopSpeech` also resolves any tracked local
    // audio promise, so the previous playback state cannot linger.
    const sequence = ++playbackSequenceRef.current
    stopSpeech()
    setSpeaking(true)
    setActiveProvider(voiceConfig.provider)
    try {
      const providerUsed = await synthesizeSpeech(voiceConfig, text)
      if (providerUsed && playbackSequenceRef.current === sequence) setActiveProvider(providerUsed)
    } finally {
      if (playbackSequenceRef.current === sequence) {
        setSpeaking(false)
        setActiveProvider(null)
      }
    }
  }

  function stop() {
    playbackSequenceRef.current += 1
    stopSpeech()
    setSpeaking(false)
    setActiveProvider(null)
  }

  return { speaking, speak, stop, activeProvider, elAvailable: elevenLabsAvailable }
}
