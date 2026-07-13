export const SUPABASE_CONFIGURATION_ERROR = 'Supabase is not configured correctly for this deployment.'

const PUBLIC_SETUP_SCREEN = Object.freeze({
  title: 'FounderLab is temporarily unavailable',
  message: 'Authentication could not start. Please try again shortly.',
  referenceCode: 'FL-AUTH-INIT',
})

const DEVELOPMENT_SETUP_DIAGNOSTICS = Object.freeze([
  'Supabase browser configuration is unavailable or invalid.',
  'Expected VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the local development environment.',
])

function isCleanString(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || /\s/.test(value)) return false
  return !['undefined', 'null'].includes(value.toLowerCase())
}

function invalidConfig() {
  return { valid: false, url: '', anonKey: '' }
}

/**
 * Public deployment screens must not reveal operational configuration. A
 * diagnostic panel is intentionally limited to local development builds.
 */
export function isSetupDiagnosticsEnabled(env = {}) {
  return env?.DEV === true
    || (env?.MODE === 'development' && env?.VITE_FOUNDERLAB_SETUP_DIAGNOSTICS === 'true')
}

export function getSetupScreenView(env = {}) {
  return {
    ...PUBLIC_SETUP_SCREEN,
    diagnostics: isSetupDiagnosticsEnabled(env) ? DEVELOPMENT_SETUP_DIAGNOSTICS : [],
  }
}

/**
 * Validates the browser-safe Supabase settings before any request URL is built.
 * Supabase project URLs must be the HTTPS project origin, never an /auth/v1 or
 * /rest/v1 endpoint. Keeping this pure makes the Vite environment boundary easy
 * to verify without exposing configuration values.
 */
export function getSupabaseConfig(env = {}) {
  const urlValue = env?.VITE_SUPABASE_URL
  const anonKey = env?.VITE_SUPABASE_ANON_KEY

  if (!isCleanString(urlValue) || !isCleanString(anonKey)) return invalidConfig()
  if (anonKey.startsWith('"') || anonKey.startsWith("'") || anonKey.endsWith('"') || anonKey.endsWith("'")) return invalidConfig()

  try {
    const url = new URL(urlValue)
    const isProjectOrigin = url.protocol === 'https:'
      && !url.username
      && !url.password
      && (url.pathname === '/' || url.pathname === '')
      && !url.search
      && !url.hash

    if (!isProjectOrigin) return invalidConfig()
    return { valid: true, url: url.origin, anonKey }
  } catch {
    return invalidConfig()
  }
}

export function requireSupabaseConfig(config) {
  if (!config?.valid) throw new Error(SUPABASE_CONFIGURATION_ERROR)
  return config
}

export function getSupabaseRequestUrl(config, path) {
  return new URL(path, requireSupabaseConfig(config).url).toString()
}

function isLocalHttpOrigin(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

/**
 * Email links should return to the exact site that initiated the auth action.
 * Preview hosts must still be listed in Supabase Auth's Redirect URLs allowlist.
 */
export function getAuthRedirectUrl(location = globalThis.location) {
  try {
    const url = new URL(location?.origin || '')
    return url.protocol === 'https:' || isLocalHttpOrigin(url) ? url.origin : null
  } catch {
    return null
  }
}

export function withAuthRedirect(body, field = 'redirect_to', location = globalThis.location) {
  const redirectUrl = getAuthRedirectUrl(location)
  return redirectUrl ? { ...body, [field]: redirectUrl } : body
}

export function getSafeAuthErrorMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (/did not match the expected pattern|invalid url|failed to parse url/i.test(message)) {
    return SUPABASE_CONFIGURATION_ERROR
  }
  return message || 'Authentication could not be completed. Please try again.'
}
