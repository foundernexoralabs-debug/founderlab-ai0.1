import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV) {
      console.error('[founderlab:app-error]', { name: error?.name, message: error?.message })
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
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
