import { defineConfig, type Plugin } from 'vite'
import { Readable } from 'node:stream'
import react from '@vitejs/plugin-react'
import playlistHandler from './api/playlist'
import xtreamHandler from './api/xtream'
import streamHandler from './api/stream'

function localApi(): Plugin {
  return {
    name: 'streamhub-local-api',
    configureServer(server) {
      const handlers: Record<string, (request: Request) => Promise<Response>> = {
        '/api/playlist': playlistHandler,
        '/api/xtream': xtreamHandler,
        '/api/stream': streamHandler,
      }

      for (const [route, handler] of Object.entries(handlers)) {
        server.middlewares.use(route, async (req: any, res: any, next: any) => {
          try {
            const request = new Request(`http://localhost:5173${req.url ?? ''}`, {
              method: req.method ?? 'GET',
            })
            const response = await handler(request)
            res.statusCode = response.status
            response.headers.forEach((value, key) => res.setHeader(key, value))

            if (route === '/api/stream' && response.body) {
              Readable.fromWeb(response.body as any).pipe(res)
              return
            }

            res.end(new Uint8Array(await response.arrayBuffer()))
          } catch (error) {
            next(error)
          }
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
})
