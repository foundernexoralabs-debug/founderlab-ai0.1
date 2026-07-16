import { useEffect, useRef } from 'react'
import { getChatDestructiveActionCopy } from './chatUtils'

/**
 * A small, feature-scoped confirmation surface for real destructive Chat
 * actions. Browser confirm dialogs interrupt the product flow and vary by
 * platform, so keep the decision in the calm, accessible Chat UI instead.
 */
export function ChatConfirmDialog({ action, onCancel, onConfirm }) {
  const cancelRef = useRef(null)
  const dialogRef = useRef(null)
  const copy = getChatDestructiveActionCopy(action?.type)

  useEffect(() => {
    if (!copy) return undefined
    cancelRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...(dialogRef.current?.querySelectorAll('button:not([disabled])') || [])]
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [copy, onCancel])

  if (!copy) return null

  return (
    <div
      className="fl-chat-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}>
      <section ref={dialogRef} className="fl-chat-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="fl-chat-confirm-title" aria-describedby="fl-chat-confirm-description">
        <div className="fl-chat-confirm-icon" aria-hidden="true">!</div>
        <div>
          <h2 id="fl-chat-confirm-title">{copy.title}</h2>
          <p id="fl-chat-confirm-description">{copy.description}</p>
        </div>
        <div className="fl-chat-confirm-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Keep it</button>
          <button type="button" className="is-destructive" onClick={onConfirm}>{copy.confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
