export function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2)
  }
}

export function timestamp() {
  return new Date().toISOString()
}
