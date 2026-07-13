// GitHub personal access tokens are intentionally memory-only. A future OAuth
// integration can replace this boundary without changing feature components.
let githubToken = ''

export function getGithubToken() {
  return githubToken
}

export function setGithubToken(token) {
  githubToken = token.trim()
}

export function clearGithubToken() {
  githubToken = ''
}
