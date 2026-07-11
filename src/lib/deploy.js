// Shared export/deploy helpers — used by both Code AI and Builder so the
// GitHub push / ZIP download / Vercel deploy logic lives in exactly one place.
import { zipSupported, createZip, downloadBlob } from './zip'

// files: [{ path, content }]
export async function downloadProjectZip(files, name) {
  if (!files?.length) throw new Error('Nothing to download yet')
  if (!zipSupported) {
    files.forEach(f => downloadBlob(new Blob([f.content], { type:'text/plain' }), f.path.split('/').pop()))
    return { fallback: true }
  }
  const blob = await createZip(files)
  downloadBlob(blob, `${(name || 'founderlab-project').replace(/[^\w.-]/g,'-')}.zip`)
  return { fallback: false }
}

// Push files to a (new or existing) GitHub repo owned by the token holder.
// token: the user's own GitHub personal access token (repo scope), stored client-side only.
export async function pushToGithub({ files, repoName, token }) {
  if (!files?.length) throw new Error('Nothing to push yet')
  if (!token || !repoName?.trim()) throw new Error('Repo name and GitHub token are required')

  const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${token}` } })
  if (!userRes.ok) throw new Error('Invalid GitHub token — check it has "repo" scope')
  const ghUser = await userRes.json()

  const createRes = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: repoName.trim(), private: false, auto_init: true }),
  })
  if (!createRes.ok && createRes.status !== 422) throw new Error('Could not create repository')
  const repoFullName = `${ghUser.login}/${repoName.trim()}`

  for (const f of files) {
    const content = typeof f.content === 'string' ? f.content : new TextDecoder().decode(f.content)
    const b64 = btoa(unescape(encodeURIComponent(content)))
    await fetch(`https://api.github.com/repos/${repoFullName}/contents/${f.path}`, {
      method: 'PUT',
      headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Add ${f.path} via FounderLab AI`, content: b64 }),
    })
  }
  return { repoUrl: `https://github.com/${repoFullName}`, repoFullName }
}

// Vercel's documented zero-auth "clone & import" deep link — no backend, no secrets needed.
export function vercelDeployUrl(repoUrl) {
  return `https://vercel.com/new/clone?repository-url=${encodeURIComponent(repoUrl)}`
}

export function openVercelDeploy(repoUrl) {
  if (!repoUrl) throw new Error('Push to GitHub first, then deploy')
  window.open(vercelDeployUrl(repoUrl), '_blank', 'noopener,noreferrer')
}
