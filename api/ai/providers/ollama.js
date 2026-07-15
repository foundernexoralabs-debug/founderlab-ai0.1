const {
  assertProviderResponse,
  createProviderError,
  readProviderJson,
} = require('../providerUtils')

async function execute({ request, fetchImpl }) {
  if (!request.ollamaUrl) {
    throw createProviderError({
      provider: 'ollama',
      status: 400,
      code: 'REQUEST_INVALID',
      message: 'Ollama URL must use localhost.',
    })
  }

  const messages = request.system
    ? [{ role: 'system', content: request.system }, ...request.messages]
    : request.messages
  const response = await fetchImpl(request.ollamaUrl + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      stream: false,
      options: { num_predict: request.maxTokens },
    }),
  })
  const data = await readProviderJson(response, 'ollama')
  assertProviderResponse(response, data, 'ollama')
  return {
    text: data.message?.content || '',
    usage: data.eval_count ? { outputTokens: data.eval_count } : null,
    finishReason: data.done_reason,
  }
}

module.exports = { execute }
