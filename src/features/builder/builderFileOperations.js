import { BUILDER_ENTRY_FILE, inferFileLanguage, normalizeBuilderFile } from './builderProjectSchema.js'
import { normalizeBuilderPath } from './builderValidation.js'

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function operationError(code, message) {
  return { ok: false, code, message }
}

function rewriteLocalReferences(content, fromPath, toPath) {
  const escaped = escapeRegExp(fromPath)
  return String(content || '')
    .replace(new RegExp(`(\\b(?:href|src)\\s*=\\s*['"])${escaped}(['"])`, 'g'), `$1${toPath}$2`)
    .replace(new RegExp(`(\\burl\\(\\s*['"]?)${escaped}(['"]?\\s*\\))`, 'g'), `$1${toPath}$2`)
}

export function buildBuilderFileTree(files) {
  const root = { type: 'folder', path: '', name: '', children: [] }
  const folders = new Map([['', root]])
  for (const file of [...(files || [])].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = String(file?.path || '').split('/').filter(Boolean)
    if (!segments.length) continue
    let parent = root
    let currentPath = ''
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      if (!folders.has(currentPath)) {
        const folder = { type: 'folder', path: currentPath, name: segment, children: [] }
        folders.set(currentPath, folder)
        parent.children.push(folder)
      }
      parent = folders.get(currentPath)
    }
    parent.children.push({ type: 'file', path: file.path, name: segments.at(-1), file })
  }
  const sortChildren = (node) => {
    node.children.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    node.children.filter((child) => child.type === 'folder').forEach(sortChildren)
  }
  sortChildren(root)
  return root
}

export function createBuilderFile(path, { now = new Date().toISOString() } = {}) {
  const normalizedPath = normalizeBuilderPath(path)
  if (!normalizedPath || !/^(?:pages\/.+\.html|assets\/.+\.(?:json|svg))$/i.test(normalizedPath)) {
    return operationError('FILE_PATH_INVALID', 'Use pages/name.html or assets/name.json (or .svg).')
  }
  const content = normalizedPath.endsWith('.html') ? '<main>New page</main>' : normalizedPath.endsWith('.svg')
    ? '<svg viewBox="0 0 24 24"></svg>'
    : '{}'
  return {
    ok: true,
    file: normalizeBuilderFile({
      path: normalizedPath,
      content,
      role: 'source',
      language: inferFileLanguage(normalizedPath),
      state: 'edited',
      createdAt: now,
      updatedAt: now,
    }, { now }),
  }
}

export function renameBuilderFile(files, fromPath, toPath, { now = new Date().toISOString() } = {}) {
  const source = normalizeBuilderPath(fromPath)
  const destination = normalizeBuilderPath(toPath)
  if (!source || !destination) return operationError('FILE_PATH_INVALID', 'Choose a supported project file path.')
  if (source === BUILDER_ENTRY_FILE) return operationError('ENTRY_FILE_RENAME_BLOCKED', 'index.html is required and cannot be renamed.')
  if (source === destination) return operationError('FILE_RENAME_NO_CHANGE', 'Choose a different file path.')
  const existing = (files || []).find((file) => file.path === source)
  if (!existing) return operationError('FILE_NOT_FOUND', 'The file is no longer available.')
  if ((files || []).some((file) => file.path === destination)) return operationError('FILE_PATH_CONFLICT', 'Another file already uses that path.')

  const updatedFiles = (files || []).map((file) => {
    const content = rewriteLocalReferences(file.content, source, destination)
    if (file.path !== source) return content === file.content ? file : { ...file, content, updatedAt: now }
    return normalizeBuilderFile({
      ...file,
      path: destination,
      content,
      language: inferFileLanguage(destination),
      state: 'edited',
      updatedAt: now,
    }, { now })
  })
  return { ok: true, files: updatedFiles, changedPaths: [source, destination] }
}
