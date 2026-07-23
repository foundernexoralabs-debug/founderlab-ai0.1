/**
 * Small, provider-neutral transport helpers for FounderLab's streaming AI
 * protocol. The client only renders text received from these events; it never
 * creates artificial token delays or simulated typing.
 */

function parseEvent(block) {
  const lines = String(block || '').replace(/\r/g, '').split('\n')
  let event = 'message'
  const data = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^\s/, '')
    if (field === 'event') event = value || 'message'
    if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  try {
    return { event, data: JSON.parse(data.join('\n')) }
  } catch {
    return null
  }
}

async function* readTextChunks(body) {
  if (!body) return
  const decoder = new TextDecoder()
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) yield decoder.decode(value, { stream: true })
      }
      const tail = decoder.decode()
      if (tail) yield tail
    } finally {
      reader.releaseLock?.()
    }
    return
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const value of body) {
      if (value) yield typeof value === 'string' ? value : decoder.decode(value, { stream: true })
    }
    const tail = decoder.decode()
    if (tail) yield tail
  }
}

/** Consume the server SSE protocol and return only the actually received text. */
export async function consumeAIEventStream(response, { onEvent } = {}) {
  let buffer = ''
  let text = ''
  let completion = null
  let failure = null
  let completed = false

  const emit = (event) => {
    try { onEvent?.(event) } catch { /* a view observer must not break the request */ }
  }
  const apply = (parsed) => {
    if (!parsed || !parsed.data || typeof parsed.data !== 'object') return
    const payload = parsed.data
    const type = payload.type || parsed.event
    if (type === 'started') emit({ type: 'started', provider: payload.provider, model: payload.model })
    if (type === 'delta' && typeof payload.text === 'string' && payload.text) {
      text += payload.text
      emit({ type: 'delta', text: payload.text, totalText: text })
    }
    if (type === 'complete') {
      completion = payload
      completed = true
      emit({ type: 'complete', provider: payload.provider, model: payload.model, meta: payload.meta || null })
    }
    if (type === 'error') {
      failure = payload.error || null
      emit({ type: 'error', error: failure })
    }
  }

  try {
    for await (const chunk of readTextChunks(response?.body)) {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        apply(parseEvent(buffer.slice(0, boundary)))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) apply(parseEvent(buffer))
  } catch (error) {
    error.partialText = text
    throw error
  }

  return { text, completion, completed, error: failure }
}

export function isAIEventStream(response) {
  return /text\/event-stream/i.test(response?.headers?.get?.('content-type') || '')
}
