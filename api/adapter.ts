type WebHandler = (request: Request) => Promise<Response>

async function requestBody(incoming: any, method: string) {
  if (method === 'GET' || method === 'HEAD') return undefined
  const chunks: Uint8Array[] = []
  for await (const chunk of incoming) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
  }
  if (!chunks.length) return undefined
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function handleNodeRequest(incoming: any, outgoing: any, handle: WebHandler): Promise<void> {
  try {
    const forwardedProtocol = incoming.headers?.['x-forwarded-proto']
    // Sem proxy na frente (ex.: npm start local) a conexão é HTTP puro; assumir https quebrava os links do manifesto.
    const protocol = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol)?.split(',')[0].trim() || (incoming.socket?.encrypted ? 'https' : 'http')
    const host = incoming.headers?.host || 'localhost'
    const headers = new Headers()
    for (const [key, value] of Object.entries(incoming.headers || {})) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }
    const method = incoming.method || 'GET'
    const request = new Request(new URL(incoming.url || '/', `${protocol}://${host}`), {
      method,
      headers,
      body: await requestBody(incoming, method),
    })
    const response = await handle(request)
    outgoing.statusCode = response.status
    response.headers.forEach((value, key) => outgoing.setHeader(key, value))
    if (response.body) {
      const reader = response.body.getReader()
      // Quando o navegador troca de canal ou fecha a aba, cancela a leitura e
      // libera a conexão com o IPTV (muitos provedores só permitem 1 conexão).
      let clientGone = false
      const onClose = () => {
        if (outgoing.writableFinished) return
        clientGone = true
        void reader.cancel().catch(() => undefined)
      }
      outgoing.on?.('close', onClose)
      try {
        while (!clientGone) {
          const { done, value } = await reader.read()
          if (done || clientGone) break
          const flushed = outgoing.write(value)
          if (!flushed && !clientGone) await new Promise<void>((resolve) => {
            const done = () => { outgoing.off?.('drain', done); outgoing.off?.('close', done); resolve() }
            outgoing.once?.('drain', done)
            outgoing.once?.('close', done)
          })
        }
      } catch (error) {
        if (!clientGone) throw error
      } finally {
        outgoing.off?.('close', onClose)
        try { reader.releaseLock() } catch { /* stream already cancelled */ }
      }
      if (clientGone) return
    }
    outgoing.end()
  } catch (error) {
    console.error('StreamHub API handler failed', error)
    if (!outgoing.headersSent) outgoing.setHeader('Content-Type', 'application/json; charset=utf-8')
    outgoing.statusCode = 500
    outgoing.end(JSON.stringify({ error: 'A função da API não conseguiu processar a solicitação.' }))
  }
}
