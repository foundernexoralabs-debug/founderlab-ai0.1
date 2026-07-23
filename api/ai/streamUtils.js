function encodeEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

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
  return data.length ? { event, data: data.join('\n') } : null
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

/** Iterate a provider Server-Sent Event stream without buffering the response. */
async function* iterateSSE(body) {
  let buffer = ''
  for await (const chunk of readTextChunks(body)) {
    buffer = (buffer + chunk).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const parsed = parseEvent(buffer.slice(0, boundary))
      if (parsed) yield parsed
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) {
    const parsed = parseEvent(buffer)
    if (parsed) yield parsed
  }
}

function startSSE(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

function writeSSE(res, event, payload) {
  res.write(encodeEvent(event, payload))
}

module.exports = { iterateSSE, startSSE, writeSSE }
