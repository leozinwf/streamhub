import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import playlistHandler from './api/playlist'
import xtreamHandler from './api/xtream'

function localApi(): Plugin {
  return {
    name: 'streamhub-local-api',
    configureServer(server) {
      server.middlewares.use('/api/playlist', async (req: any, res: any, next: any) => {
        try {
          const request = new Request(`http://localhost:5173${req.url ?? ''}`, {
            method: req.method ?? 'GET',
          })
          const response = await playlistHandler(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(new Uint8Array(await response.arrayBuffer()))
        } catch (error) {
          next(error)
        }
      })

      server.middlewares.use('/api/xtream', async (req: any, res: any, next: any) => {
        try {
          const request = new Request(`http://localhost:5173${req.url ?? ''}`, {
            method: req.method ?? 'GET',
          })
          const response = await xtreamHandler(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(new Uint8Array(await response.arrayBuffer()))
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
})
