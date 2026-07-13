import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseFiles, isPreviewable } from '../src/lib/codeFiles.js'
import { getGithubToken, setGithubToken, clearGithubToken } from '../src/services/githubTokenSession.js'
import { persistSession, readPersistedSession } from '../src/lib/persistedSession.js'
import {
  GENERATED_PREVIEW_REFERRER_POLICY,
  GENERATED_PREVIEW_SANDBOX,
  isRestrictivePreviewSandbox,
} from '../src/lib/previewSecurity.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function createStorage(initialValue) {
  let value = initialValue
  let removals = 0
  return {
    getItem: () => value,
    setItem: (_, nextValue) => {
      value = nextValue
    },
    removeItem: () => {
      value = null
      removals += 1
    },
    get removals() {
      return removals
    },
  }
}

test('persisted sessions require a refresh token and clear malformed data', () => {
  const valid = createStorage(JSON.stringify({ refresh_token: 'refresh-token', access_token: 'old-access-token' }))
  assert.deepEqual(readPersistedSession(valid, 'fl_session'), { refresh_token: 'refresh-token', access_token: 'old-access-token' })
  assert.equal(valid.removals, 0)

  const missingRefreshToken = createStorage(JSON.stringify({ access_token: 'old-access-token' }))
  assert.equal(readPersistedSession(missingRefreshToken, 'fl_session'), null)
  assert.equal(missingRefreshToken.removals, 1)

  const malformed = createStorage('{not-json')
  assert.equal(readPersistedSession(malformed, 'fl_session'), null)
  assert.equal(malformed.removals, 1)
})

test('a non-remembered sign-in removes a previously stored session', () => {
  const storage = createStorage(JSON.stringify({ refresh_token: 'prior-user-token' }))
  persistSession(storage, 'fl_session', { refresh_token: 'new-token' }, false)
  assert.equal(storage.getItem('fl_session'), null)
  assert.equal(storage.removals, 1)

  persistSession(storage, 'fl_session', { refresh_token: 'new-token' }, true)
  assert.deepEqual(readPersistedSession(storage, 'fl_session'), { refresh_token: 'new-token' })
})

test('GitHub tokens remain session-memory only', () => {
  clearGithubToken()
  assert.equal(getGithubToken(), '')
  setGithubToken('  ghp_example  ')
  assert.equal(getGithubToken(), 'ghp_example')
  clearGithubToken()
  assert.equal(getGithubToken(), '')

  const appSource = fs.readFileSync(path.join(repositoryRoot, 'src/App.jsx'), 'utf8')
  assert.match(appSource, /await sb\.signOut\(\)\s*\n\s*clearGithubToken\(\)/)
})

test('generated previews use the minimal sandbox policy', () => {
  assert.equal(GENERATED_PREVIEW_SANDBOX, 'allow-scripts')
  assert.equal(GENERATED_PREVIEW_REFERRER_POLICY, 'no-referrer')
  assert.equal(isRestrictivePreviewSandbox(GENERATED_PREVIEW_SANDBOX), true)
  assert.equal(isRestrictivePreviewSandbox('allow-scripts allow-same-origin'), false)
})

test('both generated preview surfaces consume the restrictive sandbox policy', () => {
  const appSource = fs.readFileSync(path.join(repositoryRoot, 'src/App.jsx'), 'utf8')
  const previewBundleSource = fs.readFileSync(path.join(repositoryRoot, 'src/lib/previewBundle.js'), 'utf8')
  assert.equal((appSource.match(/srcDoc=/g) || []).length, 2)
  assert.equal((appSource.match(/sandbox=\{GENERATED_PREVIEW_SANDBOX\}/g) || []).length, 2)
  assert.equal((appSource.match(/referrerPolicy=\{GENERATED_PREVIEW_REFERRER_POLICY\}/g) || []).length, 2)
  assert.equal(previewBundleSource.includes('.innerHTML'), false)
  assert.equal(/\beval\b/.test(previewBundleSource), false)
})

test('file parsing preserves explicit generated filenames', () => {
  const fence = String.fromCharCode(96).repeat(3)
  const source = '// file: src/example.js\n' + fence + 'javascript\nexport const answer = 42\n' + fence
  const files = parseFiles(source)
  assert.deepEqual(files, [{ path: 'src/example.js', content: 'export const answer = 42', lang: 'javascript' }])
  assert.equal(isPreviewable([{ path: 'index.html', content: '<h1>Preview</h1>' }]), true)
})
