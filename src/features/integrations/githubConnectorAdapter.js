/**
 * GitHub connector authentication adapter.
 *
 * The browser session token remains in githubTokenSession only. This adapter
 * returns a deliberately small, safe capability result for the shared
 * connector platform and never forwards GitHub's raw error payload.
 */

const GITHUB_USER_ENDPOINT = 'https://api.github.com/user'

function safeLogin(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(value) ? value : ''
}
function safeRuntime(value = {}) {
  return Object.freeze({
    configured: value.configured === true,
    connected: value.connected === true,
    authorization: value.authorization === 'authorized' ? 'authorized' : 'not-authorized',
    health: value.health === 'temporarily-unavailable' ? 'temporarily-unavailable' : 'healthy',
  })
}

/** Verify a session-only GitHub token and expose no credential or raw upstream detail. */
export async function verifyGithubConnectorSession(token, { fetchImpl = globalThis.fetch } = {}) {
  const credential = typeof token === 'string' ? token.trim() : ''
  if (!credential || typeof fetchImpl !== 'function') {
    return Object.freeze({ ok: false, reason: 'not-configured', runtime: safeRuntime() })
  }
  try {
    const response = await fetchImpl(GITHUB_USER_ENDPOINT, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential}`,
      },
    })
    if (!response?.ok) {
      return Object.freeze({ ok: false, reason: 'not-authorized', runtime: safeRuntime({ configured: true }) })
    }
    const payload = await response.json().catch(() => null)
    const login = safeLogin(payload?.login)
    if (!login) {
      return Object.freeze({ ok: false, reason: 'not-authorized', runtime: safeRuntime({ configured: true }) })
    }
    return Object.freeze({
      ok: true,
      identity: Object.freeze({ login }),
      runtime: safeRuntime({ configured: true, connected: true, authorization: 'authorized' }),
    })
  } catch {
    return Object.freeze({
      ok: false,
      reason: 'temporarily-unavailable',
      runtime: safeRuntime({ configured: true, health: 'temporarily-unavailable' }),
    })
  }
}
