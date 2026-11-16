import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import type { Server } from 'node:http'
import { handleNodeRequest } from '../api/adapter.js'
import { handleXtream } from '../api/xtream.js'
import { handleStream } from '../api/stream.js'
import { handlePlaylist } from '../api/playlist.js'
import { handleExport } from '../api/export.js'

export type StartOptions = {
  port: number
  host?: string
  /** Folder with the built front-end (vite build). */
  distDir: string
}

/** Creates the StreamHub server (front-end + /api proxy). Used by the web deploy and by the desktop app. */
export function createApp(distDir: string) {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: true, credentials: false }))

  app.get('/api/health', (_req, res) => {
    res.json({ success: true, service: 'streamhub-api', timestamp: new Date().toISOString() })
  })

  // Não usar express.json() global: o adaptador lê o corpo bruto da requisição.
  const routes = {
    '/api/xtream': handleXtream,
    '/api/stream': handleStream,
    '/api/playlist': handlePlaylist,
    '/api/export': handleExport,
  } as const

  for (const [route, handler] of Object.entries(routes)) {
    app.all(route, (req, res) => { void handleNodeRequest(req, res, handler) })
  }

  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Rota da API não encontrada.' }) })

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(distDir, 'index.html'))
    })
  } else {
    console.warn(`[StreamHub] Pasta ${distDir} não encontrada — rode "npm run build" para servir o front-end.`)
  }
  return app
}

export function startServer({ port, host = '0.0.0.0', distDir }: StartOptions): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createApp(distDir).listen(port, host, () => resolve(server))
    server.once('error', reject)
  })
}
