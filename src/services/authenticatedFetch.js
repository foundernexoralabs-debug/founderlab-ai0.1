import { workspaceStore } from '@/services/workspaceStore'

export function getAuthenticatedHeaders(headers = {}) {
  const token = workspaceStore.session?.access_token
  return token ? { ...headers, Authorization: 'Bearer ' + token } : headers
}

export function authenticatedFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: getAuthenticatedHeaders(options.headers),
  })
}
