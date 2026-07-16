import { useEffect, useRef, useState } from 'react'

/** Compact, explicit handoff actions for requests Chat can genuinely continue. */
export function ChatControlActions({ actions = [], onAction }) {
  const [busyAction, setBusyAction] = useState('')
  const [completedActions, setCompletedActions] = useState(() => new Set())
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  if (!actions.length) return null

  async function chooseAction(action) {
    if (busyAction || completedActions.has(action.id)) return
    setBusyAction(action.id)
    try {
      const completed = await onAction?.(action)
      if (completed && mountedRef.current) {
        setCompletedActions((current) => new Set([...current, action.id]))
      }
    } finally {
      if (mountedRef.current) setBusyAction('')
    }
  }

  return (
    <section className="fl-chat-control-actions" aria-label="Continue in FounderLab">
      <span className="fl-chat-control-actions-label">Continue in FounderLab</span>
      <div className="fl-chat-control-actions-list">
        {actions.map((action) => {
          const completed = completedActions.has(action.id)
          const busy = busyAction === action.id
          return (
            <button
              key={action.id}
              type="button"
              className={completed ? 'is-complete' : ''}
              onClick={() => chooseAction(action)}
              disabled={Boolean(busyAction) || completed}
              title={action.detail}
            >
              <span aria-hidden="true">{completed ? '✓' : action.icon}</span>
              <span>{busy ? 'Working…' : completed ? action.completedLabel || 'Ready' : action.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
