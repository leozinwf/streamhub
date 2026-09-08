type WebHandler = (request: Request) => Promise<Response>

export async function handleNodeRequest(incoming: any, outgoing: any, handle: WebHandler): Promise<void> {
  try {
    const forwardedProtocol = incoming.headers?.['x-forwarded-proto']
    const protocol = Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol || 'https'
    const host = incoming.headers?.host || 'localhost'
    const headers = new Headers()
    for (const [key, value] of Object.entries(incoming.headers || {})) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }
    const request = new Request(new URL(incoming.url || '/', `${protocol}://${host}`), {
      method: incoming.method || 'GET',
      headers,
    })
    const response = await handle(request)
    outgoing.statusCode = response.status
    response.headers.forEach((value, key) => outgoing.setHeader(key, value))
    if (response.body) {
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          outgoing.write(value)
        }
      } finally { reader.releaseLock() }
    }
    outgoing.end()
  } catch (error) {
    console.error('StreamHub API handler failed', error)
    if (!outgoing.headersSent) outgoing.setHeader('Content-Type', 'application/json; charset=utf-8')
    outgoing.statusCode = 500
    outgoing.end(JSON.stringify({ error: 'A função da API não conseguiu processar a solicitação.' }))
  }
}
