/**
 * Local Ollama names are dynamic, so capability detection lives outside the
 * static provider registry. This is deliberately conservative: only model
 * names that clearly identify as code-specialised are admitted to the local
 * Builder / Code AI execution path.
 */
const CODING_MODEL_PATTERN = /(?:^|[/:_-])(?:qwen(?:[\d.]+)?[-_.]?coder|deepseek[-_.]?coder|code[-_.]?llama|star[-_.]?coder|code[-_.]?gemma|codestral|wizard[-_.]?coder|phi[-_.]?coder)(?:$|[/:_.-])/i

function normalizeModelId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function getLocalModelCapabilities(modelId) {
  const id = normalizeModelId(modelId)
  const codeGeneration = Boolean(id && CODING_MODEL_PATTERN.test(id))
  return Object.freeze({
    codeGeneration,
    label: codeGeneration ? 'Code-ready' : 'General chat',
    detail: codeGeneration
      ? 'Local coding model · Builder and Code AI ready'
      : 'Local general-purpose model',
  })
}

export function isLocalCodingModel(modelId) {
  return getLocalModelCapabilities(modelId).codeGeneration
}

/**
 * Code-oriented routes may use configured cloud providers as before. Local
 * execution is intentionally opt-in to a known coding model so a general
 * chat model is never silently sent a large project-generation workload.
 */
export function getCodeGenerationReadiness({ provider = '', model = '' } = {}) {
  const providerId = normalizeModelId(provider)
  const modelId = normalizeModelId(model)
  if (providerId !== 'ollama') {
    return Object.freeze({ ready: Boolean(providerId && modelId), local: false, provider: providerId, model: modelId, reason: '' })
  }
  if (!modelId) {
    return Object.freeze({ ready: false, local: true, provider: providerId, model: '', reason: 'model-required' })
  }
  if (!isLocalCodingModel(modelId)) {
    return Object.freeze({ ready: false, local: true, provider: providerId, model: modelId, reason: 'coding-model-required' })
  }
  return Object.freeze({ ready: true, local: true, provider: providerId, model: modelId, reason: '' })
}
