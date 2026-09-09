import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handlePlaylist as playlistHandler } from './api/playlist'
import { handleXtream as xtreamHandler } from './api/xtream'
import { handleStream as streamHandler } from './api/stream'
import { handleExport as exportHandler } from './api/export'

async function sendResponse(response: Response, res: any, stream = false) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (stream && response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    } finally { reader.releaseLock() }
    res.end()
    return
  }
  res.end(new Uint8Array(await response.arrayBuffer()))
}

function localApi(): Plugin {
  return {
    name: 'streamhub-local-api',
    configureServer(server) {
      const handlers: Record<string, (request: Request) => Promise<Response>> = {
        '/api/playlist': playlistHandler,
        '/api/xtream': xtreamHandler,
        '/api/stream': streamHandler,
        '/api/export': exportHandler,
      }
      for (const [route, handler] of Object.entries(handlers)) {
        server.middlewares.use(route, async (req: any, res: any, next: any) => {
          try {
            const headers = new Headers()
            for (const [key, value] of Object.entries(req.headers ?? {})) {
              if (typeof value === 'string') headers.set(key, value)
              else if (Array.isArray(value)) headers.set(key, value.join(', '))
            }
            const method = req.method ?? 'GET'
            const chunks: Uint8Array[] = []
            if (method !== 'GET' && method !== 'HEAD') {
              for await (const chunk of req) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
            }
            const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
            const body = chunks.length ? new Uint8Array(size) : undefined
            let offset = 0
            for (const chunk of chunks) {
              body?.set(chunk, offset)
              offset += chunk.byteLength
            }
            const request = new Request(`http://localhost:5173${req.url ?? ''}`, { method, headers, body })
            const response = await handler(request)
            await sendResponse(response, res, route === '/api/stream' || route === '/api/export')
          } catch (error) {
            console.error(`[StreamHub API] ${req.method ?? 'GET'} ${route} failed`, error)
            next(error)
          }
        })
      }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
