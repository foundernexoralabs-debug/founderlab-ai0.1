import { useCallback, useEffect, useRef, useState } from 'react'

export const CONVERSATION_BOTTOM_THRESHOLD = 96

export function distanceToConversationBottom({ scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  return Math.max(0, scrollHeight - clientHeight - scrollTop)
}

export function isNearConversationBottom(metrics, threshold = CONVERSATION_BOTTOM_THRESHOLD) {
  return distanceToConversationBottom(metrics) <= threshold
}

/**
 * Keep following a conversation only while the reader is already near the
 * latest message. Switching chats still starts at the newest message, while a
 * reader inspecting earlier context receives a calm, explicit way back down.
 */
export function useConversationScroll({ conversationId, messageCount, sending }) {
  const scrollRef = useRef(null)
  const nearBottomRef = useRef(true)
  const previousConversationRef = useRef(conversationId)
  const previousSendingRef = useRef(sending)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

  const updateReadingPosition = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom = isNearConversationBottom(element)
    nearBottomRef.current = nearBottom
    setShowJumpToLatest(!nearBottom)
  }, [])

  const scrollToLatest = useCallback(({ behavior = 'smooth' } = {}) => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
    nearBottomRef.current = true
    setShowJumpToLatest(false)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    updateReadingPosition()
    element.addEventListener('scroll', updateReadingPosition, { passive: true })
    return () => element.removeEventListener('scroll', updateReadingPosition)
  }, [conversationId, updateReadingPosition])

  useEffect(() => {
    const changedConversation = previousConversationRef.current !== conversationId
    const startedSending = sending && !previousSendingRef.current
    previousConversationRef.current = conversationId
    previousSendingRef.current = sending
    // A reader keeps their place while passive content arrives, but choosing
    // to send a message is an explicit intent to return to the live edge.
    if (!conversationId || (!changedConversation && !startedSending && !nearBottomRef.current)) return
    const frame = requestAnimationFrame(() => scrollToLatest({ behavior: changedConversation ? 'auto' : sending ? 'smooth' : 'auto' }))
    return () => cancelAnimationFrame(frame)
  }, [conversationId, messageCount, sending, scrollToLatest])

  return { scrollRef, showJumpToLatest, scrollToLatest }
}
