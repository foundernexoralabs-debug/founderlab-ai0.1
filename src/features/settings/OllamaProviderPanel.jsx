import { useCallback, useEffect, useRef, useState } from 'react'
import { C } from '@/app/theme'
import { Badge, Button, Spinner } from '@/components/ui/Primitives'
import {
  createProviderConnectionTestRequest,
  discoverLocalOllama,
  getOllamaModel,
  getOllamaURL,
  requestAIResult,
  setOllamaModel,
} from '@/services/aiProviderService'
import { setProviderConnectionStatus } from '@/ai/providerConnectionState'

const INITIAL_INSPECTION = Object.freeze({
  ok: false,
  state: 'idle',
  running: false,
  models: Object.freeze([]),
  error: null,
})

function statePresentation(inspection, testing, testState, testMessage) {
  if (testing) return { title: 'Testing local Ollama', detail: 'Sending a short request to the selected model.', color: 'accent' }
  if (testState === 'connected') return { title: 'Connected', detail: 'Your selected local model replied successfully.', color: 'green' }
  if (testState === 'failed') return { title: 'Connection needs attention', detail: testMessage || 'Ollama could not complete the local test. Refresh models or check the connection help below.', color: 'red' }
  if (inspection.state === 'detecting') return { title: 'Detecting Ollama', detail: 'Looking for Ollama on this Mac.', color: 'accent' }
  if (inspection.state === 'models_available') return { title: 'Models available', detail: `${inspection.models.length} local model${inspection.models.length === 1 ? '' : 's'} found. Choose one, then test it.`, color: 'green' }
  if (inspection.state === 'no_models') return { title: 'Ollama is running', detail: 'No local models are installed yet.', color: 'yellow' }
  if (inspection.error?.code === 'MALFORMED_RESPONSE') return { title: 'Ollama needs attention', detail: 'The local service responded, but did not return a usable model list. Refresh the local connection and try again.', color: 'yellow' }
  if (inspection.error?.code === 'OLLAMA_BROWSER_ACCESS_DENIED') return { title: 'Browser access is blocked', detail: 'This browser denied FounderLab access to the local Ollama service. Allow local access, then refresh.', color: 'red' }
  if (inspection.error?.code === 'OLLAMA_BROWSER_ACCESS_BLOCKED') return { title: 'Browser could not reach local Ollama', detail: 'Ollama may be running, but this browser could not access it. Check browser local access, then refresh.', color: 'yellow' }
  if (inspection.error?.code === 'OLLAMA_TIMEOUT') return { title: 'Ollama took too long to respond', detail: 'The local service did not answer the model check in time. Confirm that Ollama is running, then refresh.', color: 'yellow' }
  return { title: 'Ollama is not available', detail: 'FounderLab could not reach a local Ollama service from this browser.', color: 'yellow' }
}

function colorForState(color) {
  return color === 'green' ? [C.greenM, C.green] : color === 'red' ? ['rgba(239,68,68,.08)', C.red] : color === 'accent' ? [C.accentM, C.accent] : [C.yellowM, C.yellow]
}

/** A self-contained local-only provider surface; cloud providers never enter it. */
export function OllamaProviderPanel() {
  const [inspection, setInspection] = useState(INITIAL_INSPECTION)
  const [selectedModel, setSelectedModel] = useState(getOllamaModel)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState('')
  const [testMessage, setTestMessage] = useState('')
  const attempt = useRef(0)

  const detect = useCallback(async () => {
    const requestId = ++attempt.current
    setTesting(false)
    setTestState('')
    setTestMessage('')
    setInspection({ ...INITIAL_INSPECTION, state: 'detecting' })
    setProviderConnectionStatus('ollama', 'detecting')
    const result = await discoverLocalOllama()
    if (requestId !== attempt.current) return
    setInspection(result)
    if (!result.ok) {
      setProviderConnectionStatus('ollama', 'unavailable')
      return
    }
    if (!result.models.length) {
      setProviderConnectionStatus('ollama', 'no_models')
      return
    }
    const remembered = getOllamaModel()
    const model = result.models.some((candidate) => candidate.id === remembered) ? remembered : result.models[0].id
    if (model !== remembered) setOllamaModel(model)
    setSelectedModel(model)
    setProviderConnectionStatus('ollama', 'ready')
  }, [])

  useEffect(() => {
    void detect()
    return () => { attempt.current += 1 }
  }, [detect])

  const chooseModel = (model) => {
    setSelectedModel(model)
    setOllamaModel(model)
    setTestState('')
    setTestMessage('')
    setProviderConnectionStatus('ollama', 'ready')
  }

  const testConnection = async () => {
    if (!selectedModel || !inspection.models.some((model) => model.id === selectedModel)) return
    setTesting(true)
    setTestState('')
    setTestMessage('')
    setProviderConnectionStatus('ollama', 'testing')
    try {
      const result = await requestAIResult({
        ...createProviderConnectionTestRequest({ provider: 'ollama', model: selectedModel }),
        localOllamaAllowed: true,
      })
      if (result.ok) {
        setTestState('connected')
        return
      }
      setTestState('failed')
      setTestMessage(result.error?.message || '')
    } catch {
      setProviderConnectionStatus('ollama', 'failed')
      setTestState('failed')
      setTestMessage('Local Ollama could not complete the connection test. Try refreshing the local connection.')
    } finally {
      setTesting(false)
    }
  }

  const presentation = statePresentation(inspection, testing, testState, testMessage)
  const [background, foreground] = colorForState(presentation.color)
  return (
    <section aria-label="Local Ollama" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong style={{ fontSize: 15, color: C.t1 }}>Local Ollama</strong><Badge color="green">Local · Free</Badge></div>
          <p style={{ margin: '5px 0 0', color: C.t2, fontSize: 12, lineHeight: 1.55 }}>Runs model inference on this Mac. FounderLab sends local Chat requests straight to Ollama—no cloud key or FounderLab server is involved. Normal workspace chat-history sync still follows your FounderLab data settings.</p>
        </div>
        <Button onClick={detect} disabled={inspection.state === 'detecting'} variant="secondary" size="sm">{inspection.state === 'detecting' ? <><Spinner size={12} color={C.accent} /> Detecting</> : 'Refresh'}</Button>
      </div>

      <div role="status" style={{ padding: '12px 13px', background, border: `1px solid ${foreground}44`, borderRadius: 9, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span aria-hidden="true" style={{ marginTop: 4, width: 7, height: 7, borderRadius: 99, background: foreground, boxShadow: `0 0 0 3px ${foreground}22` }} />
        <div><strong style={{ display: 'block', color: C.t1, fontSize: 12 }}>{presentation.title}</strong><span style={{ display: 'block', color: C.t2, fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{presentation.detail}</span></div>
      </div>

      {inspection.models.length > 0 && (
        <div>
          <label htmlFor="ollama-local-model" style={{ display: 'block', color: C.t2, fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>Local model</label>
          <select id="ollama-local-model" value={selectedModel} onChange={(event) => chooseModel(event.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.t1, fontSize: 13, padding: '9px 12px', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
            {inspection.models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.parameterSize ? ` · ${model.parameterSize}` : ''}</option>)}
          </select>
          <p style={{ margin: '6px 0 0', color: C.t3, fontSize: 11 }}>Your selected model is remembered on this device.</p>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button onClick={testConnection} disabled={testing || !inspection.ok || !selectedModel || !inspection.models.some((model) => model.id === selectedModel)} variant="secondary" size="sm">{testing ? <><Spinner size={12} color={C.accent} /> Testing</> : 'Test connection'}</Button>
        {inspection.models.length > 0 && <span style={{ color: C.t3, fontSize: 11 }}>Tests the selected model with a real local response.</span>}
      </div>

      {(inspection.state === 'unavailable' || inspection.state === 'no_models') && (
        <details style={{ paddingTop: 2 }}>
          <summary style={{ color: C.t2, cursor: 'pointer', fontSize: 12 }}>Need help connecting Ollama?</summary>
          <div style={{ color: C.t3, fontSize: 12, lineHeight: 1.65, marginTop: 8 }}>
            <ol style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              <li>Install and open <a href="https://ollama.com" target="_blank" rel="noreferrer" style={{ color: C.accent }}>Ollama</a> on this Mac.</li>
              <li>Download a local model in Terminal, for example <code style={{ color: C.t2 }}>ollama pull gemma3</code>.</li>
              <li>Return here and choose <strong style={{ color: C.t2 }}>Refresh</strong>.</li>
            </ol>
            <div>If this browser asks to connect to a local app, allow FounderLab access to this Mac’s local Ollama service, then choose <strong style={{ color: C.t2 }}>Refresh</strong>.</div>
          </div>
        </details>
      )}
    </section>
  )
}
