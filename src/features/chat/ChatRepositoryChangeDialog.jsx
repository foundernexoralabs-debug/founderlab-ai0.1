import { useEffect, useRef, useState } from 'react'

/**
 * Final human-review boundary before the narrow GitHub mutation executor.
 * It edits no state by itself: the parent loads the current file, verifies
 * its SHA, and performs the explicit one-file commit only on confirmation.
 */
export function ChatRepositoryChangeDialog({ change, onLoadFile, onApply, onCancel }) {
  const [path, setPath] = useState(change?.fileTargets?.[0] || '')
  const [file, setFile] = useState(null)
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef(null)
  const loadFileRef = useRef(onLoadFile)

  useEffect(() => {
    loadFileRef.current = onLoadFile
  }, [onLoadFile])

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    setPath(change?.fileTargets?.[0] || '')
    setFile(null)
    setContent('')
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
    if (!change || !path) return undefined
    let active = true
    setLoading(true)
    setError('')
    setFile(null)
    setContent('')
    setMessage(`FounderLab: update ${path}`)
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
  }, [change?.messageId, path])

  if (!change) return null
  const hasChange = Boolean(file && content.replace(/\r\n/g, '\n') !== file.content.replace(/\r\n/g, '\n'))
  const canApply = Boolean(file?.sha && hasChange && message.trim() && !loading && !applying)

  async function submit(event) {
    event.preventDefault()
    if (!canApply) return
    setApplying(true)
    setError('')
    try {
      const completed = await onApply?.({ path, content, expectedSha: file.sha, commitMessage: message.trim() })
      if (!completed) setError('FounderLab could not record a completed file change. Review the execution status before retrying.')
    } catch (reason) {
      setError(typeof reason?.message === 'string' ? reason.message : 'FounderLab could not apply this reviewed file change.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fl-chat-repo-change-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !applying) onCancel?.() }}>
      <section className="fl-chat-repo-change-dialog" role="dialog" aria-modal="true" aria-labelledby="fl-chat-repo-change-title" aria-describedby="fl-chat-repo-change-description">
        <header>
          <span className="fl-chat-repo-change-kicker">Approved GitHub change</span>
          <h2 id="fl-chat-repo-change-title">Review one file before committing</h2>
          <p id="fl-chat-repo-change-description">FounderLab will update only one inspected candidate file on <b>{change.branch}</b>. This creates a real GitHub commit; it never merges.</p>
        </header>
        <form onSubmit={submit}>
          <label>
            Candidate file
            <select value={path} onChange={(event) => setPath(event.target.value)} disabled={loading || applying}>
              {change.fileTargets.map((target) => <option key={target} value={target}>{target}</option>)}
            </select>
          </label>
          <label>
            Commit message
            <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={180} disabled={loading || applying} />
          </label>
          <label>
            Full replacement content
            <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck="false" disabled={loading || applying} />
          </label>
          <div className="fl-chat-repo-change-meta" aria-live="polite">
            {loading ? 'Loading the current file and its GitHub revision…' : file ? `Loaded ${file.path} · ${file.size.toLocaleString()} bytes · revision ${file.sha.slice(0, 12)}` : 'Choose an inspected candidate file to load its current content.'}
          </div>
          {error && <p className="fl-chat-repo-change-error" role="alert">{error}</p>}
          <footer>
            <button ref={cancelRef} type="button" onClick={() => onCancel?.()} disabled={applying}>Cancel</button>
            <button type="submit" className="is-apply" disabled={!canApply}>{applying ? 'Committing…' : 'Apply reviewed change'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
