import React from 'react'

function getDiagnosticArea(componentStack = '') {
  if (/Dashboard/.test(componentStack)) return 'dashboard'
  if (/Onboarding/.test(componentStack)) return 'onboarding'
  if (/Auth/.test(componentStack)) return 'authentication'
  return 'application workspace'
}

function getSafeDiagnosticMessage(error) {
  if (error?.name === 'ReferenceError') return 'A workspace component could not be loaded.'
  if (error?.name === 'TypeError') return 'A workspace value was unavailable or invalid.'
  return 'An unexpected workspace error occurred.'
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, reference: '', area: 'application workspace', message: 'An unexpected workspace error occurred.' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    const reference = 'FL-APP-' + Date.now().toString(36).toUpperCase()
    const area = getDiagnosticArea(info?.componentStack)
    const message = getSafeDiagnosticMessage(error)
    this.setState({ reference, area, message })
    if (import.meta.env.DEV) {
      console.error('[founderlab:app-error]', { reference, area, error })
    } else if (import.meta.env.VERCEL_ENV === 'preview') {
      console.error('[founderlab:app-error]', { reference, area, message })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#09090f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 32, maxWidth: 480, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ color: '#eeeef8', margin: '0 0 8px', fontSize: 18 }}>Something went wrong</h2>
            <p style={{ color: '#8888b0', fontSize: 13, margin: '0 0 20px' }}>Reload FounderLab to continue. Saved workspace data will be restored when available.</p>
            <button onClick={() => window.location.reload()} style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Reload App</button>
            {(import.meta.env.DEV || import.meta.env.VERCEL_ENV === 'preview') && (
              <details style={{ marginTop: 18, color: '#8888b0', fontSize: 12, textAlign: 'left' }}>
                <summary style={{ cursor: 'pointer' }}>Diagnostic reference: {this.state.reference || 'FL-APP-INIT'}</summary>
                <p style={{ margin: '10px 0 0', lineHeight: 1.5 }}>Area: {this.state.area}</p>
                <p style={{ margin: '4px 0 0', lineHeight: 1.5 }}>Message: {this.state.message}</p>
                {import.meta.env.DEV && this.state.error?.stack && <pre style={{ margin: '10px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#aaaacc' }}>{this.state.error.stack}</pre>}
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
