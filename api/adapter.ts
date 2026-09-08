type WebHandler = (request: Request) => Promise<Response>

export function adaptHandler(handle: WebHandler) {
  return async (incoming: Request | any, outgoing?: any): Promise<Response> => {
    if (!outgoing && incoming instanceof Request) return handle(incoming)

    const protocol = incoming.headers?.['x-forwarded-proto'] || 'https'
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
    return response
  }
}
