import { classifyAIError } from './errorClassifier.js'

export function createAIResult({ provider, model, text, usage, finishReason } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return createAIErrorResult({ provider, model, code: 'EMPTY_RESPONSE' })
  }

  return {
    ok: true,
    provider: provider || null,
    model: model || null,
    text,
    content: [{ type: 'text', text }],
    meta: {
      usage: usage || null,
      finishReason: finishReason || null,
    },
  }
}

export function createAIErrorResult({ provider, model, status, code, message } = {}) {
  return {
    ok: false,
    provider: provider || null,
    model: model || null,
    error: classifyAIError({ provider, status, code, message }),
  }
}

export function normalizeApiResult(payload, fallback = {}) {
  if (!payload || typeof payload !== 'object') {
    return createAIErrorResult({ ...fallback, code: 'MALFORMED_RESPONSE' })
  }

  if (payload.ok === false || payload.error) {
    const error = typeof payload.error === 'string' ? { message: payload.error } : payload.error || {}
    return createAIErrorResult({
      provider: payload.provider || fallback.provider,
      model: payload.model || fallback.model,
      status: error.status || payload.status,
      code: error.code || payload.errorCode,
      message: error.message,
    })
  }

  return createAIResult({
    provider: payload.provider || fallback.provider,
    model: payload.model || fallback.model,
    text: payload.text || payload.content?.map((item) => item.text || '').join('') || '',
    usage: payload.meta?.usage,
    finishReason: payload.meta?.finishReason,
  })
}

export function toLegacyAIText(result) {
  return result.ok ? result.text : '⚠ ' + result.error.message
}
