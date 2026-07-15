import { useEffect, useState } from 'react'
import { loadBrowserVoices, synthesizeSpeech, stopSpeech } from '@/services/speechService'
import { authenticatedFetch } from '@/services/authenticatedFetch'

export function useTextToSpeech(voiceConfig) {
  const [speaking, setSpeaking] = useState(false)
  const [elevenLabsAvailable, setElevenLabsAvailable] = useState(null)

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
    if (speaking) {
      stopSpeech()
      setSpeaking(false)
      return
    }

    setSpeaking(true)
    try {
      await synthesizeSpeech(voiceConfig, text)
    } finally {
      setSpeaking(false)
    }
  }

  function stop() {
    stopSpeech()
    setSpeaking(false)
  }

  return { speaking, speak, stop, elAvailable: elevenLabsAvailable }
}
