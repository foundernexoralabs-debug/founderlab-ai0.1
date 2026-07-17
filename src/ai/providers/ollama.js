import { normalizeOllamaUrl } from '../normalizeRequest.js'
import { createAIErrorResult, createAIResult } from '../normalizeResponse.js'
import { getLocalModelCapabilities } from '../localModelCapabilities.js'

export const OLLAMA_DISCOVERY_TIMEOUT_MS = 5000
export const OLLAMA_CHAT_TIMEOUT_MS = 120000
export const OLLAMA_LOOPBACK_ADDRESS_SPACE = 'loopback'

const ollamaDiagnostics = new Map()
let ollamaDiagnosticSequence = 0

function diagnosticHost(value) {
  try {
    return new URL(value).host
  } catch {
    return ''
  }
}

function createDiagnostic(flow, base, path, browserContext = getOllamaBrowserCompatibility()) {
  return {
    flow,
    requestStarted: false,
    requestHost: diagnosticHost(base),
    requestPath: path || '',
    responseReceived: false,
    httpStatus: null,
    jsonParsed: null,
    modelListEmpty: null,
    browserBlockedBeforeResponse: false,
    permissionState: 'not-checked',
    secureContext: browserContext.secureContext,
    topLevelContext: browserContext.topLevelContext,
    targetAddressSpace: OLLAMA_LOOPBACK_ADDRESS_SPACE,
    targetAddressSpaceSupported: browserContext.targetAddressSpaceSupported,
    failureStep: '',
  }
}

/**
 * Local Ollama from an HTTPS website relies on the browser's loopback
 * address-space request capability. It is deliberately feature-detected
 * instead of using a user-agent guess: Chromium-based browsers can expose it,
 * while Safari currently cannot use this request path.
 *
 * The optional inputs keep the capability check independently testable without
 * mutating browser globals.
 */
export function getOllamaBrowserCompatibility({
  windowImpl = typeof window === 'undefined' ? null : window,
  RequestImpl = typeof Request === 'undefined' ? null : Request,
  secureContext = typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : false,
} = {}) {
  if (!windowImpl) {
    return Object.freeze({
      isBrowser: false,
      secureContext: 'not-browser',
      topLevelContext: 'not-browser',
      targetAddressSpaceSupported: null,
      loopbackAccessSupported: null,
    })
  }
  let topLevelContext = false
  try {
    topLevelContext = windowImpl.top === windowImpl
  } catch {
    topLevelContext = false
  }
  let targetAddressSpaceSupported = false
  try {
    const request = new RequestImpl('http://localhost:11434', { targetAddressSpace: OLLAMA_LOOPBACK_ADDRESS_SPACE })
    targetAddressSpaceSupported = request.targetAddressSpace === OLLAMA_LOOPBACK_ADDRESS_SPACE
  } catch {
    targetAddressSpaceSupported = false
  }
  return Object.freeze({
    isBrowser: true,
    secureContext: secureContext ? 'secure' : 'insecure',
    topLevelContext,
    targetAddressSpaceSupported,
    loopbackAccessSupported: targetAddressSpaceSupported,
  })
}

function isUnsupportedBrowserForLoopback(browserContext) {
  return browserContext.isBrowser && browserContext.loopbackAccessSupported === false
}

/**
 * This intentionally stores a small, in-memory trace only. It never includes
 * prompts, response bodies, cookies, credentials, or browser exception text.
 * It is used by the temporary Local Ollama debug panel in this branch.
 */
export function recordOllamaDiagnostic(flow, update = {}) {
  const previous = ollamaDiagnostics.get(flow) || { flow }
  const next = { ...previous, ...update, flow }
  Object.defineProperty(next, 'sequence', { value: ++ollamaDiagnosticSequence, enumerable: false })
  Object.freeze(next)
  ollamaDiagnostics.set(flow, next)
  return next
}

export function getOllamaDiagnostics() {
  return Object.freeze(Object.fromEntries(ollamaDiagnostics))
}

function completeInspection(inspection, diagnostic) {
  return Object.freeze({ ...inspection, diagnostic: recordOllamaDiagnostic('discovery', diagnostic) })
}

function completeRequest(result, flow, diagnostic) {
  return Object.freeze({ ...result, diagnostic: recordOllamaDiagnostic(flow, diagnostic) })
}

function resolveElectronBridge(bridge) {
  if (bridge) return bridge
  if (typeof window === 'undefined') return null
  return window.electronBridge || null
}

function timeoutSignal(timeout) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeout)
    : undefined
}

function combinedSignal(timeout, signal) {
  const timeoutAbortSignal = timeoutSignal(timeout)
  if (!signal) return timeoutAbortSignal
  if (!timeoutAbortSignal) return signal
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeoutAbortSignal])
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener?.('abort', abort, { once: true })
  timeoutAbortSignal.addEventListener?.('abort', abort, { once: true })
  return controller.signal
}

export function normalizeOllamaModelName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  return name && name.length <= 160 ? name : ''
}

/**
 * Ollama's tags endpoint has used both `name` and `model` in client-facing
 * integrations. Normalize either form once so selection, testing, and Chat
 * always receive the exact installed name (including any tag).
 */
export function normalizeOllamaModels(models) {
  if (!Array.isArray(models)) return []
  const seen = new Set()
  return models.reduce((items, model) => {
    const name = normalizeOllamaModelName(typeof model === 'string' ? model : model?.name || model?.model)
    if (!name || seen.has(name)) return items
    seen.add(name)
    items.push(Object.freeze({
      id: name,
      name,
      family: typeof model?.details?.family === 'string' ? model.details.family : '',
      parameterSize: typeof model?.details?.parameter_size === 'string' ? model.details.parameter_size : '',
      size: Number.isFinite(model?.size) ? model.size : null,
      capabilities: getLocalModelCapabilities(name),
    }))
    return items
  }, [])
}

function unavailableInspection(code = 'OLLAMA_UNAVAILABLE') {
  return Object.freeze({
    ok: false,
    state: 'unavailable',
    running: false,
    models: Object.freeze([]),
    error: Object.freeze({ code }),
  })
}

function unsupportedBrowserInspection() {
  return unavailableInspection('OLLAMA_BROWSER_UNSUPPORTED')
}

function availableInspection(models) {
  const normalizedModels = normalizeOllamaModels(models)
  return Object.freeze({
    ok: true,
    state: normalizedModels.length ? 'models_available' : 'no_models',
    running: true,
    models: Object.freeze(normalizedModels),
    error: null,
  })
}

function localOllamaFetchOptions(options) {
  return {
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    // An HTTPS FounderLab Preview reaches a local HTTP Ollama service. This
    // tells supporting browsers that the literal localhost target is loopback,
    // allowing their local-network permission flow to relax mixed-content
    // blocking without routing a request through a cloud service.
    targetAddressSpace: OLLAMA_LOOPBACK_ADDRESS_SPACE,
    ...options,
  }
}

async function getLoopbackPermissionState(permissionQuery) {
  const query = permissionQuery
    || (typeof navigator !== 'undefined' && typeof navigator.permissions?.query === 'function'
      ? navigator.permissions.query.bind(navigator.permissions)
      : null)
  if (!query) return ''
  try {
    const permission = await query({ name: 'loopback-network' })
    return ['granted', 'prompt', 'denied'].includes(permission?.state) ? permission.state : ''
  } catch {
    // The loopback-network descriptor is not available in every browser.
    return ''
  }
}

function localRequestFailureCode(error, permissionState, signal) {
  if (signal?.aborted) return 'REQUEST_CANCELLED'
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'OLLAMA_TIMEOUT'
  if (permissionState === 'denied') return 'OLLAMA_BROWSER_ACCESS_DENIED'
  return 'OLLAMA_BROWSER_ACCESS_BLOCKED'
}

export function isElectronOllamaAvailable(bridge) {
  return Boolean(resolveElectronBridge(bridge)?.isElectron)
}

/**
 * Browser discovery is deliberately a CORS-readable /api/tags call. A no-cors
 * request produces an opaque response and cannot prove that this website can
 * actually use Ollama, so it must never be treated as a successful detection.
 */
export async function discoverOllama(base, {
  fetchImpl = globalThis.fetch,
  electronBridge,
  permissionQuery,
  browserCompatibility,
} = {}) {
  const url = normalizeOllamaUrl(base)
  const browserContext = browserCompatibility || getOllamaBrowserCompatibility()
  const diagnostic = createDiagnostic('discovery', url || base, '/api/tags', browserContext)
  if (!url || typeof fetchImpl !== 'function') {
    return completeInspection(unavailableInspection('OLLAMA_UNAVAILABLE'), {
      ...diagnostic,
      failureStep: !url ? 'url-validation' : 'fetch-unavailable',
    })
  }

  const bridge = resolveElectronBridge(electronBridge)
  try {
    if (bridge?.isElectron) {
      const result = await bridge.ollama.probe(url)
      return completeInspection(result?.running ? availableInspection(result.models) : unavailableInspection(), {
        ...diagnostic,
        requestStarted: true,
        responseReceived: Boolean(result),
        jsonParsed: Boolean(result),
        modelListEmpty: Array.isArray(result?.models) ? result.models.length === 0 : null,
        permissionState: 'electron-bridge',
        failureStep: result?.running ? '' : 'electron-probe',
      })
    }
    if (isUnsupportedBrowserForLoopback(browserContext)) {
      return completeInspection(unsupportedBrowserInspection(), {
        ...diagnostic,
        permissionState: 'unsupported-browser',
        failureStep: 'browser-capability',
      })
    }
    // Start the permission-gated fetch directly from the user's Refresh
    // action. Permissions.query() reports state only; it cannot request or
    // grant local access, so it must not delay the annotated browser request.
    const permissionStatePromise = getLoopbackPermissionState(permissionQuery)
    const response = await fetchImpl(url + '/api/tags', localOllamaFetchOptions({
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: timeoutSignal(OLLAMA_DISCOVERY_TIMEOUT_MS),
    }))
    const permissionState = await permissionStatePromise
    const responseDiagnostic = {
      ...diagnostic,
      requestStarted: true,
      responseReceived: true,
      httpStatus: Number.isFinite(response?.status) ? response.status : null,
      permissionState: permissionState || 'not-supported',
    }
    if (!response.ok) {
      return completeInspection(unavailableInspection('OLLAMA_UNAVAILABLE'), {
        ...responseDiagnostic,
        failureStep: 'http-response',
      })
    }
    let data
    try {
      data = await response.json()
    } catch {
      return completeInspection(unavailableInspection('MALFORMED_RESPONSE'), {
        ...responseDiagnostic,
        jsonParsed: false,
        failureStep: 'json-parse',
      })
    }
    if (!data || !Array.isArray(data.models)) {
      return completeInspection(unavailableInspection('MALFORMED_RESPONSE'), {
        ...responseDiagnostic,
        jsonParsed: true,
        failureStep: 'model-list',
      })
    }
    return completeInspection(availableInspection(data.models), {
      ...responseDiagnostic,
      jsonParsed: true,
      modelListEmpty: data.models.length === 0,
    })
  } catch (error) {
    const permissionState = await getLoopbackPermissionState(permissionQuery)
    return completeInspection(unavailableInspection(localRequestFailureCode(error, permissionState)), {
      ...diagnostic,
      requestStarted: true,
      browserBlockedBeforeResponse: true,
      permissionState: permissionState || 'not-supported',
      failureStep: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'fetch-before-response',
    })
  }
}

// Kept as a small compatibility alias for callers from the Phase 2.2 engine.
export const probeOllama = discoverOllama

export async function requestOllama({
  model,
  messages,
  system,
  maxTokens,
  temperature,
  responseFormat,
  ollamaUrl,
}, {
  fetchImpl = globalThis.fetch,
  electronBridge,
  permissionQuery,
  diagnosticFlow = 'chat',
  browserCompatibility,
  signal,
} = {}) {
  const base = normalizeOllamaUrl(ollamaUrl)
  const selectedModel = normalizeOllamaModelName(model)
  const browserContext = browserCompatibility || getOllamaBrowserCompatibility()
  const diagnostic = createDiagnostic(diagnosticFlow, base || ollamaUrl, '/api/chat', browserContext)
  if (!base) {
    return completeRequest(createAIErrorResult({ provider: 'ollama', model: selectedModel, code: 'OLLAMA_INVALID_URL' }), diagnosticFlow, {
      ...diagnostic,
      failureStep: 'url-validation',
    })
  }
  if (!selectedModel) {
    return completeRequest(createAIErrorResult({ provider: 'ollama', code: 'OLLAMA_MODEL_REQUIRED' }), diagnosticFlow, {
      ...diagnostic,
      failureStep: 'model-selection',
    })
  }
  const fullMessages = system ? [{ role: 'system', content: system }, ...(messages || [])] : messages || []
  const bridge = resolveElectronBridge(electronBridge)

  try {
    if (bridge?.isElectron) {
      const response = await bridge.ollama.chat({ url: base, model: selectedModel, messages: fullMessages, max: maxTokens, temperature })
      if (!response?.ok) {
        return completeRequest(createAIErrorResult({
          provider: 'ollama',
          model: selectedModel,
          code: response?.status === 404 ? 'OLLAMA_MODEL_UNAVAILABLE' : 'OLLAMA_UNAVAILABLE',
        }), diagnosticFlow, {
          ...diagnostic,
          requestStarted: true,
          responseReceived: Boolean(response),
          httpStatus: Number.isFinite(response?.status) ? response.status : null,
          jsonParsed: Boolean(response?.data),
          permissionState: 'electron-bridge',
          failureStep: 'electron-response',
        })
      }
      return completeRequest(createAIResult({
        provider: 'ollama',
        model: selectedModel,
        text: response.data?.message?.content || '',
        usage: response.data?.eval_count ? { outputTokens: response.data.eval_count } : null,
        finishReason: response.data?.done_reason,
      }), diagnosticFlow, {
        ...diagnostic,
        requestStarted: true,
        responseReceived: true,
        jsonParsed: true,
        permissionState: 'electron-bridge',
      })
    }

    if (isUnsupportedBrowserForLoopback(browserContext)) {
      return completeRequest(createAIErrorResult({
        provider: 'ollama',
        model: selectedModel,
        code: 'OLLAMA_BROWSER_UNSUPPORTED',
      }), diagnosticFlow, {
        ...diagnostic,
        permissionState: 'unsupported-browser',
        failureStep: 'browser-capability',
      })
    }

    if (typeof fetchImpl !== 'function') {
      return completeRequest(createAIErrorResult({ provider: 'ollama', model: selectedModel, code: 'OLLAMA_UNAVAILABLE' }), diagnosticFlow, {
        ...diagnostic,
        failureStep: 'fetch-unavailable',
      })
    }
    // Match discovery: a user-initiated Test or Chat must begin its annotated
    // local fetch before awaiting a permission-status query.
    const permissionStatePromise = getLoopbackPermissionState(permissionQuery)
    const response = await fetchImpl(base + '/api/chat', localOllamaFetchOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        messages: fullMessages,
        stream: false,
        // Ollama's native JSON mode prevents a local coding model from
        // wrapping Builder's structured contract in explanatory prose. The
        // response is still parsed and validated by the Builder pipeline.
        ...(responseFormat?.type === 'json_object' ? { format: 'json' } : {}),
        options: { num_predict: maxTokens, ...(temperature !== undefined && { temperature }) },
      }),
      signal: combinedSignal(OLLAMA_CHAT_TIMEOUT_MS, signal),
    }))
    const permissionState = await permissionStatePromise
    const responseDiagnostic = {
      ...diagnostic,
      requestStarted: true,
      responseReceived: true,
      httpStatus: Number.isFinite(response?.status) ? response.status : null,
      permissionState: permissionState || 'not-supported',
    }
    let data
    try {
      data = await response.json()
    } catch {
      return completeRequest(createAIErrorResult({ provider: 'ollama', model: selectedModel, code: 'MALFORMED_RESPONSE' }), diagnosticFlow, {
        ...responseDiagnostic,
        jsonParsed: false,
        failureStep: 'json-parse',
      })
    }
    if (!response.ok) {
      return completeRequest(createAIErrorResult({
        provider: 'ollama',
        model: selectedModel,
        status: response.status,
        code: response.status === 404 ? 'OLLAMA_MODEL_UNAVAILABLE' : response.status === 429 ? 'RATE_LIMITED' : 'OLLAMA_UNAVAILABLE',
      }), diagnosticFlow, {
        ...responseDiagnostic,
        jsonParsed: true,
        failureStep: 'http-response',
      })
    }
    return completeRequest(createAIResult({
      provider: 'ollama',
      model: selectedModel,
      // `/api/chat` returns message.content. `response` is retained as a
      // harmless compatibility fallback for older local Ollama builds.
      text: typeof data?.message?.content === 'string' ? data.message.content : data?.response || '',
      usage: data?.eval_count ? { outputTokens: data.eval_count } : null,
      finishReason: data?.done_reason,
    }), diagnosticFlow, {
      ...responseDiagnostic,
      jsonParsed: true,
    })
  } catch (error) {
    const permissionState = await getLoopbackPermissionState(permissionQuery)
    return completeRequest(createAIErrorResult({
      provider: 'ollama',
      model: selectedModel,
      code: localRequestFailureCode(error, permissionState, signal),
    }), diagnosticFlow, {
      ...diagnostic,
      requestStarted: true,
      browserBlockedBeforeResponse: true,
      permissionState: permissionState || 'not-supported',
      failureStep: signal?.aborted ? 'cancelled' : error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'fetch-before-response',
    })
  }
}
