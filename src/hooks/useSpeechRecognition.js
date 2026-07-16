import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/app/toast'
import { getMicrophoneStream } from '@/lib/microphone'
import {
  appendVoiceTranscript,
  commitInterimTranscript,
  shouldResumeVoiceInput,
  VOICE_INPUT_RESTART_DELAY_MS,
} from './speechRecognitionUtils'

const VOICE_ERROR_MESSAGES = {
  'not-allowed': 'Mic blocked — allow microphone access in browser settings.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice input could not reach the browser speech service.',
  'service-not-allowed': 'Voice input is unavailable in this browser right now.',
}

export function useSpeechRecognition() {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [voiceInputState, setVoiceInputState] = useState('idle')
  const [hasRecognizedSpeech, setHasRecognizedSpeech] = useState(false)
  const recognitionRef = useRef(null)
  const restartTimerRef = useRef(null)
  const desiredRef = useRef(false)
  const sessionRef = useRef(0)
  const confirmedTranscriptRef = useRef('')
  const interimTranscriptRef = useRef('')
  const onUpdateRef = useRef(null)

  const stop = useCallback(() => {
    desiredRef.current = false
    clearTimeout(restartTimerRef.current)
    restartTimerRef.current = null
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
    setVoiceInputState('idle')
  }, [])

  const clearVoiceDraft = useCallback(() => {
    confirmedTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setTranscript('')
    setHasRecognizedSpeech(false)
  }, [])

  const start = useCallback(async (onUpdate, { initialTranscript = '' } = {}) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast('Voice input requires Chrome, Edge, or Safari.', 'error')
      return false
    }
    if (desiredRef.current) return true

    let stream
    try {
      stream = await getMicrophoneStream()
    } catch (error) {
      toast(error.message, 'error')
      return false
    }
    stream.getTracks().forEach((track) => track.stop())

    const session = ++sessionRef.current
    desiredRef.current = true
    onUpdateRef.current = onUpdate
    confirmedTranscriptRef.current = typeof initialTranscript === 'string' ? initialTranscript.trim() : ''
    interimTranscriptRef.current = ''
    setTranscript(confirmedTranscriptRef.current)
    setHasRecognizedSpeech(false)
    setVoiceInputState('resuming')

    const publishTranscript = () => {
      const next = appendVoiceTranscript(confirmedTranscriptRef.current, interimTranscriptRef.current)
      setTranscript(next)
      onUpdateRef.current?.(next)
    }

    const beginRecognition = () => {
      if (!desiredRef.current || session !== sessionRef.current) return
      const recognition = new SpeechRecognition()
      recognitionRef.current = recognition
      recognition.lang = 'en-GB'
      recognition.interimResults = true
      // Chromium can still emit an `end` after a quiet moment. The guarded
      // restart below preserves the same dictation session instead of treating
      // a natural pause as an instruction to discard it.
      recognition.continuous = true
      recognition.maxAlternatives = 1
      let lastError = ''

      recognition.onstart = () => {
        if (!desiredRef.current || session !== sessionRef.current) return
        setListening(true)
        setVoiceInputState('listening')
      }
      recognition.onresult = (event) => {
        if (!desiredRef.current || session !== sessionRef.current) return
        let interim = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const phrase = result?.[0]?.transcript || ''
          if (result.isFinal) {
            confirmedTranscriptRef.current = appendVoiceTranscript(confirmedTranscriptRef.current, phrase)
            interimTranscriptRef.current = ''
            if (phrase.trim()) setHasRecognizedSpeech(true)
          } else {
            interim += phrase
          }
        }
        if (interim) {
          interimTranscriptRef.current = interim
          setHasRecognizedSpeech(true)
        }
        publishTranscript()
      }
      recognition.onerror = (event) => {
        lastError = event.error || ''
        if (lastError === 'no-speech') return
        if (lastError === 'aborted' && !desiredRef.current) return
        if (lastError) {
          desiredRef.current = false
          setListening(false)
          setVoiceInputState('error')
          toast(VOICE_ERROR_MESSAGES[lastError] || 'Voice input stopped unexpectedly. Your draft is still here.', 'error')
        }
      }
      recognition.onend = () => {
        if (session !== sessionRef.current) return
        setListening(false)
        if (!shouldResumeVoiceInput({ desired: desiredRef.current, error: lastError })) {
          // Keep a meaningful failure visible until the user explicitly
          // retries or finishes. A normal stop/abort should simply return to
          // idle, but collapsing a permission or device error immediately
          // makes recovery feel like a silent reset.
          const meaningfulFailure = lastError && !['aborted', 'no-speech'].includes(lastError)
          if (!desiredRef.current && !meaningfulFailure) setVoiceInputState('idle')
          return
        }
        // The browser can end a recognition session after returning an
        // interim-only phrase. Preserve it before reconnecting so a natural
        // pause never erases the end of the user's thought.
        if (interimTranscriptRef.current.trim()) {
          confirmedTranscriptRef.current = commitInterimTranscript(
            confirmedTranscriptRef.current,
            interimTranscriptRef.current,
          )
          interimTranscriptRef.current = ''
          publishTranscript()
        }
        setVoiceInputState('resuming')
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = setTimeout(beginRecognition, VOICE_INPUT_RESTART_DELAY_MS)
      }
      try {
        recognition.start()
      } catch {
        desiredRef.current = false
        setListening(false)
        setVoiceInputState('error')
        toast('Voice input could not start. Your draft is still here.', 'error')
      }
    }

    beginRecognition()
    return true
  }, [])

  useEffect(() => () => {
    desiredRef.current = false
    clearTimeout(restartTimerRef.current)
    recognitionRef.current?.abort()
  }, [])

  return {
    listening,
    transcript,
    setTranscript,
    clearVoiceDraft,
    hasRecognizedSpeech,
    voiceInputState,
    start,
    stop,
  }
}
