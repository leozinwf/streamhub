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

      // Keep the fallback stable so a fatal HLS error can actually switch to .ts.
      let fixed = code
        .replace('    setError(null)\n    setUsingFallback(false)\n    setDebug', '    setError(null)\n    setDebug')
        .replace('  }, [channel, retryKey, usingFallback])', '  }, [channel, retryKey])')

      if (!fixed.includes('STREAMHUB_PLAYER_DEBUG')) {
        fixed = fixed.replace(
          "function proxyStreamUrl(url: string) {\n  return `/api/stream?url=${encodeURIComponent(url)}`\n}\n",
          "function proxyStreamUrl(url: string) {\n  return `/api/stream?url=${encodeURIComponent(url)}`\n}\n\nfunction safeDebugUrl(value: string) {\n  try {\n    const url = new URL(value, window.location.origin)\n    const target = url.searchParams.get('url')\n    if (target) {\n      const upstream = new URL(target)\n      return `${upstream.origin}${upstream.pathname}`\n    }\n    return `${url.origin}${url.pathname}`\n  } catch {\n    return '[invalid-url]'\n  }\n}\n\nfunction playerDebug(channel: Channel, event: string, detail?: unknown) {\n  const payload = detail === undefined ? '' : detail\n  console.info(`[STREAMHUB_PLAYER_DEBUG] ${channel.name} :: ${event}`, payload)\n}\n"
        )

        fixed = fixed.replace(
          '      const hls = new Hls({\n',
          '      const hls = new Hls({\n        xhrSetup(xhr, requestUrl) {\n          const startedAt = performance.now()\n          const safeUrl = safeDebugUrl(requestUrl)\n          playerDebug(channel, `XHR_START ${safeUrl}`)\n          const logXhr = (event: string) => playerDebug(channel, `XHR_${event} ${safeUrl}`, { status: xhr.status, responseURL: safeDebugUrl(xhr.responseURL || requestUrl), elapsedMs: Math.round(performance.now() - startedAt) })\n          xhr.addEventListener(\'loadstart\', () => logXhr(\'LOADSTART\'), { once: true })\n          xhr.addEventListener(\'readystatechange\', () => { if (xhr.readyState === 2) logXhr(\'HEADERS\') })\n          xhr.addEventListener(\'load\', () => logXhr(\'LOAD\'))\n          xhr.addEventListener(\'error\', () => logXhr(\'ERROR\'))\n          xhr.addEventListener(\'abort\', () => logXhr(\'ABORT\'))\n          xhr.addEventListener(\'timeout\', () => logXhr(\'TIMEOUT\'))\n        },\n'
        )

        fixed = fixed.replace(
          "      hls.attachMedia(video)\n",
          "      playerDebug(channel, 'HLS_CREATE', { source: safeDebugUrl(proxyStreamUrl(sourceUrl)), userAgent: navigator.userAgent })\n      hls.attachMedia(video)\n"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.MEDIA_ATTACHED, () => {\n        if (!disposed) hls.loadSource(proxyStreamUrl(sourceUrl))\n      })",
          "      hls.on(Hls.Events.MEDIA_ATTACHED, () => {\n        playerDebug(channel, 'MEDIA_ATTACHED')\n        if (!disposed) {\n          playerDebug(channel, 'LOAD_SOURCE', safeDebugUrl(proxyStreamUrl(sourceUrl)))\n          hls.loadSource(proxyStreamUrl(sourceUrl))\n        }\n      })"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.MANIFEST_LOADING, () => {\n        if (!disposed) setDebug((current) => ({ ...current, manifest: 'carregando' }))\n      })",
          "      hls.on(Hls.Events.MANIFEST_LOADING, (_event, data) => {\n        playerDebug(channel, 'MANIFEST_LOADING', data)\n        if (!disposed) setDebug((current) => ({ ...current, manifest: 'carregando' }))\n      })"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.MANIFEST_PARSED, () => {\n        if (disposed) return",
          "      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {\n        playerDebug(channel, 'MANIFEST_PARSED', data)\n        if (disposed) return"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.FRAG_LOADING, () => {\n        if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'carregando' }))\n      })",
          "      hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {\n        playerDebug(channel, 'FRAG_LOADING', data)\n        if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'carregando' }))\n      })"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.FRAG_LOADED, () => {\n        if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'ok' }))\n      })",
          "      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {\n        playerDebug(channel, 'FRAG_LOADED', data)\n        if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'ok' }))\n      })"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.FRAG_PARSED, () => {\n        if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'ok' }))\n      })",
          "      hls.on(Hls.Events.FRAG_PARSED, (_event, data) => {\n        playerDebug(channel, 'FRAG_PARSED', data)\n        if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'ok' }))\n      })"
        )
        fixed = fixed.replace(
          "      hls.on(Hls.Events.ERROR, (_event, data) => {\n        if (disposed) return",
          "      hls.on(Hls.Events.ERROR, (_event, data) => {\n        playerDebug(channel, 'HLS_ERROR', { type: data.type, details: data.details, fatal: data.fatal, response: data.response, reason: data.reason, networkDetails: data.networkDetails ? { status: data.networkDetails.status, responseURL: safeDebugUrl(data.networkDetails.responseURL || ''), readyState: data.networkDetails.readyState } : undefined })\n        if (disposed) return"
        )
        fixed = fixed.replace(
          "    return <div className=\"video-wrapper\">",
          "    if (!debug.lastError) playerDebug(channel, 'PLAYER_RENDER', { mode: debug.mode, manifest: debug.manifest, firstSegment: debug.firstSegment, elapsed: debug.elapsed })\n\n  return <div className=\"video-wrapper\">"
        )
      }

      return fixed === code ? null : { code: fixed, map: null }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
