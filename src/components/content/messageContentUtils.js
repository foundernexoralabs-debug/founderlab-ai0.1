/**
 * Copy text without coupling shared message rendering to a feature-specific
 * toast system. The Clipboard API is preferred; the short fallback keeps the
 * action useful in older secure browser contexts.
 */
export async function copyTextToClipboard(value, {
  clipboard = globalThis.navigator?.clipboard,
  documentRef = globalThis.document,
} = {}) {
  const text = typeof value === 'string' ? value : ''
  if (!text) return false

  try {
    if (typeof clipboard?.writeText === 'function') {
      await clipboard.writeText(text)
      return true
    }
  } catch {
    // A permission failure can still use the deliberate browser fallback.
  }

  if (!documentRef?.createElement || !documentRef?.body?.appendChild || typeof documentRef.execCommand !== 'function') return false
  const area = documentRef.createElement('textarea')
  area.value = text
  area.setAttribute?.('readonly', '')
  Object.assign(area.style || {}, { position: 'fixed', opacity: '0', pointerEvents: 'none' })
  documentRef.body.appendChild(area)
  area.select?.()
  let copied = false
  try {
    copied = documentRef.execCommand('copy') === true
  } catch {
    copied = false
  }
  area.remove?.()
  if (area.parentNode?.removeChild) area.parentNode.removeChild(area)
  return copied
}
