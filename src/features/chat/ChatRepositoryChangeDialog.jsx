import { useEffect, useRef, useState } from 'react'

function safeRelativePath(value) {
  const path = typeof value === 'string' ? value.trim() : ''
  return path && !path.startsWith('/') && !path.includes('..') && !path.includes('\\') && !/[\u0000-\u001f]/.test(path) ? path : ''
}

function changeLabel(operation) {
  return operation === 'create' ? 'Create' : operation === 'delete' ? 'Delete' : 'Update'
}

/**
 * Final human-review boundary before the bounded Git Data API mutation.
 * It performs no mutation itself: each update/delete loads the current file
 * revision, and the parent creates one real branch commit only on submission.
 */
export function ChatRepositoryChangeDialog({ change, onLoadFile, onApply, onCancel }) {
  const [operation, setOperation] = useState('update')
  const [path, setPath] = useState(change?.fileTargets?.[0] || '')
  const [file, setFile] = useState(null)
  const [content, setContent] = useState('')
  const [changes, setChanges] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)
  const loadFileRef = useRef(onLoadFile)
  const maxChanges = change?.maxChanges || 4

  useEffect(() => {
    loadFileRef.current = onLoadFile
  }, [onLoadFile])

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    setOperation('update')
    setPath(change?.fileTargets?.[0] || '')
    setFile(null)
    setContent('')
    setChanges([])
    setMessage('FounderLab: apply reviewed changes')
    setError('')
  }, [change?.messageId])

  useEffect(() => {
    if (!change || applying) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [applying, change, onCancel])

  useEffect(() => {
    if (!change || operation === 'create' || !path) return undefined
    let active = true
    setLoading(true)
    setError('')
    setFile(null)
    setContent('')
    Promise.resolve(loadFileRef.current?.(path))
      .then((result) => {
        if (!active || !result) return
        setFile(result)
        setContent(result.content)
      })
      .catch((reason) => {
        if (!active) return
        setError(typeof reason?.message === 'string' ? reason.message : 'FounderLab could not load this file safely.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [change?.messageId, operation, path])

  if (!change) return null
  const selectedPath = safeRelativePath(path)
  const pathAlreadyReviewed = changes.some((item) => item.path === selectedPath)
  const updateChanged = Boolean(file && content.replace(/\r\n/g, '\n') !== file.content.replace(/\r\n/g, '\n'))
  const canAdd = Boolean(
    !loading
    && !applying
    && selectedPath
    && !pathAlreadyReviewed
    && changes.length < maxChanges
    && (operation === 'create' || (file?.sha && (operation === 'delete' || updateChanged))),
  )
  const canApply = Boolean(changes.length && message.trim() && !loading && !applying)

  function chooseOperation(nextOperation) {
    setOperation(nextOperation)
    setError('')
    setFile(null)
    setContent('')
    if (nextOperation === 'create') setPath('')
    else if (!change.fileTargets.includes(path)) setPath(change.fileTargets[0] || '')
  }

  function addReviewedChange() {
    if (!canAdd) return
    const next = operation === 'create'
      ? { operation: 'create', path: selectedPath, content: content.replace(/\r\n/g, '\n') }
      : operation === 'delete'
        ? { operation: 'delete', path: selectedPath, expectedSha: file.sha }
        : { operation: 'update', path: selectedPath, content: content.replace(/\r\n/g, '\n'), expectedSha: file.sha }
    setChanges((current) => [...current, next])
    setError('')
    setFile(null)
    setContent('')
    if (operation === 'create') setPath('')
  }

  async function submit(event) {
    event.preventDefault()
    if (!canApply) return
    setApplying(true)
    setError('')
    try {
      const completed = await onApply?.({ changes, commitMessage: message.trim() })
      if (!completed) setError('FounderLab could not record a completed branch update. Review the execution status before retrying.')
    } catch (reason) {
      setError(typeof reason?.message === 'string' ? reason.message : 'FounderLab could not apply these reviewed changes.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fl-chat-repo-change-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !applying) onCancel?.() }}>
      <section className="fl-chat-repo-change-dialog" role="dialog" aria-modal="true" aria-labelledby="fl-chat-repo-change-title" aria-describedby="fl-chat-repo-change-description">
        <header>
          <span className="fl-chat-repo-change-kicker">Approved GitHub change</span>
          <h2 id="fl-chat-repo-change-title">Review a bounded branch commit</h2>
          <p id="fl-chat-repo-change-description">FounderLab will create one real commit on <b>{change.branch}</b> with up to {maxChanges} reviewed text operations. It never merges or force-pushes.</p>
        </header>
        <form onSubmit={submit}>
          <div className="fl-chat-repo-change-builder">
            <label>
              Change type
              <select value={operation} onChange={(event) => chooseOperation(event.target.value)} disabled={loading || applying || changes.length >= maxChanges}>
                <option value="update">Update inspected file</option>
                <option value="create">Create new text file</option>
                <option value="delete">Delete inspected file</option>
              </select>
            </label>
            {operation === 'create' ? (
              <label>
                New relative path
                <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="src/new-feature.js" maxLength={220} disabled={applying || changes.length >= maxChanges} />
              </label>
            ) : (
              <label>
                Inspected candidate file
                <select value={path} onChange={(event) => setPath(event.target.value)} disabled={loading || applying || changes.length >= maxChanges}>
                  {change.fileTargets.map((target) => <option key={target} value={target}>{target}</option>)}
                </select>
              </label>
            )}
          </div>
          {operation !== 'delete' && (
            <label>
              {operation === 'create' ? 'New file content' : 'Full replacement content'}
              <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck="false" disabled={loading || applying || changes.length >= maxChanges} />
            </label>
          )}
          <div className="fl-chat-repo-change-meta" aria-live="polite">
            {loading
              ? 'Loading the current file and its GitHub revision…'
              : operation === 'create'
                ? 'New paths are checked against the latest approved branch before commit.'
                : file
                  ? `Loaded ${file.path} · ${file.size.toLocaleString()} bytes · revision ${file.sha.slice(0, 12)}`
                  : 'Choose an inspected candidate file to load its current revision.'}
          </div>
          <button type="button" className="fl-chat-repo-change-add" onClick={addReviewedChange} disabled={!canAdd}>
            Add {changeLabel(operation).toLowerCase()} to reviewed commit
          </button>
          <div className="fl-chat-repo-change-list" aria-live="polite">
            <div className="fl-chat-repo-change-list-heading"><b>Reviewed changes</b><span>{changes.length}/{maxChanges}</span></div>
            {changes.length ? changes.map((item) => (
              <div key={item.path} className={`fl-chat-repo-change-item is-${item.operation}`}>
                <span>{changeLabel(item.operation)}</span>
                <code>{item.path}</code>
                <button type="button" onClick={() => setChanges((current) => current.filter((entry) => entry.path !== item.path))} disabled={applying}>Remove</button>
              </div>
            )) : <p>No changes added. Each update or delete must use a loaded GitHub revision.</p>}
          </div>
          <label>
            Commit message
            <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={180} disabled={applying} />
          </label>
          {error && <p className="fl-chat-repo-change-error" role="alert">{error}</p>}
          <footer>
            <button ref={cancelRef} type="button" onClick={() => onCancel?.()} disabled={applying}>Cancel</button>
            <button type="submit" className="is-apply" disabled={!canApply}>{applying ? 'Committing…' : `Commit ${changes.length || ''} reviewed change${changes.length === 1 ? '' : 's'}`}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
