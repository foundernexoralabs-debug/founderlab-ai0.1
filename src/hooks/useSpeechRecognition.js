import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/app/toast'
import { getMicrophoneStream } from '@/lib/microphone'
import {
  appendVoiceTranscript,
  applyFinalSpeechPhrase,
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
  const recognitionRef = useRef(null)
  const restartTimerRef = useRef(null)
  const desiredRef = useRef(false)
  const sessionRef = useRef(0)
  const confirmedTranscriptRef = useRef('')
  const interimTranscriptRef = useRef('')
  const finalizedSegmentsRef = useRef([])
  const protectedSegmentCountRef = useRef(0)
  const onUpdateRef = useRef(null)
  const lastPublishedTranscriptRef = useRef('')
  const microphonePermissionReadyRef = useRef(false)
  const microphonePreparationRef = useRef(null)

  const prepare = useCallback(async ({ quiet = false } = {}) => {
    if (microphonePermissionReadyRef.current) return true
    if (microphonePreparationRef.current) return microphonePreparationRef.current
    const preparation = getMicrophoneStream()
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop())
        microphonePermissionReadyRef.current = true
        return true
      })
      .catch((error) => {
        if (!quiet) toast(error.message, 'error')
        return false
      })
      .finally(() => { microphonePreparationRef.current = null })
    microphonePreparationRef.current = preparation
    return preparation
  }, [])

  const stop = useCallback(() => {
    // Invalidate both an active recognition instance and a microphone
    // permission request that has not resolved yet (for example, after a
    // short press-and-hold is released quickly).
    sessionRef.current += 1
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
    finalizedSegmentsRef.current = []
    protectedSegmentCountRef.current = 0
    lastPublishedTranscriptRef.current = ''
    setTranscript('')
  }, [])

  const start = useCallback(async (onUpdate, { initialTranscript = '' } = {}) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast('Voice input requires Chrome, Edge, or Safari.', 'error')
      return false
    }
    if (desiredRef.current) return true

    const session = ++sessionRef.current
    if (!microphonePermissionReadyRef.current) {
      // Surface an immediate state change while the browser performs its
      // unavoidable permission/device handshake. This removes the dead-feel
      // between a tap and the first listening callback without pretending the
      // microphone is active before the browser confirms it.
      setVoiceInputState('starting')
      const prepared = await prepare()
      if (!prepared) return false
      // The first preflight captures the browser permission. Later turns can
      // start recognition immediately instead of waiting on another
      // getUserMedia round-trip before the listening state appears.
      microphonePermissionReadyRef.current = true
    }
    if (session !== sessionRef.current) return false

    desiredRef.current = true
    onUpdateRef.current = onUpdate
    confirmedTranscriptRef.current = typeof initialTranscript === 'string' ? initialTranscript.trim() : ''
    interimTranscriptRef.current = ''
    finalizedSegmentsRef.current = confirmedTranscriptRef.current ? [confirmedTranscriptRef.current] : []
    protectedSegmentCountRef.current = finalizedSegmentsRef.current.length
    lastPublishedTranscriptRef.current = confirmedTranscriptRef.current
    setTranscript(confirmedTranscriptRef.current)
    setVoiceInputState('resuming')

    const publishTranscript = ({ isFinal = false } = {}) => {
      const next = appendVoiceTranscript(confirmedTranscriptRef.current, interimTranscriptRef.current)
      // Some browser engines repeat an unchanged interim result. Publishing
      // each duplicate makes a live composer appear to stutter even though no
      // speech changed, so only update the UI when the audible draft moved.
      if (next !== lastPublishedTranscriptRef.current) {
        lastPublishedTranscriptRef.current = next
        setTranscript(next)
        onUpdateRef.current?.(next, { isFinal })
        return
      }
      // A browser can finalise text it already emitted as interim. Live Call
      // needs that final boundary for end-of-turn timing even when no visible
      // transcript characters changed.
      if (isFinal) onUpdateRef.current?.(next, { isFinal: true })
    }

    const finalizeSpokenPhrase = (phrase) => {
      finalizedSegmentsRef.current = applyFinalSpeechPhrase(
        finalizedSegmentsRef.current,
        phrase,
        protectedSegmentCountRef.current,
      )
      confirmedTranscriptRef.current = finalizedSegmentsRef.current.join(' ')
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
        let receivedFinal = false
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const phrase = result?.[0]?.transcript || ''
          if (result.isFinal) {
            finalizeSpokenPhrase(phrase)
            interimTranscriptRef.current = ''
            receivedFinal = true
          } else {
            interim += phrase
          }
        }
        if (interim) {
          interimTranscriptRef.current = interim
        }
        publishTranscript({ isFinal: receivedFinal })
      }
      recognition.onerror = (event) => {
        lastError = event.error || ''
        if (lastError === 'no-speech') return
        if (lastError === 'aborted' && !desiredRef.current) return
        if (lastError) {
          if (['not-allowed', 'audio-capture', 'service-not-allowed'].includes(lastError)) {
            microphonePermissionReadyRef.current = false
          }
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
          finalizeSpokenPhrase(
            interimTranscriptRef.current,
          )
          interimTranscriptRef.current = ''
          publishTranscript({ isFinal: true })
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
  }, [prepare])

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
    prepare,
    voiceInputState,
    start,
    stop,
  }
}
