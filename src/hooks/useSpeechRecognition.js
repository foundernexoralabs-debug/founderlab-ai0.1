import { useCallback, useRef, useState } from 'react'
import { toast } from '@/app/toast'
import { getMicrophoneStream } from '@/lib/microphone'

export function useSpeechRecognition() {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef(null)

  const start = useCallback(async (onFinal) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast('Voice input requires Chrome, Edge, or Safari.', 'error')
      return
    }

    let stream
    try {
      stream = await getMicrophoneStream()
    } catch (error) {
      toast(error.message, 'error')
      return
    }

    stream.getTracks().forEach((track) => track.stop())
    await new Promise((resolve) => setTimeout(resolve, 150))

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-GB'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => setListening(true)
    recognition.onresult = (event) => {
      const nextTranscript = Array.from(event.results).map((result) => result[0].transcript).join('')
      setTranscript(nextTranscript)
      if (event.results[event.results.length - 1].isFinal) onFinal?.(nextTranscript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = (event) => {
      setListening(false)
      const silentErrors = new Set(['no-speech', 'aborted'])
      if (silentErrors.has(event.error)) return
      const messages = {
        'not-allowed': 'Mic blocked — allow microphone access in browser settings.',
        'audio-capture': 'No microphone found.',
        network: 'Network error during speech recognition.',
      }
      toast(messages[event.error] || 'Speech error: ' + event.error, 'error')
    }
    recognition.start()
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  return { listening, transcript, setTranscript, start, stop }
}
