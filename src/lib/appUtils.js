import { toast } from '@/app/toast'
import { timestamp, uid } from '@/lib/ids'

export { timestamp as ts, uid }

export function timeg() {
  const hour = new Date().getHours()
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
}

export function flNavigate(page, payload) {
  try {
    if (payload !== undefined) localStorage.setItem('fl_handoff_' + page, JSON.stringify(payload))
  } catch {
    // Navigation still works when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent('fl:navigate', { detail: { page } }))
}

export function flConsumeHandoff(page) {
  try {
    const raw = localStorage.getItem('fl_handoff_' + page)
    if (!raw) return null
    localStorage.removeItem('fl_handoff_' + page)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success')).catch(() => {})
}
