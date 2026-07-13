import { useEffect, useState } from 'react'
import { uid } from '@/lib/ids'
import { C } from '@/app/theme'

let notify = null

export function toast(message, type = 'info') {
  notify?.(message, type)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    notify = (message, type) => {
      const id = uid()
      setToasts((current) => [...current, { id, message, type }])
      setTimeout(() => setToasts((current) => current.filter((toastItem) => toastItem.id !== id)), 3200)
    }

    return () => {
      notify = null
    }
  }, [])

  if (!toasts.length) return null

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map((toastItem) => (
        <div
          key={toastItem.id}
          style={{
            background: toastItem.type === 'error' ? '#1a0a0a' : toastItem.type === 'success' ? '#0a1a12' : C.surfHigh,
            color: C.t1,
            border: '1px solid ' + (toastItem.type === 'error' ? C.red : toastItem.type === 'success' ? C.green : C.border),
            borderRadius: 10,
            padding: '10px 16px',
            fontSize: 14,
            boxShadow: '0 8px 32px #0009',
            maxWidth: 340,
            animation: 'flSlide .2s ease',
            lineHeight: 1.4,
          }}
        >
          {toastItem.message}
        </div>
      ))}
    </div>
  )
}
