import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import playlistHandler from './api/playlist'
import xtreamHandler from './api/xtream'
import streamHandler from './api/stream'

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
      }
      for (const [route, handler] of Object.entries(handlers)) {
        server.middlewares.use(route, async (req: any, res: any, next: any) => {
          const startedAt = Date.now()
          try {
            const headers = new Headers()
            for (const [key, value] of Object.entries(req.headers ?? {})) {
              if (typeof value === 'string') headers.set(key, value)
              else if (Array.isArray(value)) headers.set(key, value.join(', '))
            }
            const request = new Request(`http://localhost:5173${req.url ?? ''}`, { method: req.method ?? 'GET', headers })
            const response = await handler(request)
            console.info(`[StreamHub API] ${req.method ?? 'GET'} ${route} -> ${response.status} (${Date.now() - startedAt}ms)`)
            await sendResponse(response, res, route === '/api/stream')
          } catch (error) {
            console.error(`[StreamHub API] ${req.method ?? 'GET'} ${route} -> EXCEPTION`, error)
            next(error)
          }
        })
      }
    },
    transform(code, id) {
      if (!id.endsWith('/src/App.tsx')) return null

      let fixed = code
        .replace(
          "import type { Channel, Playlist } from './types'",
          "import type { Channel, Playlist } from './types'\nimport ModernPlayer from './components/Player'\nimport { collapseChannelVariants } from './lib/channelVariants'",
        )
        .replace(
          'const filteredChannels = useMemo(() => playlist?.channels.filter(',
          'const filteredChannels = useMemo(() => collapseChannelVariants(playlist?.channels ?? []).filter(',
        )
        .replace(
          '    ? recentChannels.filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase()))',
          '    ? collapseChannelVariants(recentChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase()))',
        )
        .replace(
          '      ? favoriteChannels.filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase()))',
          '      ? collapseChannelVariants(favoriteChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase()))',
        )
        .replace(
          '<Player channel={selectedChannel} />',
          '<ModernPlayer channel={selectedChannel} />',
        )

      // Guard against a partially transformed/cached module: the runtime must never
      // reference collapseChannelVariants without its import being present.
      if (fixed.includes('collapseChannelVariants(') && !fixed.includes("import { collapseChannelVariants } from './lib/channelVariants'")) {
        fixed = fixed.replace(
          "import type { Channel, Playlist } from './types'",
          "import type { Channel, Playlist } from './types'\nimport { collapseChannelVariants } from './lib/channelVariants'",
        )
      }

      if (fixed.includes('<ModernPlayer') && !fixed.includes("import ModernPlayer from './components/Player'")) {
        fixed = fixed.replace(
          "import type { Channel, Playlist } from './types'",
          "import type { Channel, Playlist } from './types'\nimport ModernPlayer from './components/Player'",
        )
      }

      return fixed === code ? null : { code: fixed, map: null }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
