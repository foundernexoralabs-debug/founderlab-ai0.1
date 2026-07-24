// GitHub credentials are intentionally memory-only. The separate safe runtime
// state lets Settings and Chat agree on connection/authorization boundaries
// without persisting a token, account profile, or repository permission claim.
let githubToken = ''
let githubRuntime = Object.freeze({ configured: false, connected: false, authorization: 'not-authorized', health: 'healthy' })
const listeners = new Set()

function notify() {
  listeners.forEach((listener) => {
    try { listener(getGithubConnectorRuntime()) } catch {}
  })
}

function safeRuntime(value = {}) {
  const configured = value.configured === true
  const connected = value.connected === true
  const authorization = value.authorization === 'authorized' ? 'authorized' : 'not-authorized'
  const health = value.health === 'temporarily-unavailable' || value.health === 'unavailable' ? value.health : 'healthy'
  return Object.freeze({ configured, connected, authorization, health })
}

export function getGithubToken() {
  return githubToken
}

export function setGithubToken(token) {
  githubToken = typeof token === 'string' ? token.trim() : ''
  githubRuntime = safeRuntime({ configured: Boolean(githubToken), connected: false, authorization: 'not-authorized' })
  notify()
}

export function clearGithubToken() {
  githubToken = ''
  githubRuntime = safeRuntime()
  notify()
}

/** Record only a verified session capability, never an account identity or token. */
export function setGithubConnectorRuntime(value = {}) {
  githubRuntime = safeRuntime({
    configured: Boolean(githubToken) && value.configured !== false,
    connected: Boolean(githubToken) && value.connected === true,
    authorization: value.authorization,
    health: value.health,
  })
  notify()
}

export function getGithubConnectorRuntime() {
  return Object.freeze({ installed: true, ...githubRuntime })
}

export function subscribeGithubConnectorRuntime(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  listener(getGithubConnectorRuntime())
  return () => listeners.delete(listener)
}
