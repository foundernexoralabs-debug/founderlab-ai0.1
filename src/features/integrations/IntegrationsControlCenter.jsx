import { useMemo, useState } from 'react'
import { getConnectorBlockCopy, getConnectorReadinessLabel, getIntegrationSettingsConnectors } from './connectorPlatform.js'

function connectorTone(readiness, theme) {
  if (['available', 'writable'].includes(readiness)) return { accent: theme.green, surface: 'rgba(34,197,94,.10)' }
  if (readiness === 'temporarily-unavailable') return { accent: theme.yellow, surface: 'rgba(250,204,21,.10)' }
  if (['not-authorized', 'read-only'].includes(readiness)) return { accent: theme.red, surface: 'rgba(248,113,113,.10)' }
  return { accent: theme.accent, surface: theme.accentM }
}

function subtleButton(theme) {
  return {
    border: `1px solid ${theme.border}`,
    borderRadius: 9,
    background: 'transparent',
    color: theme.t2,
    cursor: 'pointer',
    font: '650 11px inherit',
    padding: '8px 10px',
  }
}

function ConnectorBadge({ connector, theme }) {
  const tone = connectorTone(connector.readiness, theme)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${tone.accent}44`, borderRadius: 999, background: tone.surface, color: tone.accent, padding: '4px 8px', fontSize: 10, fontWeight: 750, letterSpacing: '.035em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true">●</span>
      {getConnectorReadinessLabel(connector.readiness)}
    </span>
  )
}

function CapabilityChips({ connector, theme }) {
  const chips = [
    connector.installation === 'installed' ? 'Installed' : 'Available',
    connector.configuration === 'configured' ? 'Configured' : connector.configuration === 'not-configured' ? 'Setup needed' : '',
    connector.authorization === 'authorized' ? 'Authorized' : connector.authorization === 'not-authorized' ? 'Authorization needed' : '',
    connector.access === 'writable' ? 'Writable' : connector.access === 'read-only' ? 'Read-only' : '',
  ].filter(Boolean)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {chips.map((chip) => (
        <span key={chip} style={{ border: `1px solid ${theme.border}`, borderRadius: 999, color: theme.t3, fontSize: 10, fontWeight: 650, padding: '3px 7px' }}>{chip}</span>
      ))}
    </div>
  )
}

function ConnectorIdentity({ connector, theme, primary = false }) {
  return (
    <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
      <span aria-hidden="true" style={{ display: 'grid', width: primary ? 37 : 34, height: primary ? 37 : 34, flexShrink: 0, placeItems: 'center', border: `1px solid ${theme.border}`, borderRadius: primary ? 12 : 11, background: theme.bg, color: primary ? theme.t1 : theme.accent, fontSize: primary ? 18 : 17 }}>{connector.icon}</span>
      <div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: theme.t1, fontSize: primary ? 15 : 14 }}>{connector.label}</strong>
          <span style={{ color: theme.t3, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{primary ? 'First-class connector' : 'External'}</span>
        </div>
        <p style={{ margin: '4px 0 0', color: primary ? theme.t2 : theme.t3, fontSize: 12, lineHeight: primary ? 1.55 : 1.5 }}>{connector.description}</p>
      </div>
    </div>
  )
}

function ExternalConnectorCard({ connector, theme }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const readiness = connector.actionReadiness || connector.readiness
  const blocked = ['not-installed', 'not-configured', 'not-authorized', 'read-only', 'temporarily-unavailable'].includes(readiness)
  const setupCopy = readiness === 'not-installed'
    ? `${connector.label} is discoverable in FounderLab, but this deployment does not yet have a verified provider connector installed. FounderLab will route this work here rather than pretending an email or event was sent.`
    : getConnectorBlockCopy(readiness)

  return (
    <article style={{ display: 'grid', gap: 14, padding: 18, border: `1px solid ${theme.border}`, borderRadius: 15, background: `linear-gradient(145deg, ${theme.surf}, ${theme.bg})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.025)' }}>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <ConnectorIdentity connector={connector} theme={theme} />
        <ConnectorBadge connector={connector} theme={theme} />
      </div>
      <CapabilityChips connector={connector} theme={theme} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: theme.t2, fontSize: 12, lineHeight: 1.45 }}>{blocked ? setupCopy : `FounderLab can use “${connector.actionLabel}” with the explicit approval boundary shown in Chat.`}</span>
        <button type="button" onClick={() => setDetailsOpen((current) => !current)} aria-expanded={detailsOpen} style={subtleButton(theme)}>{detailsOpen ? 'Hide details' : 'Connection details'}</button>
      </div>
      {detailsOpen && <div style={{ borderLeft: `2px solid ${theme.accent}`, color: theme.t3, fontSize: 11.5, lineHeight: 1.65, padding: '2px 0 2px 10px' }}>Provider credentials and OAuth authorization are intentionally not simulated. Once an approved email or calendar connector is installed server-side, this same capability, approval, execution, and evidence model will expose it to Chat without a new app-specific flow.</div>}
    </article>
  )
}

function GitHubConnectionForm({ github, theme, onConnectGithub, onRetryGithub }) {
  const [token, setToken] = useState('')
  const unavailable = github.runtime?.health === 'temporarily-unavailable'
  const canRetry = github.runtime?.configured === true && !github.checking

  return (
    <div style={{ display: 'grid', gap: 9, borderTop: `1px solid ${theme.border}`, paddingTop: 13 }}>
      <label style={{ color: theme.t2, fontSize: 11, fontWeight: 750, letterSpacing: '.05em', textTransform: 'uppercase' }}>
        Personal access token · session only
        <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste a GitHub token with the required repository access" autoComplete="off" style={{ display: 'block', width: '100%', marginTop: 7, border: `1px solid ${theme.border}`, borderRadius: 9, background: theme.bg, color: theme.t1, font: '13px inherit', padding: '10px 11px', outline: 'none' }} />
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => { if (token.trim()) onConnectGithub?.(token.trim()); setToken('') }} disabled={!token.trim() || github.checking} style={{ border: 0, borderRadius: 9, background: theme.accent, color: '#fff', cursor: token.trim() ? 'pointer' : 'not-allowed', font: '700 12px inherit', opacity: token.trim() ? 1 : .55, padding: '9px 12px' }}>Connect GitHub</button>
        {unavailable && <button type="button" onClick={onRetryGithub} disabled={!canRetry} style={{ ...subtleButton(theme), color: theme.t1, cursor: canRetry ? 'pointer' : 'not-allowed', opacity: canRetry ? 1 : .55 }}>Retry connection</button>}
        <a href="https://github.com/settings/tokens/new?scopes=repo&description=FounderLab%20AI" target="_blank" rel="noopener noreferrer" style={{ color: theme.accent, fontSize: 12, fontWeight: 650 }}>Create a token →</a>
        <span style={{ color: theme.t3, fontSize: 11 }}>{unavailable ? 'GitHub could not be reached. Retry uses this browser session only.' : 'Never stored in local storage or sent through FounderLab.'}</span>
      </div>
    </div>
  )
}

function GitHubConnectorCard({ connector, github, theme, onConnectGithub, onDisconnectGithub, onRetryGithub }) {
  return (
    <article style={{ display: 'grid', gap: 15, padding: 19, border: `1px solid ${theme.borderFocus}`, borderRadius: 16, background: `linear-gradient(145deg, ${theme.surf}, ${theme.accentM})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.035), 0 14px 36px rgba(0,0,0,.13)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <ConnectorIdentity connector={connector} theme={theme} primary />
        {github.checking ? <span style={{ color: theme.accent, fontSize: 12 }}>Checking…</span> : <ConnectorBadge connector={connector} theme={theme} />}
      </div>
      <CapabilityChips connector={connector} theme={theme} />
      {github.user ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${theme.border}`, paddingTop: 13 }}>
          <span style={{ color: theme.t2, fontSize: 12 }}>Connected for this browser session as <strong style={{ color: theme.t1 }}>{github.user.login}</strong>. Repository access is verified at each explicit GitHub action.</span>
          <button type="button" onClick={onDisconnectGithub} style={subtleButton(theme)}>Disconnect</button>
        </div>
      ) : <GitHubConnectionForm github={github} theme={theme} onConnectGithub={onConnectGithub} onRetryGithub={onRetryGithub} />}
    </article>
  )
}

function PlatformSummary({ connectors, theme }) {
  const connectedCount = connectors.filter((connector) => ['available', 'writable'].includes(connector.readiness)).length
  const metrics = [['Connectors', String(connectors.length)], ['Connected', String(connectedCount)], ['Approval-first', 'Enabled']]
  return (
    <section style={{ display: 'flex', gap: 10, flexWrap: 'wrap', border: `1px solid ${theme.border}`, borderRadius: 13, background: theme.surf, padding: 12 }} aria-label="Connector platform summary">
      {metrics.map(([label, value]) => (
        <div key={label} style={{ minWidth: 105, flex: '1 1 105px', borderRadius: 10, background: theme.bg, padding: '9px 10px' }}>
          <div style={{ color: theme.t3, fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</div>
          <div style={{ marginTop: 3, color: theme.t1, fontSize: 13, fontWeight: 750 }}>{value}</div>
        </div>
      ))}
    </section>
  )
}

/** Settings control center for the shared connector execution platform. */
export function IntegrationsControlCenter({ theme, github = {}, onConnectGithub, onDisconnectGithub, onRetryGithub }) {
  const connectors = useMemo(() => getIntegrationSettingsConnectors({ github: github.runtime }), [github.runtime])
  const githubConnector = connectors.find((connector) => connector.id === 'github')
  const nextConnectors = connectors.filter((connector) => connector.id !== 'github')

  return (
    <div style={{ maxWidth: 700, display: 'grid', gap: 16 }}>
      <section style={{ padding: '4px 2px 6px' }}>
        <span style={{ color: theme.accent, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>Connector control center</span>
        <h3 style={{ margin: '7px 0 6px', color: theme.t1, fontSize: 20 }}>One execution layer for every tool</h3>
        <p style={{ margin: 0, maxWidth: 620, color: theme.t2, fontSize: 13, lineHeight: 1.65 }}>FounderLab selects a connector, checks capability and approval, executes only when the boundary is real, then records the result. Connections never imply that an external action already happened.</p>
      </section>

      <PlatformSummary connectors={connectors} theme={theme} />
      {githubConnector && <GitHubConnectorCard connector={githubConnector} github={github} theme={theme} onConnectGithub={onConnectGithub} onDisconnectGithub={onDisconnectGithub} onRetryGithub={onRetryGithub} />}

      <section style={{ display: 'grid', gap: 10 }}>
        <div>
          <h4 style={{ margin: 0, color: theme.t1, fontSize: 14 }}>Next connectors</h4>
          <p style={{ margin: '3px 0 0', color: theme.t3, fontSize: 12 }}>Discovered capability states are explicit. FounderLab will not simulate access before a verified provider connector exists.</p>
        </div>
        {nextConnectors.map((connector) => <ExternalConnectorCard key={connector.id} connector={connector} theme={theme} />)}
      </section>
    </div>
  )
}
