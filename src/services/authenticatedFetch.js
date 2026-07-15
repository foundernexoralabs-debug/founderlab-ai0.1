import { workspaceStore } from '@/services/workspaceStore'

export async function getAuthenticatedHeaders(headers = {}) {
  const token = await workspaceStore.getActiveAccessToken()
  return token ? { ...headers, Authorization: 'Bearer ' + token } : headers
}

export async function authenticatedFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: await getAuthenticatedHeaders(options.headers),
  })
}
